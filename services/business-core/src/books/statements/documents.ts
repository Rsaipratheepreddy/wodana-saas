import { currencyDecimals } from "../../common/currency";
import { readProjectCosts } from "../../project-core/project-money";
import { functionalRate, ledgerDecimal } from "../ledger/ledger";
import { projectCompany } from "../posting/support";
import { add, money, sub, units, ZERO } from "../reports/report-math";
import type { CashFact, PnlFact } from "./statement-builder";
import { placeOfAccount, revenueCategoryOfQuote } from "./classify";
import type { Period } from "./statement-period";
import type { PnlCostCategory } from "./statement-contract";
import type { StatementSourceContext } from "./statement-source";

/**
 * Statements read from Wodana's own money records (no journals): invoices and credit notes, client payments,
 * supplier bills and payments, petty cash and the project costs the Money tab counts. The operational-cash source is
 * built from these alone; the Ledger source uses them for its cash basis and its forecast. Amounts are converted to
 * the company's currency at the rate of their day; what has no rate is left out and counted in `missing`.
 */

type Ctx = Pick<StatementSourceContext, "db" | "workspaceId" | "legalEntityId" | "currency" | "timeZone">;

/** Values $1 workspace, $2 company, $3 the company is the workspace's only one (documents without a company belong to it). */
const SINGLE = `(SELECT count(*) = 1 FROM legal_entities only_entity WHERE only_entity.workspace_id = $1 AND only_entity.archived_at IS NULL)`;
const UUID_RE = `'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`;
/** A document of the company: its own company column, else (without one) the only company. */
const ofCompany = (expression: string) => `(coalesce((${expression})::text = $2::text, false) OR ((${expression}) IS NULL AND ${SINGLE}))`;
const textCompany = (expression: string) => `(CASE WHEN (${expression}) ~* ${UUID_RE} THEN (${expression})::uuid END)`;
const zone = `(SELECT coalesce(nullif(zone_ws.default_timezone, ''), 'UTC') FROM workspaces zone_ws WHERE zone_ws.id = $1)`;
const localDay = (expression: string) => `((${expression}) AT TIME ZONE ${zone})::date`;

/** Converts document amounts to the company's currency at their day's rate (cached per currency and day). */
class Converter {
  missing = 0;
  private readonly rates = new Map<string, string | null>();
  constructor(private readonly ctx: Ctx) {}
  async amount(value: string, currency: string, day: string): Promise<string | null> {
    const from = currency.trim().toUpperCase();
    if (from === this.ctx.currency) return money(units(value));
    const key = `${from}:${day}`;
    if (!this.rates.has(key)) this.rates.set(key, await functionalRate(this.ctx.db, this.ctx.workspaceId, from, this.ctx.currency, day));
    const rate = this.rates.get(key);
    if (!rate) { this.missing += 1; return null; }
    return ledgerDecimal.format4(ledgerDecimal.convertUnits(units(value), rate, currencyDecimals(this.ctx.currency)));
  }
}

const quoteJoin = (alias: string, caseExpr: string, quoteExpr: string) =>
  `LEFT JOIN commercial_quotes ${alias} ON ${alias}.workspace_id = $1 AND ${alias}.case_id = ${caseExpr} AND ${alias}.id = ${quoteExpr}`;

/** Accrual revenue: invoices issued (net of tax) less credit notes, by the quotation they came from. */
export async function invoicedRevenue(ctx: Ctx, period: Period, column: number, convert: Converter): Promise<PnlFact[]> {
  const rows = (await ctx.db.query<{ day: string; net: string; currency: string; kind: string | null; round: string | null }>(
    `SELECT invoice.issue_date::text AS day, invoice.net::text AS net, invoice.currency, quote.kind, quote.round
       FROM client_invoices invoice ${quoteJoin("quote", "invoice.case_id", "invoice.quote_id")}
      WHERE invoice.workspace_id = $1 AND invoice.legal_entity_id = $2 AND invoice.issue_date BETWEEN $3::date AND $4::date
     UNION ALL
     SELECT credit.issue_date::text, (-credit.net)::text, credit.currency, quote.kind, quote.round
       FROM client_credit_notes credit
       JOIN client_invoices invoice ON invoice.workspace_id = credit.workspace_id AND invoice.id = credit.invoice_id
       ${quoteJoin("quote", "invoice.case_id", "invoice.quote_id")}
      WHERE credit.workspace_id = $1 AND credit.legal_entity_id = $2 AND credit.issue_date BETWEEN $3::date AND $4::date`,
    [ctx.workspaceId, ctx.legalEntityId, period.from, period.to])).rows;
  const facts: PnlFact[] = [];
  for (const row of rows) {
    const amount = await convert.amount(row.net, row.currency, row.day);
    if (amount === null) continue;
    const category = revenueCategoryOfQuote(row);
    facts.push({ column, section: "revenue", category, key: category, label: category, amount });
  }
  return facts;
}

