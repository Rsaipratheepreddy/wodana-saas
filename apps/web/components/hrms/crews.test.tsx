import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HrmsBootstrap, HrmsCrew, HrmsCrewState, HrmsPerson, HrmsWorker, WorkCalendar } from "@wodana/contracts";
import { DesignSystemProvider } from "@/design-system";
import { HrmsPage } from "./hrms-page";

const nav = vi.hoisted(() => ({ query: "", rerender: null as null | (() => void) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: (href: string) => { nav.query = href.split("?")[1] ?? ""; nav.rerender?.(); }, push: vi.fn() }),
  usePathname: () => "/workspace/hrms/crews",
  useSearchParams: () => new URLSearchParams(nav.query),
}));
vi.mock("@/lib/hrms/pending", () => ({ readPending: async () => undefined, writePending: async () => undefined, clearPending: async () => undefined }));

const calendar: WorkCalendar = { id: "cal1", name: "Studio", timezone: "UTC", workingDays: [1, 2, 3, 4, 5], holidays: [], dayStart: "09:00", halfDay: "13:00", dayEnd: "18:00" };
const bootstrap = (permissions: Partial<HrmsBootstrap["permissions"]> = {}): HrmsBootstrap => ({
  membershipId: "m1", employee: null,
  settings: { defaultCalendarId: "cal1", fallbackApproverId: null, maxGpsAccuracyM: 100, maxCaptureAgeSeconds: 120, mediaRetentionDays: 365, version: 1 },
  calendars: [calendar], workspace: { name: "Palm Living", timezone: "UTC" },
  permissions: { self: true, team: true, manage: true, evidence: true, manageProjects: false, ...permissions },
});
const crew = (patch: Partial<HrmsCrew> = {}): HrmsCrew => ({
  id: "c1", name: "Joinery A", trade: "Carpentry", vendorId: "v1", vendorName: "Gulf Fitout", leadMembershipId: "m3", leadName: "Omar Joiner", active: true, version: 2, workers: 2, ...patch,
});
const worker = (patch: Partial<HrmsWorker> = {}): HrmsWorker => ({
  id: "w1", name: "Ravi Kumar", trade: "Carpentry", crewId: "c1", workerCode: "W-01", phone: "", dayRate: "180.0000", currency: "AED", active: true, version: 1, ...patch,
});
const crews = (patch: Partial<HrmsCrewState> = {}): HrmsCrewState => ({
  crews: [crew(), crew({ id: "c2", name: "Painters", trade: "Painting", vendorId: null, vendorName: null, leadMembershipId: null, leadName: null, workers: 0, active: false })],
  workers: [worker(), worker({ id: "w2", name: "Anil Das", workerCode: "W-02", dayRate: null, currency: null })], canManage: true, ...patch,
});
const person = (patch: Partial<HrmsPerson> = {}): HrmsPerson => ({
  membershipId: "m3", name: "Omar Joiner", email: "omar@palm.test", status: "active", enabled: true, employeeCode: "PL-07", designation: "Foreman", department: "Site",
  managerId: null, calendarId: "cal1", remoteAllowed: false, activeFrom: "2026-01-01", activeTo: null, version: 1, ...patch,
});

class Fail { constructor(readonly status: number, readonly body: Record<string, unknown>) {} }
type Call = { path: string; method: string; body: Record<string, unknown> | undefined };

