import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { projectHandedOver } from "../site/handover";
import { currencyDecimals, ensurePurchasingSettings, readNeeds } from "./orders";
import { processStockLevels } from "../inventory/stock-levels";
import { lockSuppliers } from "./payables";
import { closeSettledBlockers, raiseLateBlockers } from "./purchasing-blockers";

type Db = Pick<PoolClient, "query">;

/**
 * The daily chase, run inside one workspace's tenant transaction.
 * - Late orders are a reminder engine kind (purchase.order_late: the buyer 1, 7 and 14 days after); here a late
 *   line raises its blocker on the work that needs it, and goods in close it.
 * - Late to order: a project still needs something that should have been ordered by now to arrive when
 *   its work starts. The people who buy hear once per project, then every week while it stays so.
 * Keys make each reminder once only; a missed day catches up.
 */
export async function processPurchasingDeadlines(db: Db, workspaceId: string) {
  const today = (await db.query<{ today: string; locale: string }>(
    `SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today, coalesce(default_locale, 'en') AS locale FROM workspaces WHERE id = $1`,
    [workspaceId])).rows[0];
  if (!today) return { sent: 0 };
  // A late line holds up the work that needs it (a blocker the buyer owns, the PM told); goods in close it.
  const blocked = await raiseLateBlockers(db, workspaceId, today.today);
  await closeSettledBlockers(db, workspaceId, {}, null);
  // Free stock at or below its reorder point tells the storekeepers and buyers.
  const low = await processStockLevels(db, workspaceId);
  return { sent: blocked + low + await chaseOrdering(db, workspaceId, today.today, today.locale) };
}

async function chaseOrdering(db: Db, workspaceId: string, today: string, locale: string) {
  const settings = await ensurePurchasingSettings(db, workspaceId);
  // A project on hold is held: nobody is chased to order for it.
  const late = (await readNeeds(db, workspaceId, settings.requireMaterialSignoff))
    .filter((need) => !need.blocked && need.projectStatus === "active" && need.orderBy && need.orderBy < today && need.remaining !== null && Dec.of(need.remaining).cmp(0) > 0);
  if (!late.length) return 0;
  const buyers = (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = effective_role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'purchasing.manage'
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows.map((row) => row.userId);
  const day = (value: string) => { try { return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${value}T00:00:00Z`)); } catch { return value; } };
  let sent = 0;
  for (const projectId of new Set(late.map((need) => need.projectId))) {
    const mine = late.filter((need) => need.projectId === projectId).sort((a, b) => a.neededBy!.localeCompare(b.neededBy!));
    const since = mine.map((need) => need.orderBy!).sort()[0];
    const week = Math.floor((Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000) - 1) / 7);
    const items = mine.slice(0, 5).map((need) => `${need.title} ${Dec.of(need.remaining!).toString()} ${need.unit}`.trim() + ` (needed ${day(need.neededBy!)})`).join(", ");
    const note = `${items}${mine.length > 5 ? ` and ${mine.length - 5} more` : ""}.`;
    const project = `${mine[0].projectReference} · ${mine[0].projectName}`;
    for (const userId of buyers) {
      const message = { workspaceId, recipientUserId: userId, code: "purchasing.order_late", eventType: "purchasing.order_late", variables: { project, note }, deepLink: "/workspace/purchasing" };
      const key = `purchasing.order_late:${projectId}:${since}:${week}:${userId}`;
      const result = await notifyUserInApp(db, { ...message, idempotencyKey: key });
      await queueUserEmail(db, { ...message, idempotencyKey: `${key}:email` });
      if (result.queued) sent += 1;
    }
  }
  return sent;
}

/**
 * Retention held until handover is released once the client accepted the project's handover (the same
 * check as the stage's "The client accepted the handover"). It's released here, in the daily run, rather
 * than as the handover is accepted: the run also catches invoices approved after the handover and a last
 * area accepted later, a missed day catches up, and accepting a handover never waits on or fails for
 * suppliers' payables. What's released is recorded per invoice and project under the suppliers' locks, so
 * running again releases nothing more. The people who pay suppliers hear once per supplier.
 */
export async function processRetentionReleases(db: Db, workspaceId: string) {
  const held = await readRetentionHeld(db, workspaceId);
  if (!held.length) return { released: 0, sent: 0 };
  const handed = new Map<string, boolean>();
  for (const row of held)
    if (!handed.has(row.projectId)) handed.set(row.projectId, await projectHandedOver(db, workspaceId, { id: row.projectId, caseId: row.caseId }));
  const due = held.filter((row) => handed.get(row.projectId));
  if (!due.length) return { released: 0, sent: 0 };
  await lockSuppliers(db, workspaceId, due.map((row) => row.vendorId));
  // Read again under the locks: what someone released meanwhile isn't released twice.
  const still = new Map((await readRetentionHeld(db, workspaceId)).map((row) => [row.id, row]));
  const released: Array<(typeof due)[number] & { releaseId: string }> = [];
  for (const row of due) {
    const current = still.get(row.id);
    if (!current) continue;
    const releaseId = randomUUID();
    await db.query(`INSERT INTO supplier_retention_releases (id, workspace_id, retention_id, invoice_id, amount, automatic) VALUES ($1, $2, $3, $4, $5, true)`,
      [releaseId, workspaceId, current.id, current.invoiceId, current.held]);
    await db.query(`UPDATE supplier_invoices SET version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, current.invoiceId]);
    await recordAudit(db, { workspaceId, actorUserId: null, action: "supplier_invoice.retention_released", entityType: "supplier_invoice", entityId: current.invoiceId,
      after: { projectId: current.projectId, amount: current.held, automatic: true }, source: "internal" });
    released.push({ ...current, releaseId });
  }
  if (!released.length) return { released: 0, sent: 0 };
  const payers = await readPayers(db, workspaceId);
  let sent = 0;
  for (const vendorId of new Set(released.map((row) => row.vendorId))) {
    const mine = released.filter((row) => row.vendorId === vendorId);
    const key = createHash("sha256").update(mine.map((row) => row.releaseId).sort().join(",")).digest("hex").slice(0, 24);
    const note = mine.map((row) => `${row.number}: ${row.currency} ${Dec.of(row.held).toFixed(currencyDecimals(row.currency))} (${row.projectReference} handed over)`).join("; ").slice(0, 480);
    const totals = new Map<string, Dec>();
    for (const row of mine) totals.set(row.currency, (totals.get(row.currency) ?? Dec.ZERO).add(row.held));
    const amount = [...totals].map(([currency, total]) => `${currency} ${total.toFixed(currencyDecimals(currency))}`).join(" + ");
    for (const userId of payers) {
      const result = await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "payables.retention_released", eventType: "payables.retention_released",
        variables: { supplier: mine[0].supplierName, invoice: [...new Set(mine.map((row) => row.number))].join(", ").slice(0, 200), amount, actor: "", note },
        deepLink: `/workspace/finance/suppliers/${vendorId}`, idempotencyKey: `payables.retention_released:${vendorId}:${key}:${userId}` });
      if (result.queued) sent += 1;
    }
  }
  return { released: released.length, sent };
}

