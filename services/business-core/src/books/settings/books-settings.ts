import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { recordAudit } from "../../audit/record-audit";
import { notifyUserInApp, queueUserEmail } from "../../notifications/default-templates";
import {
  ACCOUNT_ROLES, ACCOUNT_TYPES, PAYMENT_DIRECTIONS, PAYMENT_METHODS, TAX_DIRECTIONS, TAX_TREATMENTS,
  type AccountRole, type AccountType, type PaymentDirection, type PaymentMethod, type TaxDirection, type TaxTreatment,
} from "../books-contract";
import { readBooksSettings, type BooksSettings } from "../ledger/ledger";
import { applyTemplate, readTemplate } from "../ledger/templates";
import {
  BOOKS, checkVersion, day, firstTime, holders, ledgerHttp, oneOf, optionalDay, optionalUuid, personName, readCompanies, readCompany, requireAny, text, uuid,
  versionOf, type BooksCtx, type Company, type Db,
} from "./books-common";

/**
 * Settings › Ledger, per company (plan §6.21b): turn the Ledger on by applying a chart template offered for the
 * company's country, its dates (start, lock with confirmation, fiscal year), tax point and VAT region, the chart of
 * accounts, which account plays each posting role, the payment accounts per method and direction, and the tax codes
 * (effective-dated). Every command is checked, runs once by its id, is version-checked and audited. Only holders of
 * books.manage change anything; books.view reads.
 */

export const SETTINGS_ACTIONS = [
  "turn_on", "update_settings", "add_account", "update_account", "archive_account", "restore_account", "map_role", "map_payment_account",
  "add_tax_code", "update_tax_code", "archive_tax_code", "restore_tax_code",
] as const;
export type SettingsAction = (typeof SETTINGS_ACTIONS)[number];

/** The account types each posting role may point at; the two control roles need a control account, the others refuse one. */
export const ROLE_TYPES: Record<AccountRole, readonly AccountType[]> = {
  ar_control: ["asset"], ap_control: ["liability"], client_advances: ["liability"], vat_output: ["liability"], vat_input: ["asset"],
  vat_advance_contra: ["liability", "asset"], grni: ["liability"], inventory: ["asset"], stock_in_transit: ["asset"], stock_adjustments: ["expense", "income"],
  employee_claims_payable: ["liability"], revenue_project: ["income"], revenue_other: ["income"], cost_materials: ["expense"], cost_subcontract: ["expense"],
  cost_labour: ["expense"], cost_site_expenses: ["expense"], cost_price_variance: ["expense"], cost_other: ["expense"], cogs_goods: ["expense"],
  general_expense: ["expense"], labour_absorbed: ["expense", "income"], fx_gain_loss: ["expense", "income"], rounding: ["expense", "income"],
  retained_earnings: ["equity"], opening_balance_equity: ["equity"],
};
export const CONTROL_ROLES: ReadonlySet<AccountRole> = new Set<AccountRole>(["ar_control", "ap_control"]);

/** Why an account can't play a role (null when it can). */
export function roleProblem(role: AccountRole, account: { type: AccountType; isControl: boolean; archived: boolean; code: string }): string | null {
  if (account.archived) return `${account.code} is archived.`;
  if (!ROLE_TYPES[role].includes(account.type)) return `${account.code} is ${account.type === "asset" || account.type === "income" || account.type === "expense" ? "an" : "a"} ${account.type} account; this role needs ${ROLE_TYPES[role].join(" or ")}.`;
  if (CONTROL_ROLES.has(role) && !account.isControl) return `${account.code} is not a control account; receivables and payables post to a control account.`;
  if (!CONTROL_ROLES.has(role) && account.isControl) return `${account.code} is a control account; only receivables and payables post to it.`;
  return null;
}

// ---------------------------------------------------------------- reads

export type TemplateOption = { code: string; version: number; name: string; recommended: boolean };
export type RegionOption = { code: string; name: string };
export type AccountView = {
  id: string; code: string; name: string; type: AccountType; subtype: string; parentId: string | null; isControl: boolean; allowManual: boolean;
  currency: string | null; archived: boolean; used: boolean; roles: AccountRole[]; templateKey: string | null; version: number;
};
export type RoleView = { role: AccountRole; accountId: string | null; version: number };
export type PaymentAccountView = { direction: PaymentDirection; method: PaymentMethod; accountId: string | null; version: number };
export type TaxCodeView = {
  id: string; code: string; name: string; rate: string; treatment: TaxTreatment; direction: TaxDirection; recoverable: boolean; baseBox: string | null; taxBox: string | null;
  rcOutputBox: string | null; effectiveFrom: string; effectiveTo: string | null; archived: boolean; used: boolean; version: number;
};
export type CompanySummary = Pick<Company, "id" | "code" | "name" | "countryCode" | "baseCurrency"> & { settings: BooksSettings | null; templates: TemplateOption[] };
export type LedgerSettingsView = {
  company: CompanySummary;
  regions: { label: string; options: RegionOption[] };
  accounts: AccountView[];
  roles: RoleView[];
  paymentAccounts: PaymentAccountView[];
  taxCodes: TaxCodeView[];
  hasJournals: boolean;
  today: string;
  canManage: boolean;
};

type TemplateRow = { code: string; version: number; name: string; countryCodes: string[] };

