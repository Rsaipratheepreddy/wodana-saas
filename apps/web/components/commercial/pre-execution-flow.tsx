import { useT } from "@/lib/i18n/i18n-provider";
import Link from "next/link";
import { CircleCheck, CircleDot, ShieldCheck } from "lucide-react";
import { useDesignSystem } from "@/design-system";
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
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
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
      title: t("Agreement & payments"),
      eyebrow: t("Commercial baseline"),
      status: agreementReady && paymentsReady ? t("Ready") : accepted ? t("In progress") : t("Waiting"),
      detail: accepted
        ? `${agreementReady ? t("Agreement verified") : t("Agreement pending")} · ${t("{verified}/{required} release payments verified", { verified: verifiedPayments, required: requiredPayments.length })}`
        : t("Accept a quotation to begin"),
      state: agreementState,
      current: ["contracts", "payment-plan"].includes(section),
    },
    {
      href: `${root}/variations`,
      title: t("Change control"),
      eyebrow: t("Change control"),
      status: openChanges ? t("{count} open", { count: openChanges }) : t("Clear"),
      detail: openChanges
        ? t("Resolve scope, price, and schedule impact before release")
        : data.requests.length
          ? t("{count} requests resolved or closed", { count: data.requests.length })
          : t("No unresolved client changes"),
      state: openChanges ? "attention" : "complete",
      current: section === "variations",
    },
    {
      href: `${root}/execution-release`,
      title: t("Approvals & release"),
      eyebrow: t("Execution gate"),
      status: releasedReady ? t("Released") : releaseState === "ready" ? t("Ready to release") : t("{done}/7 ready", { done: checksDone }),
      detail: releasedReady && data.release
        ? t("Released {date}", { date: new Date(data.release.at).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone }) })
        : t("Owner, materials, agreement, payments, and changes checked together"),
      state: releaseState,
      current: approvalSections.has(section),
    },
  ];

  return (
    <nav className={s.preExecutionFlow} aria-label={t("Planning readiness timeline")} data-compact={compact || undefined}>
      <div className={s.flowIntro}>
        <div>
          <span>{t("Release readiness")}</span>
          {!compact ? <strong>{t("From accepted scope to execution release")}</strong> : null}
        </div>
        <small>{t("{done} of 7 checks complete", { done: checksDone })}</small>
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
