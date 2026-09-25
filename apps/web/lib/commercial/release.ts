import type {
  Agreement,
  CommercialData,
  MaterialApproval,
  Payment,
  Quote,
} from "./types";

const demonstrationMarker =
  /\b(?:demo(?:nstration)?|illustrative|sample only|test(?:ing)? ledger|not (?:a )?live)\b/i;

function isOperationalEvidence(
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

export function agreementIsOperational(agreement: Agreement | null | undefined) {
  return Boolean(
    agreement?.status === "executed" &&
      agreement.evidence.trim() &&
      isOperationalEvidence(agreement),
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

function paymentIsVerified(payment: Payment, now = Date.now()) {
  if (payment.status !== "verified") return false;
  if (!payment.invoice) return true;
  const checkedAt = Date.parse(payment.invoice.refreshedAt);
  return (
    Boolean(payment.invoice.accountId) &&
    payment.invoice.balance === 0 &&
    !payment.invoice.lastError &&
    Number.isFinite(checkedAt) &&
    checkedAt <= now &&
    now - checkedAt <= 86_400_000
  );
}

export function releasePaymentIsOperational(payment: Payment) {
  return paymentIsVerified(payment) && isOperationalEvidence(payment);
}

/** The delivery round is distinct from the first paid design round. */
export function activeDeliveryQuote(data: CommercialData | null | undefined) {
  return data?.quotes.find((quote) => quote.kind === "quotation" && quote.status === "accepted" &&
    (!data.palmFlow || quote.round === "main"));
}

function agreementMatchesFinanceContext(data: CommercialData) {
  return Boolean(
    data.financeContext &&
      data.agreement?.legalEntityId === data.financeContext.legalEntityId &&
      data.agreement.currency === data.financeContext.currency,
  );
}

export function paymentHasFinanceVerifiedReceipt(
  data: CommercialData,
  payment: Payment,
) {
  if (!data.financeContext) return false;
  const receipt = data.receipts?.find(
    (item) =>
      item.paymentId === payment.id &&
      item.status === "finance_verified" &&
      item.legalEntityId === data.financeContext?.legalEntityId &&
      item.currency === data.financeContext.currency,
  );
  if (!receipt) return false;
  const allocated = (data.allocations ?? [])
    .filter(
      (allocation) =>
        allocation.paymentId === payment.id &&
        allocation.receiptId === receipt.id &&
        !allocation.reversedAt,
    )
    .reduce((sum, allocation) => sum + allocation.amount, 0);
  return Math.round(allocated * 100) === Math.round(payment.amount * 100);
}

type ApprovalSource = { lineId: string; materialRowId: string };

function quotationApprovalSources(quote: Quote): ApprovalSource[] {
  const selected = new Set(quote.clientDecision?.selectedOptionLineIds ?? []);
  return quote.lines.filter((line) => !line.optional || selected.has(line.id)).flatMap((line) => {
    const rows = (line.materialRows ?? [])
      .filter(
        (material) =>
          ["material", "finish"].includes(material.type) &&
          material.name.trim().length > 0,
      )
      .map((material) => ({ id: material.id }));
    const materials = rows.length
      ? rows
      : line.customMaterials?.length
        ? line.customMaterials
        : [
            ...(line.material ? [{ id: "material" }] : []),
            ...(line.finish ? [{ id: "finish" }] : []),
          ];
    return materials.map((material) => ({
      lineId: line.id,
      materialRowId: material.id,
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

export function palmMaterialListSignedOff(data: CommercialData, quote: Quote) {
  if (!data.palmFlow?.scope.materialSelection) return materialApprovalsComplete(quote, data.materialApprovals);
  return quotationApprovalSources(quote).length > 0 && materialApprovalsComplete(quote, data.materialApprovals);
}

export function financeGatePaymentsReady(data: CommercialData, quoteId?: string) {
  const required = data.payments.filter((payment) => payment.requiredForRelease &&
    (!quoteId || payment.sourceQuoteId === quoteId));
  return required.length > 0 && required.every((payment) =>
    releasePaymentIsOperational(payment) && paymentHasFinanceVerifiedReceipt(data, payment));
}

export function commercialReleaseInputsReady(
  data: CommercialData | null | undefined,
) {
  const quote = activeDeliveryQuote(data);
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
    !data.dealFile.paymentProofUrl ||
    !data.dealFile.commissionLines?.length ||
    !(data.palmFlow ? palmMaterialListSignedOff(data, quote) : materialApprovalsComplete(quote, data.materialApprovals))
  )
    return false;
  return (
    financeGatePaymentsReady(data, data.palmFlow ? quote.id : undefined) &&
    data.requests.every((request) =>
      ["resolved", "declined", "withdrawn"].includes(request.status),
    )
  );
}

export function commercialReleaseReady(
  data: CommercialData | null | undefined,
) {
  if (!data?.release) return false;
  const quote = data.quotes.find(
    (candidate) =>
      candidate.id === data.release?.quoteId && candidate.status === "accepted",
  );
  return Boolean(
    quote &&
      commercialReleaseInputsReady(data) &&
      data.dealFile &&
      data.dealFile.id === data.release.dealFileId &&
      data.dealFile.quoteId === quote.id,
  );
}
