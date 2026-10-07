import {
  ACCOUNT_ROLES, ACCOUNT_TYPES, PAYMENT_DIRECTIONS, PAYMENT_METHODS, TAX_DIRECTIONS, TAX_TREATMENTS,
  type AccountRole, type AccountType, type PaymentDirection, type PaymentMethod, type TaxDirection, type TaxTreatment,
} from "../books-contract";
import { type BooksSettings, type Db, LedgerError, readBooksSettings } from "./ledger";

/**
 * Chart templates are setup profiles of kind 'books' (migration 0283): accounts, the account for every posting role,
 * payment accounts, tax codes and the tax return layout. Applying one to a company is opt-in and versioned
 * (books_settings.template_code / template_version). It only adds what is missing: whatever the company changed or
 * mapped itself stays as it is, so applying again (or a newer version) is safe.
 */

export type TemplateAccount = {
  key: string; code: string; name: string; type: AccountType; subtype: string; isControl: boolean; allowManual: boolean; parent?: string | null;
};
export type TemplateTaxCode = {
  code: string; name: string; direction: TaxDirection; rate: string; treatment: TaxTreatment; recoverable: boolean;
  baseBox: string | null; taxBox: string | null; rcOutputBox: string | null; effectiveFrom: string; effectiveTo?: string | null;
};
export type BooksTemplate = {
  code: string;
  version: number;
  name: string;
  countryCodes: string[];
  taxModel: string;
  defaults: { fiscalYearStartMonth: number; taxPointOnPayment: boolean; revenueRecognition: "invoice" };
  accounts: TemplateAccount[];
  roles: Record<AccountRole, string>;
  paymentAccounts: Array<{ direction: PaymentDirection; method: PaymentMethod; account: string }>;
  taxCodes: TemplateTaxCode[];
  /** The tax return layout (AE: VAT 201), read by the VAT report. */
  taxReport: Record<string, unknown> | null;
};

export type ApplyTemplateResult = {
  settings: BooksSettings;
  template: { code: string; version: number };
  accountsCreated: number;
  rolesMapped: number;
  paymentAccountsMapped: number;
  taxCodesCreated: number;
};

/** The template's version (the latest selectable one when no version is given), or null. */
export async function readTemplate(db: Db, code: string, version?: number): Promise<BooksTemplate | null> {
  const row = (await db.query<{ configuration: BooksTemplate; version: number }>(
    `SELECT configuration, version FROM tenant_setup_profiles
      WHERE kind = 'books' AND code = $1 AND ($2::integer IS NULL AND selectable OR version = $2::integer)
      ORDER BY version DESC LIMIT 1`, [code, version ?? null])).rows[0];
  return row ? { ...row.configuration, code, version: row.version } : null;
}

/** What is wrong with a template (empty when it can be applied). */
export function templateProblems(template: BooksTemplate): string[] {
  const problems: string[] = [];
  const accounts = Array.isArray(template.accounts) ? template.accounts : [];
  if (!accounts.length) problems.push("no accounts");
  const keys = new Set<string>(), codes = new Set<string>();
  for (const account of accounts) {
    if (!/^[a-z][a-z0-9_]{0,59}$/.test(account.key)) problems.push(`account key ${account.key}`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/.test(account.code)) problems.push(`account code ${account.code}`);
    if (!(ACCOUNT_TYPES as readonly string[]).includes(account.type)) problems.push(`account type ${account.type} (${account.code})`);
    if (!account.name?.trim()) problems.push(`account name (${account.code})`);
    if (account.isControl && account.allowManual) problems.push(`control account ${account.code} allows manual entries`);
    if (keys.has(account.key)) problems.push(`duplicate key ${account.key}`);
    if (codes.has(account.code)) problems.push(`duplicate code ${account.code}`);
    keys.add(account.key); codes.add(account.code);
  }
  for (const account of accounts) if (account.parent && !keys.has(account.parent)) problems.push(`parent ${account.parent} of ${account.code}`);
  for (const role of ACCOUNT_ROLES) {
    const key = template.roles?.[role];
    if (!key) problems.push(`role ${role} has no account`);
    else if (!keys.has(key)) problems.push(`role ${role} names unknown account ${key}`);
  }
  for (const payment of template.paymentAccounts ?? []) {
    if (!(PAYMENT_DIRECTIONS as readonly string[]).includes(payment.direction) || !(PAYMENT_METHODS as readonly string[]).includes(payment.method)) {
      problems.push(`payment account ${payment.direction}/${payment.method}`);
    }
    if (!keys.has(payment.account)) problems.push(`payment account ${payment.direction}/${payment.method} names unknown account ${payment.account}`);
  }
  const taxKeys = new Set<string>();
  for (const tax of template.taxCodes ?? []) {
    if (!(TAX_TREATMENTS as readonly string[]).includes(tax.treatment)) problems.push(`tax treatment ${tax.treatment} (${tax.code})`);
    if (!(TAX_DIRECTIONS as readonly string[]).includes(tax.direction)) problems.push(`tax direction ${tax.direction} (${tax.code})`);
    if (!/^\d{1,3}(\.\d{1,4})?$/.test(tax.rate) || Number(tax.rate) > 100) problems.push(`tax rate ${tax.rate} (${tax.code})`);
    if (tax.recoverable && tax.direction !== "purchases") problems.push(`recoverable sales tax ${tax.code}`);
    if (tax.rcOutputBox && !["reverse_charge", "import_reverse_charge"].includes(tax.treatment)) problems.push(`output box on ${tax.code}`);
    const key = `${tax.code}|${tax.direction}|${tax.effectiveFrom}`;
    if (taxKeys.has(key)) problems.push(`duplicate tax code ${tax.code} ${tax.direction}`);
    taxKeys.add(key);
  }
  return problems;
}

