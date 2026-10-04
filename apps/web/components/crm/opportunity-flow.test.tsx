import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CrmRequestError } from "@/lib/crm/client";
import { missingFrom, requirementAction, type OpportunityFlowView } from "@/lib/crm/opportunity-flow";
import { DesignSystemProvider } from "@/design-system";
import { nowPlan } from "@/lib/crm/now-step";
import { StageBlockedSheet } from "./opportunity-flow";
import { NowCard, ProgressLine } from "./opportunity-now";

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

const design = (overrides: Partial<OpportunityFlowView> = {}) => flow({
  flow: "design", furniture: null, clientApproval: null,
  steps: [
    { stageId: "s1", name: "New Opportunity", step: "new", state: "current", optional: false },
    { stageId: "s2", name: "Qualified", step: "qualified", state: "upcoming", optional: false },
    { stageId: "s3", name: "Proposal", step: "proposal", state: "upcoming", optional: false },
    { stageId: "s4", name: "Won", step: "won", state: "upcoming", optional: false },
  ],
  next: { stageId: "s2", name: "Qualified", step: "qualified" },
  missing: [{ key: "introMeeting", label: "Intro meeting completed" }, { key: "clientType", label: "Client type chosen (not TBC)" }, { key: "enquiryType", label: "Enquiry type chosen" }],
  toWon: [{ key: "introMeeting", label: "Intro meeting completed" }, { key: "clientType", label: "Client type chosen (not TBC)" }, { key: "enquiryType", label: "Enquiry type chosen" }, { key: "discovery:area", label: "Area" }, { key: "paymentProof", label: "Payment proof attached" }],
  ...overrides,
});
const people = [{ id: "m1", label: "Dana Haddad" }, { id: "m2", label: "Omar Saleh" }];
const wrap = (node: React.ReactNode) => render(<DesignSystemProvider>{node}</DesignSystemProvider>);

describe("the Now card (F1)", () => {
  it("shows one step as a verb, why, who, when and one primary button; the rest fold away", async () => {
    const onAct = vi.fn();
    const user = userEvent.setup();
    wrap(<NowCard plan={nowPlan({ flow: design(), status: "open" })} owner={people[0]} people={people} due="2020-01-02T09:00:00.000Z" busy={false} onAct={onAct} />);
    const card = screen.getByRole("region", { name: "Book the intro meeting" });
    expect(within(card).getByText("Needed to move to Qualified")).toBeInTheDocument();
    expect(within(card).getByText("Dana Haddad")).toBeInTheDocument();
    expect(within(card).getByText(/Overdue/)).toBeInTheDocument();
    expect(within(card).getAllByRole("button").filter((button) => button.getAttribute("data-variant") === "primary")).toHaveLength(1);
    await user.click(within(card).getByRole("button", { name: "Book intro" }));
    expect(onAct).toHaveBeenCalledWith(expect.objectContaining({ id: "introMeeting", target: "intro" }));
    // "2 more before Qualified" lists the rest, each with its action.
    expect(within(card).queryByText("Set the client type")).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "2 more before Qualified" }));
    expect(within(card).getByText("Set the client type")).toBeInTheDocument();
    expect(within(card).getByText("Choose the enquiry type")).toBeInTheDocument();
    expect(screen.getByText("Then: Move to Qualified · Fill in the property details")).toBeInTheDocument();
  });

  it("reassigns through the teammate list", async () => {
    const onReassign = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    wrap(<NowCard plan={nowPlan({ flow: design(), status: "open" })} owner={people[0]} people={people} due={null} busy={false} onAct={vi.fn()} onReassign={onReassign} />);
    await user.click(screen.getByRole("button", { name: "Reassign" }));
    const list = await screen.findByRole("dialog", { name: "Reassign" });
    await user.click(within(list).getByRole("button", { name: /Omar Saleh/ }));
    expect(onReassign).toHaveBeenCalledWith("m2");
  });

  it("attaches the payment proof when that is the last need", async () => {
    const onAct = vi.fn();
    const user = userEvent.setup();
    wrap(<NowCard plan={nowPlan({ flow: flow(), status: "open" })} owner={null} people={[]} due={null} busy={false} onAct={onAct} />);
    const card = screen.getByRole("region", { name: "Attach payment proof" });
    expect(within(card).getByText("Needed to move to Won")).toBeInTheDocument();
    expect(within(card).getByText("Unassigned")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Attach proof" }));
    expect(onAct).toHaveBeenCalledWith(expect.objectContaining({ target: "proof" }));
  });
});

describe("the progress line (F1)", () => {
  it("marks done, now and next, and opens what a step needs", async () => {
    const user = userEvent.setup();
    wrap(<ProgressLine flow={flow({ missing: [{ key: "paymentProof", label: "Payment proof attached" }] })} status="open" history={[{ fromStageId: "s2", toStageId: "s3", changedAt: "2026-10-02T08:00:00.000Z" }]} />);
    const line = screen.getByRole("list", { name: "Progress" });
    expect(within(line).getAllByRole("listitem").map((item) => item.getAttribute("data-state"))).toEqual(["done", "done", "current", "upcoming", "upcoming"]);
    expect(within(line).getByRole("button", { name: /Proposal/ })).toHaveAttribute("aria-current", "step");
    await user.click(within(line).getByRole("button", { name: /^Won/ }));
    const panel = await screen.findByRole("dialog", { name: "To move to Won" });
    expect(within(panel).getByText("Attach payment proof")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(within(line).getByRole("button", { name: /Qualified/ }));
    expect(await screen.findByText(/Done · (2 Oct|Oct 2)/)).toBeInTheDocument();
  });
});

describe("a refused move (F1)", () => {
  it("shows the first need with its action and how many more", async () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    wrap(<StageBlockedSheet stageName="Won" items={[{ key: "furniturePath", label: "Furniture sub-path chosen" }, { key: "feasibility", label: "Feasibility" }, { key: "paymentProof", label: "Payment proof attached" }]} onAction={onAction} onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "To move to Won" });
    expect(within(dialog).getByText("Choose how it's supplied")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "and 2 more" }));
    expect(within(dialog).getByText("Attach payment proof")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Choose sub-path" }));
    expect(onClose).toHaveBeenCalled();
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ target: "furniture" }));
  });

  it("maps each requirement to the action that resolves it, and reads refused moves", () => {
    expect(requirementAction("paymentProof").target).toBe("proof");
    expect(requirementAction("feasibility").target).toBe("furniture");
    expect(requirementAction("quotation").target).toBe("quote");
    expect(requirementAction("discovery:question:style").target).toBe("discovery");
    expect(requirementAction("owner").target).toBe("edit");
    expect(missingFrom(new CrmRequestError("Stage requirements are not met", 422, [{ key: "paymentProof", label: "Payment proof attached" }]))).toHaveLength(1);
    expect(missingFrom(new Error("x"))).toEqual([]);
  });
});