/** Units of 10^-4 rounded to a step (100 for two decimals), half away from zero. */
export function roundTo(value: bigint, step: bigint): bigint {
  if (step <= 1n) return value;
  const half = step / 2n;
  return value >= 0n ? ((value + half) / step) * step : -(((-value + half) / step) * step);
}

/** The tax inside a gross amount at a rate in percent (amount × rate / (100 + rate)), rounded to the currency. */
export function taxInside(gross: string, ratePercent: string | null, currency: string): string {
  if (!ratePercent || units(ratePercent) === 0n) return ZERO;
  const g = units(gross), r = units(ratePercent);
  const decimals = currencyDecimals(currency);
  const step = 10n ** BigInt(4 - Math.min(4, decimals));
  const exact = (g * r * 2n) / ((1_000_000n + r) * step);
  const rounded = (exact + (exact >= 0n ? 1n : -1n)) / 2n;
  return money(rounded * step);
}

type ReceiptRow = { verifiedDay: string | null; rejectedDay: string | null; amount: string; currency: string; rate: string | null; kind: string | null; round: string | null;
  advance: boolean };

/** Client payments finance-verified (and reversed) in a period, gross, with what they paid for and whether they were advances. */
async function receipts(ctx: Ctx, period: Period): Promise<ReceiptRow[]> {
  const verifiedAt = `(nullif(receipt.detail->>'verifiedAt', ''))::timestamptz`;
  const rejectedAt = `(nullif(receipt.detail->>'rejectedAt', ''))::timestamptz`;
  return (await ctx.db.query<ReceiptRow>(
    `SELECT ${localDay(verifiedAt)}::text AS "verifiedDay", ${localDay(rejectedAt)}::text AS "rejectedDay", receipt.amount::text AS amount, btrim(receipt.currency) AS currency,
            quote.tax_rate::text AS rate, quote.kind, quote.round,
            NOT EXISTS (SELECT 1 FROM client_invoices live WHERE live.workspace_id = receipt.workspace_id AND live.case_id = receipt.case_id
                          AND live.payment_id = receipt.payment_id AND live.issued_at <= ${verifiedAt}) AS advance
       FROM commercial_receipts receipt
       JOIN commercial_payments milestone ON milestone.workspace_id = receipt.workspace_id AND milestone.case_id = receipt.case_id AND milestone.id = receipt.payment_id
       ${quoteJoin("quote", "milestone.case_id", "milestone.source_quote_id")}
      WHERE receipt.workspace_id = $1 AND ${ofCompany(textCompany("coalesce(nullif(receipt.legal_entity_id, ''), milestone.legal_entity_id)"))}
        AND ${verifiedAt} IS NOT NULL
        AND (${localDay(verifiedAt)} BETWEEN $3::date AND $4::date OR ${localDay(rejectedAt)} BETWEEN $3::date AND $4::date)`,
    [ctx.workspaceId, ctx.legalEntityId, period.from, period.to])).rows;
}

const within = (day: string | null, period: Period) => Boolean(day && day >= period.from && day <= period.to);

/** Cash revenue: client payments verified in the period (a reversal takes one off), less the tax inside them, by what they paid for. */
export async function cashRevenue(ctx: Ctx, period: Period, column: number, convert: Converter): Promise<PnlFact[]> {
  const facts: PnlFact[] = [];
  for (const row of await receipts(ctx, period)) {
    const category = revenueCategoryOfQuote(row);
    for (const [day, sign] of [[row.verifiedDay, 1n], [row.rejectedDay, -1n]] as const) {
      if (!within(day, period)) continue;
      const gross = await convert.amount(row.amount, row.currency, day!);
      if (gross === null) continue;
      const net = sub(gross, taxInside(gross, row.rate, ctx.currency));
      facts.push({ column, section: "revenue", category, key: category, label: category, amount: money(units(net) * sign) });
    }
  }
  return facts;
}