/** The chart templates a company may start from: its country's, then the generic ones (no country). */
export async function templatesFor(db: Db, countryCode: string): Promise<TemplateOption[]> {
  const rows = (await db.query<TemplateRow>(
    `SELECT DISTINCT ON (profile.code) profile.code, profile.version, coalesce(profile.configuration->>'name', profile.code) AS name,
            coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(profile.configuration->'countryCodes', '[]'::jsonb))), '{}') AS "countryCodes"
       FROM tenant_setup_profiles profile WHERE profile.kind = 'books' AND profile.selectable
      ORDER BY profile.code, profile.version DESC`)).rows;
  return rows
    .filter((row) => !row.countryCodes.length || row.countryCodes.includes(countryCode))
    .map((row) => ({ code: row.code, version: row.version, name: row.name, recommended: row.countryCodes.includes(countryCode) }))
    .sort((left, right) => Number(right.recommended) - Number(left.recommended) || left.name.localeCompare(right.name));
}

/** The regions of supply the company's tax return splits by (UAE: emirates), from its template, with their label. */
async function regionsFor(db: Db, settings: BooksSettings | null, templates: TemplateOption[]) {
  const code = settings?.templateCode ?? templates.find((item) => item.recommended)?.code ?? null;
  if (!code) return { label: "", options: [] as RegionOption[] };
  const template = await readTemplate(db, code, settings?.templateVersion ?? undefined);
  const report = template?.taxReport as { regionLabel?: unknown; regions?: unknown } | null | undefined;
  const options = Array.isArray(report?.regions)
    ? (report!.regions as Array<Record<string, unknown>>).filter((item) => typeof item.code === "string" && typeof item.name === "string")
      .map((item) => ({ code: String(item.code), name: String(item.name) }))
    : [];
  return { label: typeof report?.regionLabel === "string" ? report.regionLabel : "", options };
}

/** Every company with its Ledger settings (or none yet) and the templates it may start from. */
export async function readOverview(db: Db, ctx: BooksCtx) {
  await requireAny(ctx, [BOOKS.manage, BOOKS.view], "You don't have access to the Ledger settings.");
  const companies: CompanySummary[] = [];
  for (const company of await readCompanies(db, ctx.workspaceId)) {
    companies.push({ id: company.id, code: company.code, name: company.name, countryCode: company.countryCode, baseCurrency: company.baseCurrency,
      settings: await readBooksSettings(db, ctx.workspaceId, company.id), templates: await templatesFor(db, company.countryCode) });
  }
  return { companies, canManage: await ctx.can(BOOKS.manage) };
}

/** One company's Ledger settings: its dates, chart, roles, payment accounts and tax codes. */
export async function readSettings(db: Db, ctx: BooksCtx, legalEntityId: string): Promise<LedgerSettingsView> {
  await requireAny(ctx, [BOOKS.manage, BOOKS.view], "You don't have access to the Ledger settings.");
  const ws = ctx.workspaceId;
  const company = await readCompany(db, ws, uuid(legalEntityId, "Company"));
  const settings = await readBooksSettings(db, ws, company.id);
  const templates = await templatesFor(db, company.countryCode);
  const accounts = settings ? (await db.query<AccountView>(
    `SELECT account.id, account.code, account.name, account.type, account.subtype, account.parent_id AS "parentId", account.is_control AS "isControl",
            account.allow_manual AS "allowManual", account.currency, account.archived_at IS NOT NULL AS archived, account.template_key AS "templateKey", account.version,
            (EXISTS (SELECT 1 FROM books_journal_lines line WHERE line.workspace_id = account.workspace_id AND line.account_id = account.id)
             OR EXISTS (SELECT 1 FROM books_manual_journal_lines line WHERE line.workspace_id = account.workspace_id AND line.account_id = account.id)) AS used,
            coalesce(ARRAY(SELECT mapping.role FROM books_account_roles mapping WHERE mapping.workspace_id = account.workspace_id
              AND mapping.legal_entity_id = account.legal_entity_id AND mapping.account_id = account.id ORDER BY mapping.role), '{}') AS roles
       FROM books_accounts account WHERE account.workspace_id = $1 AND account.legal_entity_id = $2 ORDER BY account.code`, [ws, company.id])).rows : [];
  const mapped = settings ? (await db.query<{ role: AccountRole; accountId: string; version: number }>(
    `SELECT role, account_id AS "accountId", version FROM books_account_roles WHERE workspace_id = $1 AND legal_entity_id = $2`, [ws, company.id])).rows : [];
  const payments = settings ? (await db.query<{ direction: PaymentDirection; method: PaymentMethod; accountId: string; version: number }>(
    `SELECT direction, method, account_id AS "accountId", version FROM books_payment_accounts WHERE workspace_id = $1 AND legal_entity_id = $2`, [ws, company.id])).rows : [];
  const taxCodes = settings ? (await db.query<TaxCodeView>(
    `SELECT tax.id, tax.code, tax.name, tax.rate::text AS rate, tax.treatment, tax.direction, tax.recoverable, tax.base_box AS "baseBox", tax.tax_box AS "taxBox",
            tax.rc_output_box AS "rcOutputBox", tax.effective_from::text AS "effectiveFrom", tax.effective_to::text AS "effectiveTo",
            tax.archived_at IS NOT NULL AS archived, tax.version,
            (EXISTS (SELECT 1 FROM books_journal_lines line WHERE line.workspace_id = tax.workspace_id AND line.tax_code_id = tax.id)
             OR EXISTS (SELECT 1 FROM books_manual_journal_lines line WHERE line.workspace_id = tax.workspace_id AND line.tax_code_id = tax.id)) AS used
       FROM books_tax_codes tax WHERE tax.workspace_id = $1 AND tax.legal_entity_id = $2
      ORDER BY tax.direction DESC, tax.code, tax.effective_from`, [ws, company.id])).rows.map((row) => ({ ...row, rate: trimRate(row.rate) })) : [];
  const hasJournals = Boolean((await db.query(`SELECT 1 FROM books_journals WHERE workspace_id = $1 AND legal_entity_id = $2 LIMIT 1`, [ws, company.id])).rowCount);
  return {
    company: { id: company.id, code: company.code, name: company.name, countryCode: company.countryCode, baseCurrency: company.baseCurrency, settings, templates },
    regions: await regionsFor(db, settings, templates),
    accounts,
    roles: ACCOUNT_ROLES.map((role) => { const row = mapped.find((item) => item.role === role); return { role, accountId: row?.accountId ?? null, version: row?.version ?? 0 }; }),
    paymentAccounts: PAYMENT_DIRECTIONS.flatMap((direction) => PAYMENT_METHODS.map((method) => {
      const row = payments.find((item) => item.direction === direction && item.method === method);
      return { direction, method, accountId: row?.accountId ?? null, version: row?.version ?? 0 };
    })),
    taxCodes,
    hasJournals,
    today: company.today,
    canManage: await ctx.can(BOOKS.manage),
  };
}

