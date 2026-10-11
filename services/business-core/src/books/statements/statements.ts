import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { recordAudit } from "../../audit/record-audit";
import { notifyUserInApp, queueUserEmail } from "../../notifications/default-templates";
import { isDay } from "../reports/report-math";
import { BOOKS, checkVersion, firstTime, holders, personName, requireAny, uuid, versionOf, type BooksCtx, type Db } from "../settings/books-common";
import { mergeProfitAndLoss } from "./statement-builder";
import {
  FINANCIAL_STATEMENT_SOURCES, STATEMENT_BASES, STATEMENT_COMPARISONS,
  type CashFlowStatement, type FinancialStatementSource, type ProfitAndLossStatement, type StatementBasis, type StatementComparison,
  type StatementSourceCapabilities, type StatementSourceOption, type StatementSourceSettings,
} from "./statement-contract";
import { comparisonPeriod, fiscalYearOf, type Period } from "./statement-period";
import type { StatementSourceContext, StatementSourceRegistry } from "./statement-source";

/**
 * Company statements (plan §6.21b): the P&L and the cash flow of one company, read through the source its books live
 * in (`statementSource(context)`), and Settings › Ledger › Statements, where that source is chosen.
 */

/** A company statements can be read for, with what its figures are formatted and dated by (region pack, never constants). */
export type StatementCompany = {
  id: string; code: string; name: string; currency: string; locale: string; timeZone: string; countryCode: string; today: string;
  fiscalYearStartMonth: number; ledgerOn: boolean;
};

export type StatementSourceInfo = { source: FinancialStatementSource; label: string | null; chosen: boolean; capabilities: StatementSourceCapabilities };

export type StatementResponse<S> = {
  statement: S;
  company: StatementCompany;
  companies: StatementCompany[];
  source: StatementSourceInfo;
  period: Period;
  comparison: Period | null;
  compare: StatementComparison;
};

export const NO_CAPABILITIES: StatementSourceCapabilities = { accrual: false, cash: false, drillDown: false, cashAccounts: false, forecast: false };
export const SOURCE_NAMES: Record<FinancialStatementSource, string> = {
  ledger: "Wodana Ledger", zoho_books: "Zoho Books", quickbooks: "QuickBooks", operational_cash: "Operational cash",
};

const COMPANY_COLUMNS = `entity.id, entity.code, entity.display_name AS name, coalesce(settings.functional_currency, entity.base_currency) AS currency,
  coalesce(nullif(btrim(entity.locale), ''), 'en') AS locale, entity.timezone AS "timeZone", entity.country_code AS "countryCode",
  (now() AT TIME ZONE entity.timezone)::date::text AS today,
  coalesce(settings.fiscal_year_start_month::int,
    (SELECT CASE WHEN profile.configuration->>'fiscalYearStartMonth' ~ '^([1-9]|1[0-2])$' THEN (profile.configuration->>'fiscalYearStartMonth')::int END
       FROM tenant_setup_profiles profile WHERE profile.kind = 'region' AND profile.code = upper(entity.country_code) ORDER BY profile.version DESC LIMIT 1),
    1) AS "fiscalYearStartMonth",
  coalesce(settings.enabled, false) AS "ledgerOn"`;

/** Every active company of the workspace, Ledger or not. */
export async function listStatementCompanies(db: Db, workspaceId: string): Promise<StatementCompany[]> {
  return (await db.query<StatementCompany>(
    `SELECT ${COMPANY_COLUMNS}
       FROM legal_entities entity
       LEFT JOIN books_settings settings ON settings.workspace_id = entity.workspace_id AND settings.legal_entity_id = entity.id
      WHERE entity.workspace_id = $1 AND entity.archived_at IS NULL
      ORDER BY coalesce(settings.enabled, false) DESC, entity.display_name, entity.code`, [workspaceId])).rows;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (query: Record<string, unknown>, key: string) => (typeof query[key] === "string" ? (query[key] as string).trim() : "");

/** The company a statement reads: `entity`, else the first (the Ledger's first). */
export async function resolveCompany(db: Db, workspaceId: string, query: Record<string, unknown>) {
  const companies = await listStatementCompanies(db, workspaceId);
  const requested = text(query, "entity");
  if (requested && !UUID.test(requested)) throw new BadRequestException("Choose a company");
  const company = requested ? companies.find((row) => row.id === requested) : companies[0];
  if (!company) throw new NotFoundException(requested ? "Company not found" : "Add a company first");
  return { company, companies };
}

/** The period, basis and comparison asked for; the period defaults to the company's financial year to date. */
export function parseStatementQuery(company: StatementCompany, query: Record<string, unknown>) {
  for (const key of ["from", "to"]) if (text(query, key) && !isDay(text(query, key))) throw new BadRequestException("Dates are calendar days (YYYY-MM-DD)");
  const to = text(query, "to") || company.today;
  const from = text(query, "from") || fiscalYearOf(to, company.fiscalYearStartMonth).from;
  if (from > to) throw new BadRequestException("The period ends before it starts");
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 5 * 366 * 86_400_000) throw new BadRequestException("Choose a period of five years or less");
  const basis = (text(query, "basis") || "accrual") as StatementBasis;
  if (!STATEMENT_BASES.includes(basis)) throw new BadRequestException("Choose accrual or cash basis");
  const compare = (text(query, "compare") || "none") as StatementComparison;
  if (!STATEMENT_COMPARISONS.includes(compare)) throw new BadRequestException("Choose what to compare with");
  return { period: { from, to }, basis, compare };
}

