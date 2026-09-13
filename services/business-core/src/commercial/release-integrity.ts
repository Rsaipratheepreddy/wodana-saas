import { paymentIsVerified } from "./accounting-invoice";
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

export function agreementIsOperational(agreement: Agreement | null | undefined) {
  return Boolean(
    agreement?.status === "executed" &&
      agreement.evidence.trim() &&
      isOperationalEvidence(agreement),
  );
}

export function releasePaymentIsOperational(payment: Payment) {
  return paymentIsVerified(payment) && isOperationalEvidence(payment);
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
  return quote.lines.flatMap((line) => {
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

export function commercialReleaseInputsReady(data: CommercialData | null | undefined) {
  const quote = data?.quotes.find(
    (candidate) => candidate.kind === "quotation" && candidate.status === "accepted",
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
