import { Dec } from "../catalog-core/decimal";
import { depositMeetsMinimum, isPercentDeposit, minimumDepositAmount, type MinimumDeposit } from "../design/design-packages.domain";
import { paymentIsVerified } from "./accounting-invoice";
import { acceptedQuoteLines, acceptedQuoteValue } from "./commercial.domain";
import {
  agreementMatchesFinanceContext,
  paymentHasFinanceVerifiedReceipt,
} from "./finance-ledger";
import type {
  Agreement,
  CommercialData,
  MaterialApproval,
  Payment,
  Quote,
} from "./commercial.types";

const demonstrationMarker =
  /\b(?:demo(?:nstration)?|illustrative|sample only|test(?:ing)? ledger|not (?:a )?live)\b/i;

export function isOperationalEvidence(
  record: Pick<Agreement | Payment, "evidenceKind"> & {
    evidence?: string;
    proof?: string;
    reference?: string;
  },
) {
  if (record.evidenceKind === "demonstration") return false;
  return !demonstrationMarker.test(
    [record.evidence, record.proof, record.reference].filter(Boolean).join(" "),
  );
}

/** The signed agreement is on record: an uploaded signed document, or a written description of it. */
/**
 * Whether an agreement's signed evidence is live, not a demonstration. Its reference is numbered by the system from
 * the company's code (§0.3 P0), so only what people wrote is read: a company coded "DEMO" is still a live company.
 */
export function agreementEvidenceOperational(agreement: Pick<Agreement, "evidenceKind" | "evidence">) {
  return isOperationalEvidence({ evidenceKind: agreement.evidenceKind, evidence: agreement.evidence });
}

export function agreementHasSignedEvidence(agreement: Pick<Agreement, "evidence" | "files"> | null | undefined) {
  return Boolean(agreement && (agreement.evidence?.trim() || agreement.files?.length));
}

export function agreementIsOperational(agreement: Agreement | null | undefined) {
  return Boolean(
    agreement?.status === "executed" &&
      agreementHasSignedEvidence(agreement) &&
      agreementEvidenceOperational(agreement!),
  );
}

export function agreementMatchesAcceptedQuote(
  agreement: Agreement | null | undefined,
  quote: Quote | null | undefined,
) {
  return Boolean(
    agreement &&
      quote?.status === "accepted" &&
      quote.hash &&
      quote.clientDecision?.decision === "accept" &&
      quote.clientDecision.quoteHash === quote.hash &&
      agreement.quoteId === quote.id &&
      agreement.quoteHash === quote.hash &&
      agreement.acceptedTotal === quote.clientDecision.acceptedTotal &&
      JSON.stringify(agreement.selectedOptionLineIds ?? []) ===
        JSON.stringify(quote.clientDecision.selectedOptionLineIds),
  );
}

export function releasePaymentIsOperational(payment: Payment) {
  return paymentIsVerified(payment) && isOperationalEvidence(payment);
}

/** Finance verified a receipt for this quotation inside Wodana, so the Deal File needs no outside proof link. */
export function quoteHasVerifiedReceipt(data: CommercialData, quoteId: string) {
  return data.payments.some((payment) => payment.sourceQuoteId === quoteId && paymentHasFinanceVerifiedReceipt(data, payment));
}

/** The Deal File carries proof of payment: a link, or a Finance-verified receipt for its quotation. */
export function dealPaymentProofReady(data: CommercialData, proofUrl: string | undefined, quoteId: string) {
  return Boolean(proofUrl) || quoteHasVerifiedReceipt(data, quoteId);
}

export function financeGatePaymentsReady(
  data: CommercialData,
  gate: "release" | "production",
  quoteId?: string,
) {
  const required = data.payments.filter((payment) =>
    (!quoteId || payment.sourceQuoteId === quoteId) && (gate === "release"
      ? payment.requiredForRelease
      : payment.requiredForProduction === true),
  );
  // H2 exists for every released contract. H3 applies only when the accepted
  // schedule explicitly names a production-start milestone.
  if (gate === "release" && !required.length) return false;
  return required.every(
    (payment) =>
      releasePaymentIsOperational(payment) &&
      paymentHasFinanceVerifiedReceipt(data, payment),
  );
}

/**
 * Design starts only after the case's minimum design deposit (workspace configuration, frozen on the case) is actually
 * received: a fixed amount, or a share of the design fee (the accepted design quotation's value).
 */
