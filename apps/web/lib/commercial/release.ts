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

type ApprovalSource = { lineId: string; materialRowId: string };

function quotationApprovalSources(quote: Quote): ApprovalSource[] {
  return quote.lines.flatMap((line) => {
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

export function commercialReleaseInputsReady(
  data: CommercialData | null | undefined,
) {
  const quote = data?.quotes.find(
    (candidate) =>
      candidate.kind === "quotation" && candidate.status === "accepted",
  );
  if (
    !data ||
    !quote ||
    !agreementIsOperational(data.agreement) ||
    data.agreement?.quoteId !== quote.id ||
    !data.dealFile ||
    data.dealFile.quoteId !== quote.id ||
    data.ownerReview?.status !== "approved" ||
    data.ownerReview.quoteId !== quote.id ||
    !materialApprovalsComplete(quote, data.materialApprovals)
  )
    return false;
  return (
    data.payments
      .filter((payment) => payment.requiredForRelease)
      .every(releasePaymentIsOperational) &&
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