/** Cash in by month: client payments (settling an invoice) and advances (before one), gross as received. */
export async function receiptCash(ctx: Ctx, months: Period[], convert: Converter): Promise<CashFact[]> {
  const period = { from: months[0].from, to: months[months.length - 1].to };
  const facts: CashFact[] = [];
  for (const row of await receipts(ctx, period)) {
    for (const [day, sign] of [[row.verifiedDay, 1n], [row.rejectedDay, -1n]] as const) {
      const column = months.findIndex((month) => within(day, month));
      if (column < 0) continue;
      const gross = await convert.amount(row.amount, row.currency, day!);
      if (gross === null) continue;
      facts.push({ column, section: "cash_in", row: row.advance ? "client_advances" : "client_payments", amount: money(units(gross) * sign) });
    }
  }
  return facts;
}

// ---------------------------------------------------------------------------------------------------------------
// Costs.

const SERVICE_LINE = `(EXISTS (SELECT 1 FROM project_boq_lines scope JOIN project_packages bought ON bought.workspace_id = scope.workspace_id AND bought.id = scope.package_id
                        WHERE scope.workspace_id = ordered.workspace_id AND scope.id = ordered.boq_line_id AND bought.supply IN ('subcontract', 'site_work'))
                      OR ordered.work_order_id IS NOT NULL)`;

type BillLine = { day: string; vendorId: string; net: string; tax: string; total: string; currency: string; projectId: string | null; ordered: boolean; service: boolean;
  accountType: string | null; accountSubtype: string | null; templateKey: string | null; roles: string[] | null; accountId: string | null; accountCode: string | null;
  accountName: string | null };

/** Approved supplier bill lines of the company (cancelled bills are left out), with the account a person coded and what the order line bought. */
async function billLines(ctx: Ctx, period: Period | null): Promise<BillLine[]> {
  return (await ctx.db.query<BillLine>(
    `SELECT bill.invoice_date::text AS day, bill.vendor_id AS "vendorId", line.net::text AS net, line.tax::text AS tax, line.total::text AS total, bill.currency,
            coalesce(line.project_id, ordered.project_id) AS "projectId", line.order_line_id IS NOT NULL AS ordered, coalesce(${SERVICE_LINE}, false) AS service,
            account.type AS "accountType", account.subtype AS "accountSubtype", account.template_key AS "templateKey", account.id AS "accountId", account.code AS "accountCode",
            account.name AS "accountName",
            (SELECT array_agg(mapping.role::text) FROM books_account_roles mapping WHERE mapping.workspace_id = account.workspace_id AND mapping.account_id = account.id) AS roles
       FROM supplier_invoice_lines line
       JOIN supplier_invoices bill ON bill.workspace_id = line.workspace_id AND bill.id = line.invoice_id
       LEFT JOIN purchase_order_lines ordered ON ordered.workspace_id = line.workspace_id AND ordered.id = line.order_line_id
       LEFT JOIN books_accounts account ON account.workspace_id = line.workspace_id AND account.id = line.books_account_id
      WHERE line.workspace_id = $1 AND bill.legal_entity_id = $2 AND bill.status = 'approved'
        AND ($3::date IS NULL OR bill.invoice_date BETWEEN $3::date AND $4::date)`,
    [ctx.workspaceId, ctx.legalEntityId, period?.from ?? null, period?.to ?? null])).rows;
}

/** Where a bill line's cost goes: what its order line bought, else the account a person coded, else project or general costs. */
function placeOfBillLine(line: BillLine): { section: PnlFact["section"]; category: PnlCostCategory | null; key: string; label: string; accountId: string | null; code: string | null } {
  if (line.ordered) return line.service
    ? { section: "cost_of_sales", category: "subcontract_labour", key: "subcontract_labour", label: "subcontract_labour", accountId: null, code: null }
    : { section: "cost_of_sales", category: "materials", key: "materials", label: "materials", accountId: null, code: null };
  if (line.accountId && line.accountType) {
    const place = placeOfAccount({ type: line.accountType, subtype: line.accountSubtype ?? "", roles: line.roles ?? [], templateKey: line.templateKey }, null);
    if (place) return { section: place.section, category: place.category as PnlCostCategory | null, key: `account:${line.accountId}`, label: line.accountName ?? "",
      accountId: line.accountId, code: line.accountCode };
  }
  return line.projectId
    ? { section: "cost_of_sales", category: "other_costs", key: "other_costs", label: "other_costs", accountId: null, code: null }
    : { section: "operating_expenses", category: null, key: "supplier_charges", label: "Supplier charges", accountId: null, code: null };
}

