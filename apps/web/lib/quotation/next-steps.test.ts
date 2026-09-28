import { describe, expect, it } from "vitest";
import type { CommercialState } from "@/lib/commercial/types";
import { declinedSteps, nextSteps } from "./next-steps";

const quote = { id: "q1", round: "main" };
const state = (data: Partial<CommercialState["data"]>, can: Partial<CommercialState> = {}): CommercialState => ({
  workspaceId: "w", caseId: "c", title: "Villa", customerName: "Aisha", currency: "AED", contacts: [], portalSlug: null,
  canEdit: false, canApprove: false, canVerifyFinance: false, canRelease: false, canManagePortal: false, palmFlowEnabled: true,
  stepHolders: { verifyAgreement: ["Olivia"], verifyPayment: ["Layla"], approveDeal: ["Olivia", "Omar"], startProject: ["Khalid"] },
  data: { payments: [], quotes: [], ...data } as unknown as CommercialState["data"], ...can,
}) as CommercialState;
const payment = (status: string) => ({ id: "p1", sourceQuoteId: "q1", requiredForRelease: true, status, title: "Advance", amount: 100 });

describe("what happens after the client accepts", () => {
  it("offers Sales the agreement first, with everything after it waiting its turn", () => {
    const steps = nextSteps(state({}, { canEdit: true }), quote, "c", false);
    expect(steps.map((step) => [step.key, step.state])).toEqual([["agreement", "current"], ["payment", "later"], ["deal", "later"], ["project", "later"]]);
    expect(steps[0].action).toEqual({ label: "Record agreement", href: "/workspace/pre-projects/cases/c/contracts" });
    expect(steps.slice(1).every((step) => step.action === null)).toBe(true);
  });

  it("tells someone who can't act who holds the step", () => {
    const steps = nextSteps(state({ agreement: { quoteId: "q1", status: "executed" } as never, payments: [payment("proof_submitted")] as never }), quote, "c", false);
    expect(steps[0].state).toBe("done");
    expect(steps[1]).toMatchObject({ key: "payment", label: "Verify the payment", state: "waiting", action: null, holders: ["Layla"] });
  });

  it("gives Finance its action and the approver theirs", () => {
    const paid = { agreement: { quoteId: "q1", status: "executed" } as never, payments: [payment("verified")] as never };
    expect(nextSteps(state({ ...paid, ownerReview: { quoteId: "q1", status: "pending_finance" } as never }, { canVerifyFinance: true }), quote, "c", false)[2])
      .toMatchObject({ label: "Finance checks the deal", state: "current", action: { label: "Check" } });
    expect(nextSteps(state({ ...paid, ownerReview: { quoteId: "q1", status: "pending_approval" } as never }, { canApproveDeal: false }), quote, "c", false)[2])
      .toMatchObject({ label: "Approve the deal", state: "waiting", holders: ["Olivia", "Omar"] });
    const approved = nextSteps(state({ ...paid, ownerReview: { quoteId: "q1", status: "approved" } as never }), quote, "c", false);
    expect(approved.at(-1)).toMatchObject({ key: "project", state: "waiting", holders: ["Khalid"] });
    expect(nextSteps(state({ ...paid, ownerReview: { quoteId: "q1", status: "approved" } as never }), quote, "c", true).every((step) => step.state === "done")).toBe(true);
  });

  it("ends a design round at its deal: design work opens once it's approved", () => {
    const steps = nextSteps(state({}, { canEdit: true }), { id: "q1", round: "design" }, "c", false);
    expect(steps.map((step) => step.key)).toEqual(["agreement", "payment", "deal"]);
    expect(steps[2].label).toBe("Submit the design deal");
  });

  it("asks for a payment plan when none is due before the start", () => {
    const steps = nextSteps(state({ agreement: { quoteId: "q1", status: "executed" } as never }, { canEdit: true }), quote, "c", false);
    expect(steps[1]).toMatchObject({ label: "Set the payment plan", state: "current", action: { label: "Open payments" } });
  });

  it("after a decline, offers closing the open opportunity as Lost, and nothing once it's closed", () => {
    expect(declinedSteps(state({}, { opportunityId: "o1", opportunityStatus: "open" }))).toEqual([expect.objectContaining({
      key: "lost", action: { label: "Open opportunity", href: "/workspace/crm/opportunities?record=o1" } })]);
    expect(declinedSteps(state({}, { opportunityId: "o1", opportunityStatus: "lost" }))).toEqual([]);
  });
});