/** The web proxies, answered per path. */
const mount = (routes: (call: Call) => unknown, boot: HrmsBootstrap = bootstrap()) => {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, "http://localhost");
    const path = parsed.pathname.replace(/^\/api\/workspace\/hrms\/?/, "");
    const call = { path, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined };
    calls.push(call);
    let value = routes(call);
    if (value === undefined) {
      if (path === "bootstrap") value = boot;
      else if (path === "people") value = [person(), person({ membershipId: "m4", name: "Sara Site", designation: "Supervisor" })];
      else if (path.startsWith("/api/purchasing/suppliers")) value = { suppliers: [{ id: "v1", name: "Gulf Fitout", status: "active" }, { id: "v2", name: "Marble Masters", status: "active" }] };
      else if (path.startsWith("/api/")) value = { trades: [{ name: "Tiling" }] };
      else value = [];
    }
    if (value instanceof Fail) return { ok: false, status: value.status, json: async () => value.body };
    return { ok: true, status: 200, json: async () => value };
  }));
  return calls;
};
const writes = (calls: Call[], path: string) => calls.filter((call) => call.method !== "GET" && call.path === path).map((call) => call.body);
const page = () => {
  const ui = () => <DesignSystemProvider locale="en-GB" timeZone="UTC" currency="AED"><HrmsPage workspaceId="w" section="crews" /></DesignSystemProvider>;
  const view = render(ui());
  nav.rerender = () => view.rerender(ui());
  return view;
};
const grid = (name: string) => screen.findByRole("grid", { name }).catch(() => screen.findByRole("table", { name }));
const choose = async (scope: HTMLElement, field: RegExp, option: string) => {
  await userEvent.click(within(scope).getByRole("button", { name: field }));
  await userEvent.click(await screen.findByRole("option", { name: new RegExp(`^${option}`) }));
};

