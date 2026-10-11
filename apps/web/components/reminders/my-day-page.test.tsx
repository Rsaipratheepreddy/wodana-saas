import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MyDayItem, MyDayResponse } from "@wodana/contracts";
import { MyDayPage, UNDO_MS } from "./my-day-page";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace, refresh: vi.fn() }), usePathname: () => "/workspace/my-day" }));

const workspaceId = "00000000-0000-4000-8000-000000000001";
const WORK = "10000000-0000-4000-8000-000000000001";
const APPROVAL = "10000000-0000-4000-8000-000000000002";
const PERSON = "20000000-0000-4000-8000-000000000001";

const item = (overrides: Partial<MyDayItem>): MyDayItem => ({
  id: WORK, kind: "work.due", module: "projects", title: "Shop drawings", context: "Villa 12", href: "/workspace/projects/p-1/plan?item=w-1",
  dueAt: "2026-10-08", urgency: "overdue", critical: false, audience: "staff", owner: { membershipId: PERSON, name: "Maya" },
  reminders: { sent: 0, escalationLevel: 0, nextAt: null }, snoozed: null, actions: ["open", "snooze", "complete", "reassign"], completeLabel: null, version: 3, ...overrides,
});
const myDay = (overrides: Partial<MyDayResponse> = {}): MyDayResponse => ({
  generatedAt: "2026-10-11T06:00:00Z", scope: "me", timeZone: "UTC", today: "2026-10-11",
  counts: { overdue: 1, today: 0, upcoming: 0, waiting: 1, snoozed: 2, total: 2 },
  groups: [
    { jobId: "j-1", jobReference: "JOB-12", title: "Villa 12", href: "/workspace/jobs/j-1", items: [item({ reminders: { sent: 2, escalationLevel: 1, nextAt: null } })] },
    { jobId: null, jobReference: null, title: "", href: null, items: [item({ id: APPROVAL, kind: "approval.waiting", module: "approvals", title: "PALM-PO-17", context: "Oak & Co",
      href: "/workspace/purchasing/orders?order=o-1", urgency: "waiting", dueAt: "2026-10-09T08:00:00Z", critical: true, actions: ["open", "snooze"] })] },
  ],
  ...overrides,
});

type Call = { url: string; method: string; body: unknown };
function api({ day = myDay() as MyDayResponse | (() => MyDayResponse), status = 200, commandStatus = 200, commandMessage = "", assignees = [{ membershipId: PERSON, name: "Maya" }, { membershipId: "20000000-0000-4000-8000-000000000002", name: "Omar" }] } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: String(input), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "POST") return { ok: commandStatus < 400, status: commandStatus, json: async () => (commandStatus < 400 ? { item: null } : { message: commandMessage }) };
    if (String(input).includes("/assignees")) return { ok: true, status: 200, json: async () => assignees };
    const body = typeof day === "function" ? day() : day;
    return { ok: status < 400, status, json: async () => (status < 400 ? body : { message: "Permissions required" }) };
  }));
  return calls;
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout"] }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); push.mockReset(); replace.mockReset(); });
const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });

