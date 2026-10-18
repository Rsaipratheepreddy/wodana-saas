import { key } from '../../core/i18n';

/**
 * A review that fits a phone (pure; node tests import it): the evidence first (the proof, the amount, how it was paid,
 * who submitted it), then Confirm, or Return with a reason. Never a one-tap decision from a list: a row opens its review.
 *
 * Return is offered where the server takes one: the row's own "return"/"refuse" (a receipt the team recorded goes back
 * to them), or, for a payment the client reported with proof from the portal, "not received" with the reason the client reads.
 */
export const MIN_REASON = 3;
export type ManualMethod = 'bank' | 'card' | 'cash' | 'cheque' | 'other';
export const METHOD_LABEL: Record<ManualMethod, string> = { bank: key('Bank transfer'), card: key('Card'), cash: key('Cash'), cheque: key('Cheque'), other: key('Other') };

/** What a review needs from an approval row ("Waiting for you"). */
export type ReviewRow = {
  kind: string; id: string; amount: string | null; currency: string | null; since: string; canDecide: boolean; parentId: string | null;
  decide: { approve: string; other: 'return' | 'reject' | null; approveNeedsNote: boolean } | null;
};
export type ProofFile = { id: string; name: string; mimeType: string; hasPreview: boolean };
/** The receipt as the case's commercial record holds it (staff-reported evidence is words). */
export type CaseReceipt = { paymentId: string; status: string; reference?: string | null; evidence?: string | null; method?: ManualMethod | null; receivedOn?: string | null;
  reportedBy?: string | null; reportedAt?: string | null; provider?: string | null };
/** A payment the client reported in the portal, with the proof they attached. */
export type ClientPaymentReport = { id: string; paymentId: string; status: 'submitted' | 'recorded' | 'not_received'; paidOn: string | null; reference: string; amount: string | null;
  currency: string | null; note: string; grantName: string; at: string; version: number; files: ProofFile[] };

export type Evidence = {
  files: ProofFile[];
  /** Exact decimal string, as the server sent it. */
  amount: string | null; currency: string | null;
  method: ManualMethod | null; provider: string | null; reference: string | null; paidOn: string | null; note: string | null;
  submittedBy: string | null; submittedAt: string | null;
  /** The client's open report on this payment, which a return answers. */
  report: { id: string; version: number } | null;
};

/** The evidence of a payment to verify: the receipt's facts, and the client's proof when they reported it in the portal. */
export function paymentEvidence(row: Pick<ReviewRow, 'id' | 'amount' | 'currency' | 'since'>, receipts: readonly CaseReceipt[], reports: readonly ClientPaymentReport[]): Evidence {
  const receipt = receipts.find((entry) => entry.paymentId === row.id && (entry.status === 'reported' || entry.status === 'provider_confirmed'))
    ?? receipts.find((entry) => entry.paymentId === row.id && entry.status !== 'rejected');
  const forPayment = reports.filter((entry) => entry.paymentId === row.id).sort((a, b) => b.at.localeCompare(a.at));
  const report = forPayment.find((entry) => entry.status === 'submitted') ?? forPayment[0] ?? null;
  return {
    files: report?.files ?? [],
    amount: row.amount ?? report?.amount ?? null, currency: row.currency ?? report?.currency ?? null,
    method: receipt?.method ?? null, provider: receipt?.provider ?? null,
    reference: receipt?.reference || report?.reference || null,
    paidOn: receipt?.receivedOn ?? report?.paidOn ?? null,
    note: receipt?.evidence || report?.note || null,
    submittedBy: receipt?.reportedBy ?? report?.grantName ?? null,
    submittedAt: receipt?.reportedAt ?? report?.at ?? row.since,
    report: report?.status === 'submitted' ? { id: report.id, version: report.version } : null,
  };
}

export type ReturnPath =
  | { kind: 'decide'; decision: 'return' | 'reject' }
  | { kind: 'payment_report'; reportId: string; version: number };

/** How this review is returned, or null when the server takes no return for it (Confirm only). */
export function returnPath(row: ReviewRow, evidence: Pick<Evidence, 'report'> | null): ReturnPath | null {
  if (!row.canDecide) return null;
  if (row.decide?.other) return { kind: 'decide', decision: row.decide.other };
  if (row.kind === 'receipt' && evidence?.report) return { kind: 'payment_report', reportId: evidence.report.id, version: evidence.report.version };
  return null;
}

export type ReviewStep = 'evidence' | 'return';
export type ReviewProblem = 'reason' | 'note' | 'decided_elsewhere' | null;

/** Confirm: decided here only when the row can be; some approvals need a note. */
export function confirmProblem(row: ReviewRow, note: string): ReviewProblem {
  if (!row.canDecide || !row.decide) return 'decided_elsewhere';
  return row.decide.approveNeedsNote && note.trim().length < MIN_REASON ? 'note' : null;
}

/** Return: always with a reason of at least three characters (the server's rule for every decision). */
export const returnProblem = (reason: string): ReviewProblem => (reason.trim().length < MIN_REASON ? 'reason' : null);

/** A file shows as a picture when it has a preview; anything else (a PDF) is opened. */
export const isPicture = (file: Pick<ProofFile, 'hasPreview' | 'mimeType'>) => file.hasPreview || file.mimeType.startsWith('image/');
