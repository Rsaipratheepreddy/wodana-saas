import { readBooksSettings } from "../ledger/ledger";
import { money, units, ZERO } from "../reports/report-math";
import { placeOfAccount } from "./classify";
import { cashCosts, cashRevenue, Converter, dueSoon } from "./documents";
import { buildCashFlow, buildForecast, buildProfitAndLoss, NOTE_CASH_BASIS, NOTE_NO_RATE, type CashAccountFact, type CashFact, type PnlFact } from "./statement-builder";
import type {
  CashFlowStatement, FinancialStatementProvider, ProfitAndLossStatement, StatementColumn, StatementQuery, StatementSourceCapabilities,
} from "./statement-contract";
import { forecastBuckets, monthsOf, type Period } from "./statement-period";
import type { StatementSourceAdapter, StatementSourceContext } from "./statement-source";

/**
 * The Wodana Ledger as a statement source. Accrual P&L from posted journals (income and expense accounts by journal
 * date), each line placed by its account's posting role: revenue split by the quotation an invoice came from
 * (design round, variation, production), labour reported on a work order as factory. Cash basis from the money that
 * moved (client and supplier payments, petty cash), as operational cash reads it. Cash flow from the bank and cash
 * accounts' lines, classified by what each journal records, with every account's opening and closing per month.
 */

export const LEDGER_CAPABILITIES: StatementSourceCapabilities = { accrual: true, cash: true, drillDown: true, cashAccounts: true, forecast: true };

type PnlRow = {
  accountId: string; code: string; name: string; type: string; subtype: string; templateKey: string | null; roles: string[];
  parentId: string | null; parentCode: string | null; parentName: string | null; hint: string | null; debit: string; credit: string;
};

/** Income and expense movements of the company in a period, per account and per what the journal says about the line. */
async function pnlRows(ctx: StatementSourceContext, period: Period, projectId: string | null): Promise<PnlRow[]> {
  return (await ctx.db.query<PnlRow>(
    `SELECT account.id AS "accountId", account.code, account.name, account.type, account.subtype, account.template_key AS "templateKey",
            coalesce((SELECT array_agg(mapping.role::text ORDER BY mapping.role) FROM books_account_roles mapping
                       WHERE mapping.workspace_id = account.workspace_id AND mapping.legal_entity_id = account.legal_entity_id AND mapping.account_id = account.id), '{}') AS roles,
            parent.id AS "parentId", parent.code AS "parentCode", parent.name AS "parentName",
            CASE
              WHEN journal.source_type IN ('client_invoice', 'client_credit_note') THEN (
                SELECT CASE WHEN quote.kind = 'variation' THEN 'variations' WHEN quote.round = 'design' THEN 'design_fees' ELSE 'production' END
                  FROM client_invoices invoice
                  JOIN commercial_quotes quote ON quote.workspace_id = invoice.workspace_id AND quote.case_id = invoice.case_id AND quote.id = invoice.quote_id
                 WHERE invoice.workspace_id = journal.workspace_id
                   AND invoice.id::text = CASE WHEN journal.source_type = 'client_invoice' THEN journal.source_id
                                               ELSE (SELECT credit.invoice_id::text FROM client_credit_notes credit
                                                      WHERE credit.workspace_id = journal.workspace_id AND credit.id::text = journal.source_id) END)
              WHEN journal.source_type = 'labour' AND EXISTS (SELECT 1 FROM work_order_reports report WHERE report.workspace_id = journal.workspace_id
                                                              AND report.id::text = split_part(journal.source_id, ':', 2)) THEN 'factory'
            END AS hint,
            sum(line.debit)::numeric(24, 4)::text AS debit, sum(line.credit)::numeric(24, 4)::text AS credit
       FROM books_journal_lines line
       JOIN books_journals journal ON journal.workspace_id = line.workspace_id AND journal.id = line.journal_id
       JOIN books_accounts account ON account.workspace_id = line.workspace_id AND account.legal_entity_id = line.legal_entity_id AND account.id = line.account_id
       LEFT JOIN books_accounts parent ON parent.workspace_id = account.workspace_id AND parent.legal_entity_id = account.legal_entity_id AND parent.id = account.parent_id
      WHERE line.workspace_id = $1 AND line.legal_entity_id = $2 AND journal.journal_date BETWEEN $3::date AND $4::date
        AND account.type IN ('income', 'expense') AND ($5::uuid IS NULL OR line.project_id = $5::uuid)
      GROUP BY account.id, parent.id, hint`, [ctx.workspaceId, ctx.legalEntityId, period.from, period.to, projectId])).rows;
}

