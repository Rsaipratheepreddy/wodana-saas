import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { currencyDecimals } from "../common/currency";
import {
  approvalStatus, cancelApproval, canDecideApproval, decideApproval, requestApproval, tellApprovers,
} from "../approvals/approval-engine";
import type { ApprovalDecision, ApprovalStatus } from "../approvals/approval-policy";
import type { OwnerReview, Quote } from "./commercial.types";
import { acceptedQuoteValue } from "./commercial.domain";

type Db = Pick<PoolClient, "query">;

/**
 * The Deal File approval on the E3 engine (plan §6.9a). The Deal File screens keep their steps: Sales submits,
 * Finance confirms (the policy's first step) and the Deal File approvers decide (every later step, the Owner too
 * when the policy asks for one). The engine holds who may decide each step — permission, separation of duties,
 * delegation, escalation — and the record of who decided; the Deal File is created only when the engine says the
 * request is approved. The product default policy is today's rule: Finance, then any Deal File approver who
 * neither submitted nor verified it.
 */
export const DEAL_FILE_KIND = "deal_file" as const;

export const dealAmount = (quote: Pick<Quote, "currency"> & Parameters<typeof acceptedQuoteValue>[0]) =>
  Dec.of(acceptedQuoteValue(quote)).toFixed(currencyDecimals(quote.currency));

const href = (caseId: string) => `/workspace/pre-projects/cases/${caseId}/execution-release`;

/** A new submission: any request still open for this review is withdrawn and a fresh one starts at Finance. */
export async function openDealApproval(db: Db, input: { workspaceId: string; caseId: string; review: OwnerReview; quote: Quote; title: string; actorUserId: string }) {
  await cancelApproval(db, { workspaceId: input.workspaceId, kind: DEAL_FILE_KIND, subjectId: input.review.id, actorUserId: input.actorUserId, reason: "Submitted again" });
  return requestApproval(db, {
    workspaceId: input.workspaceId, kind: DEAL_FILE_KIND, subjectId: input.review.id, title: input.title, href: href(input.caseId),
    amount: dealAmount(input.quote), currency: input.quote.currency, requesterUserId: input.actorUserId, notify: false,
  });
}

/**
 * The open request for a review, created for a review that was submitted before the engine existed (with Finance's
 * confirmation recorded as already given when it was). Null for a review too old to name its submitter.
 */
export async function ensureDealApproval(db: Db, input: { workspaceId: string; caseId: string; review: OwnerReview; quote: Quote | undefined; title: string }) {
  const current = await approvalStatus(db, input.workspaceId, DEAL_FILE_KIND, input.review.id);
  if (current?.status === "pending") return current;
  if (!input.review.submittedById || !input.quote || !["pending_finance", "pending_approval"].includes(input.review.status)) return null;
  return requestApproval(db, {
    workspaceId: input.workspaceId, kind: DEAL_FILE_KIND, subjectId: input.review.id, title: input.title, href: href(input.caseId),
    amount: dealAmount(input.quote), currency: input.quote.currency, requesterUserId: input.review.submittedById, notify: false,
    priorApprovals: input.review.status === "pending_approval" && input.review.financeReviewedById
      ? [{ deciderUserId: input.review.financeReviewedById, decidedAt: input.review.financeReviewedAt ?? null }] : [],
  });
}

/**
 * Finance's confirmation or an approver's decision, through the engine. Finance decides only the first step;
 * approvers only a later one. Returns the request after the decision (null for a review without one).
 */
export async function decideDealStep(db: Db, input: {
  workspaceId: string; caseId: string; review: OwnerReview; quote: Quote | undefined; title: string; actorUserId: string;
  step: "finance" | "approver"; decision: ApprovalDecision; note: string;
}): Promise<ApprovalStatus | null> {
  const open = await ensureDealApproval(db, input);
  if (!open) return null;
  if (input.step === "finance" && open.currentStep !== 1) return open;
  if (input.step === "approver" && open.currentStep === 1) return open;
  const status = await decideApproval(db, {
    workspaceId: input.workspaceId, requestId: open.id, deciderUserId: input.actorUserId, decision: input.decision, note: input.note || null,
    expectedStep: open.currentStep, notify: false,
  });
  // A policy with more approvers after this one (the Owner above an amount): the next ones hear it is theirs.
  if (status.status === "pending" && input.step === "approver") await tellApprovers(db, input.workspaceId, status, input.actorUserId);
  return status;
}

/** The Deal File approval as the Deal File screen shows it, with whether this person may decide the current step. */
export async function dealApprovalView(db: Db, workspaceId: string, review: OwnerReview | null | undefined, userId: string) {
  if (!review) return null;
  const status = await approvalStatus(db, workspaceId, DEAL_FILE_KIND, review.id);
  if (!status) return null;
  const eligibility = status.status === "pending" ? await canDecideApproval(db, workspaceId, status.id, userId) : null;
  return { ...status, canDecide: eligibility?.canDecide ?? false, decideVia: eligibility?.via ?? null, onBehalfOf: eligibility?.onBehalfOf ?? null };
}