/** The company's projects: contracted by it, or every project when it is the workspace's only company. */
async function companyProjects(ctx: Ctx): Promise<string[]> {
  return (await ctx.db.query<{ id: string }>(
    `SELECT project.id FROM delivery_projects project
      WHERE project.workspace_id = $1 AND ${ofCompany(projectCompany("project.id"))}
      ORDER BY project.created_at, project.id`, [ctx.workspaceId, ctx.legalEntityId])).rows.map((row) => row.id);
}

const COST_PLACE: Record<string, PnlCostCategory> = { stock: "materials", price_difference: "materials", service: "subcontract_labour", charge: "other_costs", petty_cash: "other_costs" };

/**
 * Accrual costs: what every project of the company carries (the Money tab's spent: stock, services, bill
 * differences and charges, labour and petty cash), plus bill lines that belong to no project.
 */
export async function accruedCosts(ctx: Ctx, period: Period, column: number): Promise<{ facts: PnlFact[]; uncosted: number }> {
  const facts: PnlFact[] = [];
  let uncosted = 0;
  const factory = new Set((await ctx.db.query<{ id: string }>(`SELECT id::text FROM work_order_reports WHERE workspace_id = $1`, [ctx.workspaceId])).rows.map((row) => row.id));
  const convert = new Converter(ctx);
  for (const projectId of await companyProjects(ctx)) {
    const costs = await readProjectCosts(ctx.db, ctx.workspaceId, projectId);
    uncosted += costs.uncosted;
    for (const entry of costs.entries) {
      if (entry.on < period.from || entry.on > period.to) continue;
      const amount = await convert.amount(entry.amount, costs.currency, entry.on);
      if (amount === null) continue;
      const category: PnlCostCategory = entry.source === "labour"
        ? (factory.has(entry.key.split(":")[1] ?? "") ? "factory" : "subcontract_labour")
        : COST_PLACE[entry.source] ?? "other_costs";
      facts.push({ column, section: "cost_of_sales", category, key: category, label: category, amount });
    }
  }
  for (const line of await billLines(ctx, period)) {
    // Project lines are counted by their project above; ordered goods and services count when they reach a project
    // (stock bought for the store is not a cost until it is issued). What is left: charges outside projects.
    if (line.projectId || line.ordered) continue;
    const place = placeOfBillLine(line);
    const amount = await convert.amount(line.net, line.currency, line.day);
    if (amount === null) continue;
    facts.push({ column, section: place.section, category: place.category, key: place.key, label: place.label, accountId: place.accountId, code: place.code, amount });
  }
  return { facts, uncosted: uncosted + convert.missing };
}

type PaymentRow = { id: string; day: string; vendorId: string; amount: string; currency: string };

/** Supplier payments recorded in a period (reversed ones are left out). */
async function supplierPayments(ctx: Ctx, period: Period): Promise<PaymentRow[]> {
  return (await ctx.db.query<PaymentRow>(
    `SELECT payment.id, payment.paid_on::text AS day, payment.vendor_id AS "vendorId", payment.amount::text AS amount, payment.currency
       FROM supplier_payments payment
      WHERE payment.workspace_id = $1 AND payment.legal_entity_id = $2 AND payment.status <> 'reversed' AND payment.paid_on BETWEEN $3::date AND $4::date
      ORDER BY payment.paid_on, payment.id`, [ctx.workspaceId, ctx.legalEntityId, period.from, period.to])).rows;
}

type PettyRow = { day: string; amount: string; currency: string };

async function pettyCashReimbursed(ctx: Ctx, period: Period): Promise<PettyRow[]> {
  return (await ctx.db.query<PettyRow>(
    `SELECT ${localDay("claim.reimbursed_at")}::text AS day, claim.amount::text AS amount, claim.currency
       FROM petty_cash_claims claim
      WHERE claim.workspace_id = $1 AND claim.reimbursed_at IS NOT NULL AND ${ofCompany(projectCompany("claim.project_id"))}
        AND ${localDay("claim.reimbursed_at")} BETWEEN $3::date AND $4::date`, [ctx.workspaceId, ctx.legalEntityId, period.from, period.to])).rows;
}

/**
 * Cash costs: supplier payments, net of the tax inside them, spread over what the supplier's approved bills were
 * for (materials, subcontract, charges by account); petty cash when reimbursed. Payments to a supplier without an
 * approved bill count as other costs.
 */
