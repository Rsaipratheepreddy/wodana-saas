import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { BuilderState } from "@/lib/quotation/types";
import type { ValueEngineeringRound, ValueEngineeringView } from "@/lib/value-engineering/client";
import { ValueEngineering } from "./value-engineering";

const { caseRequest } = vi.hoisted(() => ({ caseRequest: vi.fn() }));
vi.mock("@/lib/pre-project/content", () => ({ caseRequest }));
vi.mock("@/components/pre-project/design-journey", () => ({ ScheduleVisitDialog: () => null }));
vi.mock("@/components/meetings/meeting-minutes", () => ({ MeetingMinutesSheet: () => null }));

const state = (patch: Partial<BuilderState["quote"]> = {}) => ({
  quote: { id: "q1", number: 1, title: "Villa 12", status: "draft", kind: "quotation", round: "main", currency: "AED", decimals: 2, validUntil: null, taxRate: "5", revision: 3,
    paymentTerms: [], approvedBy: null, clientDecision: null, ...patch },
  family: [{ id: "q1", number: 1, status: "draft", total: "340000", createdAt: null }],
}) as unknown as BuilderState;
const round = (patch: Partial<ValueEngineeringRound> = {}): ValueEngineeringRound => ({
  id: "4f0b9c1e-2a4b-4c5d-8e6f-7a8b9c0d1e2f", round: 1, chargeable: false, origin: "automatic", status: "open", step: "agree_options", outcome: null, quoteId: "q1", familyId: "q1",
  quoteName: "Q-1", outcomeQuoteId: null, outcomeQuoteName: null, currency: "AED", quotedTotal: "340000.0000", budgetAmount: "300000.0000", overBy: "40000", note: "",
  lead: { membershipId: "m-designer", name: "Dina Designer", fallback: false }, qsName: "Quinn QS", startedByName: "Quinn QS", startedAt: "2026-10-13T08:00:00Z",
  optionsNote: null, optionsAgreedAt: null, optionsAgreedByName: "", meeting: null, outcomeNote: null, closedAt: null, idleSince: "2026-10-13T08:00:00Z", version: 1, ...patch,
});
const view = (patch: Partial<ValueEngineeringView> = {}): ValueEngineeringView => ({
  timezone: "Asia/Dubai", budget: { amount: "300000", currency: "AED" }, freeRounds: null, designWork: true, rounds: [], open: null,
  quote: { id: "q1", total: "340000", currency: "AED", overBy: "40000", problem: null }, can: { start: false, lead: false, decide: false, withdraw: false }, ...patch,
});
const show = (builder = state()) => render(<DesignSystemProvider><ValueEngineering workspaceId="w1" caseId="c1" state={builder} /></DesignSystemProvider>);
afterEach(() => caseRequest.mockReset());

