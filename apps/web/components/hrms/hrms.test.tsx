import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AttendanceHistory, AttendanceReview, AttendanceSession, HrmsBootstrap, HrmsPerson, LeaveBalance, LeaveRequest, LeaveType, WorkCalendar,
} from "@wodana/contracts";
import { DesignSystemProvider } from "@/design-system";
import type { HrmsSection } from "@/lib/hrms/sections";
import type { PendingCapture } from "@/lib/hrms/pending";
import { HrmsPage } from "./hrms-page";

const nav = vi.hoisted(() => ({ query: "", replace: vi.fn(), rerender: null as null | (() => void) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: (href: string) => { nav.replace(href); nav.query = href.split("?")[1] ?? ""; nav.rerender?.(); }, push: vi.fn() }),
  usePathname: () => "/workspace/hrms",
  useSearchParams: () => new URLSearchParams(nav.query),
}));
// The device queue (IndexedDB in the browser) as a map, so a capture can wait between visits.
const device = vi.hoisted(() => new Map<string, PendingCapture>());
vi.mock("@/lib/hrms/pending", () => ({
  readPending: async (key: string) => device.get(key),
  writePending: async (pending: PendingCapture) => {
    const prior = device.get(pending.key);
    if (prior && prior.input.actionId !== pending.input.actionId) throw new Error("Another attendance capture is pending.");
    device.set(pending.key, pending);
  },
  clearPending: async (key: string) => { device.delete(key); },
}));

const TODAY = "2026-09-28";
const calendar: WorkCalendar = { id: "cal1", name: "Studio", timezone: "UTC", workingDays: [1, 2, 3, 4, 5], holidays: [], dayStart: "09:00", halfDay: "13:00", dayEnd: "18:00" };
const bootstrap = (patch: Partial<HrmsBootstrap> = {}): HrmsBootstrap => ({
  membershipId: "m1",
  employee: { membershipId: "m1", userId: "u1", name: "Dana Designer", enabled: true, remoteAllowed: false, managerId: "m2", activeFrom: "2026-01-01", activeTo: null, calendar, version: 1 },
  settings: { defaultCalendarId: "cal1", fallbackApproverId: null, maxGpsAccuracyM: 100, maxCaptureAgeSeconds: 120, mediaRetentionDays: 365, version: 1 },
  calendars: [calendar], workspace: { name: "Palm Living", timezone: "UTC" },
  permissions: { self: true, team: true, manage: true, evidence: true, manageProjects: false }, ...patch,
});
const openSession: AttendanceSession = {
  id: "s1", startedAt: `${TODAY}T08:00:00Z`, endedAt: null, calendar, version: 3, pendingReviewCount: 0, rejectedReviewCount: 0,
  segments: [{ id: "g1", mode: "site", locationId: "l1", projectId: "p1", caseId: null, context: { name: "Villa 12", location: null }, startedAt: `${TODAY}T08:00:00Z`, endedAt: null }],
};
const history = (from: string, to: string, patch: Partial<AttendanceHistory> = {}): AttendanceHistory => ({ from, to, sessions: [], segments: [], events: [], reviews: [], days: [], ...patch });
const types: LeaveType[] = [
  { id: "annual", name: "Annual leave", limited: true, annualDays: 30, allowHalfDay: true, paid: true, active: true, version: 1 },
  { id: "sick", name: "Sick leave", limited: false, annualDays: 0, allowHalfDay: false, paid: true, active: true, version: 1 },
];
const balance = (patch: Partial<LeaveBalance>): LeaveBalance => ({
  membershipId: "m1", name: "Dana Designer", leaveTypeId: "annual", leaveTypeName: "Annual leave", year: 2026, limited: true, allowance: 30, used: 16, pending: 2, available: 12, version: 1, ...patch,
});
const leave = (patch: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id: "r1", membershipId: "m3", name: "Omar Joiner", leaveTypeId: "annual", leaveTypeName: "Annual leave", startDate: "2026-10-05", endDate: "2026-10-06", dayPart: "full", days: 2,
  reason: "Family visit", status: "pending", decisionReason: null, cancellationReason: null, createdAt: "2026-09-20T08:00:00Z", version: 1, canDecide: true, ...patch,
});
const person = (patch: Partial<HrmsPerson> = {}): HrmsPerson => ({
  membershipId: "m3", name: "Omar Joiner", email: "omar@palm.test", status: "active", enabled: true, employeeCode: "PL-07", designation: "Joiner", department: "Factory",
  managerId: "m1", calendarId: "cal1", remoteAllowed: false, activeFrom: "2026-02-01", activeTo: null, version: 4, ...patch,
});

