import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HrmsBootstrap, MyTimeWeek, PayrollMonth, ProjectHours as Hours, TeamTimeWeek, TimeWeek, WorkCalendar } from "@wodana/contracts";
import { DesignSystemProvider } from "@/design-system";
import type { HrmsSection } from "@/lib/hrms/sections";
import { HrmsPage } from "./hrms-page";
import { ProjectHours } from "./project-hours";

const nav = vi.hoisted(() => ({ query: "", replace: vi.fn(), rerender: null as null | (() => void) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: (href: string) => { nav.replace(href); nav.query = href.split("?")[1] ?? ""; nav.rerender?.(); }, push: vi.fn() }),
  usePathname: () => "/workspace/hrms/time",
  useSearchParams: () => new URLSearchParams(nav.query),
}));
vi.mock("@/lib/hrms/pending", () => ({ readPending: async () => undefined, writePending: async () => undefined, clearPending: async () => undefined }));

const TODAY = "2026-09-27";
const calendar: WorkCalendar = { id: "cal1", name: "Studio", timezone: "UTC", workingDays: [1, 2, 3, 4, 5], holidays: [], dayStart: "09:00", halfDay: "13:00", dayEnd: "18:00" };
const boot: HrmsBootstrap = {
  membershipId: "m1",
  employee: { membershipId: "m1", userId: "u1", name: "Dana Designer", enabled: true, remoteAllowed: false, managerId: null, activeFrom: "2026-01-01", activeTo: null, calendar, version: 1 },
  settings: { defaultCalendarId: "cal1", fallbackApproverId: null, maxGpsAccuracyM: 100, maxCaptureAgeSeconds: 120, mediaRetentionDays: 365, version: 1 },
  calendars: [calendar], workspace: { name: "Palm Living", timezone: "UTC" },
  permissions: { self: true, team: true, manage: true, evidence: true, manageProjects: false },
};
const days = ["21", "22", "23", "24", "25", "26", "27"].map((day, index) => ({
  date: `2026-09-${day}`, scheduledMinutes: index < 5 && day !== "23" ? 480 : 0, leaveDays: day === "23" ? 1 : 0,
}));
const week = (patch: Partial<MyTimeWeek> = {}): MyTimeWeek => ({
  membershipId: "m1", name: "Dana Designer", weekStart: "2026-09-21", days, totalMinutes: 600,
  timesheet: { id: "ts1", status: "draft", version: 2, submittedAt: null, decidedByName: null, decisionNote: "" },
  entries: [
    { id: "t1", workDate: "2026-09-21", projectId: "p1", projectName: "PRJ-7 · Villa 12", stageId: "s1", stageName: "Design", minutes: 480, note: "Site visit" },
    { id: "t2", workDate: "2026-09-22", projectId: null, projectName: null, stageId: null, stageName: null, minutes: 120, note: "" },
  ],
  options: [{ id: "p1", name: "PRJ-7 · Villa 12", stages: [{ id: "s1", name: "Design" }, { id: "s2", name: "Build" }] }],
  ...patch,
});

class Fail { constructor(readonly status: number, readonly body: Record<string, unknown>) {} }
type Call = { path: string; method: string; body: unknown; query: URLSearchParams };
const mount = (routes: (call: Call) => unknown) => {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, "http://localhost");
    const path = parsed.pathname.replace(/^\/api\/workspace\/hrms\/?/, "");
    const call = { path, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined, query: parsed.searchParams };
    calls.push(call);
    let value = routes(call);
    if (value === undefined) {
      if (path === "bootstrap") value = boot;
      else if (path === "time/mine") value = week();
      else if (path === "time/team") value = { weekStart: "2026-09-21", people: [] };
      else if (path === "attendance/current") value = null;
      else if (path.startsWith("leave/") || path === "reviews") value = [];
      else value = { id: "ok" };
    }
    if (value instanceof Fail) return { ok: false, status: value.status, json: async () => value.body };
    return { ok: true, status: 200, json: async () => value };
  }));
  return calls;
};
const page = (section: HrmsSection = "time") => {
  const ui = () => <DesignSystemProvider locale="en-GB" timeZone="UTC" currency="AED"><HrmsPage workspaceId="w" section={section} /></DesignSystemProvider>;
  const view = render(ui());
  nav.rerender = () => view.rerender(ui());
  return view;
};
const grid = (name: string) => screen.findByRole("grid", { name }).catch(() => screen.findByRole("table", { name }));
const cell = (name: RegExp) => screen.getByRole("textbox", { name });

