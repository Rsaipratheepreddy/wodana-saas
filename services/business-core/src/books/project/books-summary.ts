import type { PoolClient } from "pg";
import { Dec } from "../../catalog-core/decimal";

/**
 * A one-glance summary of a company's Ledger for Woddy's `books_report` (plan §6.21b): the P&L for a period, the
 * balances of cash, receivables and payables at its end, the VAT due for it and the receivables and payables
 * ageing totals. Read straight from the journal lines; the full reports (with drill-down) live in the Ledger.
 */

type Db = Pick<PoolClient, "query">;

export const AGEING_BUCKETS = ["current", "1_30", "31_60", "61_90", "over_90"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];
export type AgeingTotals = Record<AgeingBucket, string> & { total: string };

export type BooksSummary = {
  profitAndLoss: { income: string; costOfSales: string; grossProfit: string; operatingExpenses: string; netProfit: string };
  balances: { cash: string; receivables: string; payables: string };
  vat: { output: string; input: string; due: string };
  receivablesAgeing: AgeingTotals;
  payablesAgeing: AgeingTotals;
};

const fixed = (value: Dec) => value.toFixed(4);

async function roleAccounts(db: Db, workspaceId: string, legalEntityId: string, roles: string[]) {
  return (await db.query<{ id: string }>(
    `SELECT DISTINCT account_id AS id FROM books_account_roles WHERE workspace_id = $1 AND legal_entity_id = $2 AND role = ANY($3::text[])`,
    [workspaceId, legalEntityId, roles])).rows.map((row) => row.id);
}

/** Σdebit − Σcredit on these accounts, from the start (or `from`) to `to`. */
async function movement(db: Db, workspaceId: string, legalEntityId: string, accounts: string[], to: string, from: string | null = null) {
  if (!accounts.length) return Dec.ZERO;
  const row = (await db.query<{ net: string }>(
    `SELECT coalesce(sum(line.debit - line.credit), 0)::text AS net
       FROM books_journal_lines line JOIN books_journals journal ON journal.workspace_id = line.workspace_id AND journal.id = line.journal_id
      WHERE line.workspace_id = $1 AND line.legal_entity_id = $2 AND line.account_id = ANY($3::uuid[])
        AND journal.journal_date <= $4::date AND ($5::date IS NULL OR journal.journal_date >= $5::date)`,
    [workspaceId, legalEntityId, accounts, to, from])).rows[0];
  return Dec.of(row.net);
}

/** Days from `due` to `asOf` (positive when overdue). */
function daysPast(due: string, asOf: string) {
  return Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
}

export function ageingBucket(days: number): AgeingBucket {
  if (days <= 0) return "current";
  if (days <= 30) return "1_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "over_90";
}

export type OpenItem = { party: string; amount: string; due: string };

/**
 * Open items per party, first in first out: what a party owes (charges) less what it settled, oldest charge first;
 * the rest of each charge is aged by its due date. A party that settled more than it was charged ages nothing
 * (its credit is current).
 */
export function ageOpenItems(items: readonly OpenItem[], asOf: string): AgeingTotals {
  const byParty = new Map<string, OpenItem[]>();
  for (const item of items) byParty.set(item.party, [...(byParty.get(item.party) ?? []), item]);
  const totals = Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket, Dec.ZERO])) as Record<AgeingBucket, Dec>;
  for (const partyItems of byParty.values()) {
    const charges = partyItems.filter((item) => Dec.of(item.amount).cmp(0) > 0).sort((a, b) => a.due.localeCompare(b.due)).map((item) => ({ due: item.due, left: Dec.of(item.amount) }));
    let settled = partyItems.filter((item) => Dec.of(item.amount).cmp(0) < 0).reduce((sum, item) => sum.add(Dec.of(item.amount).neg()), Dec.ZERO);
    for (const charge of charges) {
      const used = settled.cmp(charge.left) >= 0 ? charge.left : settled;
      charge.left = charge.left.sub(used);
      settled = settled.sub(used);
    }
    for (const charge of charges) {
      if (charge.left.isZero()) continue;
      const bucket = ageingBucket(daysPast(charge.due, asOf));
      totals[bucket] = totals[bucket].add(charge.left);
    }
    if (settled.cmp(0) > 0) totals.current = totals.current.sub(settled);
  }
  const result = Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket, fixed(totals[bucket])])) as Record<AgeingBucket, string>;
  return { ...result, total: fixed(AGEING_BUCKETS.reduce((sum, bucket) => sum.add(totals[bucket]), Dec.ZERO)) };
}

