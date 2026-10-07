import type { BooksPartyType } from "../books-contract";
import type { Db } from "../ledger/ledger";
import { daysBetween, money, units } from "./report-math";
import { partyNames } from "./parties";
import { AGEING_BUCKETS, type AgeingBucket, type AgeingReport, type AgeingRow, type BooksReportQuery, type ReportEntity } from "./report-types";

/**
 * Receivables and payables ageing at `to`, from the sub-ledger: the control account's lines by party. Within each
 * party, payments and credits settle the oldest open items first; what is left ages from its due date (the client
 * invoice's or supplier invoice's, else the journal date). Lines on the control account without a party (opening
 * balances, corrections) are the reconciling line, so parties + unlinked = the control account's balance.
 */

type ControlLine = {
  partyType: BooksPartyType | null; partyId: string | null; journalDate: string; dueDate: string | null; debit: string; credit: string;
};

export function bucketFor(days: number): AgeingBucket {
  if (days <= 0) return "current";
  if (days <= 30) return "1_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "over_90";
}

/** Ages one party's lines (amounts on the normal side positive): oldest open items settled first. */
export function ageParty(lines: ReadonlyArray<{ day: string; due: string; amount: bigint }>, asOf: string): Record<AgeingBucket, bigint> {
  const buckets = Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket, 0n])) as Record<AgeingBucket, bigint>;
  const open = lines.filter((line) => line.amount > 0n).map((line) => ({ ...line })).sort((a, b) => a.due.localeCompare(b.due) || a.day.localeCompare(b.day));
  let settled = lines.filter((line) => line.amount < 0n).reduce((sum, line) => sum - line.amount, 0n);
  for (const item of open) {
    const take = settled < item.amount ? settled : item.amount;
    item.amount -= take;
    settled -= take;
  }
  for (const item of open) if (item.amount > 0n) buckets[bucketFor(daysBetween(item.due, asOf))] += item.amount;
  // Paid ahead (more settled than owed): shown as a negative amount, not yet due.
  if (settled > 0n) buckets.current -= settled;
  return buckets;
}

export async function readAgeing(db: Db, workspaceId: string, entity: ReportEntity, scope: BooksReportQuery, side: "receivable" | "payable"): Promise<AgeingReport> {
  const role = side === "receivable" ? "ar_control" : "ap_control";
  const control = (await db.query<{ accountId: string; code: string; name: string }>(
    `SELECT account.id AS "accountId", account.code, account.name FROM books_account_roles mapping
       JOIN books_accounts account ON account.workspace_id = mapping.workspace_id AND account.legal_entity_id = mapping.legal_entity_id AND account.id = mapping.account_id
      WHERE mapping.workspace_id = $1 AND mapping.legal_entity_id = $2 AND mapping.role = $3`, [workspaceId, scope.legalEntityId, role])).rows[0];
  const base = { report: side === "receivable" ? "ar-ageing" as const : "ap-ageing" as const, scope, entity, generatedAt: new Date().toISOString(), side };
  const zeroTotals = { ...Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket, "0.0000"])), total: "0.0000" } as AgeingReport["totals"];
  if (!control) return { ...base, rows: [], totals: zeroTotals, control: null, unlinked: "0.0000", reconciled: true };

  // Due dates: the client invoice (P1) or supplier invoice (P5) the journal posted, when it names one.
  const lines = (await db.query<ControlLine>(
    `SELECT line.party_type AS "partyType", line.party_id AS "partyId", journal.journal_date::text AS "journalDate",
            CASE WHEN journal.source_type = 'client_invoice' THEN (SELECT invoice.due_date::text FROM client_invoices invoice
                   WHERE invoice.workspace_id = journal.workspace_id AND invoice.id::text = journal.source_id)
                 WHEN journal.source_type = 'supplier_bill' THEN (SELECT bill.due_date::text FROM supplier_invoices bill
                   WHERE bill.workspace_id = journal.workspace_id AND bill.id::text = journal.source_id) END AS "dueDate",
            line.debit::text AS debit, line.credit::text AS credit
       FROM books_journal_lines line
       JOIN books_journals journal ON journal.workspace_id = line.workspace_id AND journal.id = line.journal_id
      WHERE line.workspace_id = $1 AND line.legal_entity_id = $2 AND line.account_id = $3 AND journal.journal_date <= $4::date
      ORDER BY journal.journal_date, journal.number, line.position`, [workspaceId, scope.legalEntityId, control.accountId, scope.to])).rows;

  const normal = (line: ControlLine) => side === "receivable" ? units(line.debit) - units(line.credit) : units(line.credit) - units(line.debit);
  const byParty = new Map<string, { type: BooksPartyType; id: string; items: Array<{ day: string; due: string; amount: bigint }> }>();
  let unlinked = 0n, balance = 0n;
  for (const line of lines) {
    const amount = normal(line);
    balance += amount;
    if (!line.partyType || !line.partyId) { unlinked += amount; continue; }
    const key = `${line.partyType}:${line.partyId}`;
    const party = byParty.get(key) ?? { type: line.partyType, id: line.partyId, items: [] };
    party.items.push({ day: line.journalDate, due: line.dueDate && line.dueDate >= line.journalDate ? line.dueDate : line.journalDate, amount });
    byParty.set(key, party);
  }
  const names = await partyNames(db, workspaceId, [...byParty.values()].map((party) => ({ partyType: party.type, partyId: party.id })));
  const rows: AgeingRow[] = [];
  const totals = Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket, 0n])) as Record<AgeingBucket, bigint>;
  let partiesTotal = 0n;
  for (const [key, party] of byParty) {
    const buckets = ageParty(party.items, scope.to);
    const total = AGEING_BUCKETS.reduce((sum, bucket) => sum + buckets[bucket], 0n);
    if (total === 0n && AGEING_BUCKETS.every((bucket) => buckets[bucket] === 0n)) continue;
    for (const bucket of AGEING_BUCKETS) totals[bucket] += buckets[bucket];
    partiesTotal += total;
    rows.push({ partyType: party.type, partyId: party.id, partyName: names.get(key) ?? "", buckets: Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket, money(buckets[bucket])])) as Record<AgeingBucket, string>,
      total: money(total) });
  }
  rows.sort((a, b) => {
    const difference = units(b.total) - units(a.total);
    return difference > 0n ? 1 : difference < 0n ? -1 : a.partyName.localeCompare(b.partyName);
  });
  return {
    ...base, rows,
    totals: { ...Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket, money(totals[bucket])])), total: money(partiesTotal) } as AgeingReport["totals"],
    control: { accountId: control.accountId, code: control.code, name: control.name, balance: money(balance) },
    unlinked: money(unlinked),
    reconciled: partiesTotal + unlinked === balance,
  };
}
