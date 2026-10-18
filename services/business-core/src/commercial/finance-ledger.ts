import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Dec } from "../catalog-core/decimal";
import { currencyDecimals } from "../common/currency";
import type {
  ClientCredit,
  CommercialData,
  CommercialFinanceContext,
  FinanceAllocation,
  FinanceDocument,
  FinanceReceipt,
  ManualPaymentMethod,
  Payment,
} from "./commercial.types";
import { MANUAL_PAYMENT_METHODS } from "./commercial.types";

/** Money, exactly (decimal, never float math), in the currency's minor units; two places without a currency. */
const money = (value: number, currencyCode?: string) =>
  Dec.of(value).round(currencyCode ? currencyDecimals(currencyCode) : 2);
const round = (value: number, currencyCode?: string) => money(value, currencyCode).toNumber();
/** The exact sum of allocations, as money in the currency. */
const allocatedSum = (allocations: FinanceAllocation[], currencyCode?: string) =>
  allocations.reduce((sum, allocation) => sum.add(allocation.amount), Dec.ZERO).round(currencyCode ? currencyDecimals(currencyCode) : 2);

export type LegalEntityFinanceSource = {
  legalEntityId?: string | null;
  legalEntityCode?: string | null;
  legalEntityName?: string | null;
  legalEntityRegisteredName?: string | null;
  legalEntityCountryCode?: string | null;
  legalEntityBaseCurrency?: string | null;
  legalEntityTaxRegistrationNumber?: string | null;
};

export function bindFinanceContext(
  current: CommercialFinanceContext | null | undefined,
  entity: LegalEntityFinanceSource,
  currency: string,
  at: string,
): CommercialFinanceContext {
  if (
    !entity.legalEntityId ||
    !entity.legalEntityCode ||
    !entity.legalEntityName ||
    !entity.legalEntityRegisteredName ||
    !entity.legalEntityCountryCode ||
    !entity.legalEntityBaseCurrency
  )
    throw new ConflictException(
      "Assign an active legal entity to the opportunity before creating the agreement or finance records.",
    );
  if (
    current &&
    (current.legalEntityId !== entity.legalEntityId ||
      current.currency !== currency)
  )
    throw new ConflictException(
      "The contract finance identity is already fixed. Use a controlled commercial correction instead of changing its legal entity or currency.",
    );
  return (
    current ?? {
      legalEntityId: entity.legalEntityId,
      code: entity.legalEntityCode,
      displayName: entity.legalEntityName,
      registeredName: entity.legalEntityRegisteredName,
      countryCode: entity.legalEntityCountryCode,
      baseCurrency: entity.legalEntityBaseCurrency,
      currency,
      ...(entity.legalEntityTaxRegistrationNumber
        ? {
            taxRegistrationNumber:
              entity.legalEntityTaxRegistrationNumber,
          }
        : {}),
      taxValidation: "unvalidated",
      boundAt: at,
    }
  );
}

function assertPaymentIdentity(
  payment: Payment,
  legalEntityId: string,
  currency: string,
) {
  if (
    !payment.legalEntityId ||
    payment.legalEntityId !== legalEntityId ||
    !payment.currency ||
    payment.currency !== currency
  )
    throw new ConflictException(
      "The receipt must use the payment milestone legal entity and currency.",
    );
}

function arrays(data: CommercialData) {
  data.financeDocuments ??= [];
  data.receipts ??= [];
  data.allocations ??= [];
  return {
    documents: data.financeDocuments,
    receipts: data.receipts,
    allocations: data.allocations,
  };
}

export function upsertProviderInvoiceDocument(
  data: CommercialData,
  payment: Payment,
  input: {
    provider: string;
    connectionId: string;
    providerDocumentId: string;
    number: string;
    total: number;
    status: string;
  },
  at: string,
): FinanceDocument {
  const context = data.financeContext;
  if (!context)
    throw new ConflictException(
      "Bind the agreement to a legal entity before linking an invoice.",
    );
  assertPaymentIdentity(payment, context.legalEntityId, context.currency);
  const { documents } = arrays(data);
  const existing = documents.find(
    (document) =>
      document.kind === "invoice" &&
      document.provider === input.provider &&
      document.connectionId === input.connectionId &&
      document.providerDocumentId === input.providerDocumentId,
  );
  if (existing && existing.paymentId !== payment.id)
    throw new ConflictException(
      "This provider invoice is already bound to another payment milestone.",
    );
  const next: FinanceDocument = {
    id: existing?.id ?? randomUUID(),
    kind: "invoice",
    source: "provider",
    legalEntityId: context.legalEntityId,
    currency: context.currency,
    number: input.number || input.providerDocumentId,
    total: round(input.total, context.currency),
    status: input.status,
    paymentId: payment.id,
    provider: input.provider,
    connectionId: input.connectionId,
    providerDocumentId: input.providerDocumentId,
    issuedAt: existing?.issuedAt ?? at,
    updatedAt: at,
  };
  if (existing) Object.assign(existing, next);
  else documents.push(next);
  return existing ?? next;
}