/** The control account's lines up to `asOf` as open items: charges positive, due on the source document's due date (else the journal date). */
async function controlItems(db: Db, workspaceId: string, legalEntityId: string, role: "ar_control" | "ap_control", asOf: string): Promise<OpenItem[]> {
  const accounts = await roleAccounts(db, workspaceId, legalEntityId, [role]);
  if (!accounts.length) return [];
  const sign = role === "ar_control" ? "line.debit - line.credit" : "line.credit - line.debit";
  return (await db.query<OpenItem>(
    `SELECT coalesce(line.party_type || ':' || line.party_id::text, '') AS party, (${sign})::text AS amount,
            coalesce(CASE journal.source_type
                       WHEN 'client_invoice' THEN (SELECT invoice.due_date FROM client_invoices invoice
                                                    WHERE invoice.workspace_id = journal.workspace_id AND invoice.id::text = journal.source_id)
                       WHEN 'supplier_bill' THEN (SELECT bill.due_date FROM supplier_invoices bill
                                                   WHERE bill.workspace_id = journal.workspace_id AND bill.id::text = journal.source_id)
                     END, journal.journal_date)::text AS due
       FROM books_journal_lines line JOIN books_journals journal ON journal.workspace_id = line.workspace_id AND journal.id = line.journal_id
      WHERE line.workspace_id = $1 AND line.legal_entity_id = $2 AND line.account_id = ANY($3::uuid[]) AND journal.journal_date <= $4::date
      ORDER BY journal.journal_date, journal.number, line.position`,
    [workspaceId, legalEntityId, accounts, asOf])).rows;
}

export async function readBooksSummary(db: Db, workspaceId: string, legalEntityId: string, period: { from: string; to: string }): Promise<BooksSummary> {
  const pnl = (await db.query<{ type: string; subtype: string; net: string }>(
    `SELECT account.type, account.subtype, sum(line.credit - line.debit)::text AS net
       FROM books_journal_lines line
       JOIN books_journals journal ON journal.workspace_id = line.workspace_id AND journal.id = line.journal_id
       JOIN books_accounts account ON account.workspace_id = line.workspace_id AND account.id = line.account_id
      WHERE line.workspace_id = $1 AND line.legal_entity_id = $2 AND journal.journal_date BETWEEN $3::date AND $4::date AND account.type IN ('income', 'expense')
      GROUP BY account.type, account.subtype`, [workspaceId, legalEntityId, period.from, period.to])).rows;
  const sum = (match: (row: { type: string; subtype: string }) => boolean) => pnl.filter(match).reduce((total, row) => total.add(row.net), Dec.ZERO);
  const income = sum((row) => row.type === "income");
  const costOfSales = sum((row) => row.type === "expense" && row.subtype === "cost_of_sales").neg();
  const operating = sum((row) => row.type === "expense" && row.subtype !== "cost_of_sales").neg();

  const cashAccounts = (await db.query<{ id: string }>(
    `SELECT id FROM books_accounts WHERE workspace_id = $1 AND legal_entity_id = $2 AND type = 'asset' AND subtype IN ('bank', 'cash')`, [workspaceId, legalEntityId])).rows.map((row) => row.id);
  const [ar, ap, output, input] = [await roleAccounts(db, workspaceId, legalEntityId, ["ar_control"]), await roleAccounts(db, workspaceId, legalEntityId, ["ap_control"]),
    await roleAccounts(db, workspaceId, legalEntityId, ["vat_output"]), await roleAccounts(db, workspaceId, legalEntityId, ["vat_input"])];
  const vatOutput = (await movement(db, workspaceId, legalEntityId, output, period.to, period.from)).neg();
  const vatInput = await movement(db, workspaceId, legalEntityId, input, period.to, period.from);
  return {
    profitAndLoss: { income: fixed(income), costOfSales: fixed(costOfSales), grossProfit: fixed(income.sub(costOfSales)), operatingExpenses: fixed(operating),
      netProfit: fixed(income.sub(costOfSales).sub(operating)) },
    balances: {
      cash: fixed(await movement(db, workspaceId, legalEntityId, cashAccounts, period.to)),
      receivables: fixed(await movement(db, workspaceId, legalEntityId, ar, period.to)),
      payables: fixed((await movement(db, workspaceId, legalEntityId, ap, period.to)).neg()),
    },
    vat: { output: fixed(vatOutput), input: fixed(vatInput), due: fixed(vatOutput.sub(vatInput)) },
    receivablesAgeing: ageOpenItems(await controlItems(db, workspaceId, legalEntityId, "ar_control", period.to), period.to),
    payablesAgeing: ageOpenItems(await controlItems(db, workspaceId, legalEntityId, "ap_control", period.to), period.to),
  };
}