/** The P&L facts of one period from journals: income credit-positive, expenses debit-positive. */
export function ledgerPnlFacts(rows: readonly PnlRow[], column: number): PnlFact[] {
  const facts: PnlFact[] = [];
  for (const row of rows) {
    const place = placeOfAccount({ type: row.type, subtype: row.subtype, roles: row.roles, templateKey: row.templateKey }, row.hint);
    if (!place) continue;
    const amount = row.type === "income" ? money(units(row.credit) - units(row.debit)) : money(units(row.debit) - units(row.credit));
    if (units(amount) === 0n) continue;
    // Operating expenses group by their parent account (the chart's account groups); the others by category.
    const group = place.section === "operating_expenses" && row.parentId ? { category: `group:${row.parentId}`, categoryLabel: row.parentName ?? row.parentCode } : null;
    facts.push({
      column, section: place.section, category: group?.category ?? place.category, categoryLabel: group?.categoryLabel ?? null,
      key: `account:${row.accountId}`, label: row.name, code: row.code, accountId: row.accountId, amount,
    });
  }
  return facts;
}

type CashJournal = { day: string; sourceType: string; kind: string; cash: string; contraType: string | null; contraSubtype: string | null; contraTemplate: string | null;
  contraRoles: string[] | null };

/** The cash flow row of a journal that moved cash, from what it records (its source, else the account on its other side). */
export function cashRowOf(journal: Pick<CashJournal, "sourceType" | "cash" | "contraType" | "contraSubtype" | "contraTemplate" | "contraRoles">): CashFact["row"] {
  const inflow = units(journal.cash) > 0n;
  const roles = journal.contraRoles ?? [];
  switch (journal.sourceType) {
    case "receipt": return roles.includes("client_advances") ? "client_advances" : "client_payments";
    case "supplier_payment": return "supplier_payments";
    case "petty_cash": return "expenses";
  }
  if (journal.contraSubtype === "tax" || roles.some((role) => role === "vat_output" || role === "vat_input")) return "tax";
  if (roles.includes("ar_control") || roles.includes("client_advances")) return inflow ? "client_payments" : "other_payments";
  if (roles.includes("ap_control")) return inflow ? "other_receipts" : "supplier_payments";
  if (journal.contraTemplate === "salaries" || roles.some((role) => role === "cost_labour" || role === "labour_absorbed") || journal.contraSubtype === "salaries") return "labour";
  if (journal.contraType === "expense") return inflow ? "other_receipts" : "expenses";
  return inflow ? "other_receipts" : "other_payments";
}

/** The day a journal counts on in a cash flow: an opening balance belongs before the day it is dated. */
const EFFECTIVE_DAY = `(journal.journal_date - CASE WHEN journal.kind = 'opening' THEN 1 ELSE 0 END)`;