/** Retention still held on approved invoices for a project, per invoice and project. */
async function readRetentionHeld(db: Db, workspaceId: string) {
  return (await db.query<{ id: string; invoiceId: string; number: string; vendorId: string; supplierName: string; currency: string; projectId: string; caseId: string;
    projectReference: string; held: string }>(
    `SELECT retention.id, retention.invoice_id AS "invoiceId", bill.number, bill.vendor_id AS "vendorId", vendor.display_name AS "supplierName", bill.currency,
            retention.project_id AS "projectId", project.case_id AS "caseId", project.reference AS "projectReference",
            (retention.amount - coalesce(freed.amount, 0))::numeric(18, 4)::text AS held
       FROM supplier_invoice_retentions retention
       JOIN supplier_invoices bill ON bill.workspace_id = retention.workspace_id AND bill.id = retention.invoice_id AND bill.status = 'approved'
       JOIN workspace_vendors vendor ON vendor.workspace_id = bill.workspace_id AND vendor.id = bill.vendor_id
       JOIN delivery_projects project ON project.workspace_id = retention.workspace_id AND project.id = retention.project_id
       LEFT JOIN LATERAL (SELECT sum(amount) AS amount FROM supplier_retention_releases
                           WHERE workspace_id = retention.workspace_id AND invoice_id = retention.invoice_id AND retention_id = retention.id) freed ON true
      WHERE retention.workspace_id = $1 AND retention.amount > coalesce(freed.amount, 0)
      ORDER BY vendor.display_name, bill.number, project.reference`, [workspaceId])).rows;
}

/** The people who pay suppliers. */
async function readPayers(db: Db, workspaceId: string) {
  return (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = effective_role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'payables.manage'
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows.map((row) => row.userId);
}
