import Link from "next/link";
import { CircleCheck, CircleDot, ShieldCheck } from "lucide-react";
import {
  activeDeliveryQuote,
  agreementIsOperational,
  commercialReleaseInputsReady,
  commercialReleaseReady,
  materialApprovalsComplete,
  palmMaterialListSignedOff,
  paymentHasFinanceVerifiedReceipt,
  releasePaymentIsOperational,
} from "@/lib/commercial/release";
import type { CommercialState } from "@/lib/commercial/types";
import s from "./commercial.module.css";

const approvalSections = new Set(["approvals", "execution-release"]);

export function PreExecutionFlow({
  state,
  section,
  root,
  compact = true,
}: {
  state: CommercialState;
  section: string;
  root: string;
  compact?: boolean;
}) {
  const data = state.data;
  const accepted = activeDeliveryQuote(data);
  const requiredPayments = data.payments.filter(
    (payment) => payment.requiredForRelease && (!data.palmFlow || payment.sourceQuoteId === accepted?.id),
  );
  const verifiedPayments = requiredPayments.filter((payment) =>
    releasePaymentIsOperational(payment) && paymentHasFinanceVerifiedReceipt(data, payment)).length;
  const agreementReady =
    agreementIsOperational(data.agreement) && data.agreement?.quoteId === accepted?.id;
  const paymentsReady =
    requiredPayments.length > 0 &&
    requiredPayments.every((payment) =>
      releasePaymentIsOperational(payment) && paymentHasFinanceVerifiedReceipt(data, payment));
  const openChanges = data.requests.filter(
    (request) => !["resolved", "declined", "withdrawn"].includes(request.status),
  ).length;
  const materialsReady = Boolean(
    accepted && (data.palmFlow ? palmMaterialListSignedOff(data, accepted) : materialApprovalsComplete(accepted, data.materialApprovals)),
  );
  const ownerAndDealReady = Boolean(
    accepted &&
      state.opportunityStatus === "won" &&
      data.ownerReview?.status === "approved" &&
      data.ownerReview.quoteId === accepted.id &&
      data.dealFile?.quoteId === accepted.id,
  );
  const designReady = Boolean(
    accepted &&
      (data.palmFlow && !data.palmFlow.scope.design || Boolean(
        state.releaseReadiness &&
        state.releaseReadiness.designsRequired > 0 &&
        state.releaseReadiness.designsApproved === state.releaseReadiness.designsRequired,
      )),
  );
  const releaseChecks = [
    Boolean(accepted),
    designReady,
    agreementReady,
    paymentsReady,
    ownerAndDealReady,
    materialsReady,
    openChanges === 0,
  ];
  const checksDone = releaseChecks.filter(Boolean).length;
  const agreementState = agreementReady && paymentsReady
    ? "complete"
    : data.agreement || data.payments.length
      ? "active"
      : "pending";
  const releasedReady = commercialReleaseReady(data) && designReady;
  const releaseState = releasedReady
    ? "complete"
    : commercialReleaseInputsReady(data) && designReady
      ? "ready"
      : "pending";
  const steps = [
    {
      href: `${root}/contracts`,
      title: "Agreement & payments",
      eyebrow: "Commercial baseline",
      status: agreementReady && paymentsReady ? "Ready" : accepted ? "In progress" : "Waiting",
      detail: accepted
        ? `${agreementReady ? "Agreement verified" : "Agreement pending"} · ${verifiedPayments}/${requiredPayments.length} release payments verified`
        : "Accept a quotation to begin",
      state: agreementState,
      current: ["contracts", "payment-plan"].includes(section),
    },
    {
      href: `${root}/variations`,
      title: "Change control",
      eyebrow: "Change control",
      status: openChanges ? `${openChanges} open` : "Clear",
      detail: openChanges
        ? "Resolve scope, price, and schedule impact before release"
        : data.requests.length
          ? `${data.requests.length} requests resolved or closed`
          : "No unresolved client changes",
      state: openChanges ? "attention" : "complete",
      current: section === "variations",
    },
    {
      href: `${root}/execution-release`,
      title: "Approvals & release",
      eyebrow: "Execution gate",
      status: releasedReady ? "Released" : releaseState === "ready" ? "Ready to release" : `${checksDone}/7 ready`,
      detail: releasedReady && data.release
        ? `Released ${new Date(data.release.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
        : "Owner, materials, agreement, payments, and changes checked together",
      state: releaseState,
      current: approvalSections.has(section),
    },
  ];

  return (
    <nav className={s.preExecutionFlow} aria-label="Pre-execution readiness timeline" data-compact={compact || undefined}>
      <div className={s.flowIntro}>
        <div>
          <span>Release readiness</span>
          {!compact ? <strong>From accepted scope to execution release</strong> : null}
        </div>
        <small>{checksDone} of 7 checks complete</small>
      </div>
      <ol>
        {steps.map((step) => (
          <li key={step.href} data-state={step.state}>
            <Link href={step.href} aria-current={step.current ? "step" : undefined}>
              <span className={s.flowNode} aria-hidden="true">
                {step.state === "complete" ? <CircleCheck size={18} /> : step.state === "ready" ? <ShieldCheck size={18} /> : <CircleDot size={18} />}
              </span>
              <span className={s.flowCopy}>
                <small>{step.eyebrow}</small>
                <strong>{step.title}</strong>
                <span>{step.detail}</span>
              </span>
              <em>{step.status}</em>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