describe("Crews", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-27T10:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); nav.query = ""; nav.rerender = null; });

  it("lists the crews with their trade, lead, subcontractor and workers, and adds one", async () => {
    let state = crews();
    const calls = mount(({ path, method, body }) => {
      if (path === "crews" && method === "PUT") { state = { ...state, crews: [...state.crews, crew({ id: String(body!.id), name: String(body!.name), version: 1, workers: 0 })] }; return state; }
      return path === "crews" ? state : undefined;
    });
    page();
    const table = await grid("Crews");
    const [header, first, second] = within(table).getAllByRole("row");
    expect(header).toHaveTextContent(/Name.*Trade.*Lead.*Subcontractor.*Workers.*Active/);
    expect(first).toHaveTextContent(/Joinery A.*Carpentry.*Omar Joiner.*Gulf Fitout.*2.*Active/);
    expect(second).toHaveTextContent(/Painters.*Painting.*Inactive/);
    await userEvent.click(screen.getByRole("button", { name: "New crew" }));
    const sheet = await screen.findByRole("dialog", { name: "New crew" });
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(within(sheet).getByRole("textbox", { name: /Name/ }), "Tilers B");
    await userEvent.type(within(sheet).getByRole("combobox", { name: /Trade/ }), "Til");
    await userEvent.click(await screen.findByRole("option", { name: "Tiling" }));
    await waitFor(() => expect(within(sheet).getByRole("button", { name: /Lead/ })).toBeEnabled());
    await choose(sheet, /Lead/, "Sara Site");
    await waitFor(() => expect(within(sheet).getByRole("button", { name: /Subcontractor/ })).toBeEnabled());
    await choose(sheet, /Subcontractor/, "Marble Masters");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(calls, "crews")).toHaveLength(1));
    expect(writes(calls, "crews")[0]).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), version: 0, name: "Tilers B", trade: "Tiling", leadMembershipId: "m4", vendorId: "v2", active: true });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New crew" })).toBeNull());
    expect(within(await grid("Crews")).getByText("Tilers B")).toBeInTheDocument();
  });

  it("edits a crew on its version, and a clash with someone else's change says so", async () => {
    nav.query = "crew=c1";
    const calls = mount(({ path, method }) => (path === "crews" ? method === "PUT" ? new Fail(409, { message: "Someone else changed this crew. Reload to continue." }) : crews() : undefined));
    page();
    const sheet = await screen.findByRole("dialog", { name: "Joinery A" });
    expect(within(sheet).getByText("Ravi Kumar")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("switch", { name: "Active" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByText("Someone else changed this crew. Reload to continue.")).toBeInTheDocument();
    expect(writes(calls, "crews")[0]).toMatchObject({ id: "c1", version: 2, name: "Joinery A", trade: "Carpentry", leadMembershipId: "m3", vendorId: "v1", active: false });
  });

  it("keeps each worker's own day rate with its currency, the workspace's by default, or none for the trade's", async () => {
    let state = crews();
    const calls = mount(({ path, method, body }) => {
      if (path === "workers" && method === "PUT") { state = { ...state, workers: [...state.workers, worker({ id: String(body!.id), name: String(body!.name), dayRate: null, currency: null })] }; return state; }
      return path === "crews" ? state : undefined;
    });
    page();
    await grid("Crews");
    await userEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "Workers" }));
    const table = await grid("Workers");
    expect(within(table).getAllByRole("row")[0]).toHaveTextContent(/Name.*Trade.*Crew.*Day rate.*Active/);
    expect(within(table).getByText("Anil Das").closest("tr")).toHaveTextContent(/Anil Das.*W-02.*Carpentry.*Joinery A.*Trade rate/);
    expect(within(table).getByText("Ravi Kumar").closest("tr")).toHaveTextContent(/Ravi Kumar.*W-01.*AED\s?180\.00/);
    await userEvent.click(screen.getByRole("button", { name: "New worker" }));
    const sheet = await screen.findByRole("dialog", { name: "New worker" });
    await userEvent.type(within(sheet).getByRole("textbox", { name: /Name/ }), "Joseph Mathew");
    await userEvent.type(within(sheet).getByRole("combobox", { name: /Trade/ }), "Carp");
    await userEvent.click(await screen.findByRole("option", { name: "Carpentry" }));
    await choose(sheet, /Crew$/, "Joinery A");
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Worker code" }), "W-03");
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Phone" }), "7700 900123");
    // A rate is exact: it stops at the currency's places (never more than four).
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Day rate" }), "195.12345");
    expect(within(sheet).getByRole("textbox", { name: "Day rate" })).toHaveValue("195.12");
    await userEvent.clear(within(sheet).getByRole("textbox", { name: "Day rate" }));
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Day rate" }), "195.5");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(calls, "workers")).toHaveLength(1));
    expect(writes(calls, "workers")[0]).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), version: 0, name: "Joseph Mathew", trade: "Carpentry", crewId: "c1", workerCode: "W-03",
      phone: "+447700900123", dayRate: "195.5", currency: "AED", active: true });
  });

  it("sends a worker's rate and currency together, or neither when the trade's rate applies", async () => {
    nav.query = "worker=w1";
    const calls = mount(({ path, method }) => (path === "crews" ? crews() : path === "workers" && method === "PUT" ? crews() : undefined));
    page();
    const sheet = await screen.findByRole("dialog", { name: "Ravi Kumar" });
    expect(within(sheet).getByRole("textbox", { name: "Day rate" })).toHaveValue("180");
    await userEvent.clear(within(sheet).getByRole("textbox", { name: "Day rate" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(calls, "workers")).toHaveLength(1));
    expect(writes(calls, "workers")[0]).toMatchObject({ id: "w1", version: 1, dayRate: null, currency: null });
  });

  it("shows crews read-only, without pay, to people who don't run HR", async () => {
    mount(({ path }) => (path === "crews" ? crews({ canManage: false, workers: [worker({ dayRate: null, currency: null })] }) : undefined),
      bootstrap({ manage: false, team: true }));
    page();
    await grid("Crews");
    expect(screen.queryByRole("button", { name: "New crew" })).toBeNull();
    await userEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "Workers" }));
    const table = await grid("Workers");
    expect(within(table).getAllByRole("row")[0]).not.toHaveTextContent("Day rate");
    await userEvent.click(within(table).getByText("Ravi Kumar"));
    const sheet = await screen.findByRole("dialog", { name: "Ravi Kumar" });
    expect(within(sheet).queryByRole("textbox")).toBeNull();
    expect(within(sheet).queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(sheet).getByText("Joinery A")).toBeInTheDocument();
  });

  it("shows the Crews tab to a crew's lead only when the crews answer for them", async () => {
    const plain = { manage: false, team: false, evidence: false, manageProjects: false };
    const first = (mount(({ path }) => (path === "crews" ? crews({ canManage: false }) : undefined), bootstrap(plain)), page());
    expect(await screen.findByRole("tab", { name: "Crews" })).toBeInTheDocument();
    first.unmount();
    nav.query = "";
    const calls = mount(({ path }) => (path === "crews" ? new Fail(403, { message: "You do not have access to crews." }) : undefined), bootstrap(plain));
    render(<DesignSystemProvider locale="en-GB" timeZone="UTC"><HrmsPage workspaceId="w" section="attendance" /></DesignSystemProvider>);
    await waitFor(() => expect(calls.some((call) => call.path === "crews")).toBe(true));
    await waitFor(() => expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Attendance", "Time", "Leave", "Documents"]));
  });
});