export async function cashCosts(ctx: Ctx, period: Period, column: number, convert: Converter): Promise<PnlFact[]> {
  const facts: PnlFact[] = [];
  const mix = new Map<string, { total: bigint; tax: bigint; parts: Map<string, { place: ReturnType<typeof placeOfBillLine>; net: bigint }> }>();
  for (const line of await billLines(ctx, null)) {
    const total = await convert.amount(line.total, line.currency, line.day);
    const tax = await convert.amount(line.tax, line.currency, line.day);
    const net = await convert.amount(line.net, line.currency, line.day);
    if (total === null || tax === null || net === null) continue;
    const vendor = mix.get(line.vendorId) ?? { total: 0n, tax: 0n, parts: new Map() };
    vendor.total += units(total); vendor.tax += units(tax);
    const place = placeOfBillLine(line);
    const part = vendor.parts.get(place.key) ?? { place, net: 0n };
    part.net += units(net);
    vendor.parts.set(place.key, part);
    mix.set(line.vendorId, vendor);
  }
  for (const payment of await supplierPayments(ctx, period)) {
    const paid = await convert.amount(payment.amount, payment.currency, payment.day);
    if (paid === null) continue;
    const vendor = mix.get(payment.vendorId);
    if (!vendor || vendor.total === 0n) {
      facts.push({ column, section: "cost_of_sales", category: "other_costs", key: "other_costs", label: "other_costs", amount: paid });
      continue;
    }
    // Shares in the company currency's minor units (the last part takes what rounding leaves), so they add up exactly.
    const step = 10n ** BigInt(4 - Math.min(4, currencyDecimals(ctx.currency)));
    const net = roundTo(units(paid) - (units(paid) * vendor.tax) / vendor.total, step);
    const parts = [...vendor.parts.values()];
    const netTotal = parts.reduce((sum, part) => sum + part.net, 0n);
    let left = net;
    parts.forEach((part, index) => {
      const share = index === parts.length - 1 ? left : netTotal === 0n ? 0n : roundTo((net * part.net) / netTotal, step);
      left -= share;
      facts.push({ column, section: part.place.section, category: part.place.category, key: part.place.key, label: part.place.label,
        accountId: part.place.accountId, code: part.place.code, amount: money(share) });
    });
  }
  for (const claim of await pettyCashReimbursed(ctx, period)) {
    const amount = await convert.amount(claim.amount, claim.currency, claim.day);
    if (amount !== null) facts.push({ column, section: "cost_of_sales", category: "other_costs", key: "other_costs", label: "other_costs", amount });
  }
  return facts;
}

/** Cash out by month from documents: supplier payments and petty cash reimbursed. */
export async function paymentCash(ctx: Ctx, months: Period[], convert: Converter): Promise<CashFact[]> {
  const period = { from: months[0].from, to: months[months.length - 1].to };
  const facts: CashFact[] = [];
  for (const payment of await supplierPayments(ctx, period)) {
    const column = months.findIndex((month) => within(payment.day, month));
    const amount = await convert.amount(payment.amount, payment.currency, payment.day);
    if (column >= 0 && amount !== null) facts.push({ column, section: "cash_out", row: "supplier_payments", amount });
  }
  for (const claim of await pettyCashReimbursed(ctx, period)) {
    const column = months.findIndex((month) => within(claim.day, month));
    const amount = await convert.amount(claim.amount, claim.currency, claim.day);
    if (column >= 0 && amount !== null) facts.push({ column, section: "cash_out", row: "expenses", amount });
  }
  return facts;
}

/** The net of every client payment, supplier payment and reimbursement recorded before `day` (operational cash's opening). */
export async function cashBefore(ctx: Ctx, day: string, convert: Converter): Promise<string> {
  const start = "1900-01-01";
  const before = { from: start, to: addDay(day, -1) };
  if (before.to < start) return ZERO;
  const ins = await receiptCash(ctx, [before], convert);
  const outs = await paymentCash(ctx, [before], convert);
  return sub(add(...ins.map((fact) => fact.amount)), add(...outs.map((fact) => fact.amount)));
}

const addDay = (day: string, days: number) => { const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };

// ---------------------------------------------------------------------------------------------------------------
// Forecast.

/**
 * What is due in the next 90 days, in three 30-day buckets after today (anything overdue counts in the first):
 * client milestones still to be paid (by their live invoice's due date, else the milestone's) and approved supplier
 * bills still to be paid (each supplier's payments settle its oldest bills first).
 */
