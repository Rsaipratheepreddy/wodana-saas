import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { ProjectDetail, ProjectOverview } from "@/lib/project-core/types";
import { ProjectPage } from "./project-page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/workspace/projects/p1", useSearchParams: () => new URLSearchParams() }));

const PID = "0c6b0c7e-4c4d-4a9e-9d64-3b6f0f2d7a11";
const check = (kind: string, passed: boolean) => ({ key: `${kind}_1`, kind, passed, confirmedBy: null, confirmedAt: null, note: "" }) as ProjectDetail["stages"][number]["checks"][number];
const detail = (patch: Partial<ProjectDetail> = {}): ProjectDetail => ({
  project: { id: PID, reference: "PRJ-0007", name: "Villa 12", clientName: "Maya Rahman", status: "active", priority: "normal", health: "on_track", promiseDate: "2099-12-12",
    currency: "AED", total: "412500.00", startedAt: "2026-09-22T09:00:00Z", caseId: "c1", opportunityId: "o1", opportunityReference: "O-1", holdReason: null, holdReviewOn: null,
    startDate: null, templateName: "Joinery", version: 4, closedAt: null, closedByName: null, cancelReason: null },
  seal: null,
  roles: [{ key: "project_manager", label: "Project manager" }, { key: "factory_lead", label: "Factory lead" }],
  team: [{ role: "project_manager", label: "Project manager", member: { membershipId: "m1", name: "Omar Haddad" } }, { role: "factory_lead", label: "Factory lead", member: { membershipId: "m2", name: "Faris Factory" } }],
  stages: [{ id: "s1", position: 0, key: "installation", name: "Delivery and installation", ownerRole: "factory_lead", status: "current", startedAt: "2026-09-22T09:00:00Z", completedAt: null,
    completedByName: null, skipReason: null, checks: [check("installation_scheduled", false), check("goods_delivered", false), check("installation_done", false)], ready: false,
    owner: { membershipId: "m2", name: "Faris Factory" }, canWork: true },
  { id: "s2", position: 1, key: "handover", name: "Handover", ownerRole: "project_manager", status: "upcoming", startedAt: null, completedAt: null, completedByName: null, skipReason: null,
    checks: [check("handover_accepted", false)], ready: false, owner: { membershipId: "m1", name: "Omar Haddad" }, canWork: false }],
  next: { stage: "Delivery and installation", kind: "installation_scheduled", text: "Installation scheduled", role: "factory_lead", owner: "Faris Factory" },
  updates: [], members: [], canManage: true, canClose: true, canSeeMoney: false, progress: 80,
  production: { step: { kind: "ready", label: "Ready for delivery" }, planned: { start: "2026-09-01", end: "2026-09-20", days: 20 }, actual: { start: "2026-09-02", end: "2026-09-24", days: 23 },
    late: true, overTarget: false, orders: 2, ready: 2, held: false },
  installation: { deliveryOn: null, installationOn: null, note: "", setByName: null, setAt: null, delivery: "not_booked", installation: "not_started", siteStartedOn: null, siteFinishedOn: null,
    inRoute: true, late: false },
  canScheduleInstallation: true,
  ...patch,
});
const overview = (): ProjectOverview => ({
  today: "2026-09-28", work: { open: 0, late: 0, blocked: 0, ready: 0, openSnags: 0, criticalSnags: 0, clientRequests: 0 }, blockers: [], decisions: [], stagePlan: {},
  dates: { start: null, promise: "2099-12-12", planEnd: null, siteStarted: null, siteFinished: null }, money: null, activity: [],
  health: { health: "on_track", stated: "on_track", reasons: [] }, contacts: { client: { phone: null, email: null }, sales: null },
});

