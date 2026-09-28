import { tKey, type MessageKey } from "@/lib/i18n/keys";
import type { CommercialState } from "@/lib/commercial/types";

export type NextStepKey = "agreement" | "payment" | "deal" | "project" | "lost";

/**
 * After the client declines: a new revision is in the header; if nothing more is coming, the opportunity is
 * closed as Lost with the reason (on the opportunity, where Won and Lost are recorded).
 */
export function declinedSteps(commercial: CommercialState): NextStep[] {
  if (commercial.opportunityStatus !== "open" || !commercial.opportunityId) return [];
  return [{ key: "lost", label: tKey("Close the opportunity as Lost, with the reason, if nothing more is coming"), state: "current",
    action: { label: tKey("Open opportunity"), href: `/workspace/crm/opportunities?record=${commercial.opportunityId}` }, holders: [] }];
}
export type NextStep = {
  key: NextStepKey;
  label: MessageKey;
  state: "done" | "current" | "waiting" | "later";
  /** What to do now (for someone who can), or who holds it (for someone who can't). */
  action: { label: MessageKey; href: string } | null;
  holders: string[];
};

/**
 * After the client accepts: record and verify the agreement, report and verify the payment due before the
 * start, submit the deal for Finance and approval, then start the project. A design round ends at its deal
 * (design work opens once it's approved). Each step says who holds it, and offers the action to whoever can.
 */
export function nextSteps(commercial: CommercialState, quote: { id: string; round?: string | null }, caseId: string, projectStarted: boolean): NextStep[] {
  const data = commercial.data;
  const base = `/workspace/pre-projects/cases/${caseId}`;
  const holders = commercial.stepHolders ?? { verifyAgreement: [], verifyPayment: [], approveDeal: [], startProject: [] };
  const steps: NextStep[] = [];

  const agreement = data.agreement?.quoteId === quote.id ? data.agreement : null;
  const agreementDone = agreement?.status === "executed";
  steps.push(agreementDone ? { key: "agreement", label: tKey("Agreement signed"), state: "done", action: null, holders: [] }
    : agreement ? { key: "agreement", label: tKey("Verify the signed agreement"), state: commercial.canApprove ? "current" : "waiting",
      action: commercial.canApprove ? { label: tKey("Verify"), href: `${base}/contracts` } : null, holders: holders.verifyAgreement }
      : { key: "agreement", label: tKey("Record the agreement"), state: commercial.canEdit ? "current" : "waiting",
        action: commercial.canEdit ? { label: tKey("Record agreement"), href: `${base}/contracts` } : null, holders: [] });

  const due = data.payments.filter((payment) => payment.sourceQuoteId === quote.id && payment.requiredForRelease);
  const paid = due.length > 0 && due.every((payment) => payment.status === "verified");
  const reported = due.some((payment) => payment.status === "proof_submitted");
  steps.push(paid ? { key: "payment", label: tKey("Payment verified"), state: "done", action: null, holders: [] }
    : reported ? { key: "payment", label: tKey("Verify the payment"), state: commercial.canVerifyFinance ? "current" : "waiting",
      action: commercial.canVerifyFinance ? { label: tKey("Verify"), href: `${base}/payment-plan` } : null, holders: holders.verifyPayment }
      : { key: "payment", label: due.length ? tKey("Report the payment") : tKey("Set the payment plan"), state: commercial.canEdit ? "current" : "waiting",
        action: commercial.canEdit ? { label: due.length ? tKey("Report payment") : tKey("Open payments"), href: `${base}/payment-plan` } : null, holders: [] });

  const usesDeals = Boolean(commercial.palmFlowEnabled || data.ownerReview);
  if (usesDeals) {
    const review = data.ownerReview?.quoteId === quote.id ? data.ownerReview : null;
    const design = quote.round === "design";
    const submit = design ? tKey("Submit the design deal") : tKey("Submit the deal");
    steps.push(review?.status === "approved" ? { key: "deal", label: tKey("Deal approved"), state: "done", action: null, holders: [] }
      : review?.status === "pending_finance" ? { key: "deal", label: tKey("Finance checks the deal"), state: commercial.canVerifyFinance ? "current" : "waiting",
        action: commercial.canVerifyFinance ? { label: tKey("Check"), href: `${base}/approvals` } : null, holders: holders.verifyPayment }
        : review?.status === "pending_approval" ? { key: "deal", label: tKey("Approve the deal"), state: commercial.canApproveDeal ? "current" : "waiting",
          action: commercial.canApproveDeal ? { label: tKey("Approve"), href: `${base}/approvals` } : null, holders: holders.approveDeal }
          : { key: "deal", label: submit, state: commercial.canEdit ? "current" : "waiting",
            action: commercial.canEdit ? { label: tKey("Submit"), href: `${base}/approvals` } : null, holders: [] });
  }

  if (quote.round !== "design")
    steps.push(projectStarted ? { key: "project", label: tKey("Project started"), state: "done", action: null, holders: [] }
      : { key: "project", label: tKey("Start the project"), state: "waiting", action: null, holders: holders.startProject });

  // Only the first open step is current; the ones after it wait their turn.
  const first = steps.findIndex((step) => step.state !== "done");
  return steps.map((step, index) => (index > first && first >= 0 && step.state !== "done" ? { ...step, state: "later" as const, action: null } : step));
}