/**
 * Applies a chart template to one company: its Ledger settings (created off, starting `startDate` or today in the
 * company's time zone, in the company's base currency), then every missing account, role mapping, payment account
 * and tax code, and its JOURNAL numbering. A company keeps one template: only a newer version of it applies.
 */
export async function applyTemplate(
  db: Db, workspaceId: string, legalEntityId: string, code: string,
  options: { version?: number; actorId?: string | null; startDate?: string } = {},
): Promise<ApplyTemplateResult> {
  const template = await readTemplate(db, code, options.version);
  if (!template) throw new LedgerError("unknown_template", `There is no ${code} chart template`);
  const problems = templateProblems(template);
  if (problems.length) throw new LedgerError("invalid_template", `The ${code} template can't be applied: ${problems.slice(0, 5).join("; ")}`);
  if (options.startDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(options.startDate)) throw new LedgerError("invalid_date", "The start date is a calendar day");

  const entity = (await db.query<{ code: string }>(`SELECT code FROM legal_entities WHERE workspace_id = $1 AND id = $2`, [workspaceId, legalEntityId])).rows[0];
  if (!entity) throw new LedgerError("unknown_entity", "The company is not in this workspace");
  const current = await readBooksSettings(db, workspaceId, legalEntityId);
  if (current?.templateCode && current.templateCode !== template.code) {
    throw new LedgerError("template_conflict", `This company's chart comes from the ${current.templateCode} template`);
  }
  if (current?.templateVersion && current.templateVersion > template.version) {
    throw new LedgerError("template_conflict", `This company already has version ${current.templateVersion} of the ${code} template`);
  }
  const actor = options.actorId ?? null;

  await db.query(
    `INSERT INTO books_settings (workspace_id, legal_entity_id, start_date, functional_currency, fiscal_year_start_month, template_code, template_version,
                                revenue_recognition, tax_point_on_payment, updated_by)
     SELECT $1, entity.id, coalesce($3::date, (now() AT TIME ZONE entity.timezone)::date), entity.base_currency, $4, $5, $6, $7, $8, $9
       FROM legal_entities entity WHERE entity.workspace_id = $1 AND entity.id = $2
     ON CONFLICT (workspace_id, legal_entity_id) DO UPDATE
       SET template_code = excluded.template_code, template_version = excluded.template_version, version = books_settings.version + 1,
           updated_by = excluded.updated_by
     WHERE books_settings.template_code IS DISTINCT FROM excluded.template_code OR books_settings.template_version IS DISTINCT FROM excluded.template_version`,
    [workspaceId, legalEntityId, options.startDate ?? null, template.defaults?.fiscalYearStartMonth ?? 1, template.code, template.version,
      template.defaults?.revenueRecognition ?? "invoice", template.defaults?.taxPointOnPayment ?? false, actor]);

  const accountsCreated = (await db.query(
    `INSERT INTO books_accounts (workspace_id, legal_entity_id, code, name, type, subtype, is_control, allow_manual, template_key, created_by, updated_by)
     SELECT $1, $2, account.code, account.name, account.type, coalesce(account.subtype, ''), coalesce(account."isControl", false),
            coalesce(account."allowManual", true), account.key, $4, $4
       FROM jsonb_to_recordset($3::jsonb) AS account(key text, code text, name text, type text, subtype text, "isControl" boolean, "allowManual" boolean)
     ON CONFLICT DO NOTHING`,
    [workspaceId, legalEntityId, JSON.stringify(template.accounts), actor])).rowCount ?? 0;

  // Template accounts by key: the account carrying the key, else the one with the template's code.
  const ids = new Map((await db.query<{ key: string; id: string }>(
    `SELECT DISTINCT ON (account.key) account.key, existing.id
       FROM jsonb_to_recordset($3::jsonb) AS account(key text, code text)
       JOIN books_accounts existing ON existing.workspace_id = $1 AND existing.legal_entity_id = $2
        AND (existing.template_key = account.key OR existing.code = account.code)
      ORDER BY account.key, (existing.template_key = account.key) DESC NULLS LAST`,
    [workspaceId, legalEntityId, JSON.stringify(template.accounts.map(({ key, code: accountCode }) => ({ key, code: accountCode })))])).rows
    .map((row) => [row.key, row.id]));

  const parents = template.accounts.filter((account) => account.parent && ids.get(account.key) && ids.get(account.parent));
  if (parents.length) {
    await db.query(
      `UPDATE books_accounts account SET parent_id = link.parent_id::uuid, version = account.version + 1, updated_at = now()
         FROM jsonb_to_recordset($3::jsonb) AS link(id text, parent_id text)
        WHERE account.workspace_id = $1 AND account.legal_entity_id = $2 AND account.id = link.id::uuid AND account.parent_id IS NULL`,
      [workspaceId, legalEntityId, JSON.stringify(parents.map((account) => ({ id: ids.get(account.key), parent_id: ids.get(account.parent!) })))]);
  }

  const roles = ACCOUNT_ROLES.map((role) => ({ role, account_id: ids.get(template.roles[role]) })).filter((row) => row.account_id);
  const rolesMapped = (await db.query(
    `INSERT INTO books_account_roles (workspace_id, legal_entity_id, role, account_id, updated_by)
     SELECT $1, $2, mapping.role, mapping.account_id::uuid, $4 FROM jsonb_to_recordset($3::jsonb) AS mapping(role text, account_id text)
     ON CONFLICT DO NOTHING`, [workspaceId, legalEntityId, JSON.stringify(roles), actor])).rowCount ?? 0;

  const payments = (template.paymentAccounts ?? []).map((payment) => ({ direction: payment.direction, method: payment.method, account_id: ids.get(payment.account) }))
    .filter((row) => row.account_id);
  const paymentAccountsMapped = (await db.query(
    `INSERT INTO books_payment_accounts (workspace_id, legal_entity_id, direction, method, account_id, updated_by)
     SELECT $1, $2, payment.direction, payment.method, payment.account_id::uuid, $4
       FROM jsonb_to_recordset($3::jsonb) AS payment(direction text, method text, account_id text)
     ON CONFLICT DO NOTHING`, [workspaceId, legalEntityId, JSON.stringify(payments), actor])).rowCount ?? 0;

  const taxCodesCreated = (await db.query(
    `INSERT INTO books_tax_codes (workspace_id, legal_entity_id, code, name, rate, treatment, direction, recoverable, base_box, tax_box, rc_output_box,
                                 effective_from, effective_to, updated_by)
     SELECT $1, $2, tax.code, tax.name, tax.rate::numeric, tax.treatment, tax.direction, coalesce(tax.recoverable, false), tax."baseBox", tax."taxBox",
            tax."rcOutputBox", tax."effectiveFrom"::date, tax."effectiveTo"::date, $4
       FROM jsonb_to_recordset($3::jsonb) AS tax(code text, name text, rate text, treatment text, direction text, recoverable boolean, "baseBox" text,
            "taxBox" text, "rcOutputBox" text, "effectiveFrom" text, "effectiveTo" text)
     ON CONFLICT DO NOTHING`, [workspaceId, legalEntityId, JSON.stringify(template.taxCodes ?? []), actor])).rowCount ?? 0;

  await db.query(
    `INSERT INTO document_sequences (workspace_id, legal_entity_id, document_type, prefix, padding, reset_policy, next_number)
     VALUES ($1, $2, 'JOURNAL', $3, 6, 'never', 1)
     ON CONFLICT (legal_entity_id, document_type) DO NOTHING`, [workspaceId, legalEntityId, `${entity.code}-JV-`]);

  return {
    settings: (await readBooksSettings(db, workspaceId, legalEntityId))!,
    template: { code: template.code, version: template.version },
    accountsCreated, rolesMapped, paymentAccountsMapped, taxCodesCreated,
  };
}