class Fail { constructor(readonly status: number, readonly body: Record<string, unknown>) {} }
type Call = { path: string; method: string; body: Record<string, unknown> | undefined; query: URLSearchParams };
type Routes = (call: Call) => unknown;

/** The HRMS proxy, answered per path; anything not given answers as a quiet workspace would. */
const mount = (routes: Routes = () => undefined, boot: HrmsBootstrap = bootstrap()) => {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, "http://localhost");
    const area = parsed.pathname.startsWith("/api/workspace/projects") ? "projects" : "hrms";
    const path = `${area === "projects" ? "projects:" : ""}${parsed.pathname.replace(/^\/api\/workspace\/(hrms|projects)\/?/, "")}`;
    const call = { path, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined, query: parsed.searchParams };
    calls.push(call);
    let value = routes(call);
    if (value === undefined) {
      if (path === "bootstrap") value = boot;
      else if (path === "attendance/current") value = null;
      else if (path === "attendance/history") value = history(call.query.get("from")!, call.query.get("to")!);
      else if (path === "leave/types") value = types;
      else if (path === "leave/balances" || path === "leave/requests" || path === "reviews" || path === "people" || path.startsWith("projects:")) value = [];
      else value = { id: "saved" };
    }
    if (value instanceof Fail) return { ok: false, status: value.status, json: async () => value.body };
    return { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetcher);
  return calls;
};
const writes = (calls: Call[], path: string) => calls.filter((call) => call.method !== "GET" && call.path === path).map((call) => call.body);
const page = (section: HrmsSection = "attendance") => {
  const ui = () => <DesignSystemProvider locale="en-GB" timeZone="UTC"><HrmsPage workspaceId="w" section={section} /></DesignSystemProvider>;
  const view = render(ui());
  nav.rerender = () => view.rerender(ui());
  return view;
};
const grid = (name: string) => screen.findByRole("grid", { name }).catch(() => screen.findByRole("table", { name }));
const enabled = async (name: string) => { await waitFor(() => expect(screen.getByRole("button", { name })).toBeEnabled()); return screen.getByRole("button", { name }); };
async function setDate(scope: HTMLElement, field: string, date: string) {
  const group = within(scope).getByRole("group", { name: new RegExp(field) });
  const [year, month, day] = date.split("-");
  for (const [segment, value] of [["day", day], ["month", month], ["year", year]]) {
    await userEvent.click(within(group).getByRole("spinbutton", { name: new RegExp(`^${segment}`, "i") }));
    await userEvent.keyboard(value);
  }
}