function activeAllocatedAmount(
  allocations: FinanceAllocation[],
  paymentId: string,
  currencyCode?: string,
) {
  return allocatedSum(
    allocations.filter(
      (allocation) =>
        allocation.paymentId === paymentId && !allocation.reversedAt,
    ),
    currencyCode,
  );
}

function allocate(
  data: CommercialData,
  receipt: FinanceReceipt,
  payment: Payment,
  actor: string,
  at: string,
) {
  const { allocations } = arrays(data);
  const existing = allocations.find(
    (allocation) =>
      allocation.receiptId === receipt.id && !allocation.reversedAt,
  );
  if (existing) return existing;
  const allocated = activeAllocatedAmount(allocations, payment.id, payment.currency);
  if (allocated.add(money(receipt.amount, payment.currency)).cmp(money(payment.amount, payment.currency)) > 0)
    throw new ConflictException(
      "Receipt allocations cannot exceed the payment milestone amount.",
    );
  const allocation: FinanceAllocation = {
    id: randomUUID(),
    receiptId: receipt.id,
    paymentId: payment.id,
    legalEntityId: receipt.legalEntityId,
    currency: receipt.currency,
    amount: receipt.amount,
    createdAt: at,
    createdBy: actor,
  };
  allocations.push(allocation);
  return allocation;
}

export function recordProviderSettlement(
  data: CommercialData,
  payment: Payment,
  input: {
    provider: string;
    connectionId: string;
    providerDocumentId: string;
    reference: string;
  },
  actor: string,
  at: string,
) {
  const context = data.financeContext;
  if (!context)
    throw new ConflictException("The contract finance identity is missing.");
  assertPaymentIdentity(payment, context.legalEntityId, context.currency);
  const { receipts } = arrays(data);
  let receipt = receipts.find(
    (item) =>
      item.paymentId === payment.id &&
      item.source === "provider" &&
      item.provider === input.provider &&
      item.connectionId === input.connectionId &&
      item.providerDocumentId === input.providerDocumentId &&
      item.status !== "rejected",
  );
  if (!receipt) {
    receipt = {
      id: randomUUID(),
      paymentId: payment.id,
      legalEntityId: context.legalEntityId,
      currency: context.currency,
      amount: round(payment.amount, context.currency),
      source: "provider",
      status: "provider_confirmed",
      reference: input.reference || input.providerDocumentId,
      evidence: `${input.provider} settlement notification`,
      provider: input.provider,
      connectionId: input.connectionId,
      providerDocumentId: input.providerDocumentId,
      reportedAt: at,
      reportedBy: actor,
    };
    receipts.push(receipt);
  }
  allocate(data, receipt, payment, actor, at);
  payment.status =
    receipt.status === "finance_verified" ? "verified" : "proof_submitted";
  payment.reference = receipt.reference;
  if (receipt.status === "finance_verified") {
    payment.verifiedAt = receipt.verifiedAt;
    payment.verifiedBy = receipt.verifiedBy;
  } else {
    delete payment.verifiedAt;
    delete payment.verifiedBy;
  }
  return receipt;
}

/**
 * How and when a client paid a manually recorded receipt (§0.3 P0). Both are required: posting picks the payment
 * account from the method, and Finance checks the date against the bank. A day ahead of UTC is allowed, since
 * the firm's calendar can run up to 14 hours ahead.
 */
