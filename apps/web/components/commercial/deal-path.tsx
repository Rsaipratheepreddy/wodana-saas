"use client";

import type { ReactNode } from "react";
import { Badge } from "@/design-system";
import { RecordTimeline } from "@/components/record/record-parts";
import { useT } from "@/lib/i18n/i18n-provider";
import { activeDeliveryQuote, agreementIsOperational, commercialReleaseReady, paymentHasFinanceVerifiedReceipt, releasePaymentIsOperational } from "@/lib/commercial/release";
import type { CommercialState } from "@/lib/commercial/types";
import s from "./deal-path.module.css";

type StepState = "done" | "now" | "later";
type Step = { id: string; label: string; status: string; state: StepState; href: string; next?: string };

/**
 * Guide J, the deal in one line: accepted → signed agreement → payment → Deal File (opened by itself, Finance, then the
 * approver; locked) → release. Shown on every Deal view so it is always clear where the deal is and what comes next.
 */
export function DealPath({ state, root, action }: { state: CommercialState; section?: string; root: string; /** The next step's action, shown beside it. */ action?: ReactNode }) {
  const t = useT();
  const data = state.data;
  const accepted = activeDeliveryQuote(data);
  const agreement = data.agreement;
  const agreementDone = Boolean(accepted && agreementIsOperational(agreement) && agreement?.quoteId === accepted.id);
  const required = data.payments.filter((payment) => payment.requiredForRelease && (!data.servicePath || payment.sourceQuoteId === accepted?.id));
  const verified = required.filter((payment) => releasePaymentIsOperational(payment) && paymentHasFinanceVerifiedReceipt(data, payment)).length;
  const proof = Boolean(state.paymentProofId) || state.opportunityStatus === "won";
  const paymentDone = proof || (required.length > 0 && verified === required.length);
  const review = accepted && data.ownerReview?.quoteId === accepted.id ? data.ownerReview : null;
  const dealDone = review?.status === "approved";
  const released = commercialReleaseReady(data);
  const steps: Step[] = [
    { id: "accepted", label: t("Accepted"), href: `${root}/quotations`, state: accepted ? "done" : "now",
      status: accepted ? t("Q-{number} accepted", { number: accepted.number }) : t("Waiting for the client"), next: t("The client accepts the quotation") },
    { id: "agreement", label: t("Agreement"), href: `${root}/contracts`, state: agreementDone ? "done" : "later",
      status: agreementDone ? t("Signed and verified") : !agreement ? t("Not prepared") : agreement.status === "executed" ? t("Verified") : t("Waiting for the signed copy"),
      next: !agreement ? t("Prepare the agreement and attach the signed copy") : t("Attach the signed copy and verify it") },
    { id: "payment", label: t("Payment"), href: `${root}/payment-plan`, state: paymentDone ? "done" : "later",
      status: proof ? t("Proof attached") : required.length ? t("{verified} of {required} verified", { verified, required: required.length }) : t("No payment yet"),
      next: t("Attach the payment proof on the opportunity") },
    { id: "deal", label: t("Deal File"), href: `${root}/deal-file`, state: dealDone ? "done" : "later",
      status: dealDone ? t("Approved · locked") : review?.status === "pending_finance" ? t("With Finance") : review?.status === "pending_approval" ? t("With the approver")
        : review?.status === "returned" ? t("Returned") : review?.status === "rejected" ? t("Rejected") : t("Opens by itself"),
      next: review?.status === "returned" ? t("Correct the Deal File and send it again") : review ? t("Finance checks it, then the approver locks it")
        : t("Opens by itself once the agreement and the payment are in") },
    { id: "release", label: t("Release"), href: `${root}/execution-release`, state: released ? "done" : "later",
      status: released ? t("Released") : t("Waiting"), next: t("Release the work once everything is ready") },
  ];
  const current = steps.find((step) => step.state !== "done");
  if (current) current.state = "now";
  // The same stepper as the case's stages: checks joined by a line, the step now marked, each with its state.
  return <nav className={s.path} aria-label={t("Deal path")}>
    <RecordTimeline label={t("Deal path")} steps={steps.map((step) => ({ id: step.id, label: step.label, state: step.state === "done" ? "done" : step.state === "now" ? "current" : "upcoming",
      detail: step.status, tone: step.state === "done" ? "success" : step.state === "now" ? "info" : "neutral" }))} />
    {/* The one next step, with its action on the same line. */}
    <div className={s.next}>
      <Badge tone={current ? "info" : "success"}>{current ? t("Next") : t("Done")}</Badge>
      <span className={s.nextText}>{current?.next ?? t("The deal is approved and the work is released")}</span>
      {action ? <span className={s.nextAction}>{action}</span> : null}
    </div>
  </nav>;
}
