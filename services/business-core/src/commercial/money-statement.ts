import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { currencyDecimals } from "../purchasing/orders";
import { commercialRepository } from "./commercial-repository";
import type { CommercialData, Quote } from "./commercial.types";

type Db = Pick<PoolClient, "query">;

/**
 * §0.3 P8, the job's money statement: one calculation for every screen (the job, the client portal, handover), so the
 * same figure is never worked out twice. Exact to the currency's minor units: amounts are decimals, rounded once at
 * the currency's places; nothing passes through floating point arithmetic.
 *
 * - agreed: every accepted quotation (the design fee, the estimate) and accepted change (a deduction takes away);
 * - received: finance-verified receipts (the money that arrived, part payments included), not milestone amounts; a
 *   milestone's share follows the receipt allocations exactly as the portal and receivables read them;
 * - due: agreed less received (never below zero; above it, the client is in credit);
 * - checks: a schedule that doesn't add up to its quote, and verified receipts not in the ledger for the same amount.
 */
export type StatementLine = { id: string; kind: "design" | "quotation" | "addition" | "deduction"; title: string; number: number; agreed: string; scheduled: string };
export type StatementMilestone = { id: string; title: string; quoteId: string | null; amount: string; received: string; remaining: string; dueDate: string | null; overdue: boolean };
export type JobMoneyStatement = {
  currency: string;
  agreed: string; received: string; due: string; credit: string; overdue: string;
  /** Money that arrived and is verified but not yet allocated to a milestone. */
  unallocated: string;
  next: { id: string; title: string; amount: string; dueDate: string | null } | null;
  lines: StatementLine[];
  milestones: StatementMilestone[];
  /** Exactness checks: an empty list is a statement that reconciles to the minor unit. */
  checks: Array<{ kind: "schedule_gap"; quoteId: string; title: string; difference: string } | { kind: "not_posted" | "posted_differently"; receiptId: string; amount: string; posted: string | null }>;
};

const ACCEPTED = new Set(["accepted"]);

/** The total the client accepted on a quote (an option they chose changes it), exact at the currency's places. */
function acceptedTotal(quote: Quote, places: number) {
  return Dec.of(quote.clientDecision?.acceptedTotal ?? quote.total).round(places);
}