const trimRate = (rate: string) => (rate.includes(".") ? rate.replace(/\.?0+$/, "") : rate);

// ---------------------------------------------------------------- commands

/** One settings command, once by its id. Returns the company it changed. */
export async function runSettingsCommand(db: Db, ctx: BooksCtx, body: Record<string, unknown>): Promise<string> {
  const action = oneOf(body.action, SETTINGS_ACTIONS, "Unknown action.");
  const legalEntityId = uuid(body.legalEntityId, "Company");
  const commandId = uuid(body.commandId, "Command");
  await requireAny(ctx, [BOOKS.manage], "Only people who set up the Ledger change its settings.");
  const company = await readCompany(db, ctx.workspaceId, legalEntityId);
  // Serialises the company's settings commands (two people saving at once get one after the other).
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('books-settings:' || $1::text, 0))`, [legalEntityId]);
  if (!(await firstTime(db, ctx, commandId, action, legalEntityId))) return legalEntityId;
  if (action === "turn_on") await turnOn(db, ctx, company, body);
  else {
    const settings = await readBooksSettings(db, ctx.workspaceId, company.id);
    if (!settings) throw new ConflictException("Turn the Ledger on for this company first.");
    if (action === "update_settings") await updateSettings(db, ctx, company, settings, body);
    else if (action === "add_account") await addAccount(db, ctx, company, body);
    else if (action === "update_account") await updateAccount(db, ctx, company, body);
    else if (action === "archive_account" || action === "restore_account") await archiveAccount(db, ctx, company, body, action === "archive_account");
    else if (action === "map_role") await mapRole(db, ctx, company, body);
    else if (action === "map_payment_account") await mapPaymentAccount(db, ctx, company, body);
    else if (action === "add_tax_code") await addTaxCode(db, ctx, company, body);
    else if (action === "update_tax_code") await updateTaxCode(db, ctx, company, body);
    else await archiveTaxCode(db, ctx, company, body, action === "archive_tax_code");
  }
  return legalEntityId;
}

const audit = (db: Db, ctx: BooksCtx, action: string, entityType: string, entityId: string, before: unknown, after: unknown) =>
  recordAudit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action, entityType, entityId, before: before ?? null, after });

function month(value: unknown): number {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number) || number < 1 || number > 12) throw new BadRequestException("Choose the month the fiscal year starts.");
  return number;
}

async function checkRegion(db: Db, settings: BooksSettings | null, templates: TemplateOption[], value: unknown): Promise<string | null> {
  if (value === null || value === undefined || value === "") return null;
  const regions = await regionsFor(db, settings, templates);
  if (typeof value !== "string" || !regions.options.some((option) => option.code === value)) throw new BadRequestException("Choose the region from the list.");
  return value;
}

/** Turns the Ledger on: the chosen template (offered for the company's country), the start date, and on. */
async function turnOn(db: Db, ctx: BooksCtx, company: Company, body: Record<string, unknown>) {
  const ws = ctx.workspaceId;
  const before = await readBooksSettings(db, ws, company.id);
  if (before?.enabled) throw new ConflictException("The Ledger is already on for this company.");
  const templates = await templatesFor(db, company.countryCode);
  const code = text(body.templateCode, 40, "Chart template", true);
  const template = templates.find((item) => item.code === code);
  if (!template) throw new BadRequestException("Choose a chart template offered for this company.");
  const startDate = day(body.startDate, "Start date");
  if (before?.templateCode && before.templateCode !== code) throw new ConflictException(`This company's chart comes from the ${before.templateCode} template.`);
  const hasJournals = Boolean((await db.query(`SELECT 1 FROM books_journals WHERE workspace_id = $1 AND legal_entity_id = $2 LIMIT 1`, [ws, company.id])).rowCount);
  try {
    await applyTemplate(db, ws, company.id, code, { actorId: ctx.userId, startDate: before ? undefined : startDate });
  } catch (error) { ledgerHttp(error); }
  const applied = (await readBooksSettings(db, ws, company.id))!;
  const fiscal = body.fiscalYearStartMonth === undefined ? applied.fiscalYearStartMonth : month(body.fiscalYearStartMonth);
  const region = await checkRegion(db, applied, templates, body.vatRegion);
  if (before && hasJournals && startDate !== applied.startDate) throw new ConflictException("The start date is fixed once the company has journals.");
  await db.query(
    `UPDATE books_settings SET enabled = true, start_date = $3, fiscal_year_start_month = $4, vat_region = coalesce($5, vat_region), version = version + 1, updated_by = $6
      WHERE workspace_id = $1 AND legal_entity_id = $2`, [ws, company.id, startDate, fiscal, region, ctx.userId]);
  const after = (await readBooksSettings(db, ws, company.id))!;
  await audit(db, ctx, "books.turned_on", "books_settings", company.id, before, { ...after, template: { code: template.code, version: template.version } });
}

