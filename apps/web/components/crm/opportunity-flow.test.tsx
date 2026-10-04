import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CrmRequestError } from "@/lib/crm/client";
import { missingFrom, requirementAction, type FlowLineStep, type OpportunityFlowView } from "@/lib/crm/opportunity-flow";
import { DesignSystemProvider } from "@/design-system";
import { nextChecklist, nowPlan } from "@/lib/crm/now-step";
import { StageBlockedSheet } from "./opportunity-flow";
import { FollowUpRow, NextActions, ProgressLine } from "./opportunity-now";

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

describe("the next column's checklist", () => {
  const act = (overrides: Partial<OpportunityFlowView>, extra: { onAct?: () => void; onRow?: () => void; onReassign?: (id: string) => Promise<void>; followUp?: React.ReactNode } = {}) => {
    const view = design(overrides);
    return wrap(<NextActions plan={nowPlan({ flow: view, status: "open" })} checklist={nextChecklist(view, "open")} owner={people[0]} people={people} followUp={extra.followUp} busy={false}
      onAct={extra.onAct ?? vi.fn()} onRow={extra.onRow ?? vi.fn()} onReassign={extra.onReassign} />);
  };

  it("lists everything the next column needs at once, done and missing, with why, who and when", async () => {
    const onRow = vi.fn();
    const user = userEvent.setup();
    act({ line: [
      { key: "details", name: "Complete the client details", check: "details_complete", column: "qualified", optional: false, state: "current", doneAt: null, doneBy: null, missing: [{ key: "clientEmail", label: "Client email" }] },
      { key: "enquiry_type", name: "Confirm the enquiry type", check: "details_complete", column: "qualification", optional: false, state: "done", doneAt: "2026-10-01T08:00:00.000Z", doneBy: "Sara" },
      { key: "intro_meeting", name: "Hold the intro meeting", check: "intro_meeting_completed", column: "qualification", optional: false, state: "upcoming", doneAt: null, doneBy: null, missing: [{ key: "introMeeting", label: "Intro meeting completed" }] },
    ].map((step) => ({ missing: [], ...step }) as FlowLineStep), missing: [{ key: "clientEmail", label: "Client email" }, { key: "introMeeting", label: "Intro meeting completed" }] }, { onRow });
    const block = screen.getByRole("region", { name: "To move to Qualified" });
    expect(within(block).getByText("Qualified means the brief is clear enough to plan the intro.")).toBeInTheDocument();
    expect(within(block).getByText("Dana Haddad")).toBeInTheDocument();
    // The follow-up date is not a chip in the header: it has its own row when one is booked.
    expect(within(block).queryByText(/Overdue|Due /)).not.toBeInTheDocument();
    const rows = within(within(block).getByRole("list", { name: "To move to Qualified" })).getAllByRole("listitem");
    expect(rows.map((row) => [row.getAttribute("data-state"), row.hasAttribute("data-now")])).toEqual([["missing", true], ["done", false], ["missing", false]]);
    expect(within(rows[1]).getByText(/^Sara · /)).toBeInTheDocument();
    // One primary action: the first missing row's.
    expect(within(block).getAllByRole("button").filter((button) => button.getAttribute("data-variant") === "primary")).toHaveLength(1);
    await user.click(within(rows[0]).getByRole("button", { name: "Add · Client email" }));
    expect(onRow).toHaveBeenCalledWith(expect.objectContaining({ id: "clientEmail", group: "property", target: "discovery" }));
    await user.click(within(rows[2]).getByRole("button", { name: "Book · Intro meeting completed" }));
    expect(onRow).toHaveBeenLastCalledWith(expect.objectContaining({ group: "intro", target: "intro" }));
  });

  it("leads with the pending follow-up: what, when and Complete or Reschedule", async () => {
    const onComplete = vi.fn();
    const onReschedule = vi.fn();
    const user = userEvent.setup();
    act({}, { followUp: <FollowUpRow title="Follow up with Amal" due="2020-01-02T09:00:00.000Z" onComplete={onComplete} onReschedule={onReschedule} /> });
    const block = screen.getByRole("region", { name: "To move to Qualified" });
    expect(within(block).getByText("Follow up with Amal")).toBeInTheDocument();
    expect(within(block).getByText(/^Overdue · /)).toBeInTheDocument();
    // The follow-up row sits above the checklist and does not compete with its one primary action.
    expect(within(block).getAllByRole("button").filter((button) => button.getAttribute("data-variant") === "primary")).toHaveLength(1);
    await user.click(within(block).getByRole("button", { name: "Complete" }));
    expect(onComplete).toHaveBeenCalled();
    await user.click(within(block).getByRole("button", { name: "Reschedule" }));
    expect(onReschedule).toHaveBeenCalled();
  });

  it("offers Book a follow-up only when asked to, and otherwise shows nothing", async () => {
    const onBook = vi.fn();
    const user = userEvent.setup();
    const { unmount } = wrap(<FollowUpRow />);
    expect(screen.queryByRole("button", { name: "Book a follow-up" })).not.toBeInTheDocument();
    unmount();
    wrap(<FollowUpRow onBook={onBook} />);
    await user.click(screen.getByRole("button", { name: "Book a follow-up" }));
    expect(onBook).toHaveBeenCalled();
  });

  it("reassigns through the teammate list", async () => {
    const onReassign = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    act({}, { onReassign });
    await user.click(screen.getByRole("button", { name: "Reassign" }));
    const list = await screen.findByRole("dialog", { name: "Reassign" });
    await user.click(within(list).getByRole("button", { name: /Omar Saleh/ }));
    expect(onReassign).toHaveBeenCalledWith("m2");
  });

  it("moves on with one button once nothing is missing", async () => {
    const onAct = vi.fn();
    const user = userEvent.setup();
    act({ missing: [] }, { onAct });
    const block = screen.getByRole("region", { name: "To move to Qualified" });
    expect(within(block).getByText("Everything for Qualified is in place")).toBeInTheDocument();
    await user.click(within(block).getByRole("button", { name: "Move to Qualified" }));
    expect(onAct).toHaveBeenCalledWith(expect.objectContaining({ target: "advance" }));
  });

  it("attaches the payment proof when that is the last need", async () => {
    const onRow = vi.fn();
    const user = userEvent.setup();
    const view = flow();
    wrap(<NextActions plan={nowPlan({ flow: view, status: "open" })} checklist={nextChecklist(view, "open")} owner={null} people={[]} busy={false} onAct={vi.fn()} onRow={onRow} />);
    const block = screen.getByRole("region", { name: "To move to Won" });
    expect(within(block).getByText("Won means the client has paid.")).toBeInTheDocument();
    expect(within(block).getByText("Unassigned")).toBeInTheDocument();
    await user.click(within(block).getByRole("button", { name: "Attach · Payment proof attached" }));
    expect(onRow).toHaveBeenCalledWith(expect.objectContaining({ target: "proof" }));
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