export function manualReceiptTerms(body: { method?: unknown; receivedOn?: unknown }, now: string): { method: ManualPaymentMethod; receivedOn: string } {
  const method = (MANUAL_PAYMENT_METHODS as readonly string[]).includes(String(body.method)) ? body.method as ManualPaymentMethod : null;
  if (!method) throw new BadRequestException("Choose how the client paid: bank transfer, card, cash, cheque or other.");
  const receivedOn = typeof body.receivedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.receivedOn) ? body.receivedOn : "";
  if (!receivedOn || new Date(`${receivedOn}T00:00:00Z`).toISOString().slice(0, 10) !== receivedOn)
    throw new BadRequestException("Enter the date the payment was received.");
  if (receivedOn > new Date(Date.parse(now) + 86_400_000).toISOString().slice(0, 10))
    throw new BadRequestException("The received date can't be in the future.");
  return { method, receivedOn };
}

export function reportManualReceipt(
  data: CommercialData,
  payment: Payment,
  input: { reference: string; evidence: string; method?: FinanceReceipt["method"]; receivedOn?: string },
  actor: string,
  at: string,
  actorUserId?: string,
) {
  const context = data.financeContext;
  if (!context)
    throw new ConflictException("The contract finance identity is missing.");
  assertPaymentIdentity(payment, context.legalEntityId, context.currency);
  if (payment.invoice)
    throw new ConflictException(
      "Refresh the linked provider invoice instead of reporting a separate manual receipt.",
    );
  const { receipts } = arrays(data);
  const active = receipts.find(
    (receipt) =>
      receipt.paymentId === payment.id && receipt.status !== "rejected",
  );
  if (active)
    throw new ConflictException(
      "This payment already has an active receipt record.",
    );
  const receipt: FinanceReceipt = {
    id: randomUUID(),
    paymentId: payment.id,
    legalEntityId: context.legalEntityId,
    currency: context.currency,
    amount: round(payment.amount, context.currency),
    source: "manual",
    status: "reported",
    reference: input.reference,
    evidence: input.evidence,
    ...(input.method ? { method: input.method } : {}),
    ...(input.receivedOn ? { receivedOn: input.receivedOn } : {}),
    reportedAt: at,
    reportedBy: actor,
    ...(actorUserId ? { reportedById: actorUserId } : {}),
  };
  receipts.push(receipt);
  allocate(data, receipt, payment, actor, at);
  payment.status = "proof_submitted";
  payment.reference = receipt.reference;
  payment.proof = receipt.evidence;
  return receipt;
}

/** Whether this person reported the receipt: by their id when it was recorded, else (older receipts) by name. */
export function receiptReportedBy(receipt: Pick<FinanceReceipt, "reportedBy" | "reportedById">, name: string, userId?: string) {
  return receipt.reportedById && userId ? receipt.reportedById === userId : receipt.reportedBy === name;
}

export function verifyReceipt(
  data: CommercialData,
  payment: Payment,
  actor: string,
  at: string,
  actorUserId?: string,
) {
  const { receipts } = arrays(data);
  const receipt = receipts.find(
    (item) =>
      item.paymentId === payment.id &&
      ["reported", "provider_confirmed"].includes(item.status),
  );
  if (!receipt)
    throw new NotFoundException(
      "Record a manual receipt or refresh a settled provider invoice before finance verification.",
    );
  if (receipt.source === "manual" && receiptReportedBy(receipt, actor, actorUserId))
    throw new ConflictException(
      "Another finance-authorized person must verify a manually reported receipt.",
    );
  const allocations = data.allocations ?? [];
  if (
    activeAllocatedAmount(allocations, payment.id, payment.currency).cmp(money(payment.amount, payment.currency)) !== 0 ||
    !allocations.some(
      (allocation) =>
        allocation.receiptId === receipt.id && !allocation.reversedAt,
    )
  )
    throw new ConflictException(
      "Allocate the complete receipt to this milestone before verification.",
    );
  receipt.status = "finance_verified";
  receipt.verifiedAt = at;
  receipt.verifiedBy = actor;
  if (actorUserId) receipt.verifiedById = actorUserId;
  payment.status = "verified";
  payment.verifiedAt = at;
  payment.verifiedBy = actor;
  payment.reference = receipt.reference;
  return receipt;
}

/**
 * Finance returns a receipt the team recorded (wrong amount, unreadable proof, money not in the account), with a
 * reason: the receipt is kept as rejected, its allocation is reversed and the milestone waits for a new receipt.
 * The person who recorded it can't return it, the same rule as verifying.
 */
