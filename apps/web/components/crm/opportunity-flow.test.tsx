import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CrmRequestError } from "@/lib/crm/client";
import { missingFrom, requirementAction, type OpportunityFlowView } from "@/lib/crm/opportunity-flow";
import { NextStepCard, StageBlockedDialog } from "./opportunity-flow";

const flow = (overrides: Partial<OpportunityFlowView> = {}): OpportunityFlowView => ({
  flow: "furniture",
  steps: [
    { stageId: "s1", name: "New Opportunity", step: "new", state: "done", optional: false },
    { stageId: "s2", name: "Qualified", step: "qualified", state: "done", optional: false },
    { stageId: "s3", name: "Proposal", step: "proposal", state: "current", optional: false },
    { stageId: "s4", name: "Negotiation", step: "negotiation", state: "upcoming", optional: true },
    { stageId: "s5", name: "Won", step: "won", state: "upcoming", optional: false },
  ],
  done: 2, total: 5,
  next: { stageId: "s5", name: "Won", step: "won" },
  missing: [{ key: "paymentProof", label: "Payment proof attached" }],
  toWon: [{ key: "paymentProof", label: "Payment proof attached" }],
  negotiationOptional: true,
  enquiryType: "Furniture Only",
  furniture: { path: "take_home_now", feasibility: null, materialsChange: false },
  clientApproval: { at: "2026-10-03T10:00:00.000Z", by: "Sara" },
  quotationExists: true, paymentVerified: false, proofs: [],
  ...overrides,
});

describe("the opportunity's next step (PLM-121/122)", () => {
  it("shows the steps, the next column, one action and what is still needed", async () => {
    const onAction = vi.fn();
    render(<NextStepCard workspaceId="ws" opportunityId="opp" flow={flow()} status="open" ownerName="Sara Sales" followUp="2026-10-05T06:00:00.000Z" onAction={onAction} onAdvance={vi.fn()} advancing={false} />);
    const card = screen.getByRole("region", { name: "Next step" });
    expect(within(card).getByText("2 of 5 done")).toBeInTheDocument();
    expect(within(card).getByText("Negotiation is optional")).toBeInTheDocument();
    expect(within(card).getByText("A · Take home now")).toBeInTheDocument();
    expect(within(card).getByText(/Client approved ·/)).toBeInTheDocument();
    const rows = within(card).getByRole("list", { name: "Still needed" });
    expect(within(rows).getByText("Payment proof attached")).toBeInTheDocument();
    // The primary action is the first missing item's action, offered once.
    expect(within(card).getAllByRole("button", { name: "Attach payment proof" })).toHaveLength(1);
    await userEvent.click(within(card).getByRole("button", { name: "Attach payment proof" }));
    expect(onAction).toHaveBeenCalledWith("proof", "paymentProof");
  });

  it("moves on when nothing is missing", async () => {
    const onAdvance = vi.fn();
    render(<NextStepCard workspaceId="ws" opportunityId="opp" flow={flow({ next: { stageId: "s3", name: "Proposal", step: "proposal" }, missing: [] })} status="open" ownerName={null} followUp={null} onAction={vi.fn()} onAdvance={onAdvance} advancing={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Move to Proposal" }));
    expect(onAdvance).toHaveBeenCalled();
  });

  it("lists every missing item of a refused move with its action, and one dismiss", async () => {
    const onAction = vi.fn(), onClose = vi.fn();
    render(<StageBlockedDialog stageName="Won" onAction={onAction} onClose={onClose} items={[
      { key: "furniturePath", label: "Furniture sub-path chosen" }, { key: "introMeeting", label: "Intro meeting completed" },
    ]} />);
    expect(screen.getByText("Can't move to Won yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Book intro" }));
    expect(onAction).toHaveBeenCalledWith("intro", "introMeeting");
    expect(onClose).toHaveBeenCalled();
  });

  it("maps each requirement to the action that resolves it, and reads refused moves", () => {
    expect(requirementAction("feasibility").target).toBe("furniture");
    expect(requirementAction("quotation").target).toBe("quote");
    expect(requirementAction("discovery:question:style").target).toBe("discovery");
    expect(requirementAction("owner").target).toBe("edit");
    expect(missingFrom(new CrmRequestError("Stage requirements are not met", 422, [{ key: "paymentProof", label: "Payment proof attached" }]))).toHaveLength(1);
    expect(missingFrom(new Error("x"))).toEqual([]);
  });
});