describe("My day", () => {
  it("groups what is due by job, with counts on the chips, the critical badge and the reminder chip", async () => {
    const calls = api();
    render(<MyDayPage workspaceId={workspaceId} canTeam initialFilter={{ scope: "me" }} />);
    expect(screen.getByRole("heading", { level: 1, name: "My day" })).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "My day" });
    expect(within(table).getByText("Villa 12 · JOB-12")).toBeInTheDocument();
    expect(within(table).getByText("Other")).toBeInTheDocument();
    const work = within(table).getByText("Shop drawings").closest("tr")!;
    expect(work).toHaveTextContent("3 days late");
    expect(work).toHaveTextContent("Reminded 2× · escalated");
    expect(within(work).getByRole("link", { name: "Open Shop drawings" })).toHaveAttribute("href", "/workspace/projects/p-1/plan?item=w-1");
    const approval = within(table).getByText("PALM-PO-17").closest("tr")!;
    expect(approval).toHaveTextContent("Critical");
    expect(approval).toHaveTextContent("Since");
    const chips = within(screen.getByRole("group", { name: "When" }));
    expect(chips.getByRole("button", { name: /Overdue/ })).toHaveTextContent("1");
    expect(chips.getByRole("button", { name: /Snoozed/ })).toHaveTextContent("2");
    expect(screen.getByRole("radiogroup", { name: "Whose items" })).toBeInTheDocument();
    expect(calls[0].url).toBe(`/api/workspace/my-day?workspaceId=${workspaceId}&scope=me`);
  });

  it("keeps its toolbar in the address and reads the list for it", async () => {
    const calls = api();
    render(<MyDayPage workspaceId={workspaceId} canTeam initialFilter={{ scope: "me" }} />);
    await screen.findByRole("table", { name: "My day" });
    await user().click(within(screen.getByRole("group", { name: "When" })).getByRole("button", { name: /Overdue/ }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/workspace/my-day?urgency=overdue");
    await waitFor(() => expect(calls.at(-1)?.url).toBe(`/api/workspace/my-day?workspaceId=${workspaceId}&scope=me&urgency=overdue`));
    await user().click(screen.getByRole("radio", { name: "Team" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/workspace/my-day?scope=team&urgency=overdue");
    // No server round trip for the toolbar.
    expect(replace).not.toHaveBeenCalled();
  });

  it("takes the toolbar state of a new navigation to My day", async () => {
    const calls = api();
    const { rerender } = render(<MyDayPage workspaceId={workspaceId} canTeam initialFilter={{ scope: "me", urgency: "overdue" }} />);
    await screen.findByRole("table", { name: "My day" });
    expect(within(screen.getByRole("group", { name: "When" })).getByRole("button", { name: /Overdue/ })).toHaveAttribute("aria-pressed", "true");
    rerender(<MyDayPage workspaceId={workspaceId} canTeam initialFilter={{ scope: "me" }} />);
    await waitFor(() => expect(calls.at(-1)?.url).toBe(`/api/workspace/my-day?workspaceId=${workspaceId}&scope=me`));
    expect(within(screen.getByRole("group", { name: "When" })).getByRole("button", { name: /Overdue/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("marks an item done after the undo window, and Undo sends nothing", async () => {
    const calls = api();
    render(<MyDayPage workspaceId={workspaceId} canTeam={false} initialFilter={{ scope: "me" }} />);
    const table = await screen.findByRole("table", { name: "My day" });
    expect(screen.queryByRole("radiogroup", { name: "Whose items" })).not.toBeInTheDocument();
    await user().click(within(table).getByRole("button", { name: "More for Shop drawings" }));
    await user().click(await screen.findByRole("menuitem", { name: "Mark done" }));
    expect(within(table).queryByText("Shop drawings")).not.toBeInTheDocument();
    const toast = screen.getByRole("status", { name: "" });
    expect(toast).toHaveTextContent("Shop drawings: Mark done");
    await user().click(within(toast).getByRole("button", { name: "Undo" }));
    expect(await within(table).findByText("Shop drawings")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_MS + 100); });
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);

    await user().click(within(table).getByRole("button", { name: "More for Shop drawings" }));
    await user().click(await screen.findByRole("menuitem", { name: "Mark done" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_MS - 500); });
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    await waitFor(() => expect(calls.filter((call) => call.method === "POST")).toEqual([
      { url: `/api/workspace/my-day/${WORK}/complete?workspaceId=${workspaceId}`, method: "POST", body: { version: 3 } },
    ]));
  });

  it("snoozes with a reason, and shows the server's refusal when a critical item goes too far", async () => {
    const calls = api({ commandStatus: 422, commandMessage: "A critical item snoozes only to the next working day." });
    render(<MyDayPage workspaceId={workspaceId} canTeam={false} initialFilter={{ scope: "me" }} />);
    const table = await screen.findByRole("table", { name: "My day" });
    await user().click(within(table).getByRole("button", { name: "More for PALM-PO-17" }));
    await user().click(await screen.findByRole("menuitem", { name: "Snooze…" }));
    const dialog = await screen.findByRole("dialog", { name: "Snooze" });
    await user().click(within(dialog).getByRole("button", { name: "Tomorrow" }));
    await user().click(within(dialog).getByRole("button", { name: "Snooze" }));
    expect(await within(dialog).findByText("Say why you're snoozing it.")).toBeInTheDocument();
    await user().type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Waiting for the supplier");
    await user().click(within(dialog).getByRole("button", { name: "Snooze" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Snooze" })).not.toBeInTheDocument());
    expect(within(table).queryByText("PALM-PO-17")).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_MS + 100); });
    await waitFor(() => expect(calls.filter((call) => call.method === "POST")).toHaveLength(1));
    const post = calls.find((call) => call.method === "POST")!;
    expect(post.url).toBe(`/api/workspace/my-day/${APPROVAL}/snooze?workspaceId=${workspaceId}`);
    expect(post.body).toMatchObject({ reason: "Waiting for the supplier", version: 3, until: expect.stringMatching(/T09:00:00\.000Z$/) });
    expect(await screen.findByText("A critical item snoozes only to the next working day.")).toBeInTheDocument();
    expect(await within(table).findByText("PALM-PO-17")).toBeInTheDocument();
  });

  it("hands an item to someone else after the undo window", async () => {
    const calls = api();
    render(<MyDayPage workspaceId={workspaceId} canTeam={false} initialFilter={{ scope: "me" }} />);
    const table = await screen.findByRole("table", { name: "My day" });
    await user().click(within(table).getByRole("button", { name: "More for Shop drawings" }));
    await user().click(await screen.findByRole("menuitem", { name: "Reassign…" }));
    const dialog = await screen.findByRole("dialog", { name: "Reassign" });
    await user().click(await within(dialog).findByRole("button", { name: /Give to/ }));
    // The current owner isn't offered.
    expect(screen.queryByRole("option", { name: "Maya" })).not.toBeInTheDocument();
    await user().click(await screen.findByRole("option", { name: "Omar" }));
    await user().click(within(dialog).getByRole("button", { name: "Reassign" }));
    expect(await screen.findByText("Shop drawings handed to Omar")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_MS + 100); });
    await waitFor(() => expect(calls.filter((call) => call.method === "POST")).toEqual([
      { url: `/api/workspace/my-day/${WORK}/reassign?workspaceId=${workspaceId}`, method: "POST", body: { membershipId: "20000000-0000-4000-8000-000000000002", version: 3 } },
    ]));
  });

  it("falls back to the person's own list when Team is refused", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      calls.push({ url: String(input), method: "GET", body: undefined });
      return String(input).includes("scope=team") ? { ok: false, status: 403, json: async () => ({ message: "Permissions required" }) } : { ok: true, status: 200, json: async () => myDay() };
    }));
    render(<MyDayPage workspaceId={workspaceId} canTeam initialFilter={{ scope: "team" }} />);
    await screen.findByRole("table", { name: "My day" });
    expect(screen.queryByRole("radiogroup", { name: "Whose items" })).not.toBeInTheDocument();
    expect(calls.map((call) => call.url)).toEqual([`/api/workspace/my-day?workspaceId=${workspaceId}&scope=team`, `/api/workspace/my-day?workspaceId=${workspaceId}&scope=me`]);
  });

  it("says when nothing is due, with the next step, and retries a list that didn't load", async () => {
    api({ day: myDay({ groups: [], counts: { overdue: 0, today: 0, upcoming: 0, waiting: 0, snoozed: 0, total: 0 } }) });
    const { unmount } = render(<MyDayPage workspaceId={workspaceId} canTeam={false} initialFilter={{ scope: "me" }} />);
    expect(await screen.findByText("Nothing due today")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Home" })).toHaveAttribute("href", "/workspace");
    unmount();
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(async () => (fail ? { ok: false, status: 500, json: async () => ({ message: "" }) } : { ok: true, status: 200, json: async () => myDay() })));
    render(<MyDayPage workspaceId={workspaceId} canTeam={false} initialFilter={{ scope: "me" }} />);
    expect(await screen.findByText("My day didn't load")).toBeInTheDocument();
    fail = false;
    await user().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table", { name: "My day" })).toBeInTheDocument();
  });
});
