import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { WoddyAnswer, WoddyCard } from "@/lib/woddy/agent";
import { WoddyActionCard } from "./woddy-action-card";
import { WoddyAnswerView } from "./woddy-answer";

const WS = "00000000-0000-4000-8000-000000000001";
const CHAT_A = "00000000-0000-4000-8000-00000000000a", CHAT_B = "00000000-0000-4000-8000-00000000000b";
const card = (patch: Partial<WoddyCard> = {}): WoddyCard => ({
  id: "00000000-0000-4000-8000-0000000000c1", runId: "r-1", tool: "assign_records", status: "proposed", title: { key: "Assign {count} chats to {name}", values: { count: 2, name: "Priya" } },
  summary: "Assign 2 chats to Priya", version: 1, selection: null, record: null, failures: [], error: null, target: null, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  preview: { kind: "targets", selectable: true, fields: [{ label: "Assign to", after: "Priya" }], items: [
    { type: "conversation", id: CHAT_A, label: "Omar · whatsapp", href: `/workspace/crm/conversations?record=${CHAT_A}`, now: "Unassigned" },
    { type: "conversation", id: CHAT_B, label: "Lina · whatsapp", href: `/workspace/crm/conversations?record=${CHAT_B}`, now: "Sam" },
  ] },
  ...patch,
});
const show = (value: WoddyCard) => render(<DesignSystemProvider><WoddyActionCard workspaceId={WS} card={value} /></DesignSystemProvider>);
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Woddy's confirmation card", () => {
  it("lists every chat to assign; unticking one confirms only the rest, with the card's version", async () => {
    const user = userEvent.setup();
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    show(card());
    const section = screen.getByRole("region", { name: "Woddy action" });
    expect(section).toHaveTextContent("Assign 2 chats to Priya");
    expect(within(section).getByText("Now: Unassigned")).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "Omar · whatsapp" })).toHaveAttribute("href", `/workspace/crm/conversations?record=${CHAT_A}`);
    await user.click(within(section).getByRole("checkbox", { name: "Omar · whatsapp" }));
    await user.click(within(section).getByRole("button", { name: "Confirm" }));
    // While it runs, nothing else can be pressed.
    expect(within(section).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ workspaceId: WS, action: "confirm", version: 1, selection: [CHAT_B] });
    expect(fetcher.mock.calls[0][0]).toBe(`/api/workspace/woddy/tool-calls/${card().id}`);
    await act(async () => finish(new Response(JSON.stringify({ ...card(), status: "executed", version: 3, selection: [CHAT_B], failures: [] }), { status: 200 })));
    expect(await within(section).findByText("Done")).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });

  it("shows a field diff and the module's own message when the change was refused", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...card(), tool: "update_enquiry", status: "failed", error: "Lead changed; reload before saving", version: 3 }), { status: 200 })));
    show(card({ tool: "update_enquiry", title: { key: "Update {record}", values: { record: "ENQ-118" } }, preview: { kind: "fields", fields: [{ label: "Area", before: "Hills", after: "Palm view" }] } }));
    expect(screen.getByText("Hills")).toBeInTheDocument();
    expect(screen.getByText("Palm view")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Lead changed; reload before saving")).toBeInTheDocument();
    expect(screen.getByText("Not done")).toBeInTheDocument();
  });

  it("says a card expired, and cancels without changing anything", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ message: "This suggestion expired. Ask Woddy again.", code: "AI_TOOL_CALL_EXPIRED" }), { status: 410 }));
    vi.stubGlobal("fetch", fetcher);
    show(card());
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("This suggestion expired. Ask Woddy again.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();

    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...card(), status: "rejected", version: 2 }), { status: 200 }));
    render(<DesignSystemProvider><WoddyActionCard workspaceId={WS} card={card({ id: "00000000-0000-4000-8000-0000000000c2" })} /></DesignSystemProvider>);
    await user.click(screen.getAllByRole("button", { name: "Cancel" }).at(-1)!);
    expect(await screen.findByText("Cancelled. Nothing was changed.")).toBeInTheDocument();
  });

  it("turns into expired at its time without a reload", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    show(card({ expiresAt: new Date(Date.now() + 1_000).toISOString() }));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
    await act(async () => { vi.advanceTimersByTime(1_500); });
    await waitFor(() => expect(screen.getByText("This suggestion expired. Ask Woddy again.")).toBeInTheDocument());
  });
});

describe("Woddy's answer", () => {
  it("links each fact to the record it came from", () => {
    const answer: WoddyAnswer = { runId: "r", answer: "Q-118 R2 is with the client until Friday [S2].", cited: ["S2"], proposals: [], draft: null, stopped: null,
      sources: [{ key: "S1", type: "enquiry", id: "e", label: "ENQ-9", href: "/workspace/crm/leads?lead=e" }, { key: "S2", type: "quotation", id: "c/q", label: "Q-118 R2", href: "/workspace/pre-projects/cases/c/quotations" }] };
    render(<DesignSystemProvider><WoddyAnswerView workspaceId={WS} answer={answer} /></DesignSystemProvider>);
    expect(screen.getAllByRole("link", { name: "Q-118 R2" }).map((link) => link.getAttribute("href"))).toEqual(["/workspace/pre-projects/cases/c/quotations", "/workspace/pre-projects/cases/c/quotations"]);
    expect(screen.getByText("From")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ENQ-9" })).not.toBeInTheDocument();
  });
});
