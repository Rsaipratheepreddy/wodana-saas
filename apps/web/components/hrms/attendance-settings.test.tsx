import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HrmsBootstrap, HrmsCalendar, HrmsHoliday, LeaveType, WorkCalendar } from "@wodana/contracts";
import { DesignSystemProvider } from "@/design-system";
import { AttendanceSettingsPage } from "./attendance-settings";

const nav = vi.hoisted(() => ({ query: "", replace: vi.fn(), rerender: null as null | (() => void) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: (href: string) => { nav.replace(href); nav.query = href.split("?")[1] ?? ""; nav.rerender?.(); }, push: vi.fn() }),
  usePathname: () => "/workspace/settings/attendance",
  useSearchParams: () => new URLSearchParams(nav.query),
}));

const base: WorkCalendar = { id: "cal1", name: "Studio", timezone: "Asia/Dubai", workingDays: [1, 2, 3, 4, 5], holidays: [], dayStart: "09:00", halfDay: "13:00", dayEnd: "18:00" };
const holiday = (patch: Partial<HrmsHoliday> = {}): HrmsHoliday => ({ id: "h1", calendarId: "cal1", name: "National Day", startsOn: "2026-12-02", endsOn: "2026-12-03", days: 2, version: 1, ...patch });
const calendar = (patch: Partial<HrmsCalendar> = {}): HrmsCalendar => ({ ...base, version: 2, holidayList: [holiday()], people: 14, isDefault: true, ...patch });
const bootstrap = (patch: Partial<HrmsBootstrap> = {}): HrmsBootstrap => ({
  membershipId: "m1", employee: null, calendars: [base], workspace: { name: "Palm Living", timezone: "Asia/Dubai" },
  settings: { defaultCalendarId: "cal1", fallbackApproverId: null, maxGpsAccuracyM: 100, maxCaptureAgeSeconds: 120, mediaRetentionDays: 365, version: 3 },
  permissions: { self: true, team: true, manage: true, evidence: true, manageProjects: false }, ...patch,
});
const types: LeaveType[] = [
  { id: "annual", name: "Annual leave", limited: true, annualDays: 30, allowHalfDay: true, paid: true, active: true, version: 2 },
  { id: "sick", name: "Sick leave", limited: false, annualDays: 0, allowHalfDay: false, paid: true, active: true, version: 1 },
];

type Call = { path: string; method: string; body: Record<string, unknown> | undefined };
const mount = (routes: (call: Call) => unknown = () => undefined, boot = bootstrap()) => {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, "http://localhost");
    const path = `${parsed.pathname.startsWith("/api/workspace/projects") ? "projects:" : ""}${parsed.pathname.replace(/^\/api\/workspace\/(hrms|projects)\/?/, "")}`;
    const call = { path, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const value = routes(call) ?? (path === "bootstrap" ? boot : path === "calendars" ? [calendar()] : path === "leave/types" ? types : path === "people" || path.startsWith("projects:") ? [] : { id: "saved" });
    return { ok: true, status: 200, json: async () => value };
  }));
  return calls;
};
const writes = (calls: Call[], path: string) => calls.filter((call) => call.method !== "GET" && call.path === path).map((call) => call.body);
const page = () => {
  const ui = () => <DesignSystemProvider locale="en-GB" timeZone="Asia/Dubai"><AttendanceSettingsPage workspaceId="w" /></DesignSystemProvider>;
  const view = render(ui());
  nav.rerender = () => view.rerender(ui());
};
const grid = (name: string) => screen.findByRole("grid", { name }).catch(() => screen.findByRole("table", { name }));