export async function dueSoon(ctx: Ctx, buckets: Period[], convert: Converter): Promise<{ receipts: string[]; payments: string[] }> {
  const last = buckets[buckets.length - 1].to;
  const receiptsDue = Array.from({ length: buckets.length }, () => 0n);
  const paymentsDue = Array.from({ length: buckets.length }, () => 0n);
  const bucketOf = (day: string) => { const index = buckets.findIndex((bucket) => day <= bucket.to); return index < 0 ? -1 : index; };
  const milestones = (await ctx.db.query<{ due: string | null; amount: string; received: string; currency: string | null; caseCurrency: string | null }>(
    `SELECT coalesce((SELECT live.due_date FROM client_invoices live WHERE live.workspace_id = milestone.workspace_id AND live.case_id = milestone.case_id
                        AND live.payment_id = milestone.id AND live.status = 'issued' LIMIT 1), milestone.due_date)::text AS due,
            milestone.amount::text AS amount, milestone.currency,
            coalesce((SELECT sum(receipt.amount) FROM commercial_receipts receipt WHERE receipt.workspace_id = milestone.workspace_id AND receipt.case_id = milestone.case_id
                        AND receipt.payment_id = milestone.id AND receipt.status = 'finance_verified'), 0)::text AS received,
            (SELECT max(quote.currency) FROM commercial_quotes quote WHERE quote.workspace_id = milestone.workspace_id AND quote.case_id = milestone.case_id) AS "caseCurrency"
       FROM commercial_payments milestone
      WHERE milestone.workspace_id = $1 AND milestone.amount > 0
        AND EXISTS (SELECT 1 FROM delivery_projects project WHERE project.workspace_id = milestone.workspace_id AND project.case_id = milestone.case_id)
        AND ${ofCompany(textCompany("coalesce(nullif(milestone.legal_entity_id, ''), (SELECT live.legal_entity_id::text FROM client_invoices live WHERE live.workspace_id = milestone.workspace_id AND live.case_id = milestone.case_id AND live.payment_id = milestone.id ORDER BY live.issued_at DESC LIMIT 1))"))}`,
    [ctx.workspaceId, ctx.legalEntityId])).rows;
  const today = addDay(buckets[0].from, -1);
  for (const row of milestones) {
    if (!row.due || row.due > last) continue;
    const open = units(row.amount) - units(row.received);
    if (open <= 0n) continue;
    const amount = await convert.amount(money(open), row.currency ?? row.caseCurrency ?? ctx.currency, today);
    if (amount === null) continue;
    receiptsDue[Math.max(0, bucketOf(row.due))] += units(amount);
  }
  // Payables: each supplier's payments settle its oldest approved bills first; what is left falls due on its due date.
  const bills = (await ctx.db.query<{ vendorId: string; due: string; total: string; currency: string }>(
    `SELECT bill.vendor_id AS "vendorId", coalesce(bill.due_date, bill.invoice_date)::text AS due, bill.total::text AS total, bill.currency
       FROM supplier_invoices bill WHERE bill.workspace_id = $1 AND bill.legal_entity_id = $2 AND bill.status = 'approved'
      ORDER BY bill.vendor_id, coalesce(bill.due_date, bill.invoice_date), bill.id`, [ctx.workspaceId, ctx.legalEntityId])).rows;
  const paid = new Map((await ctx.db.query<{ vendorId: string; currency: string; paid: string }>(
    `SELECT payment.vendor_id AS "vendorId", payment.currency, sum(payment.amount)::text AS paid FROM supplier_payments payment
      WHERE payment.workspace_id = $1 AND payment.legal_entity_id = $2 AND payment.status <> 'reversed' GROUP BY 1, 2`,
    [ctx.workspaceId, ctx.legalEntityId])).rows.map((row) => [`${row.vendorId}:${row.currency}`, units(row.paid)]));
  for (const bill of bills) {
    const key = `${bill.vendorId}:${bill.currency}`;
    const credit = paid.get(key) ?? 0n;
    const settled = credit < units(bill.total) ? credit : units(bill.total);
    paid.set(key, credit - settled);
    const open = units(bill.total) - settled;
    if (open <= 0n || bill.due > last) continue;
    const amount = await convert.amount(money(open), bill.currency, today);
    if (amount === null) continue;
    paymentsDue[Math.max(0, bucketOf(bill.due))] += units(amount);
  }
  return { receipts: receiptsDue.map(money), payments: paymentsDue.map(money) };
}

export { Converter };
