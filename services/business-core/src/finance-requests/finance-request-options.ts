import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { readTaxNumberRule } from "../purchasing/tax-registration";
import { email, oneOf, optionalUuid, text, uuid } from "./finance-requests";
import { entityTax, MANAGE, paymentStages, quoteLines, RAISE, type Ctx } from "./finance-request-commands";
import { readPaymentMethods, readSettings } from "./finance-requests.store";

type Db = PoolClient;

async function needRaise(ctx: Ctx) {
  if (!(await ctx.can(RAISE)) && !(await ctx.can(MANAGE))) throw new ForbiddenException("You don't have access to finance requests.");
}

/**
 * What the request form starts from: the client, deal and project it was raised from (filled, so nobody types
 * them), the deal's payment stages and quotes, the companies with their tax rates, the payment methods, the
 * team (who authorised a payable) and the region's name for a tax number.
 */
export async function readContext(db: Db, ctx: Ctx, input: { partyId?: unknown; opportunityId?: unknown; projectId?: unknown }) {
  await needRaise(ctx);
  const workspaceId = ctx.workspaceId;
  let projectId = optionalUuid(input.projectId, "Project"), opportunityId = optionalUuid(input.opportunityId, "Deal"), partyId = optionalUuid(input.partyId, "Client");
  let caseId: string | null = null;
  let project: { id: string; reference: string | null; name: string } | null = null;
  if (projectId) {
    const row = (await db.query<{ id: string; reference: string | null; name: string; caseId: string; opportunityId: string }>(
      `SELECT project.id, project.reference, project.name, project.case_id AS "caseId", pre_case.opportunity_id AS "opportunityId" FROM delivery_projects project
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
        WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, projectId])).rows[0];
    if (!row) throw new NotFoundException("Project not found.");
    project = { id: row.id, reference: row.reference, name: row.name };
    caseId = row.caseId; opportunityId = row.opportunityId; projectId = row.id;
  }
  let deal: { id: string; reference: string; title: string; legalEntityId: string | null; salespersonName: string | null; currency: string | null } | null = null;
  if (opportunityId) {
    const row = (await db.query<{ id: string; reference: string; title: string; partyId: string; legalEntityId: string | null; salespersonName: string | null; currency: string | null }>(
      `SELECT opportunity.id, opportunity.reference, opportunity.title, opportunity.party_id AS "partyId", opportunity.legal_entity_id AS "legalEntityId",
              coalesce(nullif(btrim(person.display_name), ''), person.primary_email) AS "salespersonName", opportunity.currency_code AS currency
         FROM crm_opportunities opportunity
         LEFT JOIN workspace_memberships owner ON owner.id = opportunity.owner_membership_id
         LEFT JOIN users person ON person.id = owner.user_id
        WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`, [workspaceId, opportunityId])).rows[0];
    if (!row) throw new NotFoundException("Deal not found.");
    deal = { id: row.id, reference: row.reference, title: row.title, legalEntityId: row.legalEntityId, salespersonName: row.salespersonName, currency: row.currency };
    partyId = row.partyId;
    caseId ??= (await db.query<{ id: string }>(`SELECT id FROM pre_project_cases WHERE workspace_id = $1 AND opportunity_id = $2 ORDER BY created_at LIMIT 1`, [workspaceId, opportunityId])).rows[0]?.id ?? null;
  }
  const client = partyId ? (await clientOptions(db, workspaceId, { id: partyId }))[0] ?? null : null;
  if (partyId && !client) throw new NotFoundException("Client not found.");
  const entities = (await db.query<{ id: string; name: string }>(
    `SELECT id, coalesce(nullif(display_name, ''), registered_name) AS name FROM legal_entities WHERE workspace_id = $1 AND status = 'active' AND archived_at IS NULL ORDER BY created_at`,
    [workspaceId])).rows;
  const companies = [];
  for (const entity of entities) companies.push({ ...entity, ...(await entityTax(db, workspaceId, entity.id)) });
  const quotes = caseId ? (await db.query<{ id: string; number: number; title: string; status: string; currency: string }>(
    `SELECT id, number, title, status, currency FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND status IN ('issued', 'accepted') ORDER BY number`,
    [workspaceId, caseId])).rows : [];
  return {
    client, deal, project, caseId,
    stages: caseId ? await paymentStages(db, workspaceId, caseId) : [],
    quotes: quotes.map((quote) => ({ id: quote.id, label: `Q-${quote.number} · ${quote.title}`, status: quote.status, currency: quote.currency.trim() })),
    companies, defaultCompanyId: deal?.legalEntityId ?? (companies.length === 1 ? companies[0].id : null),
    methods: await readPaymentMethods(db, workspaceId),
    people: (await db.query<{ id: string; name: string }>(
      `SELECT membership.user_id AS id, coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS name
         FROM workspace_memberships membership JOIN users account ON account.id = membership.user_id
        WHERE membership.workspace_id = $1 AND membership.status = 'active' ORDER BY lower(coalesce(nullif(btrim(account.display_name), ''), account.primary_email)) LIMIT 500`,
      [workspaceId])).rows,
    currency: deal?.currency?.trim() || (await db.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].currency.trim(),
    taxNumberLabel: (await readTaxNumberRule(db, workspaceId)).label,
    me: ctx.userId,
  };
}

/** Clients to pick from (never typed): name, kind (a company needs its tax number) and primary email. */
async function clientOptions(db: Db, workspaceId: string, filter: { id?: string; search?: string }) {
  const values: unknown[] = [workspaceId];
  let where = "party.workspace_id = $1 AND party.status = 'active'";
  if (filter.id) { values.push(filter.id); where += ` AND party.id = $${values.length}`; }
  if (filter.search) { values.push(`%${filter.search.toLowerCase()}%`); where += ` AND party.normalized_name LIKE $${values.length}`; }
  return (await db.query<{ id: string; name: string; type: string; email: string | null }>(
    `SELECT party.id, party.display_name AS name, party.type::text AS type,
            (SELECT point.raw_value FROM crm_contact_points point WHERE point.workspace_id = party.workspace_id AND point.party_id = party.id AND point.type = 'email'
               AND point.status = 'active' ORDER BY point.is_primary DESC, point.created_at LIMIT 1) AS email
       FROM crm_parties party WHERE ${where} ORDER BY lower(party.display_name) LIMIT 20`, values)).rows;
}

const OPTION_KINDS = ["clients", "suppliers", "projects", "deals"] as const;

/** Search what a request links to: clients, suppliers (with their tax number), running projects, or a client's deals. */
export async function searchOptions(db: Db, ctx: Ctx, input: { kind?: unknown; search?: unknown; partyId?: unknown }) {
  await needRaise(ctx);
  const kind = oneOf(input.kind, OPTION_KINDS, "Unknown list.");
  const search = text(input.search, 120, "Search").replace(/[%_\\]/g, "");
  const like = `%${search.toLowerCase()}%`;
  if (kind === "clients") return clientOptions(db, ctx.workspaceId, { search });
  if (kind === "suppliers") return (await db.query<{ id: string; name: string; taxNumber: string | null; currency: string | null }>(
    `SELECT id, display_name AS name, tax_registration_number AS "taxNumber", default_currency AS currency FROM workspace_vendors
      WHERE workspace_id = $1 AND archived_at IS NULL AND status <> 'archived' AND lower(display_name || ' ' || coalesce(legal_name, '')) LIKE $2
      ORDER BY lower(display_name) LIMIT 20`, [ctx.workspaceId, like])).rows.map((row) => ({ ...row, currency: row.currency?.trim() ?? null }));
  if (kind === "projects") return (await db.query<{ id: string; name: string; reference: string | null }>(
    `SELECT id, name, reference FROM delivery_projects WHERE workspace_id = $1 AND status IN ('active', 'on_hold')
       AND lower(coalesce(reference, '') || ' ' || name) LIKE $2 ORDER BY reference DESC NULLS LAST LIMIT 20`, [ctx.workspaceId, like])).rows;
  const partyId = uuid(input.partyId, "Client");
  return (await db.query<{ id: string; reference: string; title: string; status: string }>(
    `SELECT id, reference, title, status::text AS status FROM crm_opportunities WHERE workspace_id = $1 AND party_id = $2 AND status IN ('open', 'won')
      ORDER BY created_at DESC LIMIT 20`, [ctx.workspaceId, partyId])).rows;
}

/** A deal's quote as invoice lines, before tax. */
export async function readQuoteLines(db: Db, ctx: Ctx, input: { opportunityId?: unknown; quoteId?: unknown }) {
  await needRaise(ctx);
  const opportunityId = uuid(input.opportunityId, "Deal");
  const caseId = (await db.query<{ id: string }>(`SELECT id FROM pre_project_cases WHERE workspace_id = $1 AND opportunity_id = $2 ORDER BY created_at LIMIT 1`,
    [ctx.workspaceId, opportunityId])).rows[0]?.id;
  const quoteId = text(input.quoteId, 80, "Quote");
  if (!caseId || !quoteId || !(await db.query(`SELECT 1 FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [ctx.workspaceId, caseId, quoteId])).rowCount)
    throw new NotFoundException("Quote not found.");
  return quoteLines(db, ctx.workspaceId, caseId, quoteId);
}