describe("value engineering on the estimate (PLM-147)", () => {
  it("shows the open round led by the designer with the QS, the price over budget, and the one next action", async () => {
    const open = round();
    caseRequest.mockImplementation(async (_w: string, _c: string, path: string) => (path.startsWith("value-engineering?") ? view({ open, rounds: [open], can: { start: false, lead: true, decide: true, withdraw: false } })
      : view({ open: { ...open, step: "present_options", optionsNote: "Marble to porcelain", optionsAgreedAt: "2026-10-13T09:00:00Z", version: 2 }, can: { start: false, lead: true, decide: true, withdraw: false } })));
    show();
    const panel = await screen.findByRole("region", { name: "Value engineering" });
    expect(panel).toHaveTextContent("Value engineering · round 1");
    expect(panel).toHaveTextContent("Dina Designer leads with Quinn QS");
    expect(panel).toHaveTextContent(/40,000\.00 over budget/);
    expect(within(panel).getAllByRole("listitem").map((item) => item.dataset.state)).toEqual(["current", "upcoming", "upcoming"]);
    const user = userEvent.setup();
    await user.click(within(panel).getByRole("button", { name: "Record the savings" }));
    await user.type(await screen.findByRole("textbox", { name: /Savings/ }), "Marble to porcelain");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(caseRequest).toHaveBeenCalledWith("w1", "c1", `value-engineering/${open.id}/options`, "POST", { version: 1, note: "Marble to porcelain" }));
    expect(await within(panel).findByRole("button", { name: /Book meeting/ })).toBeVisible();
    expect(panel).toHaveTextContent("Marble to porcelain");
  });

  it("reloads when the QS confirms the price, so the round it opened replaces the start prompt", async () => {
    const open = round();
    caseRequest.mockResolvedValueOnce(view({ can: { start: true, lead: false, decide: false, withdraw: false } }))
      .mockResolvedValue(view({ open, rounds: [open], can: { start: false, lead: false, decide: false, withdraw: false } }));
    const withQs = { ...state(), flow: { internalReview: true, reviewAction: "qs_approve", canReview: true, canRecordDecision: false }, canPrice: true } as BuilderState;
    const { rerender } = show(withQs);
    expect(await screen.findByRole("button", { name: "Over budget: start value engineering" })).toBeVisible();
    // Same revision; the QS's review is done.
    rerender(<DesignSystemProvider><ValueEngineering workspaceId="w1" caseId="c1" state={{ ...withQs, flow: { ...withQs.flow, canReview: false }, canPrice: false } as BuilderState} /></DesignSystemProvider>);
    const panel = await screen.findByRole("region", { name: "Value engineering" });
    await waitFor(() => expect(panel).toHaveTextContent("Value engineering · round 1"));
    expect(screen.queryByRole("button", { name: "Over budget: start value engineering" })).toBeNull();
  });

  it("says when the Account Manager leads because the job has no lead designer, and flags a chargeable round", async () => {
    const open = round({ round: 3, chargeable: true, lead: { membershipId: "m-am", name: "Sara Sales", fallback: true } });
    caseRequest.mockResolvedValue(view({ open, rounds: [open] }));
    show();
    const panel = await screen.findByRole("region", { name: "Value engineering" });
    expect(panel).toHaveTextContent("Sara Sales leads · no lead designer on the job");
    expect(panel).toHaveTextContent("Chargeable");
    // Someone who doesn't lead it sees no action.
    expect(within(panel).queryByRole("button")).toBeNull();
  });

  it("lets the QS start it when the price is over the budget or no budget is recorded; not when the price fits", async () => {
    caseRequest.mockImplementation(async (_w: string, _c: string, path: string) => (path === "value-engineering/start" ? view({ open: round({ origin: "manual" }) })
      : view({ budget: null, quote: { id: "q1", total: "340000", currency: "AED", overBy: null, problem: null }, can: { start: true, lead: false, decide: false, withdraw: false } })));
    show();
    const panel = await screen.findByRole("region", { name: "Value engineering" });
    expect(panel).toHaveTextContent("No client budget recorded");
    const user = userEvent.setup();
    await user.click(within(panel).getByRole("button", { name: "Over budget: start value engineering" }));
    await user.type(await screen.findByRole("textbox", { name: "Note for the designer" }), "Client said 250k");
    await user.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(caseRequest).toHaveBeenCalledWith("w1", "c1", "value-engineering/start", "POST", { quoteId: "q1", note: "Client said 250k" }));
  });

  it("shows nothing within the budget, and never on a Design Fee proposal or a variation", async () => {
    caseRequest.mockResolvedValue(view({ quote: { id: "q1", total: "280000", currency: "AED", overBy: null, problem: null }, can: { start: true, lead: false, decide: false, withdraw: false } }));
    const { container } = show();
    await waitFor(() => expect(caseRequest).toHaveBeenCalled());
    expect(container.querySelector("section")).toBeNull();
    caseRequest.mockClear();
    show(state({ round: "design" }));
    show(state({ kind: "variation" }));
    expect(caseRequest).not.toHaveBeenCalled();
  });
});
