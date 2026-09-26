import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { CommercialState } from "@/lib/commercial/types";
import { ApprovalRelease } from "./commercial-workflows";
import { PreExecutionFlow } from "./pre-execution-flow";

vi.mock("@/design-system", async (original) => ({
  ...(await original<typeof import("@/design-system")>()),
  ControlledModalDialog: () => null,
}));

it("shows the exact production evidence frozen in the Deal File", () => {
  const state = {
    canEdit: true,
    canApprove: true,
    canRelease: true,
    contacts: [],
    releaseReadiness: { designsRequired: 1, designsApproved: 1 },
    data: {
      revision: 1,
      quotes: [{
        id: "quote", number: 1, kind: "quotation", status: "accepted",
        title: "Villa", currency: "AED", validUntil: "2099-01-01",
        discount: 0, taxRate: 0, terms: "", exclusions: "", requestIds: [],
        paymentTerms: [], createdAt: "2026-09-18", total: 100, lines: [],
      }],
      requests: [], agreement: null, payments: [], audit: [], release: null,
      materialApprovals: [], ownerReview: null,
      dealFile: {
        id: "deal", reference: "DF-2026-001", revision: 1,
        ownerReviewId: "review", quoteId: "quote", quoteNumber: 1,
        quoteHash: "hash", agreementReference: "AGR-1", paymentIds: [],
        value: 100, cost: 50, margin: 50, commission: 0, status: "active",
        approvedAt: "2026-09-18T10:00:00.000Z", approvedBy: "Owner",
        designEvidence: { capturedAt: "2026-09-18T09:00:00.000Z", links: [{}, {}] },
        materialEvidence: [{}, {}, {}],
      },
    },
  } as unknown as CommercialState;
  render(<ApprovalRelease initialView="owner" state={state} run={vi.fn()} busy={false} root="/workspace/pre-projects/cases/case" />);
  expect(screen.getByText("DF-2026-001")).toBeVisible();
  expect(screen.getByText("2 files · 3 materials")).toBeVisible();
});

it("submits a Won opportunity Deal File with separate commission and payment evidence", async () => {
  const run = vi.fn().mockResolvedValue(true);
  const state = {
    opportunityStatus: "won", canEdit: true, contacts: [],
    data: { quotes: [{ id: "quote", number: 1, kind: "quotation", status: "accepted", currency: "AED", total: 100, lines: [] }], ownerReview: null, dealFile: null, requests: [], payments: [], materialApprovals: [] },
  } as unknown as CommercialState;
  render(<ApprovalRelease initialView="owner" state={state} run={run} busy={false} root="/workspace/pre-projects/cases/case" />);
  fireEvent.change(screen.getByRole("textbox", {name:"Proof-of-payment link"}), {target:{value:"https://example.com/proof"}});
  fireEvent.change(screen.getByRole("textbox", {name:"Commission recipient 1"}), {target:{value:"Sales A"}});
  fireEvent.change(screen.getByRole("spinbutton", {name:"Commission value 1"}), {target:{value:"10"}});
  fireEvent.change(screen.getByRole("textbox", {name:"Submission note"}), {target:{value:"Verified customer deposit"}});
  fireEvent.click(screen.getByRole("button", {name:"Send to Finance"}));
  await waitFor(()=>expect(run).toHaveBeenCalledWith("submit_owner_review", expect.objectContaining({paymentProofUrl:"https://example.com/proof",commissionLines:[{recipientName:"Sales A",type:"sales",basis:"amount",value:10}]})));
});

it("requires Finance to acknowledge payment proof before confirming a submitted deal", async () => {
  const run = vi.fn().mockResolvedValue(true);
  const state = {
    opportunityStatus: "won", canVerifyFinance: true, contacts: [],
    data: { quotes: [{ id: "quote", number: 1, kind: "quotation", status: "accepted", currency: "AED", total: 100, lines: [] }], requests: [], payments: [], materialApprovals: [], dealFile: null, ownerReview: {
      id:"review",quoteId:"quote",status:"pending_finance",submittedBy:"Sales A",submittedAt:"2026-09-24",paymentProofUrl:"https://example.com/proof",checklist:{},commissionLines:[{recipientName:"Sales A",type:"sales",basis:"amount",value:10,amount:10}],
    } },
  } as unknown as CommercialState;
  render(<ApprovalRelease initialView="owner" state={state} run={run} busy={false} root="/workspace/pre-projects/cases/case" />);
  const confirm = screen.getByRole("button", {name:"Confirm Finance review"});
  expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", {name:/I verified the linked proof of payment/}));
  fireEvent.click(confirm);
  await waitFor(()=>expect(run).toHaveBeenCalledWith("review_deal_finance", expect.objectContaining({decision:"confirm",paymentVerified:true,commissionLines:[{recipientName:"Sales A",type:"sales",basis:"amount",value:10}]})));
});

function readyMadePalmState(): CommercialState {
  const quote = {
    id: "main", number: 1, round: "main", kind: "quotation", status: "accepted", hash: "main-hash",
    title: "Ready-made furniture", currency: "AED", lines: [],
    clientDecision: { decision: "accept", quoteHash: "main-hash", selectedOptionLineIds: [], acceptedTotal: 100 },
  };
  return {
    opportunityStatus: "won", canRelease: true, contacts: [], caseId: "case",
    releaseReadiness: { designsRequired: 0, designsApproved: 0 },
    data: {
      revision: 1, quotes: [quote], requests: [], audit: [], release: null, materialApprovals: [],
      palmFlow: { selectedAt: "2026-09-25", selectedBy: "sales", scope: {
        design: false, mainQuotation: true, materialSelection: false, procurement: true,
        manufacturing: false, siteWorks: false, installation: true,
      } },
      financeContext: { legalEntityId: "entity", currency: "AED" },
      agreement: { status: "executed", evidence: "Signed agreement", evidenceKind: "operational",
        quoteId: "main", quoteHash: "main-hash", acceptedTotal: 100, selectedOptionLineIds: [],
        legalEntityId: "entity", currency: "AED" },
      payments: [{ id: "payment", sourceQuoteId: "main", legalEntityId: "entity", currency: "AED",
        amount: 100, requiredForRelease: true, status: "verified", evidenceKind: "operational" }],
      receipts: [{ id: "receipt", paymentId: "payment", legalEntityId: "entity", currency: "AED", status: "finance_verified" }],
      allocations: [{ id: "allocation", receiptId: "receipt", paymentId: "payment", amount: 100 }],
      ownerReview: { id: "review", quoteId: "main", status: "approved", financeReviewedById: "finance" },
      dealFile: { id: "deal", quoteId: "main", reference: "DF-1", paymentProofUrl: "https://example.com/proof",
        commissionLines: [{ recipientName: "Sales", type: "sales", basis: "amount", value: 1, amount: 1 }] },
    },
  } as unknown as CommercialState;
}