export function designDepositReady(data: CommercialData, quote: Quote) {
  if (quote.round !== "design" || !financeGatePaymentsReady(data, "release", quote.id)) return false;
  const paid = data.payments
    .filter(payment => payment.sourceQuoteId === quote.id && payment.requiredForRelease &&
      payment.currency === quote.currency && releasePaymentIsOperational(payment) &&
      paymentHasFinanceVerifiedReceipt(data, payment))
    .reduce((total, payment) => Dec.of(total).add(String(payment.amount)).toString(), "0");
  return depositMeetsMinimum(paid, data.servicePath?.designMinimumDeposit, quote.currency, acceptedQuoteValue(quote));
}

/** What the deal approval asks for when the design deposit isn't in: the amount, and the share of the fee when it is one. */
export function designDepositMessage(minimum: MinimumDeposit | null | undefined, quote: Quote) {
  if (!minimum) return "Verify the design proposal payment before the deal is approved.";
  const amount = minimumDepositAmount(minimum, acceptedQuoteValue(quote));
  if (isPercentDeposit(minimum))
    return `Verify at least ${Number(minimum.percent)}% of the design fee (${quote.currency} ${amount}) for the design proposal before the deal is approved.`;
  return `Verify at least ${minimum.currency} ${amount} for the design proposal before the deal is approved.`;
}

export function variationReleasePaymentsReady(
  data: CommercialData,
  quote: Quote,
) {
  if (quote.direction === "deduction" || quote.total <= 0) return true;
  const required = data.payments.filter(
    (payment) =>
      payment.sourceQuoteId === quote.id && payment.requiredForRelease,
  );
  return (
    required.length > 0 &&
    required.every(
      (payment) =>
        releasePaymentIsOperational(payment) &&
        paymentHasFinanceVerifiedReceipt(data, payment),
    )
  );
}

export type ApprovalSource = {
  lineId: string;
  materialRowId: string;
  room: string;
  item: string;
  name: string;
  code: string;
  brand: string;
  specification: string;
};

export function quotationApprovalSources(quote: Quote): ApprovalSource[] {
  return acceptedQuoteLines(quote).flatMap((line) => {
    const rows = (line.materialRows ?? [])
      .filter(
        (material) =>
          ["material", "finish"].includes(material.type) &&
          material.name.trim().length > 0,
      )
      .map((material) => ({
        id: material.id,
        name: material.name,
        code: "",
        brand: "",
        specification: material.specification,
      }));
    const materials = rows.length
      ? rows
      : line.customMaterials?.length
        ? line.customMaterials
        : [
            ...(line.material
              ? [
                  {
                    id: "material",
                    name: line.material,
                    code: "",
                    brand: "",
                    specification: line.specification,
                  },
                ]
              : []),
            ...(line.finish
              ? [
                  {
                    id: "finish",
                    name: line.finish,
                    code: "",
                    brand: "",
                    specification: "",
                  },
                ]
              : []),
          ];
    return materials.map((material) => ({
      lineId: line.id,
      materialRowId: material.id,
      room: line.room,
      item: line.title,
      name: material.name,
      code: material.code,
      brand: material.brand,
      specification: material.specification,
    }));
  });
}

export function materialApprovalsComplete(
  quote: Quote,
  approvals: MaterialApproval[] | undefined,
) {
  const expected = quotationApprovalSources(quote);
  if (!expected.length) return true;
  return expected.every((source) =>
    (approvals ?? []).some(
      (approval) =>
        approval.quoteId === quote.id &&
        approval.lineId === source.lineId &&
        approval.materialRowId === source.materialRowId &&
        approval.status === "approved",
    ),
  );
}

/** H1 review is independent from H2 receipt verification; both meet at release. */
export function ownerReviewInputsReady(data: CommercialData, quote: Quote) {
  return (
    agreementIsOperational(data.agreement) &&
    agreementMatchesAcceptedQuote(data.agreement, quote) &&
    materialApprovalsComplete(quote, data.materialApprovals)
  );
}

/** A selected material-list stage needs a real client decision, not an empty vacuous pass. */
export function materialListSignedOff(data: CommercialData, quote: Quote) {
  if (!data.servicePath?.scope.materialSelection)
    return true;
  return quotationApprovalSources(quote).length > 0 &&
    materialApprovalsComplete(quote, data.materialApprovals);
}