export function sourceContext(db: Db, workspaceId: string, company: StatementCompany, userId: string): StatementSourceContext {
  return {
    db, workspaceId, legalEntityId: company.id, currency: company.currency, locale: company.locale, timeZone: company.timeZone, today: company.today,
    fiscalYearStartMonth: company.fiscalYearStartMonth, userId,
  };
}

/** Where a company's statements come from, and what each source could give it now. */
export async function readSourceSettings(registry: StatementSourceRegistry, context: StatementSourceContext): Promise<StatementSourceSettings> {
  const row = (await context.db.query<{ source: FinancialStatementSource; version: number }>(
    `SELECT source, version FROM books_statement_sources WHERE workspace_id = $1 AND legal_entity_id = $2`, [context.workspaceId, context.legalEntityId])).rows[0];
  const options: StatementSourceOption[] = [];
  for (const source of FINANCIAL_STATEMENT_SOURCES) {
    const adapter = registry.get(source);
    if (!adapter) { options.push({ source, available: false, label: null, capabilities: NO_CAPABILITIES }); continue; }
    const availability = await adapter.availability(context);
    options.push({ source, available: availability.available, label: availability.label,
      capabilities: availability.available ? await adapter.provider(context).capabilities() : NO_CAPABILITIES });
  }
  const fallback: FinancialStatementSource = options.find((option) => option.source === "ledger")?.available ? "ledger" : "operational_cash";
  return { legalEntityId: context.legalEntityId, source: row?.source ?? fallback, chosen: Boolean(row), version: row?.version ?? 0, options };
}

/**
 * The provider of a company's chosen source: `statementSource(context).profitAndLoss(query)` / `.cashFlow(query)`.
 * A chosen source that can't serve the company now (not connected, the Ledger turned off) is refused with what to do.
 */
export async function statementSource(registry: StatementSourceRegistry, context: StatementSourceContext) {
  const settings = await readSourceSettings(registry, context);
  const option = settings.options.find((item) => item.source === settings.source)!;
  const adapter = registry.get(settings.source);
  if (!adapter || !option.available) {
    throw new ConflictException({ message: `${SOURCE_NAMES[settings.source]} isn't connected for this company. Choose where the books live in Settings › Ledger.`,
      code: "source_unavailable", source: settings.source });
  }
  const info: StatementSourceInfo = { source: settings.source, label: option.label, chosen: settings.chosen, capabilities: option.capabilities };
  return { provider: adapter.provider(context), info };
}

export async function readProfitAndLoss(registry: StatementSourceRegistry, db: Db, workspaceId: string, userId: string, query: Record<string, unknown>)
  : Promise<StatementResponse<ProfitAndLossStatement>> {
  const { company, companies } = await resolveCompany(db, workspaceId, query);
  const { period, basis, compare } = parseStatementQuery(company, query);
  const { provider, info } = await statementSource(registry, sourceContext(db, workspaceId, company, userId));
  if (!info.capabilities[basis]) throw new UnprocessableEntityException({ message: basis === "cash" ? "This source has no cash basis" : "This source has no accrual basis", code: "basis_unavailable" });
  const comparison = comparisonPeriod(period, compare);
  let statement = await provider.profitAndLoss({ legalEntityId: company.id, from: period.from, to: period.to, basis });
  if (comparison) statement = mergeProfitAndLoss(statement, await provider.profitAndLoss({ legalEntityId: company.id, from: comparison.from, to: comparison.to, basis }));
  return { statement, company, companies, source: info, period, comparison, compare };
}