describe("People", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${TODAY}T10:30:00Z`)); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); device.clear(); nav.query = ""; nav.rerender = null; nav.replace.mockReset(); });

  describe("attendance", () => {
    it("offers Check in while out, and Check out with Switch place while in", async () => {
      mount();
      const first = page();
      expect(await enabled("Check in")).toHaveAttribute("data-variant", "primary");
      expect(screen.queryByRole("button", { name: "Switch place" })).toBeNull();
      expect(within(screen.getByRole("group", { name: "Today" })).getByText("Not checked in")).toBeInTheDocument();
      first.unmount();

      mount(({ path }) => (path === "attendance/current" ? openSession : path === "attendance/history"
        ? history(TODAY, TODAY, { days: [{ membershipId: "m1", name: "Dana Designer", date: TODAY, timezone: "UTC", firstIn: `${TODAY}T08:00:00Z`, lastOut: null, workedMinutes: 0,
          elapsedMinutes: 150, open: true, stale: false, reviewCount: 0, rejectedCount: 0, leaveDays: 0, leaveStatus: null, leaveType: null, scheduled: true, place: "Villa 12",
          status: "checked_in", breakdown: [{ name: "Villa 12", mode: "site", minutes: 150 }] }] }) : undefined));
      page();
      expect(await enabled("Check out")).toHaveAttribute("data-variant", "primary");
      expect(screen.getByRole("button", { name: "Switch place" })).toBeEnabled();
      const today = screen.getByRole("group", { name: "Today" });
      await waitFor(() => expect(today).toHaveTextContent("Checked in"));
      expect(today).toHaveTextContent("Site");
      expect(today).toHaveTextContent("2h 30m");
    });

    it("keeps a capture on the device when the connection drops, and sends the same action again", async () => {
      let attempts = 0;
      const calls = mount(({ path }) => {
        if (path === "attendance/actions") { attempts += 1; return attempts === 1 ? new Fail(503, { message: "The attendance service is unavailable." }) : { current: openSession }; }
        return undefined;
      });
      page();
      await userEvent.click(await enabled("Check in"));
      const dialog = await screen.findByRole("dialog", { name: "Check in" });
      // No camera or location here: a reason goes with the capture.
      await waitFor(() => expect(within(dialog).getByText("Camera unavailable")).toBeInTheDocument());
      expect(within(dialog).getByRole("button", { name: "Check in" })).toBeDisabled();
      await userEvent.click(within(dialog).getByRole("radio", { name: "Field" }));
      await userEvent.type(within(dialog).getByRole("textbox", { name: /Reason for review/ }), "Camera broken on my phone");
      await userEvent.click(within(dialog).getByRole("button", { name: "Check in" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Check in" })).toBeNull());
      expect(await screen.findByText("Not sent yet")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Check in" })).toBeDisabled();
      await userEvent.click(screen.getByRole("button", { name: "Send now" }));
      expect(await enabled("Check out")).toBeInTheDocument();
      const [sent, again] = writes(calls, "attendance/actions");
      expect(sent).toMatchObject({ kind: "check_in", mode: "field", locationId: null, position: null, exceptionReason: "Camera broken on my phone" });
      expect(again).toEqual(sent);
      expect(writes(calls, "captures")).toEqual([{ id: sent!.captureId }, { id: sent!.captureId }]);
      expect(device.size).toBe(0);
    });

    it("asks for a reason when the server finds the evidence short, and sends the same action with it", async () => {
      device.set("w:m1", { key: "w:m1", photo: null, createdAt: Date.now(), input: {
        actionId: "a1", captureId: "c1", kind: "check_in", mode: "office", locationId: "o1", projectId: null, caseId: null, deviceAt: `${TODAY}T07:58:00Z`,
        position: { latitude: 25.2, longitude: 55.3, accuracyM: 12, capturedAt: `${TODAY}T07:58:00Z`, mock: false }, note: "", exceptionReason: "" } });
      const calls = mount(({ path, body }) => (path === "attendance/actions"
        ? body?.exceptionReason ? { current: openSession } : new Fail(400, { message: "Retry the capture or provide an exception reason.", issues: ["Photo was not captured", "Location uncertain"] })
        : undefined));
      page();
      await userEvent.click(await screen.findByRole("button", { name: "Send now" }));
      expect(await screen.findByText("Needs a reason")).toBeInTheDocument();
      expect(screen.getByText("No photo")).toBeInTheDocument();
      expect(screen.getByText("Location uncertain")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
      await userEvent.type(screen.getByRole("textbox", { name: /Reason for review/ }), "Signal was weak in the basement");
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      expect(await enabled("Check out")).toBeInTheDocument();
      const [refused, accepted] = writes(calls, "attendance/actions");
      expect(refused).toMatchObject({ actionId: "a1", captureId: "c1", exceptionReason: "" });
      expect(accepted).toEqual({ ...refused, exceptionReason: "Signal was weak in the basement" });
    });

    it("opens a linked day with its events and asks for a correction on the day's time zone", async () => {
      nav.query = "day=2026-09-21";
      const day = { membershipId: "m1", name: "Dana Designer", date: "2026-09-21", timezone: "Asia/Kolkata", firstIn: "2026-09-21T03:40:00Z", lastOut: "2026-09-21T12:30:00Z",
        workedMinutes: 530, elapsedMinutes: 530, open: false, stale: false, reviewCount: 0, rejectedCount: 0, leaveDays: 0, leaveStatus: null, leaveType: null, scheduled: true, place: null,
        status: "complete", breakdown: [{ name: "Head office", mode: "office", minutes: 530 }] };
      const calls = mount(({ path, query }) => (path === "attendance/history" && query.get("from") === "2026-09-01" ? history("2026-09-01", TODAY, {
        days: [day], sessions: [{ ...openSession, id: "s9", startedAt: day.firstIn, endedAt: day.lastOut }],
        events: [
          { id: "e1", sessionId: "s9", kind: "check_in", originalAt: day.firstIn, effectiveAt: day.firstIn, receivedAt: day.firstIn, deviceAt: day.firstIn, captureId: "c9", note: "",
            evidence: { position: null, location: null, arrival: { status: "inside", distanceM: 4, accuracyM: 10 }, photoCaptured: true, verification: "recorded" } },
          { id: "e2", sessionId: "s9", kind: "check_out", originalAt: day.lastOut, effectiveAt: day.lastOut, receivedAt: day.lastOut, deviceAt: day.lastOut, captureId: null, note: "",
            evidence: { position: null, location: null, arrival: { status: "missing", distanceM: null, accuracyM: null }, photoCaptured: false, verification: "pending_review" } },
        ] }) : undefined));
      page();
      const sheet = await screen.findByRole("dialog", { name: "Monday, 21 September 2026" });
      expect(within(sheet).getByText("Head office · 8h 50m")).toBeInTheDocument();
      expect(within(sheet).getByRole("img", { name: /Photo at 0?9:10/ })).toHaveAttribute("src", expect.stringContaining("/api/workspace/hrms/captures/c9/photo"));
      await userEvent.click(within(sheet).getByRole("button", { name: "Ask for correction" }));
      const dialog = await screen.findByRole("dialog", { name: "Ask for correction" });
      const hour = within(dialog).getByRole("spinbutton", { name: /^hour/i });
      await userEvent.click(hour); await userEvent.keyboard("09");
      await userEvent.click(within(dialog).getByRole("spinbutton", { name: /^minute/i })); await userEvent.keyboard("00");
      await userEvent.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "I arrived before the photo");
      await userEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
      await waitFor(() => expect(writes(calls, "reviews")).toHaveLength(1));
      expect(writes(calls, "reviews")[0]).toEqual({ actionId: expect.any(String), kind: "correction", sessionId: "s9", eventId: "e1", requestedAt: "2026-09-21T03:30:00.000Z",
        reason: "I arrived before the photo" });
    });
  });

  describe("leave", () => {
    it("shows what's left of limited leave and what's been used of unlimited leave", async () => {
      mount(({ path }) => (path === "leave/balances" ? [balance({}), balance({ leaveTypeId: "sick", leaveTypeName: "Sick leave", limited: false, allowance: null, available: null, used: 2, pending: 0 })]
        : undefined));
      page("leave");
      const balances = await screen.findByRole("list", { name: "Balances" });
      expect(within(balances).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Annual leave · 12 of 30 left", "Sick leave · 2 used"]);
    });

    it("asks for half a day only for one day of a kind that allows it", async () => {
      const calls = mount();
      page("leave");
      await userEvent.click(await screen.findByRole("button", { name: "Request leave" }));
      const dialog = await screen.findByRole("dialog", { name: "Request leave" });
      await userEvent.click(within(dialog).getByRole("button", { name: /Type/ }));
      await userEvent.click(await screen.findByRole("option", { name: /Annual leave/ }));
      await setDate(dialog, "From", "2026-10-05");
      expect(within(dialog).getByRole("radiogroup", { name: "Part of day" })).toBeInTheDocument();
      await setDate(dialog, "To", "2026-10-07");
      expect(within(dialog).queryByRole("radiogroup", { name: "Part of day" })).toBeNull();
      await setDate(dialog, "To", "2026-10-05");
      await userEvent.click(within(dialog).getByRole("radio", { name: "Second half" }));
      await userEvent.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "School meeting");
      await userEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
      await waitFor(() => expect(writes(calls, "leave/requests")).toHaveLength(1));
      expect(writes(calls, "leave/requests")[0]).toEqual({ actionId: expect.any(String), leaveTypeId: "annual", startDate: "2026-10-05", endDate: "2026-10-05", dayPart: "second_half",
        reason: "School meeting" });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Request leave" })).toBeNull());
    });

    it("never offers half days for a kind that doesn't allow them", async () => {
      const calls = mount();
      page("leave");
      await userEvent.click(await screen.findByRole("button", { name: "Request leave" }));
      const dialog = await screen.findByRole("dialog", { name: "Request leave" });
      await userEvent.click(within(dialog).getByRole("button", { name: /Type/ }));
      await userEvent.click(await screen.findByRole("option", { name: /Sick leave/ }));
      await setDate(dialog, "From", "2026-09-29");
      expect(within(dialog).queryByRole("radiogroup", { name: "Part of day" })).toBeNull();
      await userEvent.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Flu");
      await userEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
      await waitFor(() => expect(writes(calls, "leave/requests")[0]).toMatchObject({ leaveTypeId: "sick", startDate: "2026-09-29", endDate: "2026-09-29", dayPart: "full" }));
    });
  });

  describe("team", () => {
    it("decides a linked leave request only with a reason, then shows nothing left to approve", async () => {
      nav.query = "leave=r1";
      let decided = false;
      const review: AttendanceReview = { id: "v1", membershipId: "m4", name: "Sara Site", sessionId: "s4", eventId: "e4", kind: "exception", reason: "No signal on site", status: "pending",
        requestedAt: null, decisionReason: null, createdAt: "2026-09-25T08:00:00Z", canDecide: true, captureId: "c4",
        evidence: { position: null, location: null, arrival: { status: "outside", distanceM: 900, accuracyM: 20 }, photoCaptured: true, issues: ["Location outside"], verification: "pending_review" } };
      const calls = mount(({ path }) => {
        if (path === "leave/requests") return decided ? [leave({ status: "approved", canDecide: false })] : [leave()];
        if (path === "reviews") return [review];
        if (path === "leave/requests/r1/decision") { decided = true; return { id: "r1" }; }
        return undefined;
      });
      page("team");
      const sheet = await screen.findByRole("dialog", { name: "Omar Joiner" });
      // Behind the sheet: To approve, with what's waiting counted.
      expect(await screen.findByRole("radio", { name: "To approve (2)", hidden: true })).toHaveAttribute("aria-checked", "true");
      expect(within(sheet).getByText("Family visit")).toBeInTheDocument();
      expect(within(sheet).getByRole("button", { name: "Approve" })).toBeDisabled();
      expect(within(sheet).getByRole("button", { name: "Reject" })).toBeDisabled();
      await userEvent.type(within(sheet).getByRole("textbox", { name: /Reason for your decision/ }), "ok");
      expect(within(sheet).getByRole("button", { name: "Approve" })).toBeDisabled();
      await userEvent.type(within(sheet).getByRole("textbox", { name: /Reason for your decision/ }), " enjoy");
      await userEvent.click(within(sheet).getByRole("button", { name: "Approve" }));
      await waitFor(() => expect(writes(calls, "leave/requests/r1/decision")).toEqual([{ decision: "approve", reason: "ok enjoy" }]));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Omar Joiner" })).toBeNull());
      expect(await screen.findByRole("radio", { name: "To approve (1)" })).toBeInTheDocument();
      // The attendance review shows its evidence, the photo only to those who may see it.
      await userEvent.click(within(await grid("To approve")).getByText("Sara Site"));
      const evidence = await screen.findByRole("dialog", { name: "Sara Site" });
      expect(within(evidence).getByText("Outside the workplace", { selector: "dd" })).toBeInTheDocument();
      expect(within(evidence).getByRole("img", { name: "Photo from Sara Site" })).toBeInTheDocument();
    });
  });

  describe("people", () => {
    it("saves a person's HR record and a limited allowance, each on its version", async () => {
      const calls = mount(({ path }) => {
        if (path === "people") return [person(), person({ membershipId: "m1", name: "Dana Designer", email: "dana@palm.test", managerId: null })];
        if (path === "leave/balances") return [balance({ membershipId: "m3", name: "Omar Joiner", version: 2 }),
          balance({ membershipId: "m3", leaveTypeId: "sick", leaveTypeName: "Sick leave", limited: false, allowance: null, available: null, used: 1, pending: 0 })];
        return undefined;
      });
      page("people");
      const table = await grid("People");
      expect(table).toHaveTextContent("omar@palm.test");
      await userEvent.click(within(table).getByText("Omar Joiner"));
      const sheet = await screen.findByRole("dialog", { name: /Omar Joiner/ });
      expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled();
      await userEvent.clear(within(sheet).getByRole("textbox", { name: "Designation" }));
      await userEvent.type(within(sheet).getByRole("textbox", { name: "Designation" }), "Senior joiner");
      await userEvent.click(within(sheet).getByRole("switch", { name: "Remote allowed" }));
      // Reports to: anyone but themself.
      await userEvent.click(within(sheet).getByRole("button", { name: /Reports to/ }));
      expect(screen.queryByRole("option", { name: "Omar Joiner" })).toBeNull();
      await userEvent.click(await screen.findByRole("option", { name: "No one" }));
      expect(await within(sheet).findByText("Unlimited")).toBeInTheDocument();
      const allowance = within(sheet).getByRole("textbox", { name: "Annual leave days a year" });
      await userEvent.clear(allowance);
      await userEvent.type(allowance, "32.5");
      await userEvent.tab();
      await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(writes(calls, "leave/allowances")).toHaveLength(1));
      expect(writes(calls, "people/m3")).toEqual([{ version: 4, enabled: true, employeeCode: "PL-07", designation: "Senior joiner", department: "Factory", managerId: null, calendarId: "cal1",
        remoteAllowed: true, activeFrom: "2026-02-01", activeTo: null }]);
      expect(writes(calls, "leave/allowances")).toEqual([{ membershipId: "m3", leaveTypeId: "annual", year: 2026, days: 32.5, version: 2 }]);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: /Omar Joiner/ })).toBeNull());
    });

    it("keeps the sheet open with the server's message when someone else saved first", async () => {
      mount(({ path }) => (path === "people" ? [person()] : path === "people/m3" ? new Fail(409, { message: "Someone else changed this person. Reload to continue." }) : undefined));
      nav.query = "person=m3";
      page("people");
      const sheet = await screen.findByRole("dialog", { name: /Omar Joiner/ });
      await userEvent.type(within(sheet).getByRole("textbox", { name: "Department" }), " workshop");
      await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
      expect(await within(sheet).findByText("Someone else changed this person. Reload to continue.")).toBeInTheDocument();
    });
  });

  it("shows only the tabs the person may use", async () => {
    mount(undefined, bootstrap({ permissions: { self: true, team: false, manage: false, evidence: false, manageProjects: false } }));
    page();
    await enabled("Check in");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Attendance", "Leave"]);
    await act(async () => { await userEvent.click(screen.getByRole("tab", { name: "Leave" })); });
    expect(nav.replace).toHaveBeenLastCalledWith("/workspace/hrms/leave");
  });
});
