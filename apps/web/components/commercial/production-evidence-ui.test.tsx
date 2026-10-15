import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  // The approval reads as a date, not a raw ISO day.
  expect(document.querySelector('time[datetime="2026-09-18T10:00:00.000Z"]')?.textContent).toBe("Sep 18, 2026");
});

it("submits a Won opportunity Deal File with separate commission and payment evidence", async () => {
  const run = vi.fn().mockResolvedValue(true);
  const state = {
    opportunityStatus: "won", canEdit: true, contacts: [],
    data: { quotes: [{ id: "quote", number: 1, kind: "quotation", status: "accepted", currency: "AED", total: 100, lines: [] }], ownerReview: null, dealFile: null, requests: [], payments: [], materialApprovals: [] },
  } as unknown as CommercialState;
  render(<ApprovalRelease initialView="owner" state={state} run={run} busy={false} root="/workspace/pre-projects/cases/case" />);
  fireEvent.change(screen.getByRole("textbox", {name:"Proof-of-payment link"}), {target:{value:"https://example.com/proof"}});
  const commission = screen.getByRole("group", {name:"Commission 1"});
  fireEvent.change(within(commission).getByRole("textbox", {name:"Recipient"}), {target:{value:"Sales A"}});
  fireEvent.change(within(commission).getByRole("textbox", {name:"Amount"}), {target:{value:"10"}});
  fireEvent.change(screen.getByRole("textbox", {name:"Submission note"}), {target:{value:"Verified customer deposit"}});
  fireEvent.click(screen.getByRole("button", {name:"Send to Finance"}));
  await waitFor(()=>expect(run).toHaveBeenCalledWith("submit_owner_review", expect.objectContaining({paymentProofUrl:"https://example.com/proof",commissionLines:[{recipientName:"Sales A",type:"sales",basis:"amount",value:10}]})));
});

it("labels the designer commission \"Designer fee\" and still sends the designer type", async () => {
  const user = userEvent.setup();
  const run = vi.fn().mockResolvedValue(true);
  const state = {
    opportunityStatus: "won", canEdit: true, contacts: [],
    data: { quotes: [{ id: "quote", number: 1, kind: "quotation", status: "accepted", currency: "AED", total: 100, lines: [] }], ownerReview: null, dealFile: null, requests: [], payments: [], materialApprovals: [] },
  } as unknown as CommercialState;
  render(<ApprovalRelease initialView="owner" state={state} run={run} busy={false} root="/workspace/pre-projects/cases/case" />);
  fireEvent.change(screen.getByRole("textbox", {name:"Proof-of-payment link"}), {target:{value:"https://example.com/proof"}});
  const commission = screen.getByRole("group", {name:"Commission 1"});
  fireEvent.change(within(commission).getByRole("textbox", {name:"Recipient"}), {target:{value:"Dana"}});
  fireEvent.change(within(commission).getByRole("textbox", {name:"Amount"}), {target:{value:"25"}});
  await user.click(within(commission).getByRole("button", {name:/Type/}));
  expect(screen.queryByRole("option", {name:"Designer"})).not.toBeInTheDocument();
  await user.click(await screen.findByRole("option", {name:"Designer fee"}));
  fireEvent.change(screen.getByRole("textbox", {name:"Submission note"}), {target:{value:"Designer fee agreed"}});
  fireEvent.click(screen.getByRole("button", {name:"Send to Finance"}));
  await waitFor(()=>expect(run).toHaveBeenCalledWith("submit_owner_review", expect.objectContaining({commissionLines:[{recipientName:"Dana",type:"designer",basis:"amount",value:25}]})));
});

