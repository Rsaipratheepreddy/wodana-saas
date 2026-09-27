import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HrmsBootstrap, HrmsDocument, HrmsDocuments, HrmsPerson, WorkCalendar } from "@wodana/contracts";
import { DesignSystemProvider } from "@/design-system";
import type { HrmsSection } from "@/lib/hrms/sections";
import { HrmsPage } from "./hrms-page";

const nav = vi.hoisted(() => ({ query: "", replace: vi.fn(), rerender: null as null | (() => void) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: (href: string) => { nav.replace(href); nav.query = href.split("?")[1] ?? ""; nav.rerender?.(); }, push: vi.fn() }),
  usePathname: () => "/workspace/hrms/documents",
  useSearchParams: () => new URLSearchParams(nav.query),
}));
vi.mock("@/lib/hrms/pending", () => ({ readPending: async () => undefined, writePending: async () => undefined, clearPending: async () => undefined }));

const calendar: WorkCalendar = { id: "cal1", name: "Studio", timezone: "UTC", workingDays: [1, 2, 3, 4, 5], holidays: [], dayStart: "09:00", halfDay: "13:00", dayEnd: "18:00" };
const bootstrap = (manage = true): HrmsBootstrap => ({
  membershipId: "m1",
  employee: { membershipId: "m1", userId: "u1", name: "Dana Designer", enabled: true, remoteAllowed: false, managerId: null, activeFrom: "2026-01-01", activeTo: null, calendar, version: 1 },
  settings: { defaultCalendarId: "cal1", fallbackApproverId: null, maxGpsAccuracyM: 100, maxCaptureAgeSeconds: 120, mediaRetentionDays: 365, version: 1 },
  calendars: [calendar], workspace: { name: "Palm Living", timezone: "UTC" },
  permissions: { self: true, team: manage, manage, evidence: manage, manageProjects: false },
});
const document = (patch: Partial<HrmsDocument> = {}): HrmsDocument => ({
  id: "d1", membershipId: "m3", workerId: null, personName: "Omar Joiner", kind: "work_permit", title: "Work permit", number: "784-1990-123", issuedOn: "2025-01-10",
  expiresOn: "2026-10-10", fileName: "permit.pdf", note: "", version: 2, createdAt: "2025-01-10T08:00:00Z", status: "expiring", ...patch,
});
const documents = (patch: Partial<HrmsDocuments> = {}): HrmsDocuments => ({
  documents: [document(), document({ id: "d2", membershipId: null, workerId: "w1", personName: "Ravi Kumar", kind: "safety_induction", title: "Safety induction", number: "",
    expiresOn: "2026-09-01", status: "expired", fileName: null }), document({ id: "d3", kind: "identity", title: "Passport", number: "P1234567", expiresOn: "2031-01-01", status: "valid" })],
  siteDocuments: ["work_permit", "safety_induction"], canManage: true, ...patch,
});
const person = (patch: Partial<HrmsPerson> = {}): HrmsPerson => ({
  membershipId: "m3", name: "Omar Joiner", email: "omar@palm.test", status: "active", enabled: true, employeeCode: "PL-07", designation: "Foreman", department: "Site",
  managerId: null, calendarId: "cal1", remoteAllowed: false, activeFrom: "2026-01-01", activeTo: null, version: 1, ...patch,
});

class Fail { constructor(readonly status: number, readonly body: Record<string, unknown>) {} }
type Call = { path: string; method: string; body: unknown; query: URLSearchParams };
const mount = (routes: (call: Call) => unknown, boot = bootstrap()) => {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, "http://localhost");
    const path = parsed.pathname.replace(/^\/api\/workspace\/hrms\/?/, "");
    const call = { path, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body, query: parsed.searchParams };
    calls.push(call);
    let value = routes(call);
    if (value === undefined) {
      if (path === "bootstrap") value = boot;
      else if (path === "documents") value = documents({ canManage: boot.permissions.manage });
      else if (path === "people") value = [person(), person({ membershipId: "m4", name: "Sara Site" })];
      else if (path === "crews") value = { crews: [], workers: [{ id: "w1", name: "Ravi Kumar", trade: "Carpentry", crewId: null, workerCode: "W-01", phone: "", dayRate: null, currency: null, active: true, version: 1 }], canManage: true };
      else if (path === "attendance/current") value = null;
      else if (path === "attendance/history") value = { from: "", to: "", sessions: [], segments: [], events: [], reviews: [], days: [] };
      else if (path.startsWith("leave/") || path === "reviews") value = [];
      else value = { id: "ok" };
    }
    if (value instanceof Fail) return { ok: false, status: value.status, json: async () => value.body };
    return { ok: true, status: 200, json: async () => value };
  }));
  return calls;
};
const writes = (calls: Call[], path: string) => calls.filter((call) => call.method !== "GET" && call.path === path);
const page = (section: HrmsSection = "documents") => {
  const ui = () => <DesignSystemProvider locale="en-GB" timeZone="UTC"><HrmsPage workspaceId="w" section={section} /></DesignSystemProvider>;
  const view = render(ui());
  nav.rerender = () => view.rerender(ui());
  return view;
};
const grid = (name: string) => screen.findByRole("grid", { name }).catch(() => screen.findByRole("table", { name }));
const choose = async (scope: HTMLElement, field: RegExp, option: string) => {
  await userEvent.click(within(scope).getByRole("button", { name: field }));
  await userEvent.click(await screen.findByRole("option", { name: new RegExp(`^${option}`) }));
};

