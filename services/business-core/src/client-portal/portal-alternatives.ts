import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { lineTotal, priceImpact } from "../design/design-ledger.domain";
import { readLedger } from "../design/design-ledger.store";
import { caseTeam, caseTitle, tellStaff } from "./portal-notices";
import { grantFor, type DecisionContext } from "./portal-decisions";

type Db = Pick<PoolClient, "query">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * R2: when the client declines a material or design choice, up to three alternatives are offered from the firm's
 * catalogue: the same category, in stock first, then within the declined choice's budget, then items the firm used on
 * past jobs, then the nearest price. Only the selling price is read (never a cost or a supplier). The offer is kept
 * as it was made; the client's pick becomes a new version of the choice, confirmed by them in the portal (E5-2).
 */
export type Alternative = { id: string; title: string; unit: string; unitPrice: string | null; currency: string | null; lineTotal: string | null; inStock: boolean;
  inBudget: boolean; source: "catalog" | "past_job" };

type Candidate = { itemId: string; title: string; unit: string; price: string | null; onHand: string; pastJobs: number };

/** Ranks candidates (pure): in stock, in budget, used before, then the price nearest the declined one. */
export function rankAlternatives(candidates: Candidate[], declined: { quantity: string | null; total: Dec | null }, limit = 3) {
  const quantity = declined.quantity ?? "1";
  return candidates.map((item) => {
    const total = item.price ? Dec.of(item.price).mul(quantity).round(2) : null;
    const inStock = Dec.of(item.onHand).cmp(quantity) >= 0;
    const inBudget = Boolean(total && declined.total && total.cmp(declined.total) <= 0);
    const distance = total && declined.total ? total.sub(declined.total).abs() : null;
    return { ...item, total, inStock, inBudget, distance };
  }).sort((a, b) => Number(b.inStock) - Number(a.inStock) || Number(b.inBudget) - Number(a.inBudget) || Number(b.pastJobs > 0) - Number(a.pastJobs > 0)
    || (a.distance && b.distance ? a.distance.cmp(b.distance) : a.distance ? -1 : b.distance ? 1 : 0) || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/** Makes (once) the offer for a declined version; nothing when its choice has no catalogue item or category. */
export async function offerAlternatives(db: Db, workspaceId: string, caseId: string, entryId: string, versionId: string) {
  if ((await db.query(`SELECT 1 FROM design_ledger_alternatives WHERE workspace_id = $1 AND declined_version_id = $2 LIMIT 1`, [workspaceId, versionId])).rowCount) return;
  const declined = (await db.query<{ catalogItemId: string | null; categoryId: string | null; quantity: string | null; unitPrice: string | null; currency: string | null }>(
    `SELECT version.catalog_item_id AS "catalogItemId", item.category_id AS "categoryId", version.quantity::text AS quantity, version.unit_price::text AS "unitPrice",
            COALESCE(version.currency, NULLIF(opportunity.currency_code, ''), workspace.default_currency) AS currency
       FROM design_ledger_versions version
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = version.workspace_id AND pre_case.id = version.case_id
       JOIN workspaces workspace ON workspace.id = version.workspace_id
       LEFT JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN catalog_items item ON item.workspace_id = version.workspace_id AND item.id = version.catalog_item_id
      WHERE version.workspace_id = $1 AND version.case_id = $2 AND version.entry_id = $3 AND version.id = $4 AND version.status = 'declined'`,
    [workspaceId, caseId, entryId, versionId])).rows[0];
  if (!declined?.categoryId || !declined.currency) return;
  const candidates = (await db.query<Candidate>(
    `SELECT item.id AS "itemId", item.name AS title, item.unit_code AS unit,
            (SELECT round(COALESCE(entry.price, entry.rate, entry.cost * (1 + COALESCE(entry.markup_percent, 0) / 100)), 2)::text
               FROM price_entries entry JOIN price_books book ON book.workspace_id = entry.workspace_id AND book.id = entry.price_book_id
              WHERE entry.workspace_id = item.workspace_id AND entry.item_id = item.id AND entry.variant_id IS NULL AND entry.status = 'active'
                AND book.status = 'active' AND book.currency = $4 AND book.effective_from <= current_date AND (book.effective_to IS NULL OR book.effective_to >= current_date)
              ORDER BY book.effective_from DESC LIMIT 1) AS price,
            COALESCE((SELECT sum(balance.on_hand) FROM stock_items stock JOIN stock_balances balance ON balance.workspace_id = stock.workspace_id AND balance.item_id = stock.id AND balance.project_id IS NULL
                       WHERE stock.workspace_id = item.workspace_id AND stock.catalog_item_id = item.id AND stock.active), 0)::text AS "onHand",
            (SELECT count(DISTINCT used.case_id)::int FROM design_ledger_versions used WHERE used.workspace_id = item.workspace_id AND used.catalog_item_id = item.id
               AND used.status = 'confirmed' AND used.case_id <> $5) AS "pastJobs"
       FROM catalog_items item
      WHERE item.workspace_id = $1 AND item.category_id = $2 AND item.status = 'active' AND item.id <> $3
        -- never one the client already turned down for this choice
        AND NOT EXISTS (SELECT 1 FROM design_ledger_versions other WHERE other.workspace_id = item.workspace_id AND other.entry_id = $6 AND other.catalog_item_id = item.id AND other.status = 'declined')
      LIMIT 200`, [workspaceId, declined.categoryId, declined.catalogItemId, declined.currency, caseId, entryId])).rows;
  const ranked = rankAlternatives(candidates, { quantity: declined.quantity, total: lineTotal(declined.quantity, declined.unitPrice) });
  for (const [index, item] of ranked.entries())
    await db.query(
      `INSERT INTO design_ledger_alternatives (id, workspace_id, case_id, entry_id, declined_version_id, rank, catalog_item_id, source, title, unit, unit_price, currency, line_total, in_stock, in_budget)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::numeric, $12, $13::numeric, $14, $15) ON CONFLICT DO NOTHING`,
      [randomUUID(), workspaceId, caseId, entryId, versionId, index + 1, item.itemId, item.pastJobs > 0 ? "past_job" : "catalog", item.title, item.unit, item.price,
        item.price ? declined.currency : null, item.total?.toFixed(2) ?? null, item.inStock, item.inBudget]);
}

/** The open offers on a case, by declined version (an offer stays open until one is chosen or the choice moves on). */
export async function readAlternatives(db: Db, workspaceId: string, caseId: string) {
  const rows = (await db.query<Alternative & { versionId: string; chosen: boolean }>(
    `SELECT id, declined_version_id AS "versionId", title, unit, unit_price::text AS "unitPrice", currency, line_total::text AS "lineTotal", in_stock AS "inStock",
            in_budget AS "inBudget", source, chosen_at IS NOT NULL AS chosen
       FROM design_ledger_alternatives WHERE workspace_id = $1 AND case_id = $2 ORDER BY declined_version_id, rank`, [workspaceId, caseId])).rows;
  const offers = new Map<string, Alternative[]>();
  for (const { versionId, chosen, ...row } of rows) if (!chosen) offers.set(versionId, [...(offers.get(versionId) ?? []), row]);
  return offers;
}

/** The client picks an offered alternative: a new version of the choice, confirmed by them, written to the ledger. */
export async function chooseAlternative(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "decisions");
  if (grant.role !== "approver") throw new ForbiddenException("Only the project's decision-maker can decide this. You can still read it.");
  if (!["active", "released"].includes(row.caseStatus)) throw new ConflictException("This project isn't taking decisions any more.");
  const alternativeId = typeof body.alternativeId === "string" && UUID.test(body.alternativeId) ? body.alternativeId : null;
  if (!alternativeId) throw new BadRequestException("Choose an alternative.");
  const offer = (await ctx.db.query<{ entryId: string; versionId: string; catalogItemId: string; title: string; unit: string; unitPrice: string | null; currency: string | null; chosenVersionId: string | null;
    chosenGrant: string | null }>(
    `SELECT entry_id AS "entryId", declined_version_id AS "versionId", catalog_item_id AS "catalogItemId", title, unit, unit_price::text AS "unitPrice", currency,
            chosen_version_id AS "chosenVersionId", chosen_by_grant_id AS "chosenGrant"
       FROM design_ledger_alternatives WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [ctx.workspaceId, row.caseId, alternativeId])).rows[0];
  if (!offer) throw new NotFoundException("This alternative isn't offered to you.");
  if (offer.chosenVersionId) {
    if (offer.chosenGrant === grant.id) return { ok: true, versionId: offer.chosenVersionId, entity: { type: "design_ledger_entry", id: offer.entryId }, audit: { alternativeId, replayed: true } };
    throw new ConflictException("Someone on your side already chose for this. Reload to see it.");
  }
  const entry = (await ctx.db.query<{ currentNumber: number; archivedAt: Date | null; version: number }>(
    `SELECT current_number AS "currentNumber", archived_at AS "archivedAt", version FROM design_ledger_entries WHERE workspace_id = $1 AND case_id = $2 AND id = $3 FOR UPDATE`,
    [ctx.workspaceId, row.caseId, offer.entryId])).rows[0];
  if (!entry || entry.archivedAt) throw new NotFoundException("This choice isn't on the list any more.");
  const declined = (await ctx.db.query<{ number: number; quantity: string | null; unitPrice: string | null; specification: string; title: string }>(
    `SELECT number, quantity::text AS quantity, unit_price::text AS "unitPrice", specification, title FROM design_ledger_versions WHERE workspace_id = $1 AND id = $2`,
    [ctx.workspaceId, offer.versionId])).rows[0];
  // The client chooses on the version they declined; if the team has moved the choice on since, the offer is closed.
  if (!declined || declined.number !== entry.currentNumber) throw new ConflictException("This choice changed since. Reload to see the latest.");
  const ledger = await readLedger(ctx.db, ctx.workspaceId, row.caseId);
  const versionId = randomUUID();
  const number = entry.currentNumber + 1;
  const next = { quantity: declined.quantity, unitPrice: offer.unitPrice };
  await ctx.db.query(
    `INSERT INTO design_ledger_versions (id, workspace_id, case_id, entry_id, number, title, specification, catalog_item_id, supplier, quantity, unit, unit_price, currency,
                                         price_impact, time_impact_days, source, said_at, evidence_note, note, after_lock, status, confirmed_at, confirmation_method, confirmed_by_name,
                                         confirmed_by_grant_id, recorded_by, recorded_by_grant_id)
     VALUES ($1, $2, $3, $4, $5, $6, '', $7, '', $8::numeric, $9, $10::numeric, $11, $12::numeric, 0, 'portal', clock_timestamp(), $13, '', $14, 'confirmed', clock_timestamp(),
             'portal', $15, $16, NULL, $16)`,
    [versionId, ctx.workspaceId, row.caseId, offer.entryId, number, offer.title, offer.catalogItemId, declined.quantity, offer.unit, offer.unitPrice, offer.unitPrice ? offer.currency : null,
      priceImpact({ quantity: declined.quantity, unitPrice: declined.unitPrice }, next), `Alternative chosen in the portal instead of ${declined.title}`, Boolean(ledger.lock), grant.name, grant.id]);
  await ctx.db.query(`UPDATE design_ledger_entries SET current_number = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [ctx.workspaceId, offer.entryId, number]);
  await ctx.db.query(`UPDATE design_ledger_alternatives SET chosen_at = now(), chosen_by_grant_id = $3, chosen_version_id = $4 WHERE workspace_id = $1 AND id = $2`,
    [ctx.workspaceId, alternativeId, grant.id, versionId]);
  const facts = await caseTitle(ctx.db, ctx.workspaceId, row.caseId);
  await tellStaff(ctx.db, { workspaceId: ctx.workspaceId, recipients: await caseTeam(ctx.db, ctx.workspaceId, row.caseId, ["design"]), code: "ledger.alternative_chosen",
    variables: { clientName: facts.clientName, title: offer.title, previous: declined.title }, deepLink: `/workspace/pre-projects/cases/${row.caseId}/designs?stage=ledger`, key: versionId });
  return { ok: true, versionId, entity: { type: "design_ledger_entry", id: offer.entryId }, audit: { alternativeId, versionId, catalogItemId: offer.catalogItemId, afterLock: Boolean(ledger.lock) } };
}
