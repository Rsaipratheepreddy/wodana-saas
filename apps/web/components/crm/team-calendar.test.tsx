import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crmRequest } from "@/lib/crm/client";
import { CrmCalendar } from "./crm-calendar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/workspace/crm/calendar", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/crm/client", async (original) => ({ ...await original<object>(), crmRequest: vi.fn() }));
// A fixed mid-week day: "yesterday" and "three days ago" stay in the week the calendar opens on, whatever today is.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date(2026, 9, 14, 10, 0, 0));
afterAll(() => vi.useRealTimers());
const workspaceId = "00000000-0000-4000-8000-000000000001";
const bookingId = "00000000-0000-4000-8000-000000000009";
const day = (offset: number) => { const date = new Date(); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };

type Call = { url: string; method: string; body: Record<string, unknown> };
let calls: Call[] = [];
const settings = { targets: { design: { connectionId: null, calendarId: null, version: 0 }, logistics: { connectionId: null, calendarId: null, version: 0 } }, renderDays: 5, drawingDays: 3,
  designVersion: 0, canRead: { design: true, logistics: false }, canManage: { design: true, logistics: false } };
const entries = [{ key: `booking:${bookingId}`, kind: "render", recordId: bookingId, subject: "Maya Client", detail: null, start: day(-3), end: day(0), allDay: true, days: 4,
  status: "booked", overdue: false, ownerName: "Vic Visualiser", href: "/workspace/pre-projects/cases/c1/overview", version: 2 },
{ key: "deadline:c2:concepts", kind: "design_deadline", recordId: "c2", subject: "Omar Client", detail: "concepts", start: day(-1), end: day(-1), allDay: true, days: null,
  status: "active", overdue: true, ownerName: "Dana Designer", href: "/workspace/pre-projects/cases/c2/overview" }];

beforeEach(() => {
  calls = [];
  vi.mocked(crmRequest).mockImplementation(async (_w, path) => (path === "members" ? [] : { data: [], nextCursor: null }) as never);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : {} });
    const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.startsWith("/api/workspace/team-calendars/settings")) return reply(settings);
    if (url.startsWith("/api/workspace/team-calendars/design?")) return reply({ team: "design", today: day(0), timeZone: "UTC", entries, canBook: true, canManage: true, google: false });
    if (url.startsWith("/api/workspace/team-calendars/booking-options")) return reply({ cases: [{ id: "c1", title: "O-1 · Maya Client" }], members: [{ id: "m-vic", name: "Vic Visualiser", visualiser: true }], renderDays: 5, drawingDays: 3 });
    if (url.startsWith("/api/workspace/team-calendars/bookings")) return reply({ id: bookingId, status: "done" });
    return reply([]);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("team calendars in the Wodana calendar (PLM-090)", () => {
  it("shows the design team's work across jobs, with the days a render needs and what is overdue", async () => {
    const user = userEvent.setup();
    render(<CrmCalendar workspaceId={workspaceId} />);
    const toolbar = await screen.findByRole("toolbar", { name: "Calendar controls" });
    await waitFor(() => expect(calls.some((call) => call.url.startsWith("/api/workspace/team-calendars/settings"))).toBe(true));
    await user.click(within(toolbar).getByRole("button", { name: /Whose calendar/ }));
    // A team the person can't read isn't offered.
    expect(screen.queryByRole("option", { name: "Factory and logistics" })).toBeNull();
    await user.click(await screen.findByRole("option", { name: "Design team" }));
    expect((await screen.findAllByRole("button", { name: /Visualiser renders · Maya Client · 4 days/ })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Overdue · Concepts due · Omar Client/ }).length).toBeGreaterThan(0);
    // One primary action: book design time, instead of a new event.
    expect(screen.getByRole("button", { name: "Book design time" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New event" })).toBeNull();
  });

  it("marks booked render time done from its entry", async () => {
    const user = userEvent.setup();
    render(<CrmCalendar workspaceId={workspaceId} />);
    const toolbar = await screen.findByRole("toolbar", { name: "Calendar controls" });
    await waitFor(() => expect(calls.some((call) => call.url.startsWith("/api/workspace/team-calendars/settings"))).toBe(true));
    await user.click(within(toolbar).getByRole("button", { name: /Whose calendar/ }));
    await user.click(await screen.findByRole("option", { name: "Design team" }));
    await user.click((await screen.findAllByRole("button", { name: /Visualiser renders · Maya Client · 4 days/ }))[0]);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Vic Visualiser")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Mark done" }));
    await waitFor(() => expect(calls.find((call) => call.method === "POST")).toMatchObject({ url: expect.stringContaining(`/api/workspace/team-calendars/bookings/${bookingId}/complete`), body: { version: 2 } }));
  });

  it("books render time for the Visualiser with the firm's default days", async () => {
    const user = userEvent.setup();
    render(<CrmCalendar workspaceId={workspaceId} />);
    const toolbar = await screen.findByRole("toolbar", { name: "Calendar controls" });
    await waitFor(() => expect(calls.some((call) => call.url.startsWith("/api/workspace/team-calendars/settings"))).toBe(true));
    await user.click(within(toolbar).getByRole("button", { name: /Whose calendar/ }));
    await user.click(await screen.findByRole("option", { name: "Design team" }));
    await user.click(await screen.findByRole("button", { name: "Book design time" }));
    const dialog = await screen.findByRole("dialog", { name: "Book design time" });
    await user.click(await within(dialog).findByRole("button", { name: /Job/ }));
    await user.click(await screen.findByRole("option", { name: "O-1 · Maya Client" }));
    expect(within(dialog).getByRole("button", { name: /Who does it/ })).toHaveTextContent("Vic Visualiser · Visualiser");
    expect(within(dialog).getByRole("textbox", { name: /Days needed/ })).toHaveValue("5");
    await user.click(within(dialog).getByRole("button", { name: "Book" }));
    await waitFor(() => expect(calls.find((call) => call.method === "POST" && call.url.includes("/team-calendars/bookings?"))?.body).toMatchObject({ caseId: "c1", kind: "render", assigneeMembershipId: "m-vic", days: 5 }));
  });
});