describe("Settings → Attendance & leave", () => {
  afterEach(() => { vi.unstubAllGlobals(); nav.query = ""; nav.rerender = null; nav.replace.mockReset(); });

  it("lists calendars with their week, hours and holidays, and adds and removes a holiday", async () => {
    const calls = mount();
    page();
    const table = await grid("Calendars");
    const row = within(table).getAllByRole("row")[1];
    expect(row).toHaveTextContent("Studio");
    expect(row).toHaveTextContent("Default");
    expect(row).toHaveTextContent("Asia/Dubai");
    expect(row).toHaveTextContent("Mon–Fri");
    expect(row).toHaveTextContent("09:00–18:00");
    await userEvent.click(within(table).getByText("Studio"));
    const sheet = await screen.findByRole("dialog", { name: "Studio" });
    expect(within(sheet).getByText("National Day")).toBeInTheDocument();
    expect(within(sheet).getByText(/^2\s*–\s*3 Dec · 2 days$/)).toBeInTheDocument();

    await userEvent.click(within(sheet).getByRole("button", { name: "Add holiday" }));
    const dialog = await screen.findByRole("dialog", { name: "Add holiday" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Name/ }), "Eid al-Fitr");
    const dates = within(dialog).getByRole("group", { name: /Dates/ });
    const [startDay, startMonth, startYear, endDay, endMonth, endYear] = within(dates).getAllByRole("spinbutton");
    for (const [segment, value] of [[startDay, "20"], [startMonth, "03"], [startYear, "2027"], [endDay, "22"], [endMonth, "03"], [endYear, "2027"]] as const) {
      await userEvent.click(segment); await userEvent.keyboard(value);
    }
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(calls, "calendars/cal1/holidays")).toEqual([{ name: "Eid al-Fitr", startsOn: "2027-03-20", endsOn: "2027-03-22" }]));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add holiday" })).toBeNull());

    await userEvent.click(within(sheet).getByRole("button", { name: "Remove National Day" }));
    const confirm = await screen.findByRole("dialog", { name: "Remove National Day?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(writes(calls, "holidays/h1/remove")).toEqual([{ version: 1 }]));
  });

  it("saves a calendar's working days in the locale's week, checked against its version", async () => {
    const calls = mount(({ path, method }) => (path === "calendars/cal1" && method === "PUT" ? calendar({ workingDays: [0, 1, 2, 3, 4], version: 3 }) : undefined));
    page();
    await userEvent.click(within(await grid("Calendars")).getByText("Studio"));
    const sheet = await screen.findByRole("dialog", { name: "Studio" });
    const days = within(sheet).getByRole("group", { name: "Working days" });
    // en-GB weeks start on Monday.
    expect(within(days).getAllByRole("checkbox").map((box) => box.getAttribute("aria-label"))).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    await userEvent.click(within(days).getByRole("checkbox", { name: "Friday" }));
    await userEvent.click(within(days).getByRole("checkbox", { name: "Sunday" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(calls, "calendars/cal1")).toEqual([{ name: "Studio", timezone: "Asia/Dubai", workingDays: [0, 1, 2, 3, 4], dayStart: "09:00", halfDay: "13:00",
      dayEnd: "18:00", version: 2 }]));
  });

  it("saves a limited leave type with its days a year, and an unlimited one without", async () => {
    nav.query = "tab=leave-types";
    const calls = mount();
    page();
    const table = await grid("Leave types");
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("30 days a year");
    expect(within(table).getAllByRole("row")[2]).toHaveTextContent("Unlimited");

    await userEvent.click(screen.getByRole("button", { name: "New leave type" }));
    let dialog = await screen.findByRole("dialog", { name: "New leave type" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Name/ }), "Study leave");
    const days = within(dialog).getByRole("textbox", { name: /Days a year/ });
    await userEvent.clear(days); await userEvent.type(days, "5.5"); await userEvent.tab();
    await userEvent.click(within(dialog).getByRole("switch", { name: "Paid" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(calls, "leave/types")).toHaveLength(1));
    expect(writes(calls, "leave/types")[0]).toEqual({ version: 0, name: "Study leave", limited: true, annualDays: 5.5, allowHalfDay: true, paid: false, active: true });

    await userEvent.click(within(await grid("Leave types")).getByText("Annual leave"));
    dialog = await screen.findByRole("dialog", { name: "Annual leave" });
    await userEvent.click(within(dialog).getByRole("switch", { name: "Limited" }));
    expect(within(dialog).queryByRole("textbox", { name: /Days a year/ })).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(calls, "leave/types")).toHaveLength(2));
    expect(writes(calls, "leave/types")[1]).toEqual({ id: "annual", version: 2, name: "Annual leave", limited: false, annualDays: 0, allowHalfDay: true, paid: true, active: true });
  });

  it("adds a project's site as a workplace", async () => {
    nav.query = "tab=workplaces";
    const calls = mount(({ path }) => (path === "projects:" ? [{ id: "p1", name: "Villa 12", kind: "project", status: "active", caseId: "k1", customerName: "Maya Client" }] : undefined));
    page();
    expect(await screen.findByText("No workplaces yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New workplace" }));
    const sheet = await screen.findByRole("dialog", { name: "New workplace" });
    await userEvent.click(within(sheet).getByRole("radio", { name: "Site" }));
    await userEvent.click(within(sheet).getByRole("button", { name: /Project/ }));
    await userEvent.click(await screen.findByRole("option", { name: /Villa 12/ }));
    await userEvent.type(within(sheet).getByRole("textbox", { name: /^Name/ }), "Villa 12 site");
    await userEvent.type(within(sheet).getByRole("textbox", { name: /Latitude/ }), "25.1");
    await userEvent.type(within(sheet).getByRole("textbox", { name: /Longitude/ }), "55.2");
    await userEvent.tab();
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(calls, "projects:locations")).toEqual([{ version: 0, name: "Villa 12 site", kind: "site", projectId: "p1", caseId: null, address: "",
      latitude: 25.1, longitude: 55.2, radiusM: 150, active: true }]));
  });

  it("is for whoever manages HR", async () => {
    mount(undefined, bootstrap({ permissions: { self: true, team: true, manage: false, evidence: false, manageProjects: false } }));
    page();
    expect(await screen.findByText("You don't have access to this")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New calendar" })).toBeNull();
  });
});