const SETTING_FIELDS = ["enabled", "startDate", "lockDate", "fiscalYearStartMonth", "taxPointOnPayment", "vatRegion"] as const;

/** Dates, fiscal year, tax point, VAT region, on or off. A new lock date needs `confirmLockDate` and tells everyone who sets up the Ledger. */
async function updateSettings(db: Db, ctx: BooksCtx, company: Company, settings: BooksSettings, body: Record<string, unknown>) {
  const ws = ctx.workspaceId;
  checkVersion(settings.version, versionOf(body.version), "The Ledger settings");
  const next = { ...settings };
  const given = (key: (typeof SETTING_FIELDS)[number]) => Object.prototype.hasOwnProperty.call(body, key);
  if (!SETTING_FIELDS.some(given)) throw new BadRequestException("Nothing to change.");
  if (given("enabled")) {
    if (typeof body.enabled !== "boolean") throw new BadRequestException("Turn the Ledger on or off.");
    next.enabled = body.enabled;
  }
  if (given("startDate")) next.startDate = day(body.startDate, "Start date");
  if (given("lockDate")) next.lockDate = optionalDay(body.lockDate, "Lock date");
  if (given("fiscalYearStartMonth")) next.fiscalYearStartMonth = month(body.fiscalYearStartMonth);
  if (given("taxPointOnPayment")) {
    if (typeof body.taxPointOnPayment !== "boolean") throw new BadRequestException("Choose when tax is due.");
    next.taxPointOnPayment = body.taxPointOnPayment;
  }
  if (given("vatRegion")) next.vatRegion = await checkRegion(db, settings, await templatesFor(db, company.countryCode), body.vatRegion);
  if (next.startDate !== settings.startDate
    && (await db.query(`SELECT 1 FROM books_journals WHERE workspace_id = $1 AND legal_entity_id = $2 LIMIT 1`, [ws, company.id])).rowCount) {
    throw new ConflictException("The start date is fixed once the company has journals.");
  }
  const lockChanged = next.lockDate !== settings.lockDate;
  if (lockChanged) {
    if (next.lockDate && next.lockDate > company.today) throw new UnprocessableEntityException("The lock date can't be after today.");
    if (body.confirmLockDate !== true) throw new UnprocessableEntityException({ message: "Confirm the new lock date.", code: "confirm_lock_date" });
  }
  await db.query(
    `UPDATE books_settings SET enabled = $3, start_date = $4, lock_date = $5, fiscal_year_start_month = $6, tax_point_on_payment = $7, vat_region = $8,
            version = version + 1, updated_by = $9
      WHERE workspace_id = $1 AND legal_entity_id = $2`,
    [ws, company.id, next.enabled, next.startDate, next.lockDate, next.fiscalYearStartMonth, next.taxPointOnPayment, next.vatRegion, ctx.userId]);
  const after = (await readBooksSettings(db, ws, company.id))!;
  await audit(db, ctx, "books.settings_changed", "books_settings", company.id, settings, after);
  if (lockChanged) {
    await audit(db, ctx, "books.lock_date_changed", "books_settings", company.id, { lockDate: settings.lockDate }, { lockDate: after.lockDate });
    await tellLockDate(db, ctx, company, settings.lockDate, after.lockDate, after.version);
  }
}

/** books.lock_date_changed: everyone who sets up the Ledger, in the app and by email, never who changed it. */
async function tellLockDate(db: Db, ctx: BooksCtx, company: Company, previous: string | null, lockDate: string | null, version: number) {
  const variables = { company: company.name, lockDate: lockDate ?? "none", previous: previous ?? "none", actor: await personName(db, ctx.userId) || "Wodana" };
  const code = "books.lock_date_changed";
  const link = `/workspace/settings/ledger?company=${company.id}`;
  for (const userId of await holders(db, ctx.workspaceId, BOOKS.manage)) {
    if (userId === ctx.userId) continue;
    const key = `${code}:${company.id}:${version}:${userId}`;
    await notifyUserInApp(db, { workspaceId: ctx.workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink: link, idempotencyKey: key });
    await queueUserEmail(db, { workspaceId: ctx.workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink: link, idempotencyKey: `${key}:email` });
  }
}

// ---------------------------------------------------------------- accounts

type AccountRow = { id: string; code: string; name: string; type: AccountType; subtype: string; parentId: string | null; isControl: boolean; allowManual: boolean;
  currency: string | null; archived: boolean; version: number; used: boolean; roles: string[]; payments: number };

async function lockAccount(db: Db, ws: string, legalEntityId: string, accountId: string): Promise<AccountRow> {
  const row = (await db.query<AccountRow>(
    `SELECT account.id, account.code, account.name, account.type, account.subtype, account.parent_id AS "parentId", account.is_control AS "isControl",
            account.allow_manual AS "allowManual", account.currency, account.archived_at IS NOT NULL AS archived, account.version,
            (EXISTS (SELECT 1 FROM books_journal_lines line WHERE line.workspace_id = account.workspace_id AND line.account_id = account.id)
             OR EXISTS (SELECT 1 FROM books_manual_journal_lines line WHERE line.workspace_id = account.workspace_id AND line.account_id = account.id)) AS used,
            coalesce(ARRAY(SELECT mapping.role FROM books_account_roles mapping WHERE mapping.workspace_id = account.workspace_id
              AND mapping.legal_entity_id = account.legal_entity_id AND mapping.account_id = account.id), '{}') AS roles,
            (SELECT count(*)::int FROM books_payment_accounts payment WHERE payment.workspace_id = account.workspace_id
              AND payment.legal_entity_id = account.legal_entity_id AND payment.account_id = account.id) AS payments
       FROM books_accounts account WHERE account.workspace_id = $1 AND account.legal_entity_id = $2 AND account.id = $3 FOR UPDATE OF account`,
    [ws, legalEntityId, accountId])).rows[0];
  if (!row) throw new NotFoundException("Account not found.");
  return row;
}