// ---------------------------------------------------------------- settings (Finance › Requests › Settings)

export async function readRequestSettings(db: Db, ctx: Ctx) {
  await needRaise(ctx);
  return { settings: await readSettings(db, ctx.workspaceId), methods: await readPaymentMethods(db, ctx.workspaceId), canManage: await ctx.can(MANAGE) };
}

const SETTINGS_ACTIONS = ["save_settings", "save_method", "archive_method"] as const;

/**
 * Finance's settings, version-checked and audited: the finance inbox (empty: no email), automatic stage invoice
 * requests, and the payment methods (the refund methods a refund request picks from) with their refund guidance,
 * whether a refund needs bank details and how many days a refund usually takes (empty: no date shown). Nothing here
 * is a constant in code.
 */
export async function saveRequestSettings(db: Db, ctx: Ctx, body: Record<string, unknown>) {
  if (!(await ctx.can(MANAGE))) throw new ForbiddenException("Only Finance changes these settings.");
  const action = oneOf(body.action, SETTINGS_ACTIONS, "Unknown action.");
  const workspaceId = ctx.workspaceId;
  if (action === "save_settings") {
    const current = await readSettings(db, workspaceId);
    if (body.version !== current.version) throw new ConflictException("These settings changed elsewhere. Reload to see them.");
    const inbox = email(body.financeInbox, "Finance inbox") || null;
    const stage = body.stageInvoiceRequests === true;
    await db.query(
      `INSERT INTO finance_request_settings (workspace_id, finance_inbox, stage_invoice_requests, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id) DO UPDATE SET finance_inbox = $2, stage_invoice_requests = $3, updated_by = $4, updated_at = now(),
         version = finance_request_settings.version + 1`, [workspaceId, inbox, stage, ctx.userId]);
    await recordAudit(db, { workspaceId, actorUserId: ctx.userId, action: "finance_request.settings_changed", entityType: "finance_request_settings", entityId: workspaceId,
      before: current, after: { financeInbox: inbox, stageInvoiceRequests: stage } });
    return;
  }
  const id = uuid(body.id, "Payment method");
  const existing = (await db.query<{ version: number; archived: boolean }>(`SELECT version, archived_at IS NOT NULL AS archived FROM finance_payment_methods WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
    [workspaceId, id])).rows[0];
  if (existing && body.version !== existing.version) throw new ConflictException("This payment method changed elsewhere. Reload to see it.");
  if (action === "archive_method") {
    if (!existing) throw new NotFoundException("Payment method not found.");
    await db.query(`UPDATE finance_payment_methods SET archived_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
    await recordAudit(db, { workspaceId, actorUserId: ctx.userId, action: "finance_request.method_archived", entityType: "finance_payment_method", entityId: id });
    return;
  }
  const label = text(body.label, 80, "Name");
  if (!label) throw new BadRequestException("Name the payment method.");
  const guidance = text(body.refundGuidance, 1000, "Refund guidance");
  const bank = body.needsBankDetails === true;
  const days = refundDays(body.refundDays);
  const taken = (await db.query(`SELECT 1 FROM finance_payment_methods WHERE workspace_id = $1 AND id <> $2 AND archived_at IS NULL AND lower(btrim(label)) = lower($3)`,
    [workspaceId, id, label])).rowCount;
  if (taken) throw new ConflictException("A payment method with this name exists.");
  if (existing) await db.query(`UPDATE finance_payment_methods SET label = $3, refund_guidance = $4, needs_bank_details = $5, refund_days = $6, version = version + 1
    WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, label, guidance, bank, days]);
  else await db.query(`INSERT INTO finance_payment_methods (id, workspace_id, label, refund_guidance, needs_bank_details, refund_days, position)
    SELECT $2, $1, $3, $4, $5, $6, coalesce(max(position), 0) + 1 FROM finance_payment_methods WHERE workspace_id = $1`, [workspaceId, id, label, guidance, bank, days]);
  await recordAudit(db, { workspaceId, actorUserId: ctx.userId, action: "finance_request.method_saved", entityType: "finance_payment_method", entityId: id,
    after: { label, refundGuidance: guidance, needsBankDetails: bank, refundDays: days, created: !existing } });
}

/** How many days a refund paid back this way usually takes: a whole number from 1 to 365, or empty (no date shown). */
export function refundDays(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const days = typeof value === "number" ? value : typeof value === "string" && /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new BadRequestException("Refund days must be a whole number from 1 to 365.");
  return days;
}

