import { describe, expect, it } from "vitest";
import { emptyCommercial } from "./commercial.domain";
import {
  bindFinanceContext,
  recordCreditNote,
  recordProviderSettlement,
  manualReceiptTerms,
  reportManualReceipt,
  returnManualReceipt,
  reverseProviderSettlement,
  upsertProviderInvoiceDocument,
  verifyReceipt,
} from "./finance-ledger";
import type { ClientCredit, Payment } from "./commercial.types";
import { commercialCommandPermission } from "./commercial.service";

const at = "2026-09-18T10:00:00.000Z";
const entity = {
  legalEntityId: "entity-a",
  legalEntityCode: "PLM-AE",
  legalEntityName: "Palm Living UAE",
  legalEntityRegisteredName: "Palm Living Interiors LLC",
  legalEntityCountryCode: "AE",
  legalEntityBaseCurrency: "AED",
  legalEntityTaxRegistrationNumber: "TRN-1",
};
const payment = (): Payment => ({
  id: "payment-a",
  legalEntityId: "entity-a",
  currency: "AED",
  title: "Advance",
  amount: 1_000,
  dueDate: "2026-09-20",
  requiredForRelease: true,
  status: "pending",
  proof: "",
  reference: "",
});

describe("structured commercial finance ledger", () => {
  it("separates finance verification from commercial approval and editing", () => {
    expect(commercialCommandPermission("verify_payment")).toBe(
      "commercial.finance.verify",
    );
    expect(commercialCommandPermission("verify_credit")).toBe(
      "commercial.finance.verify",
    );
    expect(commercialCommandPermission("review_deal_finance")).toBe(
      "commercial.finance.verify",
    );
    expect(commercialCommandPermission("approve")).toBe("commercial.approve");
    expect(commercialCommandPermission("decide_owner_review")).toBe("commercial.deal.approve");
    expect(commercialCommandPermission("report_payment_receipt")).toBe(
      "pre_projects.edit",
    );
  });
  it("binds one legal entity and contract currency without claiming regional tax validation", () => {
    const context = bindFinanceContext(null, entity, "AED", at);
    expect(context).toMatchObject({
      legalEntityId: "entity-a",
      baseCurrency: "AED",
      currency: "AED",
      taxValidation: "unvalidated",
    });
    expect(bindFinanceContext(context, entity, "AED", at)).toBe(context);
    expect(() =>
      bindFinanceContext(context, { ...entity, legalEntityId: "entity-b" }, "AED", at),
    ).toThrow(/identity is already fixed/i);
    expect(() => bindFinanceContext(null, {}, "AED", at)).toThrow(/assign an active legal entity/i);
  });

  it("keeps provider confirmation separate from finance verification and is replay safe", () => {
    const data = emptyCommercial(), milestone = payment();
    data.financeContext = bindFinanceContext(null, entity, "AED", at);
    data.payments.push(milestone);
    upsertProviderInvoiceDocument(data, milestone, {
      provider: "zoho_books",
      connectionId: "connection-a",
      providerDocumentId: "invoice-a",
      number: "INV-1",
      total: 1_000,
      status: "paid",
    }, at);
    const receipt = recordProviderSettlement(data, milestone, {
      provider: "zoho_books",
      connectionId: "connection-a",
      providerDocumentId: "invoice-a",
      reference: "INV-1",
    }, "Accounting provider", at);
    const replay = recordProviderSettlement(data, milestone, {
      provider: "zoho_books",
      connectionId: "connection-a",
      providerDocumentId: "invoice-a",
      reference: "INV-1",
    }, "Accounting provider", at);
    expect(replay.id).toBe(receipt.id);
    expect(data.financeDocuments).toHaveLength(1);
    expect(data.receipts).toHaveLength(1);
    expect(data.allocations).toHaveLength(1);
    expect(receipt.status).toBe("provider_confirmed");
    expect(milestone.status).toBe("proof_submitted");
    verifyReceipt(data, milestone, "Finance manager", at);
    expect(receipt.status).toBe("finance_verified");
    expect(milestone).toMatchObject({
      status: "verified",
      verifiedBy: "Finance manager",
    });
  });

  it("reopens allocations when the provider reverses settlement", () => {
    const data = emptyCommercial(), milestone = payment();
    data.financeContext = bindFinanceContext(null, entity, "AED", at);
    data.payments.push(milestone);
    recordProviderSettlement(data, milestone, {
      provider: "quickbooks",
      connectionId: "connection-a",
      providerDocumentId: "invoice-a",
      reference: "QB-1",
    }, "Accounting provider", at);
    verifyReceipt(data, milestone, "Finance manager", at);
    expect(reverseProviderSettlement(data, milestone, "Balance reopened", at)).toBe(1);
    expect(milestone.status).toBe("pending");
    expect(data.receipts?.[0]).toMatchObject({ status: "rejected", rejectionReason: "Balance reopened" });
    expect(data.allocations?.[0].reversedAt).toBe(at);
  });

  it("records a manual receipt before a separate finance verification", () => {
    const data = emptyCommercial(), milestone = payment();
    data.financeContext = bindFinanceContext(null, entity, "AED", at);
    data.payments.push(milestone);
    const receipt = reportManualReceipt(
      data,
      milestone,
      { reference: "BANK-42", evidence: "Bank statement row 42" },
      "Operations",
      at,
    );
    expect(receipt.status).toBe("reported");
    expect(milestone.status).toBe("proof_submitted");
    expect(() => verifyReceipt(data, milestone, "Operations", at)).toThrow(
      /another finance-authorized person/i,
    );
    verifyReceipt(data, milestone, "Finance manager", at);
    expect(receipt).toMatchObject({
      status: "finance_verified",
      verifiedBy: "Finance manager",
    });
  });

  it("asks how and when a manual receipt was paid, and keeps both on the receipt (§0.3 P0)", () => {
    const now = "2026-10-17T08:00:00.000Z";
    expect(manualReceiptTerms({ method: "cheque", receivedOn: "2026-10-16" }, now)).toEqual({ method: "cheque", receivedOn: "2026-10-16" });
    // The firm's calendar can be a day ahead of UTC.
    expect(manualReceiptTerms({ method: "bank", receivedOn: "2026-10-18" }, now).receivedOn).toBe("2026-10-18");
    expect(() => manualReceiptTerms({ receivedOn: "2026-10-16" }, now)).toThrow(/how the client paid/);
    expect(() => manualReceiptTerms({ method: "crypto", receivedOn: "2026-10-16" }, now)).toThrow(/how the client paid/);
    expect(() => manualReceiptTerms({ method: "bank" }, now)).toThrow(/date the payment was received/);
    expect(() => manualReceiptTerms({ method: "bank", receivedOn: "2026-02-30" }, now)).toThrow(/date the payment was received/);
    expect(() => manualReceiptTerms({ method: "bank", receivedOn: "2026-10-19" }, now)).toThrow(/future/);
    const data = emptyCommercial(), milestone = payment();
    data.financeContext = bindFinanceContext(null, entity, "AED", at);
    data.payments.push(milestone);
    const receipt = reportManualReceipt(data, milestone, { reference: "CHQ-7", evidence: "Cheque 7", method: "cheque", receivedOn: "2026-10-16" }, "Sara", at, "user-sara");
    expect(receipt).toMatchObject({ method: "cheque", receivedOn: "2026-10-16" });
  });

  it("returns a receipt the team recorded with a reason: kept as rejected, allocation reversed, the payment waits for a new one", () => {
    const data = emptyCommercial(), milestone = payment();
    data.financeContext = bindFinanceContext(null, entity, "AED", at);
    data.payments.push(milestone);
    const first = reportManualReceipt(data, milestone, { reference: "BANK-44", evidence: "Row 44", method: "bank", receivedOn: "2026-09-17" }, "Sara", at, "user-sara");
    expect(commercialCommandPermission("return_payment")).toBe("commercial.finance.verify");
    expect(() => returnManualReceipt(data, milestone, "Wrong amount", "Sara", at, "user-sara")).toThrow(/another finance-authorized person/i);
    returnManualReceipt(data, milestone, "The bank shows 900, not 1,000", "Finance manager", at, "user-finance");
    expect(first).toMatchObject({ status: "rejected", rejectionReason: "The bank shows 900, not 1,000", rejectedBy: "Finance manager", rejectedById: "user-finance" });
    expect(data.allocations?.filter((allocation) => allocation.receiptId === first.id).every((allocation) => allocation.reversedAt === at)).toBe(true);
    expect(milestone).toMatchObject({ status: "pending", proof: "", reference: "" });
    expect(() => verifyReceipt(data, milestone, "Finance manager", at, "user-finance")).toThrow(/Record a manual receipt/);
    expect(() => returnManualReceipt(data, milestone, "Again", "Finance manager", at, "user-finance")).toThrow(/no recorded receipt/);
    // Recorded again with the right amount, it is verified as usual: the returned one stays in the history.
    const second = reportManualReceipt(data, milestone, { reference: "BANK-45", evidence: "Row 45", method: "bank", receivedOn: "2026-09-18" }, "Sara", at, "user-sara");
    verifyReceipt(data, milestone, "Finance manager", at, "user-finance");
    expect(second.status).toBe("finance_verified");
    expect(data.receipts?.map((receipt) => receipt.status)).toEqual(["rejected", "finance_verified"]);
  });

  it("never returns a provider's settlement (the provider reverses it)", () => {
    const data = emptyCommercial(), milestone = payment();
    data.financeContext = bindFinanceContext(null, entity, "AED", at);
    data.payments.push(milestone);
    expect(() => returnManualReceipt(data, milestone, "Wrong", "Finance manager", at, "user-finance")).toThrow(/no recorded receipt/);
  });

  it("keeps the separation rule by person: two people with the same name are still two people", () => {
    const data = emptyCommercial(), milestone = payment();
    data.financeContext = bindFinanceContext(null, entity, "AED", at);
    data.payments.push(milestone);
    const receipt = reportManualReceipt(data, milestone, { reference: "BANK-43", evidence: "Row 43" }, "Sara", at, "user-sara");
    expect(receipt.reportedById).toBe("user-sara");
    expect(() => verifyReceipt(data, milestone, "Sara K.", at, "user-sara")).toThrow(/another finance-authorized person/i);
    verifyReceipt(data, milestone, "Sara", at, "user-other-sara");
    expect(receipt).toMatchObject({ status: "finance_verified", verifiedById: "user-other-sara" });
  });

  it("verifies money exactly in the contract currency (no float drift, 3-decimal currencies)", () => {
    const kwd = { ...entity, legalEntityBaseCurrency: "KWD" };
    const data = emptyCommercial(), milestone = { ...payment(), currency: "KWD", amount: 0.1 + 0.2 + 1234.567 };
    data.financeContext = bindFinanceContext(null, kwd, "KWD", at);
    data.payments.push(milestone);
    const receipt = reportManualReceipt(data, milestone, { reference: "K-1", evidence: "Row" }, "Sara", at, "user-sara");
    // 1234.867 exactly, three places: not 1234.87, and not 1234.8670000000002.
    expect(receipt.amount).toBe(1234.867);
    verifyReceipt(data, milestone, "Layla", at, "user-layla");
    expect(milestone.status).toBe("verified");
  });

  it("creates a legal-entity credit-note record for a verified deduction", () => {
    const data = emptyCommercial();
    data.financeContext = bindFinanceContext(null, entity, "AED", at);
    const credit: ClientCredit = {
      id: "credit-a",
      quoteId: "variation-a",
      legalEntityId: "entity-a",
      amount: 250,
      currency: "AED",
      status: "pending",
      reference: "",
      evidence: "",
    };
    data.credits?.push(credit);
    const document = recordCreditNote(
      data,
      credit,
      { reference: "CN-7", evidence: "Applied in accounting" },
      "Finance manager",
      at,
    );
    expect(document).toMatchObject({
      kind: "credit_note",
      legalEntityId: "entity-a",
      number: "CN-7",
      total: 250,
    });
    expect(credit.status).toBe("verified");
  });
});