const ACCOUNT_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;
const SUBTYPE = /^[a-z0-9_]{0,40}$/;

function accountCode(value: unknown) {
  const code = text(value, 20, "Account code", true);
  if (!ACCOUNT_CODE.test(code)) throw new BadRequestException("An account code is letters and digits (up to 20), for example 6130.");
  return code;
}

function subtype(value: unknown) {
  const result = text(value, 40, "Account group").toLowerCase();
  if (!SUBTYPE.test(result)) throw new BadRequestException("An account group is lowercase letters, digits and underscores.");
  return result;
}

function currencyCode(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value.trim().toUpperCase())) throw new BadRequestException("Choose the currency.");
  return value.trim().toUpperCase();
}

async function checkParent(db: Db, ws: string, legalEntityId: string, parentId: string | null, type: AccountType, selfId: string | null) {
  if (!parentId) return null;
  if (parentId === selfId) throw new BadRequestException("An account can't sit under itself.");
  const parent = (await db.query<{ type: AccountType; archived: boolean }>(
    `SELECT type, archived_at IS NOT NULL AS archived FROM books_accounts WHERE workspace_id = $1 AND legal_entity_id = $2 AND id = $3`, [ws, legalEntityId, parentId])).rows[0];
  if (!parent || parent.archived) throw new BadRequestException("Choose an open account of this company as the parent.");
  if (parent.type !== type) throw new BadRequestException("An account sits under an account of the same type.");
  if (selfId) {
    // No loops: the new parent must not sit under this account.
    const loop = (await db.query(
      `WITH RECURSIVE up AS (SELECT id, parent_id FROM books_accounts WHERE workspace_id = $1 AND legal_entity_id = $2 AND id = $3
         UNION SELECT account.id, account.parent_id FROM books_accounts account JOIN up ON account.id = up.parent_id WHERE account.workspace_id = $1)
       SELECT 1 FROM up WHERE id = $4`, [ws, legalEntityId, parentId, selfId])).rowCount;
    if (loop) throw new BadRequestException("An account can't sit under one of its own sub-accounts.");
  }
  return parentId;
}

async function codeTaken(db: Db, ws: string, legalEntityId: string, code: string, selfId: string | null) {
  return Boolean((await db.query(`SELECT 1 FROM books_accounts WHERE workspace_id = $1 AND legal_entity_id = $2 AND lower(code) = lower($3) AND id IS DISTINCT FROM $4`,
    [ws, legalEntityId, code, selfId])).rowCount);
}

async function addAccount(db: Db, ctx: BooksCtx, company: Company, body: Record<string, unknown>) {
  const ws = ctx.workspaceId;
  const code = accountCode(body.code);
  const name = text(body.name, 160, "Account name", true);
  const type = oneOf(body.type, ACCOUNT_TYPES, "Choose the account type.");
  const isControl = body.isControl === true;
  const allowManual = isControl ? false : body.allowManual !== false;
  const parentId = await checkParent(db, ws, company.id, optionalUuid(body.parentId, "Parent account"), type, null);
  if (await codeTaken(db, ws, company.id, code, null)) throw new ConflictException(`There is already an account ${code}.`);
  const id = (await db.query<{ id: string }>(
    `INSERT INTO books_accounts (workspace_id, legal_entity_id, code, name, type, subtype, parent_id, is_control, allow_manual, currency, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING id`,
    [ws, company.id, code, name, type, subtype(body.subtype), parentId, isControl, allowManual, currencyCode(body.currency), ctx.userId])).rows[0].id;
  await audit(db, ctx, "books.account_added", "books_account", id, null, { legalEntityId: company.id, code, name, type, isControl, allowManual, parentId });
}

/**
 * Renames and regroups an account. Once used (posted, or on a manual journal) its code, type, currency and control
 * flag are fixed; a control account never takes manual entries, and the receivables and payables accounts stay control.
 */
async function updateAccount(db: Db, ctx: BooksCtx, company: Company, body: Record<string, unknown>) {
  const ws = ctx.workspaceId;
  const account = await lockAccount(db, ws, company.id, uuid(body.accountId, "Account"));
  checkVersion(account.version, versionOf(body.version), `Account ${account.code}`);
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const next = {
    code: has("code") ? accountCode(body.code) : account.code,
    name: has("name") ? text(body.name, 160, "Account name", true) : account.name,
    type: has("type") ? oneOf(body.type, ACCOUNT_TYPES, "Choose the account type.") : account.type,
    subtype: has("subtype") ? subtype(body.subtype) : account.subtype,
    isControl: has("isControl") ? body.isControl === true : account.isControl,
    allowManual: has("allowManual") ? body.allowManual === true : account.allowManual,
    currency: has("currency") ? currencyCode(body.currency) : account.currency,
    parentId: account.parentId,
  };
  next.parentId = has("parentId") ? await checkParent(db, ws, company.id, optionalUuid(body.parentId, "Parent account"), next.type, account.id) : account.parentId;
  if (account.used && (next.code !== account.code || next.type !== account.type || next.isControl !== account.isControl || next.currency !== account.currency)) {
    throw new ConflictException(`Account ${account.code} has entries: its code, type, currency and control setting stay as they are.`);
  }
  if (next.isControl && next.allowManual) throw new UnprocessableEntityException("A control account is posted only by its own records, never by hand.");
  if (!next.isControl && account.roles.some((role) => CONTROL_ROLES.has(role as AccountRole))) {
    throw new UnprocessableEntityException(`Account ${account.code} is the receivables or payables account and stays a control account.`);
  }
  for (const role of account.roles as AccountRole[]) {
    const problem = roleProblem(role, { ...next, archived: false });
    if (problem) throw new UnprocessableEntityException(problem);
  }
  if (next.code !== account.code && await codeTaken(db, ws, company.id, next.code, account.id)) throw new ConflictException(`There is already an account ${next.code}.`);
  if (next.type !== account.type && (await db.query(`SELECT 1 FROM books_accounts WHERE workspace_id = $1 AND legal_entity_id = $2 AND parent_id = $3 LIMIT 1`,
    [ws, company.id, account.id])).rowCount) throw new ConflictException(`Account ${account.code} has sub-accounts of its type.`);
  await db.query(
    `UPDATE books_accounts SET code = $4, name = $5, type = $6, subtype = $7, is_control = $8, allow_manual = $9, currency = $10, parent_id = $11,
            version = version + 1, updated_by = $12, updated_at = now()
      WHERE workspace_id = $1 AND legal_entity_id = $2 AND id = $3`,
    [ws, company.id, account.id, next.code, next.name, next.type, next.subtype, next.isControl, next.allowManual, next.currency, next.parentId, ctx.userId]);
  const { used: _used, roles: _roles, payments: _payments, ...before } = account;
  await audit(db, ctx, "books.account_changed", "books_account", account.id, before, { ...next, legalEntityId: company.id });
}