async function cashFacts(ctx: StatementSourceContext, months: Period[]): Promise<{ facts: CashFact[]; accounts: CashAccountFact[] }> {
  const from = months[0].from, to = months[months.length - 1].to;
  const bank = `SELECT cash_account.id FROM books_accounts cash_account WHERE cash_account.workspace_id = $1 AND cash_account.legal_entity_id = $2
                  AND cash_account.type = 'asset' AND cash_account.subtype IN ('bank', 'cash')`;
  const journals = (await ctx.db.query<CashJournal>(
    `WITH moved AS (
       SELECT journal.id, ${EFFECTIVE_DAY}::text AS day, journal.source_type AS "sourceType", journal.kind,
              sum(line.debit - line.credit) FILTER (WHERE line.account_id IN (${bank}))::numeric(24, 4)::text AS cash,
              count(*) FILTER (WHERE line.account_id NOT IN (${bank})) AS others
         FROM books_journals journal
         JOIN books_journal_lines line ON line.workspace_id = journal.workspace_id AND line.journal_id = journal.id
        WHERE journal.workspace_id = $1 AND journal.legal_entity_id = $2 AND ${EFFECTIVE_DAY} BETWEEN $3::date AND $4::date
        GROUP BY journal.id)
     SELECT moved.day, moved."sourceType", moved.kind, moved.cash, contra.type AS "contraType", contra.subtype AS "contraSubtype",
            contra.template_key AS "contraTemplate", contra.roles AS "contraRoles"
       FROM moved
       LEFT JOIN LATERAL (
         SELECT account.type, account.subtype, account.template_key,
                (SELECT array_agg(mapping.role::text) FROM books_account_roles mapping WHERE mapping.workspace_id = account.workspace_id AND mapping.account_id = account.id) AS roles
           FROM books_journal_lines other
           JOIN books_accounts account ON account.workspace_id = other.workspace_id AND account.id = other.account_id
          WHERE other.workspace_id = $1 AND other.journal_id = moved.id AND other.account_id NOT IN (${bank})
          ORDER BY abs(other.debit - other.credit) DESC, other.position LIMIT 1) contra ON true
      WHERE moved.cash IS NOT NULL AND moved.cash::numeric <> 0 AND moved.others > 0`,
    [ctx.workspaceId, ctx.legalEntityId, from, to])).rows;
  const facts: CashFact[] = [];
  for (const journal of journals) {
    const column = months.findIndex((month) => journal.day >= month.from && journal.day <= month.to);
    if (column < 0) continue;
    const row = cashRowOf(journal);
    const inSection = row === "client_payments" || row === "client_advances" || row === "other_receipts";
    // Cash in rows add what came in (a reversal takes off); cash out rows add what went out.
    facts.push({ column, section: inSection ? "cash_in" : "cash_out", row, amount: inSection ? journal.cash : money(-units(journal.cash)) });
  }
  const balances = (await ctx.db.query<{ accountId: string; code: string; name: string; opening: string; movements: string[] }>(
    `SELECT account.id AS "accountId", account.code, account.name,
            coalesce((SELECT sum(line.debit - line.credit) FROM books_journal_lines line
                        JOIN books_journals journal ON journal.workspace_id = line.workspace_id AND journal.id = line.journal_id
                       WHERE line.workspace_id = $1 AND line.account_id = account.id AND ${EFFECTIVE_DAY} < $3::date), 0)::numeric(24, 4)::text AS opening,
            ARRAY(SELECT coalesce((SELECT sum(line.debit - line.credit) FROM books_journal_lines line
                                     JOIN books_journals journal ON journal.workspace_id = line.workspace_id AND journal.id = line.journal_id
                                    WHERE line.workspace_id = $1 AND line.account_id = account.id
                                      AND ${EFFECTIVE_DAY} BETWEEN (month->>'from')::date AND (month->>'to')::date), 0)::numeric(24, 4)::text
                    FROM jsonb_array_elements($4::jsonb) WITH ORDINALITY AS months(month, position) ORDER BY position) AS movements
       FROM books_accounts account
      WHERE account.workspace_id = $1 AND account.legal_entity_id = $2 AND account.type = 'asset' AND account.subtype IN ('bank', 'cash')
      ORDER BY account.code`,
    [ctx.workspaceId, ctx.legalEntityId, from, JSON.stringify(months)])).rows;
  const accounts = balances
    .filter((row) => units(row.opening) !== 0n || row.movements.some((value) => units(value) !== 0n))
    .map((row) => ({ key: `account:${row.accountId}`, label: row.name, accountId: row.accountId, opening: row.opening, movements: row.movements }));
  return { facts, accounts };
}