/** Exact approved selection revisions that cross the commercial release boundary. */
export function approvedMaterialEvidence(
  quote: Quote,
  approvals: MaterialApproval[] | undefined,
) {
  return quotationApprovalSources(quote)
    .map((source) => {
      const approval = (approvals ?? []).find(
        (candidate) =>
          candidate.quoteId === quote.id &&
          candidate.lineId === source.lineId &&
          candidate.materialRowId === source.materialRowId &&
          candidate.status === "approved",
      );
      return approval ? structuredClone(approval) : null;
    })
    .filter((approval): approval is MaterialApproval => Boolean(approval));
}

export function sameMaterialEvidence(
  expected: MaterialApproval[] | undefined,
  current: MaterialApproval[],
) {
  if (!expected) return false;
  const normalize = (items: MaterialApproval[]) =>
    items
      .map(({ decisionChallengeId: _challenge, approverId: _approver, ...item }) => item)
      .sort((left, right) =>
        `${left.lineId}:${left.materialRowId}`.localeCompare(
          `${right.lineId}:${right.materialRowId}`,
        ),
      );
  return JSON.stringify(normalize(expected)) === JSON.stringify(normalize(current));
}

/**
 * Whether a change request holds up release (Q-29): a decision the client still owes, a controlled change case, or
 * a change to a quote while it is open. A client's plain message from the portal ("when do you start?") is a
 * conversation, not a change, and never blocks.
 */
export function requestBlocksRelease(request: Pick<CommercialData["requests"][number], "status" | "quoteId" | "control" | "decisionRequest">) {
  if (["resolved", "declined", "withdrawn"].includes(request.status)) return false;
  return Boolean(request.decisionRequest || request.control || request.quoteId);
}

export function commercialReleaseInputsReady(data: CommercialData | null | undefined) {
  const quote = data?.servicePath
    ? data.quotes.find(candidate => candidate.kind === "quotation" && candidate.round === "main" && candidate.status === "accepted")
    : data?.quotes.find(candidate => candidate.kind === "quotation" && candidate.status === "accepted");
  if (
    !data ||
    !quote ||
    !agreementIsOperational(data.agreement) ||
    !agreementMatchesAcceptedQuote(data.agreement, quote) ||
    !agreementMatchesFinanceContext(data) ||
    !data.dealFile ||
    data.dealFile.quoteId !== quote.id ||
    data.ownerReview?.status !== "approved" ||
    data.ownerReview.quoteId !== quote.id ||
    !data.ownerReview.financeReviewedById ||
    !dealPaymentProofReady(data, data.dealFile.paymentProofUrl, quote.id) ||
    !Array.isArray(data.dealFile.commissionLines) ||
    !(data.servicePath ? materialListSignedOff(data, quote) : materialApprovalsComplete(quote, data.materialApprovals))
  )
    return false;
  return (
    financeGatePaymentsReady(data, "release", data.servicePath ? quote.id : undefined) &&
    !data.requests.some(requestBlocksRelease)
  );
}

export function commercialReleaseReady(data: CommercialData | null | undefined) {
  if (!data?.release) return false;
  const quote = data.quotes.find(
    (candidate) =>
      candidate.id === data.release?.quoteId && candidate.status === "accepted",
  );
  if (
    !quote ||
    !commercialReleaseInputsReady(data) ||
    !data.dealFile ||
    data.dealFile.id !== data.release.dealFileId ||
    data.dealFile.quoteId !== quote.id
  )
    return false;
  return true;
}

/** What the owner's deal checklist checks, in words for the error that lists what's missing. */
export const DEAL_CHECK_LABELS: Record<keyof ReturnType<typeof dealChecklist>, string> = {
  agreement: "the signed agreement verified against the accepted quotation",
  documents: "the signed agreement document",
  payment: "proof of payment or a Finance-verified receipt",
  boq: "the priced quotation lines",
  margin: "the deal's figures",
  materials: "every client material decision",
};

/**
 * The deal checklist read from the records, never ticked by hand (§0.3 P0). The margin is shown to the owner from the
 * deal's own figures and never blocks; the design-fee round has no priced BOQ.
 */
export function dealChecklist(data: CommercialData, quote: Quote, proofUrl: string | undefined) {
  return {
    agreement: agreementIsOperational(data.agreement) && agreementMatchesAcceptedQuote(data.agreement, quote),
    documents: agreementHasSignedEvidence(data.agreement),
    payment: dealPaymentProofReady(data, proofUrl, quote.id),
    boq: quote.round === "design" || quote.lines.length > 0,
    margin: true,
    materials: data.servicePath ? true : materialApprovalsComplete(quote, data.materialApprovals),
  };
}