describe("Time", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${TODAY}T10:00:00Z`)); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); nav.query = ""; nav.rerender = null; nav.replace.mockReset(); });

  it("shows my week: a row per piece of work, hours by day, each day against what's expected and leave marked", async () => {
    nav.query = "week=2026-09-24";
    const calls = mount(() => undefined);
    page();
    const table = await grid("My hours");
    expect(calls.find((call) => call.path === "time/mine")!.query.get("date")).toBe("2026-09-24");
    const rows = within(table).getAllByRole("row");
    expect(rows[0]).toHaveTextContent(/Work.*Mon 21.*Tue 22.*Wed 23.*Sun 27.*Total/);
    expect(rows[1]).toHaveTextContent(/PRJ-7 · Villa 12.*Design/);
    expect(cell(/Design on Mon,? 21 Sept?/)).toHaveValue("8:00");
    expect(cell(/^Internal on Tue,? 22 Sept?/)).toHaveValue("2:00");
    expect(rows.at(-1)).toHaveTextContent(/Total.*8:00.*8:00.*2:00.*8:00.*Leave.*10:00 \/ 32:00/);
    expect(screen.getByText("Draft")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous week" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/workspace/hrms/time?week=2026-09-14");
  });

  it("saves the week as it's written, keeping each entry's note, and adds work to it", async () => {
    const calls = mount(({ path, method }) => (method === "PUT" && path.startsWith("time/weeks/") ? week({ timesheet: { id: "ts1", status: "draft", version: 3, submittedAt: null, decidedByName: null, decisionNote: "" } }) : undefined));
    page();
    await grid("My hours");
    await userEvent.type(cell(/Design on Tue,? 22 Sept?/), "7:30");
    await userEvent.click(screen.getByRole("button", { name: /Add work/ }));
    await userEvent.click(await screen.findByRole("option", { name: /Villa 12\s*Build/ }));
    await userEvent.type(cell(/Build on Thu,? 24 Sept?/), "1.5");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.filter((call) => call.method === "PUT")).toHaveLength(1));
    const [put] = calls.filter((call) => call.method === "PUT");
    expect(put.path).toBe("time/weeks/2026-09-21");
    expect(put.body).toEqual({ version: 2, entries: [
      { workDate: "2026-09-21", projectId: "p1", stageId: "s1", minutes: 480, note: "Site visit" },
      { workDate: "2026-09-22", projectId: "p1", stageId: "s1", minutes: 450, note: "" },
      { workDate: "2026-09-22", projectId: null, stageId: null, minutes: 120, note: "" },
      { workDate: "2026-09-24", projectId: "p1", stageId: "s2", minutes: 90, note: "" },
    ] });
  });

  it("saves what changed before submitting, then shows the week waiting for approval", async () => {
    const calls = mount(({ path, method }) => {
      if (method === "PUT") return week({ timesheet: { id: "ts1", status: "draft", version: 3, submittedAt: null, decidedByName: null, decisionNote: "" } });
      if (path === "time/ts1/submit") return { ...week({ timesheet: { id: "ts1", status: "submitted", version: 4, submittedAt: `${TODAY}T10:00:00Z`, decidedByName: null, decisionNote: "" } }), options: undefined };
      return undefined;
    });
    page();
    await grid("My hours");
    await userEvent.type(cell(/^Internal on Wed,? 23 Sept?/), "1");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(calls.filter((call) => call.path === "time/ts1/submit").map((call) => call.body)).toEqual([{ version: 3 }]));
    expect(calls.findIndex((call) => call.method === "PUT")).toBeLessThan(calls.findIndex((call) => call.path === "time/ts1/submit"));
    expect(await screen.findByText("Waiting for approval")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /on Mon/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
  });

  it("shows what to change on a week sent back, and won't save hours it can't read or a day over 24 hours", async () => {
    mount(({ path }) => (path === "time/mine" ? week({ timesheet: { id: "ts1", status: "returned", version: 5, submittedAt: null, decidedByName: "Omar Manager", decisionNote: "Split Monday by stage" } }) : undefined));
    page();
    await grid("My hours");
    expect(screen.getByText("Sent back by Omar Manager: Split Monday by stage")).toBeInTheDocument();
    await userEvent.type(cell(/^Internal on Thu,? 24 Sept?/), "abc");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
    await userEvent.clear(cell(/^Internal on Thu,? 24 Sept?/));
    await userEvent.type(cell(/^Internal on Mon,? 21 Sept?/), "20");
    expect(screen.getByText("A day has at most 24 hours.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("puts a submitted week in the manager's To approve, approves it, or sends it back only with a note", async () => {
    nav.query = "timesheet=ts9";
    const person: TeamTimeWeek["people"][number] = { ...week(), membershipId: "m3", name: "Omar Joiner", scheduledMinutes: 1920, canDecide: true,
      timesheet: { id: "ts9", status: "submitted", version: 3, submittedAt: "2026-09-26T17:00:00Z", decidedByName: null, decisionNote: "" } };
    const calls = mount(({ path, body }) => {
      if (path === "time/team") return { weekStart: "2026-09-21", people: [person] };
      if (path === "time/ts9/decision") return { ...person, timesheet: { ...person.timesheet!, status: (body as { decision: string }).decision === "approve" ? "approved" : "returned" } } satisfies TimeWeek;
      return undefined;
    });
    page("team");
    const sheet = await screen.findByRole("dialog", { name: "Omar Joiner" });
    expect(within(sheet).getByText("10h 0m / 32h 0m")).toBeInTheDocument();
    expect(within(sheet).getByRole("region", { name: "By work" })).toHaveTextContent(/PRJ-7 · Villa 12.*Design.*8h 0m.*Internal.*2h 0m/);
    expect(within(sheet).getByRole("region", { name: "By day" })).toHaveTextContent(/Wed 23 Sept?.*Leave/);
    await userEvent.click(within(sheet).getByRole("button", { name: "Review" }));
    const review = await screen.findByRole("dialog", { name: "Review" });
    await userEvent.click(within(review).getByRole("radio", { name: "Send back" }));
    expect(within(review).getByRole("button", { name: "Send back" })).toBeDisabled();
    await userEvent.type(within(review).getByRole("textbox", { name: /What needs to change/ }), "Split Monday by stage");
    await userEvent.click(within(review).getByRole("button", { name: "Send back" }));
    await waitFor(() => expect(calls.filter((call) => call.path === "time/ts9/decision").map((call) => call.body)).toEqual([{ version: 3, decision: "return", note: "Split Monday by stage" }]));
    expect(nav.replace).toHaveBeenLastCalledWith("/workspace/hrms/team");
  });

  it("lists the team's week of hours against what's expected", async () => {
    const person: TeamTimeWeek["people"][number] = { ...week(), membershipId: "m3", name: "Omar Joiner", scheduledMinutes: 1920, canDecide: false };
    mount(({ path }) => (path === "time/team" ? { weekStart: "2026-09-21", people: [person] } : undefined));
    page("team");
    await userEvent.click(await screen.findByRole("button", { name: "Time" }));
    const table = await grid("Team hours");
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent(/Omar Joiner.*10h 0m.*32h 0m.*Draft/);
  });
});

describe("Payroll", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${TODAY}T10:00:00Z`)); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); nav.query = ""; nav.rerender = null; });

  it("shows the month's employees and crew workers, and exports each list as CSV", async () => {
    const month: PayrollMonth = { month: "2026-09", from: "2026-09-01", to: "2026-09-30",
      people: [{ membershipId: "m3", name: "Omar Joiner", employeeCode: "PL-07", designation: "Foreman", department: "Site", scheduledDays: 22, workedDays: 19.5, workedHours: 160, overtimeHours: 6,
        paidLeaveDays: 2, unpaidLeaveDays: 0.5, absentDays: 0, toReview: 1 }],
      workers: [{ workerId: "w1", name: "Ravi Kumar", workerCode: "W-01", trade: "Carpentry", crew: "Joinery A", days: 21.5, overtimeHours: 4, uncosted: 1,
        amounts: [{ currency: "AED", amount: "3870.0000" }] }] };
    const calls = mount(({ path }) => (path === "payroll" ? month : undefined));
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this.href); });
    page("payroll");
    const employees = await grid("Employees");
    expect(calls.find((call) => call.path === "payroll")!.query.get("month")).toBe("2026-09");
    expect(within(employees).getAllByRole("row")[1]).toHaveTextContent(/Omar Joiner.*PL-07 · Foreman.*Site.*22.*19\.5.*160.*6.*2.*0\.5.*0.*1/);
    await userEvent.click(screen.getByRole("button", { name: "Crew workers" }));
    const workers = await grid("Crew workers");
    expect(within(workers).getAllByRole("row")[1]).toHaveTextContent(/Ravi Kumar.*W-01.*Carpentry.*Joinery A.*21\.5.*4.*AED\s?3,870\.00.*1/);
    await userEvent.click(screen.getAllByRole("button", { name: "Table options" }).at(-1)!);
    await userEvent.click(screen.getByRole("button", { name: /Export/ }));
    await userEvent.keyboard("{Escape}");
    expect(clicks.at(-1)).toMatch(/\/api\/workspace\/hrms\/payroll\/export\?month=2026-09&kind=workers&workspaceId=w$/);
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(calls.filter((call) => call.path === "payroll").at(-1)!.query.get("month")).toBe("2026-08"));
  });
});

describe("Project hours", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("shows a project's approved hours by person and stage", async () => {
    const hours: Hours = { projectId: "p1", from: null, to: null, totalMinutes: 750, rows: [
      { membershipId: "m1", name: "Dana Designer", stageId: "s1", stageName: "Design", minutes: 480 },
      { membershipId: "m1", name: "Dana Designer", stageId: null, stageName: null, minutes: 270 },
    ] };
    const calls = mount(({ path }) => (path === "time/project" ? hours : undefined));
    render(<DesignSystemProvider locale="en-GB" timeZone="UTC"><ProjectHours workspaceId="w" projectId="p1" switcher={null} /></DesignSystemProvider>);
    const table = await grid("Hours");
    expect(calls[0].query.get("projectId")).toBe("p1");
    expect(within(table).getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual([expect.stringMatching(/Dana Designer.*Design.*8h 0m/), expect.stringMatching(/Dana Designer.*No stage.*4h 30m/)]);
    expect(screen.getByText("12h 30m approved")).toBeInTheDocument();
  });
});