export function returnManualReceipt(
  data: CommercialData,
  payment: Payment,
  reason: string,
  actor: string,
  at: string,
  actorUserId?: string,
) {
  const { receipts } = arrays(data);
  const receipt = receipts.find((item) => item.paymentId === payment.id && item.status === "reported" && item.source === "manual");
  if (!receipt)
    throw new NotFoundException("There is no recorded receipt waiting for Finance on this payment.");
  if (receiptReportedBy(receipt, actor, actorUserId))
    throw new ConflictException("Another finance-authorized person must return a receipt you recorded.");
  receipt.status = "rejected";
  receipt.rejectedAt = at;
  receipt.rejectionReason = reason;
  receipt.rejectedBy = actor;
  if (actorUserId) receipt.rejectedById = actorUserId;
  for (const allocation of data.allocations ?? []) {
    if (allocation.receiptId !== receipt.id || allocation.reversedAt) continue;
    allocation.reversedAt = at;
    allocation.reversalReason = reason;
  }
  payment.status = "pending";
  payment.proof = "";
  payment.reference = "";
  delete payment.verifiedAt;
  delete payment.verifiedBy;
  return receipt;
}

export function reverseProviderSettlement(
  data: CommercialData,
  payment: Payment,
  reason: string,
  at: string,
) {
  const { receipts, allocations } = arrays(data);
  const affected = receipts.filter(
    (receipt) =>
      receipt.paymentId === payment.id &&
      receipt.source === "provider" &&
      receipt.status !== "rejected",
  );
  for (const receipt of affected) {
    receipt.status = "rejected";
    receipt.rejectedAt = at;
    receipt.rejectionReason = reason;
    for (const allocation of allocations) {
      if (allocation.receiptId !== receipt.id || allocation.reversedAt) continue;
      allocation.reversedAt = at;
      allocation.reversalReason = reason;
    }
  }
  payment.status = "pending";
  delete payment.verifiedAt;
  delete payment.verifiedBy;
  return affected.length;
}

export function recordCreditNote(
  data: CommercialData,
  credit: ClientCredit,
  input: { reference: string; evidence: string },
  actor: string,
  at: string,
) {
  const context = data.financeContext;
  if (!context || credit.legalEntityId !== context.legalEntityId)
    throw new ConflictException(
      "The client credit must use the contract legal entity.",
    );
  if (credit.currency !== context.currency)
    throw new ConflictException(
      "The client credit must use the contract currency.",
    );
  const { documents } = arrays(data);
  if (
    documents.some(
      (document) =>
        document.kind === "credit_note" && document.creditId === credit.id,
    )
  )
    throw new ConflictException(
      "This client credit already has a verified credit-note record.",
    );
  const document: FinanceDocument = {
    id: randomUUID(),
    kind: "credit_note",
    source: "manual",
    legalEntityId: context.legalEntityId,
    currency: context.currency,
    number: input.reference,
    total: round(credit.amount, context.currency),
    status: "verified",
    creditId: credit.id,
    evidence: input.evidence,
    issuedAt: at,
    updatedAt: at,
  };
  documents.push(document);
  credit.reference = input.reference;
  credit.evidence = input.evidence;
  credit.verifiedBy = actor;
  credit.verifiedAt = at;
  credit.status = "verified";
  return document;
}

/**
 * Structural finance truth used in addition to provider freshness checks.
 * Aggregates created before the structured ledger remain readable, but every
 * contract with a finance context must carry a verified receipt and allocation.
 */
export function paymentHasFinanceVerifiedReceipt(
  data: CommercialData,
  payment: Payment,
) {
  if (!data.financeContext) return payment.status === "verified";
  if (
    payment.status !== "verified" ||
    payment.legalEntityId !== data.financeContext.legalEntityId ||
    payment.currency !== data.financeContext.currency
  )
    return false;
  const receipt = data.receipts?.find(
    (item) =>
      item.paymentId === payment.id &&
      item.status === "finance_verified" &&
      item.legalEntityId === data.financeContext?.legalEntityId &&
      item.currency === data.financeContext.currency,
  );
  if (!receipt) return false;
  return (
    allocatedSum(
      (data.allocations ?? []).filter(
        (allocation) =>
          allocation.paymentId === payment.id &&
          allocation.receiptId === receipt.id &&
          !allocation.reversedAt,
      ),
      payment.currency,
    ).cmp(money(payment.amount, payment.currency)) === 0
  );
}

export function agreementMatchesFinanceContext(data: CommercialData) {
  if (!data.financeContext) return false;
  return Boolean(
    data.agreement?.legalEntityId === data.financeContext.legalEntityId &&
      data.agreement.currency === data.financeContext.currency,
  );
}