it("sends a Deal File with no commission, and says why Send to Finance waits (M5)", async () => {
  const run = vi.fn().mockResolvedValue(true);
  const state = {
    opportunityStatus: "won", canEdit: true, contacts: [],
    data: { quotes: [{ id: "quote", number: 1, kind: "quotation", status: "accepted", currency: "AED", total: 100, lines: [] }], ownerReview: null, dealFile: null, requests: [], payments: [], materialApprovals: [] },
  } as unknown as CommercialState;
  render(<ApprovalRelease initialView="owner" state={state} run={run} busy={false} root="/workspace/pre-projects/cases/case" />);
  fireEvent.change(screen.getByRole("textbox", {name:"Proof-of-payment link"}), {target:{value:"https://example.com/proof"}});
  expect(screen.getByRole("button", {name:"Send to Finance"})).toBeDisabled();
  expect(screen.getByText("Write the submission note.")).toBeVisible();
  fireEvent.change(screen.getByRole("textbox", {name:"Submission note"}), {target:{value:"No commission on this one"}});
  // A half-filled commission says what's missing; removing it sends the deal without one.
  const commission = screen.getByRole("group", {name:"Commission 1"});
  fireEvent.change(within(commission).getByRole("textbox", {name:"Recipient"}), {target:{value:"Sales A"}});
  expect(screen.getByText("Finish commission 1 or remove it.")).toBeVisible();
  expect(screen.getByRole("button", {name:"Send to Finance"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button", {name:"Remove commission 1"}));
  expect(screen.queryByRole("group", {name:"Commission 1"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name:"Send to Finance"}));
  await waitFor(()=>expect(run).toHaveBeenCalledWith("submit_owner_review", expect.objectContaining({commissionLines:[]})));
});

it("ignores the empty commission row when nothing is typed in it (M5)", async () => {
  const run = vi.fn().mockResolvedValue(true);
  const state = {
    opportunityStatus: "won", canEdit: true, contacts: [],
    data: { quotes: [{ id: "quote", number: 1, kind: "quotation", status: "accepted", currency: "AED", total: 100, lines: [] }], ownerReview: null, dealFile: null, requests: [], payments: [], materialApprovals: [] },
  } as unknown as CommercialState;
  render(<ApprovalRelease initialView="owner" state={state} run={run} busy={false} root="/workspace/pre-projects/cases/case" />);
  fireEvent.change(screen.getByRole("textbox", {name:"Proof-of-payment link"}), {target:{value:"https://example.com/proof"}});
  fireEvent.change(screen.getByRole("textbox", {name:"Submission note"}), {target:{value:"No commission"}});
  expect(screen.getByRole("button", {name:"Send to Finance"})).toBeEnabled();
  fireEvent.click(screen.getByRole("button", {name:"Send to Finance"}));
  await waitFor(()=>expect(run).toHaveBeenCalledWith("submit_owner_review", expect.objectContaining({commissionLines:[]})));
});

it("shows the owner's return remark, checks the proof link before sending, and needs no link once Finance verified the receipt", async () => {
  const run = vi.fn().mockResolvedValue(true);
  const state = (payments: unknown[]) => ({
    opportunityStatus: "won", canEdit: true, contacts: [],
    data: { quotes: [{ id: "quote", number: 1, kind: "quotation", status: "accepted", currency: "AED", total: 100, lines: [] }], dealFile: null, requests: [], payments, materialApprovals: [], ownerReview: {
      id: "review", quoteId: "quote", status: "returned", financeNote: "Transfer matched", decisionNote: "Attach the signed BOQ", checklist: {}, commissionLines: [],
    } },
  }) as unknown as CommercialState;
  const { unmount } = render(<ApprovalRelease initialView="owner" state={state([])} run={run} busy={false} root="/workspace/pre-projects/cases/case" />);
  expect(screen.getByText(/Attach the signed BOQ/)).toBeInTheDocument();
  expect(screen.queryByText(/Transfer matched/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", {name:"Submission note"}), {target:{value:"Fixed"}});
  expect(screen.getByText("Add a proof-of-payment link.")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", {name:"Proof-of-payment link"}), {target:{value:"http://example.com/proof"}});
  expect(screen.getAllByText("Use a secure HTTPS proof-of-payment link.").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", {name:"Send to Finance"})).toBeDisabled();
  unmount();
  render(<ApprovalRelease initialView="owner" state={state([{ id: "p1", sourceQuoteId: "quote", status: "verified" }])} run={run} busy={false} root="/workspace/pre-projects/cases/case" />);
  // The verified payment is the proof: no link is asked for.
  expect(screen.getByText("Payment verified by Finance")).toBeVisible();
  expect(screen.queryByRole("textbox", {name:"Proof-of-payment link"})).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", {name:"Submission note"}), {target:{value:"Receipt verified"}});
  fireEvent.click(screen.getByRole("button", {name:"Send to Finance"}));
  await waitFor(()=>expect(run).toHaveBeenCalledWith("submit_owner_review", expect.objectContaining({paymentProofUrl:""})));
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

it("keeps Finance's note out of the approver's remarks, and shows the decision only to an approver who didn't verify it (m18)", async () => {
  const pending = (viewerId: string) => ({
    opportunityStatus: "won", canVerifyFinance: true, canApproveDeal: true, viewerId, contacts: [], stepHolders: { verifyAgreement: [], verifyPayment: [], approveDeal: ["Olivia"], startProject: [] },
    data: { quotes: [{ id: "quote", number: 1, kind: "quotation", status: "accepted", currency: "AED", total: 100, lines: [] }], requests: [], payments: [], materialApprovals: [], dealFile: null, ownerReview: {
      id: "review", quoteId: "quote", status: "pending_approval", submittedById: "sara", financeReviewedById: "layla", financeNote: "Checked the transfer", checklist: { agreement: true }, finalCommissionLines: [],
    } },
  }) as unknown as CommercialState;
  const { unmount } = render(<ApprovalRelease initialView="owner" state={pending("layla")} run={vi.fn()} busy={false} root="/workspace/pre-projects/cases/case" />);
  expect(screen.queryByRole("textbox", { name: "Decision remarks" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Approve Deal File" })).not.toBeInTheDocument();
  expect(screen.getByText("Waiting for Olivia")).toBeInTheDocument();
  unmount();
  render(<ApprovalRelease initialView="owner" state={pending("olivia")} run={vi.fn()} busy={false} root="/workspace/pre-projects/cases/case" />);
  expect(screen.getByRole("textbox", { name: "Decision remarks" })).toHaveValue("");
  expect(screen.getByRole("button", { name: "Approve Deal File" })).toBeInTheDocument();
});

function readyMadeServicePathState(): CommercialState {
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
      servicePath: { selectedAt: "2026-09-25", selectedBy: "sales", scope: {
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


it("shows the deal's cost and margin only to people who can see costs", () => {
  const quote = { id: "quote", number: 1, kind: "quotation", status: "accepted", title: "Villa", currency: "AED", validUntil: "2099-01-01",
    discount: 0, taxRate: 0, terms: "", exclusions: "", requestIds: [], paymentTerms: [], createdAt: "2026-09-18", total: 100, lines: [] };
  const state = (canViewCosts: boolean) => ({ canEdit: true, canApprove: false, canRelease: false, canViewCosts, contacts: [], releaseReadiness: { designsRequired: 0, designsApproved: 0 },
    data: { revision: 1, quotes: [quote], requests: [], agreement: null, payments: [], audit: [], release: null, materialApprovals: [], ownerReview: null, dealFile: null } }) as unknown as CommercialState;
  const { unmount } = render(<ApprovalRelease initialView="owner" state={state(false)} run={vi.fn()} busy={false} root="/workspace/pre-projects/cases/case" />);
  expect(screen.queryByText("Internal cost")).not.toBeInTheDocument();
  expect(screen.queryByText("Gross margin")).not.toBeInTheDocument();
  unmount();
  render(<ApprovalRelease initialView="owner" state={state(true)} run={vi.fn()} busy={false} root="/workspace/pre-projects/cases/case" />);
  expect(screen.getByText("Internal cost")).toBeInTheDocument();
});

it("lays the Deal File out as KPI tiles, the next step and titled sections: requirements, approvals, money and commission", () => {
  const quote = { id: "quote", number: 1, kind: "quotation", status: "accepted", title: "Villa", currency: "AED", validUntil: "2099-01-01",
    discount: 0, taxRate: 0, terms: "", exclusions: "", requestIds: [], paymentTerms: [], createdAt: "2026-09-18", total: 100, lines: [] };
  const state = {
    opportunityStatus: "won", canVerifyFinance: false, canApproveDeal: true, canViewCosts: true, viewerId: "olivia", contacts: [], workspaceId: "w",
    releaseReadiness: { designsRequired: 0, designsApproved: 0 },
    dealInsight: {
      currency: "AED", agreed: "100.00", received: "50.00", outstanding: "50.00", rounds: [], nextDue: null, risks: ["qs_estimate_missing"], closing: null, proposals: [],
      sections: [
        { key: "quotation", group: "common", state: "present", href: "/q" },
        { key: "boq", group: "production", state: "missing", href: null },
      ],
    },
    dealApproval: { id: "r", kind: "deal_file", subjectId: "s", title: "Villa", href: null, status: "pending", amount: "100", currency: "AED", previousAmount: null,
      policy: { id: "p", versionId: "v", version: 1, name: "Deals" }, requestedBy: { userId: "sara", name: "Sara" }, requestedAt: "2026-10-01T00:00:00.000Z",
      currentStep: 2, stepSince: "2026-10-02T00:00:00.000Z", escalated: false, expiresAt: null, canDecide: true, waitingFor: ["Olivia"],
      steps: [
        { position: 1, label: "Finance verifies", approverKind: "permission", state: "done", decidedBy: "Layla", onBehalfOf: null, via: "direct", decidedAt: "2026-10-01T10:00:00.000Z", note: null },
        { position: 2, label: "Deal File approver", approverKind: "permission", state: "current", decidedBy: null, onBehalfOf: null, via: null, decidedAt: null, note: null },
      ] },
    data: { revision: 1, quotes: [quote], requests: [], agreement: null, payments: [], audit: [], release: null, materialApprovals: [], dealFile: null, ownerReview: {
      id: "review", quoteId: "quote", status: "pending_approval", submittedById: "sara", financeReviewedById: "layla", checklist: { agreement: true, boq: false },
      finalCommissionLines: [{ recipientName: "Sam Carter", type: "sales", basis: "amount", value: 10, amount: 10 }, { recipientName: "Dana Haddad", type: "designer", basis: "amount", value: 5.5, amount: 5.5 }],
    } },
  } as unknown as CommercialState;
  render(<ApprovalRelease initialView="owner" state={state} run={vi.fn()} busy={false} root="/workspace/pre-projects/cases/case" />);
  const tiles = screen.getByLabelText("Deal File summary");
  expect(within(tiles).getAllByRole("term").map((term) => term.textContent)).toEqual(["Deal value", "Gross margin", "Requirements", "Payment", "Internal approval", "Commission"]);
  const tile = (label: string) => within(tiles).getByText(label, { selector: "dt" }).closest(".wd-kpi-tile")!;
  expect(tile("Requirements")).toHaveTextContent("1 of 2");
  expect(tile("Requirements")).toHaveTextContent("1 missing");
  expect(tile("Requirements")).toHaveAttribute("data-tone", "warning");
  expect(tile("Payment")).toHaveTextContent("Verified");
  expect(tile("Payment")).toHaveTextContent("50% paid");
  expect(tile("Commission")).toHaveTextContent("15.50");
  // The next step is its own card: the step, who it waits for, what to check, the owner's checklist and the decision.
  const next = screen.getByRole("heading", { level: 3, name: "Owner approval" }).closest("section")!;
  expect(within(next).getByText("Next step")).toBeInTheDocument();
  expect(within(next).getByText("Waiting for Olivia")).toBeInTheDocument();
  expect(within(next).getByText("Check: QS price check")).toBeInTheDocument();
  const checklist = within(next).getByRole("list", { name: "Owner checklist" });
  expect(within(checklist).getByText("Agreement").closest("li")).toHaveAttribute("data-done");
  expect(within(checklist).getByText("BOQ").closest("li")).not.toHaveAttribute("data-done");
  expect(within(next).getByRole("button", { name: "Approve Deal File" })).toBeDisabled();
  // The long lists are sub-tabs under the next step (requirements first); the small facts are titled cards beside them.
  expect(within(screen.getByRole("tablist", { name: "Lists" })).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Requirements", "Approvals"]);
  expect(within(screen.getByRole("tabpanel", { name: "Requirements" })).getByText("Missing")).toBeInTheDocument();
  fireEvent.click(within(tile("Internal approval") as HTMLElement).getByRole("button"));
  expect(within(screen.getByRole("tabpanel", { name: "Approvals" })).getByText("Finance verifies")).toBeInTheDocument();
  for (const name of ["Money", "Commission"]) expect(screen.getByRole("region", { name })).toBeInTheDocument();
  const commission = screen.getByRole("region", { name: "Commission" });
  expect(within(commission).getByText("Sam Carter")).toBeInTheDocument();
  expect(within(commission).getByText("Total").closest("div")).toHaveTextContent("15.50");
  expect(within(screen.getByRole("region", { name: "Money" })).getByText("Internal cost")).toBeInTheDocument();
});
