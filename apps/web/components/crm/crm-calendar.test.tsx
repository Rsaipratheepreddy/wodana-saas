import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crmRequest } from "@/lib/crm/client";
import { WorkspaceRegionProvider } from "@/design-system";
import { zonedToUtc, zonedToday } from "@/lib/crm/zoned-time";
import { CrmCalendar } from "./crm-calendar";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/workspace/crm/calendar", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/crm/client", async (original) => ({ ...await original<object>(), crmRequest: vi.fn() }));
const workspaceId = "00000000-0000-4000-8000-000000000001";
const partyId = "00000000-0000-4000-8000-000000000002";
const managerId = "00000000-0000-4000-8000-000000000003";
const userId = "00000000-0000-4000-8000-000000000004";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  vi.mocked(crmRequest).mockImplementation(async (_workspace, path, method) => {
    if (method === "POST") return { id: "created-meeting" };
    if (path.startsWith("parties")) return { data: [{ id: partyId, displayName: "Calendar customer" }] };
    if (path === "members") return [{ id: managerId, userId, displayName: "Iglo Manager", email: "manager@example.com", status: "active" }];
    // Sales owners (the people who can own a meeting) come from their own list.
    if (path === "sales-owners") return { items: [{ id: managerId, displayName: "Iglo Manager", email: "manager@example.com", status: "active" }], currentMembershipId: managerId };
    return { data: [
      { id: "pending", title: "Design consultation", dueAt: new Date().toISOString(), ownerMembershipId: managerId, status: "pending" },
      { id: "cancelled", title: "Cancelled consultation", dueAt: new Date().toISOString(), status: "cancelled" },
    ], nextCursor: null };
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("CRM calendar", () => {
  it("does not serialize server-local dates into the user's calendar", () => {
    const html = renderToString(<CrmCalendar workspaceId={workspaceId} />);
    expect(html).toContain("Loading your local calendar");
    expect(html).not.toContain("Schedule on");
  });

  it("has one title, one New event action and one toolbar row: period, search, whose calendar, Day · Week · Month and ⋯", async () => {
    const user = userEvent.setup(); render(<CrmCalendar workspaceId={workspaceId} currentUserId={userId} />);
    const toolbar = await screen.findByRole("toolbar", { name: "Calendar controls" });
    expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual(["Calendar"]);
    expect(screen.getAllByRole("button", { name: "New event" })).toHaveLength(1);
    expect(within(toolbar).getByRole("button", { name: "Week" })).toHaveAttribute("aria-pressed", "true");
    expect(within(toolbar).getByRole("button", { name: "Today" })).toBeInTheDocument();
    // Search is an icon until used: the field is collapsed (no data-open) while empty.
    const search = within(toolbar).getByRole("searchbox", { name: "Search calendar" });
    expect(search.closest("form")).not.toHaveAttribute("data-open");
    expect(await within(toolbar).findByRole("button", { name: /Whose calendar/ })).toHaveTextContent("Everyone");
    // Google and the CRM meeting live in the ⋯ menu.
    await user.click(within(toolbar).getByRole("button", { name: "Calendar options" }));
    await user.click(await screen.findByRole("menuitem", { name: "Connect Google" }));
    expect(push).toHaveBeenCalledWith("/workspace/integrations?connect=google_workspace");
  });

  it("opens the booking pages from the ⋯ menu, only for someone who manages them", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<CrmCalendar workspaceId={workspaceId} currentUserId={userId} />);
    await user.click(within(await screen.findByRole("toolbar", { name: "Calendar controls" })).getByRole("button", { name: "Calendar options" }));
    expect(await screen.findByRole("menuitem", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Booking pages" })).toBeNull();
    unmount();
    render(<CrmCalendar workspaceId={workspaceId} currentUserId={userId} canManageBooking />);
    await user.click(within(await screen.findByRole("toolbar", { name: "Calendar controls" })).getByRole("button", { name: "Calendar options" }));
    await user.click(await screen.findByRole("menuitem", { name: "Booking pages" }));
    expect(push).toHaveBeenCalledWith("/workspace/crm/booking-types");
  });

  it("shows real activities, excludes cancellations and supports the day/search view", async () => {
    const user = userEvent.setup(); render(<CrmCalendar workspaceId={workspaceId} />);
    expect(await screen.findByRole("button", { name: /CRM Design consultation/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancelled consultation/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Day" }));
    expect(screen.getByRole("group", { name: "Day calendar" })).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Search calendar" }), "No match");
    expect(screen.queryByRole("button", { name: /CRM Design consultation/ })).not.toBeInTheDocument();
  });

  it("saves the activity and appointment through one atomic command, not a Google send", async () => {
    const user = userEvent.setup(); render(<CrmCalendar workspaceId={workspaceId} />);
    await user.click(await screen.findByRole("button", { name: "New event" }));
    const dialog = await screen.findByRole("dialog", { name: "Schedule CRM meeting" });
    await user.type(within(dialog).getByRole("textbox", { name: /Meeting title/ }), "Site visit");
    await user.click(within(dialog).getByRole("button", { name: /Customer/ }));
    await user.click(await screen.findByRole("option", { name: "Calendar customer" }));
    await user.click(within(dialog).getByRole("button", { name: /Sales owner/ }));
    await user.click(await screen.findByRole("option", { name: "Iglo Manager" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(vi.mocked(crmRequest).mock.calls.filter((call) => call[2] === "POST")).toHaveLength(1));
    const call = vi.mocked(crmRequest).mock.calls.find((item) => item[2] === "POST")!;
    expect(call.slice(0, 3)).toEqual([workspaceId, "activities", "POST"]);
    expect(call[3]).toMatchObject({ title: "Site visit", type: "meeting", partyId, ownerMembershipId: managerId, appointment: { timezone: expect.any(String) } });
    const body = call[3] as { dueAt: string; appointment: { startsAt: string; endsAt: string } };
    expect(body.dueAt).toBe(body.appointment.startsAt);
    expect(Date.parse(body.appointment.endsAt) - Date.parse(body.appointment.startsAt)).toBe(3600000);
    expect(vi.mocked(fetch).mock.calls.every((item) => !String(item[0]).includes("/tools"))).toBe(true);
  });

  it("shows a fetch error instead of presenting it as an empty calendar", async () => {
    vi.mocked(crmRequest).mockRejectedValue(new Error("Access denied"));
    render(<CrmCalendar workspaceId={workspaceId} />);
    expect((await screen.findAllByText("Access denied")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("group", { name: "Week calendar" })).not.toBeInTheDocument();
  });

  it("draws a meeting at the workspace's hour, not the browser's (CAL-2)", async () => {
    const dubaiTen = zonedToUtc(zonedToday("Asia/Dubai"), "10:00", "Asia/Dubai")!;
    const record = { id: "dubai", title: "Dubai meeting", type: "meeting", status: "pending", dueAt: dubaiTen, version: 1 };
    vi.mocked(crmRequest).mockImplementation(async () => ({ data: [record], nextCursor: null }));
    render(<WorkspaceRegionProvider timeZone="Asia/Dubai"><CrmCalendar workspaceId={workspaceId} /></WorkspaceRegionProvider>);
    expect(await screen.findByRole("button", { name: /^10:00 AM · CRM Dubai meeting/ })).toBeInTheDocument();
    // The week is fetched from midnight in Dubai (20:00 UTC), not the browser's midnight.
    expect(String(vi.mocked(crmRequest).mock.calls.find(([, path]) => String(path).startsWith("activities?"))?.[1])).toContain(encodeURIComponent("T20:00:00.000Z"));
  });

  it("opens notes and reschedules a follow-up even without a meeting appointment", async () => {
    const record = { id: "pending", title: "Call Maya", type: "call", status: "pending", dueAt: new Date().toISOString(), description: "Discuss the quote", version: 2 };
    vi.mocked(crmRequest).mockImplementation(async (_workspace, path, method, body) => {
      if (method === "PATCH") return { ...record, ...body as object, version: 3 };
      if (path === "activities/pending") return record;
      return { data: [record], nextCursor: null };
    });
    const user = userEvent.setup(); render(<WorkspaceRegionProvider timeZone="Asia/Dubai"><CrmCalendar workspaceId={workspaceId} /></WorkspaceRegionProvider>);
    await user.click(await screen.findByRole("button", { name: /CRM Call Maya/ }));
    const notes = await screen.findByRole("textbox", { name: "Notes" });
    expect(notes).toHaveValue("Discuss the quote");
    await user.type(notes, ". Call tomorrow.");
    for (const [segment, value] of [["year", "2026"], ["month", "9"], ["day", "9"]]) {
      await user.click(screen.getByRole("spinbutton", { name: new RegExp(`${segment},.*Reminder date`, "i") }));
      await user.keyboard(value);
    }
    await user.click(screen.getByRole("spinbutton", { name: "hour, Reminder time" })); await user.keyboard("11");
    await user.click(screen.getByRole("spinbutton", { name: "minute, Reminder time" })); await user.keyboard("00");
    await user.click(screen.getByRole("spinbutton", { name: /am\/pm, Reminder time/i })); await user.keyboard("a");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved. Your reminder is updated in Today and Calendar.");
    expect(vi.mocked(crmRequest)).toHaveBeenCalledWith(workspaceId, "activities/pending", "PATCH", expect.objectContaining({ version: 2, description: "Discuss the quote. Call tomorrow.", dueAt: "2026-09-09T07:00:00.000Z" }));
  });
});