/** The statement from the deal's records; `posted` maps a verified receipt's id to the amount its ledger journal carries. */
export function buildStatement(data: Pick<CommercialData, "quotes" | "payments" | "receipts" | "allocations"> & { financeContext?: CommercialData["financeContext"] }, input: { currency: string; today: string; posted: Map<string, string> }): JobMoneyStatement {
  const places = currencyDecimals(input.currency);
  const fixed = (value: Dec) => value.toFixed(places);
  const accepted = data.quotes.filter((quote) => ACCEPTED.has(quote.status));
  const lines: StatementLine[] = accepted.map((quote) => {
    const total = acceptedTotal(quote, places);
    const kind: StatementLine["kind"] = quote.kind === "variation" ? (quote.direction === "deduction" ? "deduction" : "addition") : quote.round === "design" ? "design" : "quotation";
    const scheduled = (data.payments ?? []).filter((payment) => payment.sourceQuoteId === quote.id).reduce((sum, payment) => sum.add(Dec.of(payment.amount).round(places)), Dec.ZERO);
    return { id: quote.id, kind, title: quote.title, number: quote.number, agreed: fixed(kind === "deduction" ? total.neg() : total), scheduled: fixed(scheduled) };
  });
  const agreed = lines.reduce((sum, line) => sum.add(line.agreed), Dec.ZERO);
  const verified = (data.receipts ?? []).filter((receipt) => receipt.status === "finance_verified");
  // The same rule as the portal and receivables (readMilestonePaid): under a finance contract a milestone is paid by its
  // live allocations from verified receipts; before one, a verified milestone counts in full. Money that arrived and
  // isn't allocated yet is received but shown as unallocated, never spread by guesswork.
  const contracted = Boolean(data.financeContext);
  const live = (data.allocations ?? []).filter((allocation) => !allocation.reversedAt && verified.some((receipt) => receipt.id === allocation.receiptId));
  const receivedFor = (payment: { id: string; amount: number; status: string }) => contracted
    ? live.filter((allocation) => allocation.paymentId === payment.id).reduce((sum, allocation) => sum.add(Dec.of(allocation.amount).round(places)), Dec.ZERO)
    : payment.status === "verified" ? Dec.of(payment.amount).round(places) : Dec.ZERO;
  const received = contracted ? verified.reduce((sum, receipt) => sum.add(Dec.of(receipt.amount).round(places)), Dec.ZERO)
    : (data.payments ?? []).reduce((sum, payment) => sum.add(receivedFor(payment)), Dec.ZERO);
  const unallocated = contracted ? received.sub(live.reduce((sum, allocation) => sum.add(Dec.of(allocation.amount).round(places)), Dec.ZERO)) : Dec.ZERO;
  const acceptedIds = new Set(accepted.map((quote) => quote.id));
  const milestones: StatementMilestone[] = (data.payments ?? []).filter((payment) => !payment.sourceQuoteId || acceptedIds.has(payment.sourceQuoteId)).map((payment) => {
    const amount = Dec.of(payment.amount).round(places);
    const got = receivedFor(payment);
    const remaining = amount.sub(got).cmp(0) > 0 ? amount.sub(got) : Dec.ZERO;
    return { id: payment.id, title: payment.title, quoteId: payment.sourceQuoteId ?? null, amount: fixed(amount), received: fixed(got), remaining: fixed(remaining),
      dueDate: payment.dueDate || null, overdue: Boolean(payment.dueDate && payment.dueDate < input.today && remaining.cmp(0) > 0) };
  }).sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31"));
  const balance = agreed.sub(received);
  const next = milestones.find((milestone) => Dec.of(milestone.remaining).cmp(0) > 0) ?? null;
  const checks: JobMoneyStatement["checks"] = [];
  for (const line of lines) {
    // A quote with a payment schedule must be scheduled to the minor unit (a deduction is credited, not scheduled).
    if (line.kind === "deduction" || Dec.of(line.scheduled).isZero()) continue;
    const difference = Dec.of(line.agreed).sub(line.scheduled);
    if (!difference.isZero()) checks.push({ kind: "schedule_gap", quoteId: line.id, title: line.title, difference: fixed(difference) });
  }
  for (const receipt of verified) {
    const amount = Dec.of(receipt.amount).round(places);
    const posted = input.posted.get(receipt.id);
    if (posted === undefined) checks.push({ kind: "not_posted", receiptId: receipt.id, amount: fixed(amount), posted: null });
    else if (Dec.of(posted).round(places).cmp(amount) !== 0) checks.push({ kind: "posted_differently", receiptId: receipt.id, amount: fixed(amount), posted: fixed(Dec.of(posted).round(places)) });
  }
  return {
    currency: input.currency,
    agreed: fixed(agreed), received: fixed(received), unallocated: fixed(unallocated),
    due: fixed(balance.cmp(0) > 0 ? balance : Dec.ZERO), credit: fixed(balance.cmp(0) < 0 ? balance.neg() : Dec.ZERO),
    overdue: fixed(milestones.filter((milestone) => milestone.overdue).reduce((sum, milestone) => sum.add(milestone.remaining), Dec.ZERO)),
    next: next ? { id: next.id, title: next.title, amount: next.remaining, dueDate: next.dueDate } : null,
    lines, milestones, checks,
  };
}

/** The statement of a planning case's deal, with the ledger journals of its verified receipts. */
export async function readMoneyStatement(db: Db, workspaceId: string, caseId: string): Promise<JobMoneyStatement | null> {
  const loaded = await commercialRepository.load(db as PoolClient, workspaceId, caseId);
  if (!loaded) return null;
  const data = loaded.content as CommercialData;
  const currency = data.financeContext?.currency ?? data.quotes.find((quote) => ACCEPTED.has(quote.status))?.currency ?? data.quotes[0]?.currency
    ?? (await db.query<{ currency: string }>(`SELECT trim(default_currency) AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? "";
  const receiptIds = (data.receipts ?? []).filter((receipt) => receipt.status === "finance_verified").map((receipt) => receipt.id);
  // A verified receipt's journal (keyed "case:receipt") debits the bank or cash account with the receipt's amount on its first line.
  const posted = new Map((receiptIds.length ? (await db.query<{ id: string; amount: string }>(
    `SELECT split_part(journal.source_id, ':', 2) AS id, line.doc_amount::text AS amount
       FROM books_journals journal JOIN books_journal_lines line ON line.workspace_id = journal.workspace_id AND line.journal_id = journal.id AND line.position = 0
      WHERE journal.workspace_id = $1 AND journal.source_type = 'receipt' AND journal.source_event = 'verified'
        AND journal.source_id = ANY(SELECT $2::text || ':' || receipt_id FROM unnest($3::text[]) AS receipt_id)
        AND journal.reverses_journal_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM books_journals reversal WHERE reversal.workspace_id = journal.workspace_id AND reversal.reverses_journal_id = journal.id)`,
    [workspaceId, caseId, receiptIds])).rows : []).map((row) => [row.id, row.amount]));
  const today = (await db.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`,
    [workspaceId])).rows[0]?.today ?? new Date().toISOString().slice(0, 10);
  return buildStatement(data, { currency, today, posted });
}
