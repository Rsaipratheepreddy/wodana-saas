import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrewDay, HrmsBootstrap, HrmsCrew, HrmsCrewState, HrmsWorker } from "@wodana/contracts";
import { DesignSystemProvider } from "@/design-system";
import type { SiteState } from "@/lib/site/types";
import { ProjectSite } from "../site/project-site";

const nav = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/workspace/projects/p1/site", useSearchParams: () => new URLSearchParams(nav.query),
}));

const PID = "0c6b0c7e-4c4d-4a9e-9d64-3b6f0f2d7a11";
const TODAY = "2026-09-27";
const site: SiteState = { site: { startedOn: "2026-09-21", finishedOn: null }, reports: [], lines: [], members: [], today: TODAY, me: "u1", canReport: true, canApprove: true, canManage: false };
const boot: HrmsBootstrap = {
  membershipId: "m1", employee: null, settings: null, calendars: [], workspace: { name: "Palm Living", timezone: "UTC" },
  permissions: { self: true, team: false, manage: false, evidence: true, manageProjects: false },
};
const crew = (patch: Partial<HrmsCrew> = {}): HrmsCrew => ({
  id: "c1", name: "Joinery A", trade: "Carpentry", vendorId: null, vendorName: null, leadMembershipId: "m9", leadName: "Omar", active: true, version: 1, workers: 2, ...patch,
});
const worker = (patch: Partial<HrmsWorker>): HrmsWorker => ({ id: "w1", name: "Ravi Kumar", trade: "Carpentry", crewId: "c1", workerCode: "W-01", phone: "", dayRate: null, currency: null,
  active: true, version: 1, ...patch });
const crews: HrmsCrewState = {
  crews: [crew(), crew({ id: "c2", name: "Painters", trade: "Painting" })],
  workers: [worker({ id: "w1", name: "Ravi Kumar" }), worker({ id: "w2", name: "Anil Das", workerCode: "W-02" }), worker({ id: "w3", name: "Joseph Mathew", crewId: "c2", trade: "Painting" })],
  canManage: false,
};
const day = (patch: Partial<CrewDay> = {}): CrewDay => ({
  id: "d1", crewId: "c1", crewName: "Joinery A", trade: "Carpentry", projectId: PID, projectName: "PRJ-7 · Villa 12", workDate: "2026-09-26", status: "submitted", markedBy: "u2",
  markedByName: "Sara Site", captureId: "cap1", note: "", exceptionReason: "", submittedAt: "2026-09-26T15:00:00Z", decidedByName: null, decidedAt: null, decisionNote: "", version: 3,
  evidence: { arrival: { status: "inside", distanceM: 12, accuracyM: 8 }, photoCaptured: true, issues: [] }, present: 1.5,
  workers: [
    { workerId: "w1", name: "Ravi Kumar", trade: "Carpentry", presence: "present", overtimeHours: "2.00", dayRate: null, currency: null },
    { workerId: "w2", name: "Anil Das", trade: "Carpentry", presence: "half_day", overtimeHours: "0.00", dayRate: null, currency: null },
  ],
  canMark: false, canDecide: true, ...patch,
});

class Fail { constructor(readonly status: number, readonly body: Record<string, unknown>) {} }
type Call = { path: string; method: string; body: unknown; query: URLSearchParams };

/** The site and HRMS proxies, answered per path. */
const mount = (routes: (call: Call) => unknown) => {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, "http://localhost");
    const path = parsed.pathname.replace(/^\/api\/workspace\/hrms\/?/, "");
    const call = { path, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body, query: parsed.searchParams };
    calls.push(call);
    let value = routes(call);
    if (value === undefined) {
      if (path.startsWith("/api/site/")) value = site;
      else if (path === "bootstrap") value = boot;
      else if (path === "crews") value = crews;
      else if (path === "crew-days") value = { days: [], canSeeCosts: false };
      else value = { id: "ok" };
    }
    if (value instanceof Fail) return { ok: false, status: value.status, json: async () => value.body };
    return { ok: true, status: 200, json: async () => value };
  }));
  return calls;
};
const writes = (calls: Call[], path: string | RegExp) => calls.filter((call) => call.method !== "GET" && (typeof path === "string" ? call.path === path : path.test(call.path)));
const show = () => render(<DesignSystemProvider locale="en-GB" timeZone="UTC" currency="AED"><ProjectSite workspaceId="w" projectId={PID} /></DesignSystemProvider>);
const grid = (name: string) => screen.findByRole("grid", { name }).catch(() => screen.findByRole("table", { name }));
const openCrewDays = async (empty = true) => {
  await userEvent.click(await screen.findByRole("radio", { name: "Crew days" }));
  return empty ? screen.findByText("No crew days yet") : grid("Crew days");
};