export async function readCashFlow(registry: StatementSourceRegistry, db: Db, workspaceId: string, userId: string, query: Record<string, unknown>)
  : Promise<StatementResponse<CashFlowStatement>> {
  const { company, companies } = await resolveCompany(db, workspaceId, query);
  const { period } = parseStatementQuery(company, query);
  const { provider, info } = await statementSource(registry, sourceContext(db, workspaceId, company, userId));
  const statement = await provider.cashFlow({ legalEntityId: company.id, from: period.from, to: period.to, basis: "cash" });
  return { statement, company, companies, source: info, period, comparison: null, compare: "none" };
}

// ---------------------------------------------------------------------------------------------------------------
// Settings › Ledger › Statements.

export type StatementSourceView = StatementSourceSettings & { company: StatementCompany; companies: StatementCompany[]; canManage: boolean };

export async function readSourceView(registry: StatementSourceRegistry, db: Db, ctx: BooksCtx, query: Record<string, unknown>): Promise<StatementSourceView> {
  await requireAny(ctx, [BOOKS.view, BOOKS.manage], "You don't have access to the Ledger.");
  const { company, companies } = await resolveCompany(db, ctx.workspaceId, query);
  const settings = await readSourceSettings(registry, sourceContext(db, ctx.workspaceId, company, ctx.userId));
  return { ...settings, company, companies, canManage: await ctx.can(BOOKS.manage) };
}

/**
 * Chooses where a company's statements come from: once by its command id, version-checked, only a source that can
 * serve the company now, audited, and told to everyone else who sets up the Ledger (in the app and by email).
 */
export async function setStatementSource(registry: StatementSourceRegistry, db: Db, ctx: BooksCtx, body: Record<string, unknown>): Promise<StatementSourceView> {
  await requireAny(ctx, [BOOKS.manage], "Only people who set up the Ledger choose where statements come from.");
  const legalEntityId = uuid(body.legalEntityId, "Company");
  const commandId = uuid(body.commandId, "Command");
  const source = body.source as FinancialStatementSource;
  if (!FINANCIAL_STATEMENT_SOURCES.includes(source)) throw new BadRequestException("Choose where the books live.");
  const expected = versionOf(body.expectedVersion);
  const { company } = await resolveCompany(db, ctx.workspaceId, { entity: legalEntityId });
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('books-statement-source:' || $1::text, 0))`, [legalEntityId]);
  if (!(await firstTime(db, ctx, commandId, "set_statement_source", legalEntityId))) return readSourceView(registry, db, ctx, { entity: legalEntityId });
  const context = sourceContext(db, ctx.workspaceId, company, ctx.userId);
  const before = await readSourceSettings(registry, context);
  checkVersion(before.version, expected, "Where statements come from");
  const option = before.options.find((item) => item.source === source)!;
  if (!option.available) {
    throw new ConflictException(source === "ledger" ? "Turn the Ledger on for this company first." : `Connect ${SOURCE_NAMES[source]} for this company first.`);
  }
  if (before.chosen && before.source === source) return readSourceView(registry, db, ctx, { entity: legalEntityId });
  await db.query(
    `INSERT INTO books_statement_sources (workspace_id, legal_entity_id, source, version, updated_by) VALUES ($1, $2, $3, 1, $4)
     ON CONFLICT (workspace_id, legal_entity_id) DO UPDATE SET source = excluded.source, version = books_statement_sources.version + 1,
       updated_by = excluded.updated_by, updated_at = now()`, [ctx.workspaceId, legalEntityId, source, ctx.userId]);
  const after = await readSourceSettings(registry, context);
  await recordAudit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "books.statement_source_changed", entityType: "books_statement_sources",
    entityId: legalEntityId, before: { source: before.source, chosen: before.chosen, version: before.version }, after: { source: after.source, version: after.version } });
  const variables = { company: company.name, source: SOURCE_NAMES[after.source], previous: SOURCE_NAMES[before.source], actor: await personName(db, ctx.userId) || "Wodana" };
  const code = "books.statement_source_changed";
  const link = `/workspace/ledger/reports/profit-and-loss?entity=${legalEntityId}`;
  for (const userId of await holders(db, ctx.workspaceId, BOOKS.manage)) {
    if (userId === ctx.userId) continue;
    const key = `${code}:${legalEntityId}:${after.version}:${userId}`;
    await notifyUserInApp(db, { workspaceId: ctx.workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink: link, idempotencyKey: key });
    await queueUserEmail(db, { workspaceId: ctx.workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink: link, idempotencyKey: `${key}:email` });
  }
  return readSourceView(registry, db, ctx, { entity: legalEntityId });
}