/** Archives an account (never deleted): not while a posting role or payment method points at it, or an open account sits under it. */
async function archiveAccount(db: Db, ctx: BooksCtx, company: Company, body: Record<string, unknown>, archive: boolean) {
  const ws = ctx.workspaceId;
  const account = await lockAccount(db, ws, company.id, uuid(body.accountId, "Account"));
  checkVersion(account.version, versionOf(body.version), `Account ${account.code}`);
  if (account.archived === archive) return;
  if (archive) {
    if (account.roles.length) throw new ConflictException(`Account ${account.code} plays a posting role (${account.roles.join(", ")}). Choose another account for it first.`);
    if (account.payments) throw new ConflictException(`Payments go through account ${account.code}. Choose another account for them first.`);
    if ((await db.query(`SELECT 1 FROM books_accounts WHERE workspace_id = $1 AND legal_entity_id = $2 AND parent_id = $3 AND archived_at IS NULL LIMIT 1`,
      [ws, company.id, account.id])).rowCount) throw new ConflictException(`Account ${account.code} has open sub-accounts.`);
    if ((await db.query(
      `SELECT 1 FROM books_manual_journal_lines line JOIN books_manual_journals journal ON journal.workspace_id = line.workspace_id AND journal.id = line.manual_journal_id
        WHERE line.workspace_id = $1 AND line.account_id = $2 AND journal.status IN ('draft', 'submitted', 'returned') LIMIT 1`, [ws, account.id])).rowCount) {
      throw new ConflictException(`A journal waiting to post uses account ${account.code}.`);
    }
  }
  await db.query(`UPDATE books_accounts SET archived_at = CASE WHEN $4 THEN now() ELSE NULL END, version = version + 1, updated_by = $5, updated_at = now()
    WHERE workspace_id = $1 AND legal_entity_id = $2 AND id = $3`, [ws, company.id, account.id, archive, ctx.userId]);
  await audit(db, ctx, archive ? "books.account_archived" : "books.account_restored", "books_account", account.id, { archived: account.archived }, { archived: archive, code: account.code });
}

async function openAccount(db: Db, ws: string, legalEntityId: string, accountId: string) {
  const row = (await db.query<{ id: string; code: string; type: AccountType; isControl: boolean; archived: boolean }>(
    `SELECT id, code, type, is_control AS "isControl", archived_at IS NOT NULL AS archived FROM books_accounts WHERE workspace_id = $1 AND legal_entity_id = $2 AND id = $3`,
    [ws, legalEntityId, accountId])).rows[0];
  if (!row) throw new BadRequestException("Choose one of this company's accounts.");
  return row;
}

/** Which account plays a posting role: of the role's type, a control account for receivables and payables only. */
async function mapRole(db: Db, ctx: BooksCtx, company: Company, body: Record<string, unknown>) {
  const ws = ctx.workspaceId;
  const role = oneOf(body.role, ACCOUNT_ROLES, "Choose the posting role.");
  const account = await openAccount(db, ws, company.id, uuid(body.accountId, "Account"));
  const problem = roleProblem(role, account);
  if (problem) throw new UnprocessableEntityException(problem);
  const current = (await db.query<{ accountId: string; version: number }>(
    `SELECT account_id AS "accountId", version FROM books_account_roles WHERE workspace_id = $1 AND legal_entity_id = $2 AND role = $3 FOR UPDATE`, [ws, company.id, role])).rows[0];
  checkVersion(current?.version ?? 0, versionOf(body.version), "This posting role");
  if (current?.accountId === account.id) return;
  await db.query(
    `INSERT INTO books_account_roles (workspace_id, legal_entity_id, role, account_id, updated_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, legal_entity_id, role) DO UPDATE SET account_id = excluded.account_id, version = books_account_roles.version + 1,
       updated_by = excluded.updated_by, updated_at = now()`, [ws, company.id, role, account.id, ctx.userId]);
  await audit(db, ctx, "books.role_mapped", "books_settings", company.id, { role, accountId: current?.accountId ?? null }, { role, accountId: account.id, code: account.code });
}