const header = (ctx: StatementSourceContext, query: StatementQuery, notes: string[] = []) => ({
  source: "ledger" as const, sourceLabel: null, basis: query.basis, currency: ctx.currency, legalEntityId: ctx.legalEntityId,
  projectId: query.projectId ?? null, generatedAt: new Date().toISOString(), notes,
});

export class LedgerStatementProvider implements FinancialStatementProvider {
  readonly source = "ledger" as const;
  constructor(private readonly ctx: StatementSourceContext) {}

  async capabilities() { return LEDGER_CAPABILITIES; }

  async profitAndLoss(query: StatementQuery): Promise<ProfitAndLossStatement> {
    const columns: StatementColumn[] = [{ key: "current", from: query.from, to: query.to, role: "current" }];
    if (query.basis === "cash") {
      const convert = new Converter(this.ctx);
      const facts = [...await cashRevenue(this.ctx, query, 0, convert), ...await cashCosts(this.ctx, query, 0, convert)];
      const notes = [NOTE_CASH_BASIS];
      if (convert.missing) notes.push(NOTE_NO_RATE);
      return buildProfitAndLoss(header(this.ctx, query, notes), columns, facts);
    }
    const facts = ledgerPnlFacts(await pnlRows(this.ctx, query, query.projectId ?? null), 0);
    return buildProfitAndLoss(header(this.ctx, query), columns, facts);
  }

  async cashFlow(query: StatementQuery): Promise<CashFlowStatement> {
    const months = monthsOf(query);
    const columns: StatementColumn[] = months.map((month, index) => ({ key: `m${index}`, from: month.from, to: month.to, role: "month" }));
    const { facts, accounts } = await cashFacts(this.ctx, months);
    const statement = buildCashFlow(header(this.ctx, { ...query, basis: "cash" }), columns, { facts, accounts });
    // The forecast runs from today, when the period reaches today.
    if (query.to >= this.ctx.today) {
      const buckets = forecastBuckets(this.ctx.today);
      const convert = new Converter(this.ctx);
      const due = await dueSoon(this.ctx, buckets, convert);
      const cashNow = await this.cashToday();
      statement.forecast = buildForecast(buckets.map((bucket, index) => ({ key: `f${index}`, from: bucket.from, to: bucket.to, role: "forecast" })),
        due.receipts, due.payments, cashNow);
    }
    return statement;
  }

  /** Cash in the company's bank and cash accounts at the end of today. */
  private async cashToday() {
    return (await this.ctx.db.query<{ cash: string }>(
      `SELECT coalesce(sum(line.debit - line.credit), 0)::numeric(24, 4)::text AS cash
         FROM books_journal_lines line
         JOIN books_journals journal ON journal.workspace_id = line.workspace_id AND journal.id = line.journal_id
         JOIN books_accounts account ON account.workspace_id = line.workspace_id AND account.id = line.account_id
        WHERE line.workspace_id = $1 AND line.legal_entity_id = $2 AND account.type = 'asset' AND account.subtype IN ('bank', 'cash')
          AND journal.journal_date <= $3::date`, [this.ctx.workspaceId, this.ctx.legalEntityId, this.ctx.today])).rows[0]?.cash ?? ZERO;
  }
}

export const ledgerStatementSource: StatementSourceAdapter = {
  source: "ledger",
  async availability(ctx) {
    const settings = await readBooksSettings(ctx.db, ctx.workspaceId, ctx.legalEntityId);
    const journals = settings ? Boolean((await ctx.db.query(`SELECT 1 FROM books_journals WHERE workspace_id = $1 AND legal_entity_id = $2 LIMIT 1`,
      [ctx.workspaceId, ctx.legalEntityId])).rowCount) : false;
    return { available: Boolean(settings?.enabled || journals), label: null };
  },
  provider: (ctx) => new LedgerStatementProvider(ctx),
};