/** A phone with a back camera and a location fix. */
function phone() {
  const stop = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
    getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 25.2, longitude: 55.3, accuracy: 9 }, timestamp: Date.parse(`${TODAY}T09:00:00Z`) } as GeolocationPosition),
  } });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 1200 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 900 });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback: BlobCallback) { callback(new Blob(["jpeg"], { type: "image/jpeg" })); });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:group"), revokeObjectURL: vi.fn() }));
}

describe("crew days", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${TODAY}T10:00:00Z`)); });
  afterEach(() => {
    vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); nav.query = "";
    Reflect.deleteProperty(navigator, "mediaDevices"); Reflect.deleteProperty(navigator, "geolocation");
  });

  it("lists the project's crew days beside the reports: date, crew, people, status and who marked it", async () => {
    const calls = mount(({ path }) => (path === "crew-days" ? { days: [day(), day({ id: "d2", workDate: "2026-09-25", status: "approved", present: 3, markedByName: "Omar", canDecide: false })], canSeeCosts: false } : undefined));
    show();
    const table = await openCrewDays(false);
    const rows = within(table).getAllByRole("row");
    expect(rows[0]).toHaveTextContent(/Date.*Crew.*People.*Status.*Marked by/);
    expect(rows[1]).toHaveTextContent(/Sat,? 26 Sept?.*Joinery A.*Carpentry.*1\.5.*Waiting for approval.*Sara Site/);
    expect(rows[2]).toHaveTextContent(/25 Sept?.*3.*Approved.*Omar/);
    expect(calls.find((call) => call.path === "crew-days")!.query.get("projectId")).toBe(PID);
    expect(screen.getByRole("button", { name: "Mark crew day" })).toBeInTheDocument();
  });

  it("marks who of the crew was there, with overtime and someone from another crew, and saves it as a draft", async () => {
    let saved: CrewDay | null = null;
    const calls = mount(({ path, method, body }) => {
      if (method === "PUT" && path.startsWith("crew-days/")) { saved = day({ id: path.split("/")[1], status: "draft", markedBy: "u1", version: 1, captureId: null }); return saved; }
      if (path === "crew-days") return { days: saved ? [saved] : [], canSeeCosts: false };
      return body === undefined ? undefined : undefined;
    });
    show();
    await openCrewDays();
    await userEvent.click(screen.getByRole("button", { name: "Mark crew day" }));
    const sheet = await screen.findByRole("dialog", { name: "Mark crew day" });
    await userEvent.click(within(sheet).getByRole("button", { name: /Crew$/ }));
    await userEvent.click(await screen.findByRole("option", { name: /^Joinery A/ }));
    // The crew's workers are listed, there the whole day unless changed.
    const ravi = within(sheet).getByRole("radiogroup", { name: "Ravi Kumar was" });
    expect(within(ravi).getByRole("radio", { name: "Present" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(within(within(sheet).getByRole("radiogroup", { name: "Anil Das was" })).getByRole("radio", { name: "Half day" }));
    const overtime = within(sheet).getByRole("textbox", { name: "Overtime for Ravi Kumar" });
    await userEvent.clear(overtime); await userEvent.type(overtime, "2"); await userEvent.tab();
    await userEvent.type(within(sheet).getByRole("combobox", { name: /Add a worker/ }), "Jos");
    await userEvent.click(await screen.findByRole("option", { name: /Joseph Mathew/ }));
    expect(within(sheet).getByRole("radiogroup", { name: "Joseph Mathew was" })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(writes(calls, /^crew-days\//)).toHaveLength(1));
    const [put] = writes(calls, /^crew-days\//);
    expect(put.path).toMatch(/^crew-days\/[0-9a-f-]{36}$/);
    expect(put.body).toEqual({ version: 0, crewId: "c1", projectId: PID, workDate: TODAY, note: "", workers: [
      { workerId: "w1", presence: "present", overtimeHours: 2 }, { workerId: "w2", presence: "half_day", overtimeHours: 0 }, { workerId: "w3", presence: "present", overtimeHours: 0 },
    ] });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Mark crew day" })).toBeNull());
  });

  it("needs someone there and a day that isn't ahead", async () => {
    mount(() => undefined);
    show();
    await openCrewDays();
    await userEvent.click(screen.getByRole("button", { name: "Mark crew day" }));
    const sheet = await screen.findByRole("dialog", { name: "Mark crew day" });
    await userEvent.click(within(sheet).getByRole("button", { name: /Crew$/ }));
    await userEvent.click(await screen.findByRole("option", { name: /^Joinery A/ }));
    for (const name of ["Ravi Kumar", "Anil Das"])
      await userEvent.click(within(within(sheet).getByRole("radiogroup", { name: `${name} was` })).getByRole("radio", { name: "Absent" }));
    expect(within(sheet).getByText("Mark who was there.")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Save draft" })).toBeDisabled();
    expect(within(sheet).getByRole("button", { name: "Submit" })).toBeDisabled();
  });

  it("submits with the group photo and position, asks for a reason when the server finds the evidence short, and resends the same photo with it", async () => {
    phone();
    let saved: CrewDay | null = null;
    const calls = mount(({ path, method, body }) => {
      if (method === "PUT" && /^crew-days\/[^/]+$/.test(path)) {
        saved = day({ id: path.split("/")[1], workDate: (body as { workDate: string }).workDate, status: "draft", markedBy: "u1", version: 1, captureId: null, canDecide: false });
        return saved;
      }
      if (path.endsWith("/submit")) return (body as { exceptionReason: string }).exceptionReason ? { ...saved!, status: "submitted", version: 2 }
        : new Fail(400, { message: "Retake the photo or give a reason.", issues: ["Location outside", "Not cleared for site: Ravi Kumar"] });
      if (path === "crew-days") return { days: saved ? [saved] : [], canSeeCosts: false };
      return undefined;
    });
    show();
    await openCrewDays();
    await userEvent.click(screen.getByRole("button", { name: "Mark crew day" }));
    const sheet = await screen.findByRole("dialog", { name: "Mark crew day" });
    await userEvent.click(within(sheet).getByRole("button", { name: /Crew$/ }));
    await userEvent.click(await screen.findByRole("option", { name: /^Joinery A/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Submit" }));
    const dialog = await screen.findByRole("dialog", { name: "Group photo" });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: "environment" }) }));
    await userEvent.click(await within(dialog).findByRole("button", { name: "Take photo" }));
    expect(within(dialog).getByRole("img", { name: "Group photo" })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByText(/Location ±9/)).toBeInTheDocument());
    // Photo and position in hand, marked today: no reason needed up front.
    expect(within(dialog).queryByRole("textbox", { name: /Reason for review/ })).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
    expect(await within(dialog).findByText("Outside the workplace")).toBeInTheDocument();
    expect(within(dialog).getByText("Not cleared for site: Ravi Kumar")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Submit" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Reason for review/ }), "Crew worked in the annex across the road");
    await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Group photo" })).toBeNull());
    const [capture] = writes(calls, "captures");
    const captureId = (capture.body as { id: string }).id;
    expect(writes(calls, `captures/${captureId}/photo`)).toHaveLength(1);
    const [refused, accepted] = writes(calls, /\/submit$/).map((call) => call.body);
    expect(refused).toEqual({ version: 1, captureId, position: { latitude: 25.2, longitude: 55.3, accuracyM: 9, capturedAt: `${TODAY}T09:00:00.000Z`, mock: false }, exceptionReason: "" });
    expect(accepted).toEqual({ ...(refused as object), exceptionReason: "Crew worked in the annex across the road" });
    // Sent, the day shows what went with it.
    expect(await screen.findByRole("dialog", { name: /Joinery A · 27 Sept?/ })).toBeInTheDocument();
  });

  it("shows why a day can't go when someone is already marked elsewhere that day", async () => {
    const draft = day({ status: "draft", markedBy: "u1", workDate: TODAY, canMark: true, canDecide: false, version: 4 });
    mount(({ path }) => (path.endsWith("/submit") ? new Fail(409, { message: "Already marked for the whole day elsewhere: Ravi Kumar." })
      : path === "crew-days" ? { days: [draft], canSeeCosts: false } : undefined));
    nav.query = "crewDay=d1";
    show();
    const sheet = await screen.findByRole("dialog", { name: /Joinery A/ });
    await userEvent.click(within(sheet).getByRole("button", { name: "Submit" }));
    const dialog = await screen.findByRole("dialog", { name: "Group photo" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Reason for review/ }), "Camera broken");
    await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
    expect(await within(dialog).findByText("Already marked for the whole day elsewhere: Ravi Kumar.")).toBeInTheDocument();
  });

  it("opens the day a notice links to with its evidence, and approves it or sends it back with what to change", async () => {
    nav.query = "crewDay=d1";
    const calls = mount(({ path, body }) => {
      if (path.endsWith("/decision")) return day({ status: (body as { decision: string }).decision === "approve" ? "approved" : "returned", version: 4, canDecide: false });
      if (path === "crew-days") return { days: [day({ exceptionReason: "Signal was weak", evidence: { arrival: { status: "uncertain", distanceM: null, accuracyM: 90 }, photoCaptured: true,
        issues: ["Location uncertain", "Marked on a later day"] } })], canSeeCosts: false };
      return undefined;
    });
    show();
    const sheet = await screen.findByRole("dialog", { name: /Joinery A · 26 Sept?/ });
    expect(within(sheet).getByText("Waiting for approval")).toBeInTheDocument();
    expect(within(sheet).getByText("Location uncertain")).toBeInTheDocument();
    expect(within(sheet).getByText("Marked on a later day")).toBeInTheDocument();
    expect(within(sheet).getByText("Signal was weak")).toBeInTheDocument();
    expect(within(sheet).getByRole("img", { name: "Group photo of Joinery A" })).toHaveAttribute("src", expect.stringContaining("/api/workspace/hrms/captures/cap1/photo"));
    expect(within(sheet).getByText("Present · 2h 0m overtime")).toBeInTheDocument();
    expect(within(sheet).getByText("Half day")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Send back" }));
    const back = await screen.findByRole("dialog", { name: "Send the crew day back" });
    expect(within(back).getByRole("button", { name: "Send back" })).toBeDisabled();
    await userEvent.type(within(back).getByRole("textbox", { name: /What to change/ }), "Anil left at noon");
    await userEvent.click(within(back).getByRole("button", { name: "Send back" }));
    await waitFor(() => expect(writes(calls, "crew-days/d1/decision").map((call) => call.body)).toEqual([{ version: 3, decision: "return", note: "Anil left at noon" }]));
  });

  it("approves on the day's version", async () => {
    nav.query = "crewDay=d1";
    const calls = mount(({ path }) => (path.endsWith("/decision") ? day({ status: "approved", version: 4, canDecide: false }) : path === "crew-days" ? { days: [day()], canSeeCosts: false } : undefined));
    show();
    const sheet = await screen.findByRole("dialog", { name: /Joinery A/ });
    await userEvent.click(within(sheet).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(writes(calls, "crew-days/d1/decision").map((call) => call.body)).toEqual([{ version: 3, decision: "approve", note: "" }]));
  });

  it("shows each person's fixed day rate and the day's total only to people who see costs", async () => {
    const approved = day({ status: "approved", canDecide: false, decidedByName: "Omar", decidedAt: "2026-09-27T08:00:00Z", workers: [
      { workerId: "w1", name: "Ravi Kumar", trade: "Carpentry", presence: "present", overtimeHours: "0.00", dayRate: "180.0000", currency: "AED" },
      { workerId: "w2", name: "Anil Das", trade: "Carpentry", presence: "half_day", overtimeHours: "0.00", dayRate: "150.5000", currency: "AED" },
    ] });
    nav.query = "crewDay=d1";
    mount(({ path }) => (path === "crew-days" ? { days: [approved], canSeeCosts: true } : undefined));
    const first = show();
    let sheet = await screen.findByRole("dialog", { name: /Joinery A/ });
    expect(within(sheet).getByText(/AED\s?180\.00 a day/)).toBeInTheDocument();
    expect(within(sheet).getByText(/AED\s?75\.25$/)).toBeInTheDocument();
    expect(within(sheet).getByText("Total").parentElement).toHaveTextContent(/AED\s?255\.25/);
    first.unmount();
    mount(({ path }) => (path === "crew-days" ? { days: [{ ...approved, workers: approved.workers.map((line) => ({ ...line, dayRate: null, currency: null })) }], canSeeCosts: false } : undefined));
    show();
    sheet = await screen.findByRole("dialog", { name: /Joinery A/ });
    expect(within(sheet).queryByText("Total")).toBeNull();
    expect(within(sheet).queryByText(/AED/)).toBeNull();
  });
});