/** Where money comes in or goes out by method: an open asset account (bank, cash, clearing), never a control account; none removes it. */
async function mapPaymentAccount(db: Db, ctx: BooksCtx, company: Company, body: Record<string, unknown>) {
  const ws = ctx.workspaceId;
  const direction = oneOf(body.direction, PAYMENT_DIRECTIONS, "Choose money in or out.");
  const method = oneOf(body.method, PAYMENT_METHODS, "Choose the payment method.");
  const accountId = optionalUuid(body.accountId, "Account");
  const current = (await db.query<{ accountId: string; version: number }>(
    `SELECT account_id AS "accountId", version FROM books_payment_accounts WHERE workspace_id = $1 AND legal_entity_id = $2 AND direction = $3 AND method = $4 FOR UPDATE`,
    [ws, company.id, direction, method])).rows[0];
  checkVersion(current?.version ?? 0, versionOf(body.version), "This payment account");
  if ((current?.accountId ?? null) === accountId) return;
  if (!accountId) {
    await db.query(`DELETE FROM books_payment_accounts WHERE workspace_id = $1 AND legal_entity_id = $2 AND direction = $3 AND method = $4`, [ws, company.id, direction, method]);
  } else {
    const account = await openAccount(db, ws, company.id, accountId);
    if (account.archived) throw new UnprocessableEntityException(`${account.code} is archived.`);
    if (account.type !== "asset" || account.isControl) throw new UnprocessableEntityException(`${account.code} isn't a bank, cash or clearing account.`);
    await db.query(
      `INSERT INTO books_payment_accounts (workspace_id, legal_entity_id, direction, method, account_id, updated_by) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, legal_entity_id, direction, method) DO UPDATE SET account_id = excluded.account_id, version = books_payment_accounts.version + 1,
         updated_by = excluded.updated_by, updated_at = now()`, [ws, company.id, direction, method, account.id, ctx.userId]);
  }
  await audit(db, ctx, "books.payment_account_mapped", "books_settings", company.id, { direction, method, accountId: current?.accountId ?? null }, { direction, method, accountId });
}

// ---------------------------------------------------------------- tax codes

type TaxFields = {
  code: string; name: string; rate: string; treatment: TaxTreatment; direction: TaxDirection; recoverable: boolean; baseBox: string | null; taxBox: string | null;
  rcOutputBox: string | null; effectiveFrom: string; effectiveTo: string | null;
};
type TaxRow = TaxFields & { id: string; archived: boolean; used: boolean; version: number };

const BOX = /^[0-9]{1,3}[a-z]?$/;
function box(value: unknown, what: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !BOX.test(value.trim())) throw new BadRequestException(`${what}: a return box like 1, 9 or 1a.`);
  return value.trim();
}

function rate(value: unknown): string {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(raw) || Number(raw.split(".")[0]) > 100 || (Number(raw.split(".")[0]) === 100 && /\.\d*[1-9]/.test(raw))) {
    throw new BadRequestException("A tax rate is a percentage from 0 to 100, up to four decimals.");
  }
  return trimRate(raw.includes(".") ? raw : `${raw}`);
}

/** The rules a tax code keeps (also checked by the table): recovery only on purchases, reverse charge only on purchases with its output box. */
export function taxProblem(fields: TaxFields): string | null {
  if (fields.recoverable && fields.direction !== "purchases") return "Only purchase tax is recoverable.";
  if ((fields.treatment === "reverse_charge" || fields.treatment === "import_reverse_charge") && fields.direction !== "purchases") return "Reverse charge applies to purchases.";
  if (fields.rcOutputBox && fields.treatment !== "reverse_charge" && fields.treatment !== "import_reverse_charge") return "Only reverse charge feeds an output box.";
  if (fields.effectiveTo && fields.effectiveTo < fields.effectiveFrom) return "A tax code ends on or after the day it starts.";
  return null;
}

function taxFields(body: Record<string, unknown>, base?: TaxFields): TaxFields {
  const has = (key: string) => !base || Object.prototype.hasOwnProperty.call(body, key);
  const code = has("code") ? text(body.code, 20, "Tax code", true).toUpperCase() : base!.code;
  if (!ACCOUNT_CODE.test(code)) throw new BadRequestException("A tax code is letters and digits, for example SR.");
  return {
    code,
    name: has("name") ? text(body.name, 160, "Tax code name", true) : base!.name,
    rate: has("rate") ? rate(body.rate) : base!.rate,
    treatment: has("treatment") ? oneOf(body.treatment, TAX_TREATMENTS, "Choose the tax treatment.") : base!.treatment,
    direction: has("direction") ? oneOf(body.direction, TAX_DIRECTIONS, "Choose sales or purchases.") : base!.direction,
    recoverable: has("recoverable") ? body.recoverable === true : base!.recoverable,
    baseBox: has("baseBox") ? box(body.baseBox, "Base box") : base!.baseBox,
    taxBox: has("taxBox") ? box(body.taxBox, "Tax box") : base!.taxBox,
    rcOutputBox: has("rcOutputBox") ? box(body.rcOutputBox, "Output box") : base!.rcOutputBox,
    effectiveFrom: has("effectiveFrom") ? day(body.effectiveFrom, "Effective from") : base!.effectiveFrom,
    effectiveTo: has("effectiveTo") ? optionalDay(body.effectiveTo, "Effective to") : base!.effectiveTo,
  };
}

/** One rate per code and direction on any day: open codes' periods never overlap. */
async function checkOverlap(db: Db, ws: string, legalEntityId: string, fields: TaxFields, selfId: string | null) {
  const clash = (await db.query<{ from: string; to: string | null }>(
    `SELECT effective_from::text AS from, effective_to::text AS to FROM books_tax_codes
      WHERE workspace_id = $1 AND legal_entity_id = $2 AND upper(code) = $3 AND direction = $4 AND archived_at IS NULL AND id IS DISTINCT FROM $5
        AND daterange(effective_from, effective_to, '[]') && daterange($6::date, $7::date, '[]') LIMIT 1`,
    [ws, legalEntityId, fields.code, fields.direction, selfId, fields.effectiveFrom, fields.effectiveTo])).rows[0];
  if (clash) throw new ConflictException(`${fields.code} already has a ${fields.direction} rate from ${clash.from}${clash.to ? ` to ${clash.to}` : ""}. End that one first.`);
}