describe("Documents", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-27T10:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); nav.query = ""; nav.rerender = null; nav.replace.mockReset(); });

  it("lists everyone's documents for HR, expired first, and filters them by status", async () => {
    mount(() => undefined);
    page();
    const table = await grid("Documents");
    const rows = within(table).getAllByRole("row");
    expect(rows[0]).toHaveTextContent(/Person.*Document.*Expires.*Status/);
    expect(rows[1]).toHaveTextContent(/Ravi Kumar.*Crew worker.*Safety induction.*1 Sept?.*Expired/);
    expect(rows[2]).toHaveTextContent(/Omar Joiner.*Work permit.*784-1990-123.*10 Oct.*Expiring/);
    expect(rows[3]).toHaveTextContent(/Passport.*P1234567.*2031.*Valid/);
    await choose(screen.getByRole("tabpanel"), /^Any status/, "Expiring");
    expect(within(await grid("Documents")).getAllByRole("row")).toHaveLength(2);
  });

  it("files a new document against a person, named after its kind, then attaches its scan", async () => {
    const calls = mount(({ path, method, body }) => (method === "PUT" && /^documents\/[^/]+$/.test(path)
      ? document({ id: path.split("/")[1], version: 1, title: (body as { title: string }).title }) : method === "PUT" ? document({ version: 2 }) : undefined));
    page();
    await grid("Documents");
    await userEvent.click(screen.getByRole("button", { name: "New document" }));
    const sheet = await screen.findByRole("dialog", { name: "New document" });
    await choose(sheet, /Person$/, "Sara Site");
    await choose(sheet, /Kind$/, "Work permit");
    expect(within(sheet).getByRole("textbox", { name: /Title/ })).toHaveValue("Work permit");
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Number" }), "784-2001-555");
    await userEvent.upload(within(sheet).getByLabelText("Attach file"), new File(["%PDF"], "sara-permit.pdf", { type: "application/pdf" }));
    expect(within(sheet).getByText("sara-permit.pdf")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.filter((call) => call.method === "PUT")).toHaveLength(2));
    const [save, file] = calls.filter((call) => call.method === "PUT");
    expect(save.path).toMatch(/^documents\/[0-9a-f-]{36}$/);
    expect(save.body).toEqual({ version: 0, membershipId: "m4", workerId: null, kind: "work_permit", title: "Work permit", number: "784-2001-555", issuedOn: null, expiresOn: null, note: "" });
    expect(file.path).toBe(`${save.path}/file`);
    expect((file.body as FormData).get("file")).toBeInstanceOf(File);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New document" })).toBeNull());
  });

  it("files a crew worker's document, and removes one on its version", async () => {
    nav.query = "document=d1";
    const calls = mount(() => undefined);
    page();
    const sheet = await screen.findByRole("dialog", { name: "Work permit" });
    expect(within(sheet).getByRole("link", { name: "permit.pdf" })).toHaveAttribute("href", expect.stringContaining("/api/workspace/hrms/documents/d1/file"));
    await userEvent.click(within(sheet).getByRole("button", { name: "Remove" }));
    const confirm = await screen.findByRole("dialog", { name: "Remove Work permit?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(writes(calls, "documents/d1/remove").map((call) => call.body)).toEqual([{ version: 2 }]));
  });

  it("asks whose document it is — a person or a crew worker — and that it expires after it's issued", async () => {
    const calls = mount(({ method, path }) => (method === "PUT" && path.startsWith("documents/") ? document({ workerId: "w1", membershipId: null }) : undefined));
    page();
    await grid("Documents");
    await userEvent.click(screen.getByRole("button", { name: "New document" }));
    const sheet = await screen.findByRole("dialog", { name: "New document" });
    await userEvent.click(within(sheet).getByRole("radio", { name: "Crew worker" }));
    await choose(sheet, /Crew worker$/, "Ravi Kumar");
    await choose(sheet, /Kind$/, "Safety induction");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(calls, calls.find((call) => call.method === "PUT")?.path ?? "")).toHaveLength(1));
    expect(calls.find((call) => call.method === "PUT")!.body).toMatchObject({ membershipId: null, workerId: "w1", kind: "safety_induction", title: "Safety induction" });
  });

  it("shows a person only their own documents, read-only", async () => {
    mount(({ path }) => (path === "documents" ? documents({ canManage: false, documents: [document({ id: "d9", membershipId: "m1", personName: "Dana Designer" })] }) : undefined), bootstrap(false));
    page();
    const table = await grid("Documents");
    expect(within(table).getAllByRole("row")[0]).not.toHaveTextContent("Person");
    expect(screen.queryByRole("button", { name: "New document" })).toBeNull();
    await userEvent.click(within(table).getByText("Work permit"));
    const sheet = await screen.findByRole("dialog", { name: "Work permit" });
    expect(within(sheet).queryByRole("textbox")).toBeNull();
    expect(within(sheet).getByText("784-1990-123")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("lists a person's documents on their HR record, each opening in Documents", async () => {
    nav.query = "person=m3";
    const calls = mount(({ path }) => (path === "people" ? [person()] : undefined));
    page("people");
    const sheet = await screen.findByRole("dialog", { name: /Omar Joiner/ });
    const list = await within(sheet).findByRole("region", { name: "Documents" });
    await waitFor(() => expect(within(list).getByText("Passport")).toBeInTheDocument());
    expect(calls.find((call) => call.path === "documents" && call.query.get("membershipId") === "m3")).toBeTruthy();
    await userEvent.click(within(list).getByRole("button", { name: /Passport/ }));
    expect(nav.replace).toHaveBeenLastCalledWith("/workspace/hrms/documents?document=d3");
  });
});