describe("production and installation on a project (PLM-063, PLM-069)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows production as the factory works it, and schedules delivery and installation from the stage's next step", async () => {
    let current = detail();
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      if (body?.action === "schedule_installation") current = detail({ project: { ...detail().project, version: 5 },
        installation: { ...detail().installation!, deliveryOn: body.deliveryOn, installationOn: body.installationOn, note: body.note, delivery: "booked" } });
      const value = url.includes("/overview") ? overview() : url.includes("/factory/") ? { samples: [], canRequest: false } : current;
      return { ok: true, status: 200, json: async () => value };
    });
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="overview" /></DesignSystemProvider>);

    const production = await screen.findByRole("region", { name: "Production" });
    expect(within(production).getByText("Ready for delivery")).toBeInTheDocument();
    expect(within(production).getByText(/23 days · Late/)).toBeInTheDocument();
    const installation = screen.getByRole("region", { name: "Delivery and installation" });
    expect(within(installation).getByText("Not booked")).toBeInTheDocument();
    expect(within(installation).getByText("Not started")).toBeInTheDocument();
    // The stage's checks read from the records.
    expect(screen.getAllByText("Everything delivered").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Installation signed off").length).toBeGreaterThan(0);

    await userEvent.click(screen.getAllByRole("button", { name: "Schedule delivery and installation" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Delivery and installation" });
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Note" }), "Crane booked");
    // Dates are typed segment by segment (month, day, year).
    const segments = within(dialog).getAllByRole("spinbutton");
    await userEvent.type(segments[3], "10");
    await userEvent.type(segments[4], "15");
    await userEvent.type(segments[5], "2099");
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() => expect(fetcher.mock.calls.map(([, init]) => (typeof init?.body === "string" ? JSON.parse(init.body) : null)).filter(Boolean))
      .toEqual([expect.objectContaining({ action: "schedule_installation", installationOn: "2099-10-15", deliveryOn: null, note: "Crane booked", version: 4 })]));
    expect(await within(screen.getByRole("region", { name: "Delivery and installation" })).findByText("Booked")).toBeInTheDocument();
  });

  it("shows who goes, the vehicle and driver, and the building permit the delivery still needs (Palm, 6 Oct)", async () => {
    const crew = { assignmentId: "a1", version: 2, crew: null, note: "", people: [{ id: "w1", name: "Ali Khan", lead: true }, { id: "w2", name: "Sam", lead: false }],
      vehicle: { id: "v1", name: "Van 2" }, driver: { id: "w3", name: "Omar Driver" } };
    const permitStage = { ...detail().stages[0], checks: [check("installation_scheduled", true), check("permit_collected", false), check("goods_delivered", false)] };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (url.includes("/overview") ? overview()
      : url.includes("/api/logistics/options") ? { projects: [], workOrders: [], workers: [], crews: [], vehicles: [], canBook: false, canAddPeople: false, permitWarningDays: 3 }
      : detail({ stages: [permitStage, detail().stages[1]], next: { stage: "Delivery and installation", kind: "permit_collected", text: "Building permit collected", role: "factory_lead", owner: "Faris Factory" },
        installation: { ...detail().installation!, deliveryOn: "2099-10-14", installationOn: "2099-10-15", delivery: "booked", deliveryCrew: crew, installationCrew: null,
          permit: { required: true, valid: false, validTo: null, collectOn: "2099-10-10", plannedId: "p1", collected: false } } })) })));
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="overview" /></DesignSystemProvider>);
    const installation = await screen.findByRole("region", { name: "Delivery and installation" });
    expect(within(installation).getByText("Ali Khan, Sam")).toBeInTheDocument();
    expect(within(installation).getByText("Van 2")).toBeInTheDocument();
    expect(within(installation).getByText("Driver: Omar Driver")).toBeInTheDocument();
    expect(within(installation).getByText("Missing")).toBeInTheDocument();
    expect(within(installation).getByRole("button", { name: "Delivery crew and vehicle" })).toBeInTheDocument();
    // The stage's next step is the permit; it opens where the permit is recorded.
    expect(screen.getAllByText("Building permit collected").length).toBeGreaterThan(0);
    await userEvent.click(within(installation).getByRole("button", { name: "Record the building permit" }));
    const dialog = await screen.findByRole("dialog", { name: "Record the building permit" });
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("leaves scheduling to the project manager and the installation team", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (url.includes("/overview") ? overview()
      : detail({ canManage: false, canScheduleInstallation: false, production: null }) ) })));
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="overview" /></DesignSystemProvider>);
    const installation = await screen.findByRole("region", { name: "Delivery and installation" });
    expect(within(installation).queryByRole("button", { name: "Schedule" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Schedule delivery and installation" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Production" })).toBeNull();
  });
});