async function addTaxCode(db: Db, ctx: BooksCtx, company: Company, body: Record<string, unknown>) {
  const ws = ctx.workspaceId;
  const fields = taxFields(body);
  const problem = taxProblem(fields);
  if (problem) throw new UnprocessableEntityException(problem);
  await checkOverlap(db, ws, company.id, fields, null);
  const id = (await db.query<{ id: string }>(
    `INSERT INTO books_tax_codes (workspace_id, legal_entity_id, code, name, rate, treatment, direction, recoverable, base_box, tax_box, rc_output_box, effective_from,
                                  effective_to, updated_by)
     VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
    [ws, company.id, fields.code, fields.name, fields.rate, fields.treatment, fields.direction, fields.recoverable, fields.baseBox, fields.taxBox, fields.rcOutputBox,
      fields.effectiveFrom, fields.effectiveTo, ctx.userId])).rows[0].id;
  await audit(db, ctx, "books.tax_code_added", "books_tax_code", id, null, { legalEntityId: company.id, ...fields });
}

async function lockTaxCode(db: Db, ws: string, legalEntityId: string, id: string): Promise<TaxRow> {
  const row = (await db.query<TaxRow>(
    `SELECT tax.id, tax.code, tax.name, tax.rate::text AS rate, tax.treatment, tax.direction, tax.recoverable, tax.base_box AS "baseBox", tax.tax_box AS "taxBox",
            tax.rc_output_box AS "rcOutputBox", tax.effective_from::text AS "effectiveFrom", tax.effective_to::text AS "effectiveTo",
            tax.archived_at IS NOT NULL AS archived, tax.version,
            (EXISTS (SELECT 1 FROM books_journal_lines line WHERE line.workspace_id = tax.workspace_id AND line.tax_code_id = tax.id)
             OR EXISTS (SELECT 1 FROM books_manual_journal_lines line WHERE line.workspace_id = tax.workspace_id AND line.tax_code_id = tax.id)) AS used
       FROM books_tax_codes tax WHERE tax.workspace_id = $1 AND tax.legal_entity_id = $2 AND tax.id = $3 FOR UPDATE OF tax`, [ws, legalEntityId, id])).rows[0];
  if (!row) throw new NotFoundException("Tax code not found.");
  return { ...row, rate: trimRate(row.rate) };
}

/**
 * Changes a tax code. Once used, what it charged is history: its code, direction, rate, treatment, recovery and
 * start stay; it can be renamed, its boxes corrected and given an end date, and the new rate added from the next day.
 */
async function updateTaxCode(db: Db, ctx: BooksCtx, company: Company, body: Record<string, unknown>) {
  const ws = ctx.workspaceId;
  const current = await lockTaxCode(db, ws, company.id, uuid(body.taxCodeId, "Tax code"));
  checkVersion(current.version, versionOf(body.version), `Tax code ${current.code}`);
  const { id: _id, archived: _archived, used: _used, version: _version, ...base } = current;
  const next = taxFields(body, base);
  if (current.used && (next.code !== base.code || next.direction !== base.direction || next.rate !== base.rate || next.treatment !== base.treatment
    || next.recoverable !== base.recoverable || next.effectiveFrom !== base.effectiveFrom)) {
    throw new ConflictException(`${current.code} has been used: end it and add the new rate from the day it starts.`);
  }
  const problem = taxProblem(next);
  if (problem) throw new UnprocessableEntityException(problem);
  if (!current.archived) await checkOverlap(db, ws, company.id, next, current.id);
  await db.query(
    `UPDATE books_tax_codes SET code = $4, name = $5, rate = $6::numeric, treatment = $7, direction = $8, recoverable = $9, base_box = $10, tax_box = $11, rc_output_box = $12,
            effective_from = $13, effective_to = $14, version = version + 1, updated_by = $15, updated_at = now()
      WHERE workspace_id = $1 AND legal_entity_id = $2 AND id = $3`,
    [ws, company.id, current.id, next.code, next.name, next.rate, next.treatment, next.direction, next.recoverable, next.baseBox, next.taxBox, next.rcOutputBox,
      next.effectiveFrom, next.effectiveTo, ctx.userId]);
  await audit(db, ctx, "books.tax_code_changed", "books_tax_code", current.id, base, next);
}

async function archiveTaxCode(db: Db, ctx: BooksCtx, company: Company, body: Record<string, unknown>, archive: boolean) {
  const ws = ctx.workspaceId;
  const current = await lockTaxCode(db, ws, company.id, uuid(body.taxCodeId, "Tax code"));
  checkVersion(current.version, versionOf(body.version), `Tax code ${current.code}`);
  if (current.archived === archive) return;
  if (!archive) await checkOverlap(db, ws, company.id, current, current.id);
  await db.query(`UPDATE books_tax_codes SET archived_at = CASE WHEN $4 THEN now() ELSE NULL END, version = version + 1, updated_by = $5, updated_at = now()
    WHERE workspace_id = $1 AND legal_entity_id = $2 AND id = $3`, [ws, company.id, current.id, archive, ctx.userId]);
  await audit(db, ctx, archive ? "books.tax_code_archived" : "books.tax_code_restored", "books_tax_code", current.id, { archived: current.archived }, { archived: archive, code: current.code });
}
