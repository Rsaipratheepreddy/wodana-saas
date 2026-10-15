import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { CloseOut, LiveScope, MaterialsState, ProjectDetail, ProjectOverview, ProjectRow, SealedScope, StartState } from "@/lib/project-core/types";
import { ProjectPage } from "./project-page";
import { splitByPercent } from "./sealed-document";
import { ProjectsPage } from "./projects-page";
import { StartProjectDialog } from "./start-project-dialog";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/workspace/projects/p1", useSearchParams: () => new URLSearchParams() }));

const PID = "0c6b0c7e-4c4d-4a9e-9d64-3b6f0f2d7a11";
const detail = (patch: Partial<ProjectDetail["project"]> = {}, stages?: ProjectDetail["stages"]): ProjectDetail => ({
  project: { id: PID, reference: "PRJ-0007", name: "Villa 12", clientName: "Maya Rahman", status: "active", priority: "normal", health: "on_track", promiseDate: "2099-12-12",
    currency: "AED", total: "412500.00", startedAt: "2026-09-22T09:00:00Z", caseId: "c1", opportunityId: "o1", opportunityReference: "O-1", holdReason: null, holdReviewOn: null,
    startDate: null, templateName: "Standard", version: 4, closedAt: null, closedByName: null, cancelReason: null, ...patch },
  seal: { revisionLabel: "R3", quoteNumber: 14, acceptedAt: "2026-09-20T10:00:00Z", acceptedBy: "Maya Rahman", method: "signed_document", contentHash: "a".repeat(64), sealedAt: "2026-09-22T09:00:00Z" },
  roles: [{ key: "project_manager", label: "Project manager" }, { key: "designer", label: "Designer" }],
  team: [{ role: "project_manager", label: "Project manager", member: { membershipId: "m1", name: "Omar Haddad" } }, { role: "designer", label: "Designer", member: null }],
  stages: stages ?? [
    { id: "s0", position: 0, key: "kickoff", name: "Kickoff", ownerRole: "project_manager", status: "current", startedAt: "2026-09-22T09:00:00Z", completedAt: null, completedByName: null, skipReason: null,
      checks: [{ key: "lead", kind: "lead_assigned", passed: true, confirmedBy: null, confirmedAt: null, note: "" }, { key: "meeting", kind: "confirm", label: "Kickoff meeting held", passed: false, confirmedBy: null, confirmedAt: null, note: "" }],
      ready: false, owner: { membershipId: "m1", name: "Omar Haddad" }, canWork: true },
    { id: "s1", position: 1, key: "production", name: "Production", ownerRole: "designer", status: "upcoming", startedAt: null, completedAt: null, completedByName: null, skipReason: null,
      checks: [{ key: "payment", kind: "payment_verified", passed: false, confirmedBy: null, confirmedAt: null, note: "" }], ready: false, owner: null, canWork: false },
  ],
  next: { stage: "Kickoff", kind: "confirm", text: "Kickoff meeting held", role: "project_manager", owner: "Omar Haddad" },
  updates: [], members: [{ membershipId: "m1", name: "Omar Haddad" }, { membershipId: "m2", name: "Dana Karim" }], canManage: true, canClose: true, canSeeMoney: false, progress: 35,
});
/** The Overview's own read: blockers, the plan per stage, dates, money and activity. */
const overview = (patch: Partial<ProjectOverview> = {}): ProjectOverview => ({
  today: "2026-09-28", work: { open: 3, late: 1, blocked: 1, ready: 1, openSnags: 0, criticalSnags: 0, clientRequests: 0 },
  blockers: [{ key: "late_work", count: 1, items: ["#4 Measure the kitchen"], href: `/workspace/projects/${PID}/plan?filter=late` }],
  decisions: [], stagePlan: { s0: { start: "2026-09-20", end: "2026-09-25", open: 1, total: 2 } },
  dates: { start: "2026-09-20", promise: "2099-12-12", planEnd: "2026-10-30", siteStarted: null, siteFinished: null },
  money: null, activity: [{ id: "a1", at: "2026-09-27T08:00:00Z", action: "work.create", source: "user", actor: "Omar Haddad", subject: "#4 Measure the kitchen", detail: {} }],
  health: { health: "at_risk", stated: "on_track", reasons: [{ key: "late_work", count: 1 }] }, contacts: { client: { phone: "+971501234567", email: null }, sales: null }, ...patch,
});
const mount = (respond: (url: string, body: Record<string, unknown> | undefined) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const value = !init?.body && url.includes("/overview") ? overview() : respond(url, typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
    return value instanceof Error
      ? { ok: false, status: 409, json: async () => ({ message: value.message }) }
      : { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const posts = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(String(init!.body)));

describe("projects", () => {
  afterEach(() => { vi.unstubAllGlobals(); router.push.mockReset(); });

  it("lists running projects with their stage, next step and handover, and filters by status", async () => {
    const rows: ProjectRow[] = [
      { ...detail().project, stage: { name: "Kickoff", position: 1, count: 8 }, lead: "Omar Haddad", next: detail().next },
      { ...detail({ id: "p2", reference: "PRJ-0006", name: "Marina Penthouse", status: "on_hold" }).project, stage: null, lead: null, next: null },
    ];
    mount(() => ({ projects: rows, canStart: true }));
    render(<DesignSystemProvider><ProjectsPage workspaceId="w" /></DesignSystemProvider>);
    const table = await screen.findByRole("grid", { name: "Projects" }).catch(() => screen.findByRole("table", { name: "Projects" }));
    expect(within(table).getByRole("link", { name: "Villa 12" })).toHaveAttribute("href", `/workspace/projects/${PID}`);
    expect(table).toHaveTextContent("Kickoff meeting held");
    expect(table).not.toHaveTextContent("Marina Penthouse");
    await userEvent.click(screen.getByRole("button", { name: "On hold" }));
    expect(await screen.findByText("Marina Penthouse")).toBeInTheDocument();
  });

  it("has one title, one primary action, status tabs under the title, and health as a removable filter chip", async () => {
    const rows: ProjectRow[] = [
      { ...detail().project, stage: { name: "Kickoff", position: 1, count: 8 }, lead: "Omar Haddad", next: detail().next },
      { ...detail({ id: "p3", reference: "PRJ-0009", name: "Palm Duplex", health: "at_risk" }).project, stage: null, lead: null, next: null },
    ];
    mount(() => ({ projects: rows, canStart: true }));
    render(<DesignSystemProvider><ProjectsPage workspaceId="w" initialHealth="at-risk" /></DesignSystemProvider>);
    expect(await screen.findByText("Palm Duplex")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Start project" })).toHaveLength(1);
    expect(within(screen.getByRole("group", { name: "Show" })).getAllByRole("button").map((tab) => tab.textContent)).toEqual(["Running", "On hold", "Closed"]);
    expect(screen.queryByRole("link", { name: "Villa 12" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Filters in use" })).getByText("At risk")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Remove filter Health" }));
    expect(await screen.findByRole("link", { name: "Villa 12" })).toBeInTheDocument();
    expect(router.replace).toHaveBeenCalledWith("/workspace/projects");
  });

  it("opens Profitability from the table options for people who see project costs, and only for them", async () => {
    const rows: ProjectRow[] = [{ ...detail().project, stage: null, lead: null, next: null }];
    mount(() => ({ projects: rows, canStart: false, canSeeProfit: true }));
    const { unmount } = render(<DesignSystemProvider><ProjectsPage workspaceId="w" /></DesignSystemProvider>);
    await screen.findByRole("link", { name: "Villa 12" });
    await userEvent.click(screen.getByRole("button", { name: "Table options" }));
    await userEvent.click(await screen.findByRole("button", { name: "Profitability" }));
    expect(router.push).toHaveBeenCalledWith("/workspace/projects/profitability");
    unmount();
    mount(() => ({ projects: rows, canStart: false }));
    render(<DesignSystemProvider><ProjectsPage workspaceId="w" /></DesignSystemProvider>);
    await screen.findByRole("link", { name: "Villa 12" });
    await userEvent.click(screen.getByRole("button", { name: "Table options" }));
    expect(screen.queryByRole("button", { name: "Profitability" })).toBeNull();
  });

  it("works the current stage: confirms a check, then finishes it; sends the project's version with every change", async () => {
    let current = detail();
    const fetcher = mount((url, body) => {
      if (!body) return current;
      if (body.action === "confirm_check") {
        current = detail({ version: 5 }, current.stages.map((stage, index) => index ? stage
          : { ...stage, ready: true, checks: stage.checks.map((check) => ({ ...check, passed: true, confirmedBy: "Omar Haddad", confirmedAt: "2026-09-23T09:00:00Z" })) }));
      }
      return current;
    });
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="overview" /></DesignSystemProvider>);
    // The next step names what the stage needs; its button confirms it.
    expect(await screen.findByRole("heading", { level: 3, name: "Kickoff meeting held" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm: Kickoff meeting held" })).toHaveTextContent("Confirm");
    // Read from the records, never ticked by hand.
    expect(screen.getByText("Project manager named")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Kickoff meeting held" }));
    // Ready: the one action finishes the stage.
    const finish = await screen.findByRole("button", { name: "Finish Kickoff" });
    expect(finish).toBeEnabled();
    await userEvent.click(finish);
    // Finishing moves the project on, so it asks first and nothing is sent until it's confirmed.
    const dialog = await screen.findByRole("dialog", { name: "Finish Kickoff?" });
    expect(posts(fetcher).map((post) => post.action)).toEqual(["confirm_check"]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Finish Kickoff" }));
    await waitFor(() => expect(posts(fetcher).map((post) => [post.action, post.version])).toEqual([["confirm_check", 4], ["complete_stage", 5]]));
    expect(posts(fetcher)[0]).toMatchObject({ stageId: "s0", checkKey: "meeting" });
  });

  it("shows the areas the job's enquiry-type path uses after Won: Plan and delivery hide when the path skips them (PLM-098)", async () => {
    const installation = { deliveryOn: null, installationOn: null, note: "", setByName: null, setAt: null, delivery: "not_booked", installation: "not_started", siteStartedOn: null,
      siteFinishedOn: null, inRoute: true, late: false } as ProjectDetail["installation"];
    mount((_url, body) => body ? detail() : { ...detail(), installation, areas: { planning: false, production: true, supply: true, delivery: false } });
    const { unmount } = render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="plan" /></DesignSystemProvider>);
    const tabs = (await screen.findByRole("tab", { name: "Scope" })).closest("[role=tablist]") as HTMLElement;
    expect(within(tabs).queryByRole("tab", { name: "Plan" })).toBeNull();
    // An address to the hidden tab opens the Overview.
    expect(within(tabs).getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Delivery and installation")).toBeNull();
    unmount();
    // Nothing configured: every area, as before.
    mount((_url, body) => body ? detail() : { ...detail(), installation });
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="overview" /></DesignSystemProvider>);
    expect(await screen.findByRole("tab", { name: "Plan" })).toBeInTheDocument();
    expect(await screen.findByText("Delivery and installation")).toBeInTheDocument();
  });

  it("renames the project from its title and edits the priority in place, with the project's version", async () => {
    let current = detail();
    const fetcher = mount((url, body) => {
      if (body?.action === "rename") current = detail({ name: String(body.name), version: 5 });
      if (body?.action === "set_priority") current = detail({ name: current.project.name, priority: body.priority as ProjectDetail["project"]["priority"], version: 6 });
      return current;
    });
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="overview" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Edit Project name" }));
    const name = screen.getByRole("textbox", { name: "Project name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Villa 12 · Phase 2{Enter}");
    await waitFor(() => expect(posts(fetcher)).toEqual([expect.objectContaining({ action: "rename", name: "Villa 12 · Phase 2", version: 4 })]));
    expect(await screen.findByRole("heading", { level: 1, name: "Villa 12 · Phase 2" })).toBeInTheDocument();
    // On the Overview the details are the sidebar's Details tab.
    await userEvent.click(screen.getByRole("tab", { name: "Details" }));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Priority" }));
    await userEvent.click(await screen.findByRole("option", { name: "High" }));
    await waitFor(() => expect(posts(fetcher)[1]).toEqual(expect.objectContaining({ action: "set_priority", priority: "high", version: 5 })));
  });

  it("shows plain details to people who can't manage the project", async () => {
    mount(() => ({ ...detail(), canManage: false }));
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="overview" /></DesignSystemProvider>);
    expect(await screen.findByRole("heading", { level: 1, name: "Villa 12" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Project name" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(await screen.findByText("Priority")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Priority" })).not.toBeInTheDocument();
  });

  it("QA-006: shows no agreed value, prices or sealed documents to someone who doesn't see the project's value", async () => {
    const live: LiveScope = {
      lines: [{ id: "a", position: 0, kind: "item", areaId: "k", areaName: "Kitchen", workPackageId: null, tradeName: null, title: "Kitchen cabinets", description: "", unit: "m", quantity: "6.5000", rate: null, net: null, status: "active", packageId: null, origin: "R3", catalogImageId: null, imageAssetId: null }],
      packages: [], seals: [{ id: "s1", kind: "baseline", revisionLabel: "R3", quoteNumber: 14, total: null, currency: "AED", acceptedAt: "2026-09-20T10:00:00Z", acceptedBy: "Maya Rahman" }],
      currency: "AED", version: 4, canManage: false, members: [], variations: [], caseId: "c1", baselineQuoteId: "q1", canSeeValue: false,
    };
    mount((url) => (url.includes("/scope") ? live : url.includes("/lines/") ? { history: [] } : { ...detail({ total: null }), canManage: false, canSeeValue: false }));
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="scope" /></DesignSystemProvider>);
    const table = await screen.findByRole("table", { name: "Scope items" });
    expect(within(table).getByText("Kitchen cabinets")).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Amount" })).not.toBeInTheDocument();
    expect(screen.queryByText("Agreed value")).not.toBeInTheDocument();
    expect(screen.queryByText(/AED/)).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Sealed" })).not.toBeInTheDocument();
  });

  it("shows why a change was refused and reloads when someone else changed the project", async () => {
    let loads = 0;
    mount((url, body) => (body ? new Error("Someone else changed this project. Reload to see their changes.")
      : url.includes("/api/history/") ? { items: [], next: null, timeZone: "UTC" } : (loads++, detail())));
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="overview" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Kickoff meeting held" }));
    expect(await screen.findByText(/Someone else changed this project/)).toBeInTheDocument();
    await waitFor(() => expect(loads).toBe(2));
  });

  it("puts a project on hold with a reason and shows it at the top", async () => {
    let current = detail();
    const fetcher = mount((url, body) => {
      if (body?.action === "hold") current = detail({ status: "on_hold", holdReason: String(body.reason), version: 5 });
      return current;
    });
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="overview" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Project actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Put on hold" }));
    const dialog = await screen.findByRole("dialog", { name: "Put on hold" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why/ }), "Client travelling");
    await userEvent.click(within(dialog).getByRole("button", { name: "Put on hold" }));
    await waitFor(() => expect(posts(fetcher)).toEqual([expect.objectContaining({ action: "hold", reason: "Client travelling", version: 4 })]));
    expect(await screen.findByText("Client travelling")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Finish/ })).not.toBeInTheDocument();
  });

  it("cancels a project only once nothing is left half-way, and says what cancelling does by itself", async () => {
    const closeOut = (blocked: boolean): CloseOut => ({
      owedOrders: blocked ? [{ id: "o1", number: "PO-0003", supplierName: "Nile Marble", lines: 1 }] : [], sharedDrafts: [], inspections: [], moves: [],
      siteStock: blocked ? [{ itemName: "Oak veneer", unit: "sheets", quantity: "2.0000", locationName: "PRJ-0007 · Villa 12" }] : [],
      openWork: 2, drafts: [{ id: "o2", number: "PO-0004", kind: "order" }],
      heldStock: [{ itemId: "i1", itemName: "Oak veneer", unit: "sheets", quantity: "4.0000", locationId: "l1", locationName: "Warehouse" }],
      blockers: blocked ? ["PO-0003 is still owed goods", "1 item is still at the site"] : [],
    });
    let blocked = true;
    let current = detail();
    const fetcher = mount((url, body) => {
      if (url.includes("/close-out")) return closeOut(blocked);
      if (body?.action === "cancel") current = detail({ status: "cancelled", cancelReason: String(body.reason), closedAt: "2026-09-27T08:00:00Z", closedByName: "Omar Haddad", version: 5 });
      return current;
    });
    const { unmount } = render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="overview" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Project actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Cancel the project" }));
    let dialog = await screen.findByRole("dialog", { name: "Cancel the project" });
    const first = await within(dialog).findByRole("region", { name: "Settle these first" });
    expect(within(first).getByRole("link", { name: "PO-0003 · Nile Marble" })).toHaveAttribute("href", "/workspace/purchasing/orders?order=o1");
    expect(within(first).getByText("2 sheets still at PRJ-0007 · Villa 12")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel the project" })).toBeDisabled();
    unmount();

    blocked = false;
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="overview" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Project actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Cancel the project" }));
    dialog = await screen.findByRole("dialog", { name: "Cancel the project" });
    const also = await within(dialog).findByRole("region", { name: "Cancelling also" });
    expect(within(also).getByText("Cancelled; it was never sent")).toBeInTheDocument();
    expect(within(also).getByText("2 cancelled")).toBeInTheDocument();
    expect(within(also).getByText("4 sheets at Warehouse becomes free stock")).toBeInTheDocument();
    expect(within(dialog).queryByRole("region", { name: "Settle these first" })).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why it's cancelled/ }), "Client withdrew");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel the project" }));
    await waitFor(() => expect(posts(fetcher)).toEqual([expect.objectContaining({ action: "cancel", reason: "Client withdrew", version: 4 })]));
    expect(await screen.findByText(/Client withdrew · .* · Omar Haddad/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Project actions" })).not.toBeInTheDocument();
  });

  it("shows a completed project and reopens it with why", async () => {
    let current = detail({ status: "completed", closedAt: "2026-09-27T08:00:00Z", closedByName: "Omar Haddad" });
    const fetcher = mount((_url, body) => {
      if (body?.action === "reopen") current = detail({ version: 5 });
      return current;
    });
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="overview" /></DesignSystemProvider>);
    expect(await screen.findByText(/· Omar Haddad/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Project actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Reopen" }));
    const dialog = await screen.findByRole("dialog", { name: "Reopen the project" });
    expect(within(dialog).getByRole("button", { name: "Reopen" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why it's reopened/ }), "Handover signed too early");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(posts(fetcher)).toEqual([expect.objectContaining({ action: "reopen", reason: "Handover signed too early", version: 4 })]));
  });

  it("shows the project as a record: one title, where it stands, the next step, the team and its contacts", async () => {
    mount(() => detail());
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="overview" /></DesignSystemProvider>);
    const heading = await screen.findByRole("heading", { level: 1, name: "Villa 12" });
    expect(heading.closest("header")!).toHaveTextContent("PRJ-0007");
    // The strip: the stage and the handover; the health from the records (a task is late) is the header's badge, once.
    const strip = await screen.findByLabelText("Where the project stands");
    expect(strip).toHaveTextContent("KickoffStage 1 of 2");
    await waitFor(() => expect(heading.closest("header")!).toHaveTextContent("At risk"));
    expect(strip).not.toHaveTextContent("At risk");
    expect(screen.getAllByText("At risk")).toHaveLength(1);
    // The one next step lives in its card, not twice in the header.
    expect(screen.getAllByRole("button", { name: "Confirm: Kickoff meeting held" })).toHaveLength(1);
    // Seven tabs, in the order work happens.
    expect(screen.getAllByRole("tab").slice(0, 7).map((tab) => tab.textContent)).toEqual(["Overview", "Scope", "Plan", "Money", "Site", "Handover", "Updates"]);
    // The sidebar's team: each person once, the roles nobody holds, and how to reach the client.
    const team = screen.getByRole("list", { name: "Team" });
    expect(within(team).getByText("Omar Haddad")).toBeInTheDocument();
    expect(screen.getByText("Not named: Designer")).toBeInTheDocument();
    expect(within(team).getByRole("link", { name: "Call Maya Rahman" })).toHaveAttribute("href", "tel:+971501234567");
  });

  it("shows what holds the project up, each linked to its list, and the latest activity", async () => {
    mount(() => detail());
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="overview" /></DesignSystemProvider>);
    const blockers = await screen.findByRole("region", { name: "Needs attention" });
    expect(within(blockers).getByRole("link", { name: /1 task late/ })).toHaveAttribute("href", `/workspace/projects/${PID}/plan?filter=late`);
    expect(screen.getByRole("heading", { level: 3, name: "Kickoff meeting held" })).toBeInTheDocument();
    // Who did what is the project's History (the shared component).
    expect(screen.getByRole("region", { name: "History" })).toBeInTheDocument();
    // Kickoff's planned work ended on the 25th and is still open: on the next step, and in the Stages section.
    expect(screen.getByText("3 days past its plan")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Stages" })).getByText("3 days late")).toBeVisible();
  });

  it("resumes a held project, offering to move the dates by the working days lost", async () => {
    let current: ProjectDetail = { ...detail({ status: "on_hold", holdReason: "Client travelling" }), hold: { days: 7, workingDays: 5 } };
    const fetcher = mount((_url, body) => {
      if (body?.action === "resume") current = { ...detail({ version: 5 }), hold: null };
      return current;
    });
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="overview" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume" }));
    const dialog = await screen.findByRole("dialog", { name: "Resume the project" });
    expect(within(dialog).getByRole("checkbox", { name: "Move open work and the handover date 5 working days later" })).toBeChecked();
    await userEvent.click(within(dialog).getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(posts(fetcher)).toEqual([expect.objectContaining({ action: "resume", shiftDates: true, version: 4 })]));
  });

  it("starts a project only once the start rules pass and a project manager is chosen", async () => {
    const state = (ok: boolean): StartState => ({
      project: null, quote: { id: "q1", number: 14, title: "Main quote", currency: "AED", total: "412500", acceptedAt: null, acceptedBy: null },
      checks: [{ key: "accepted", ok: true, required: true }, { key: "payment", ok, required: true }], caseStatus: "active",
      templates: [{ id: "t1", name: "Standard", isDefault: true }], members: [{ membershipId: "m1", name: "Omar Haddad" }], suggested: { name: "Villa 12", lead: null }, canStart: ok, canManage: true,
    });
    const fetcher = mount((url, body) => (body ? { projectId: "p9", existing: false } : state(false)));
    const view = render(<DesignSystemProvider><StartProjectDialog workspaceId="w" caseId="c1" onClose={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Start project" });
    expect(await within(dialog).findByRole("link", { name: "Open" })).toHaveAttribute("href", "/workspace/pre-projects/cases/c1/payment-plan");
    expect(within(dialog).getByRole("button", { name: "Start project" })).toBeDisabled();
    view.unmount();

    fetcher.mockImplementation(async (url: string, init?: RequestInit) => ({ ok: true, status: 200, json: async () => (init?.method === "POST" ? { projectId: "p9", existing: false } : state(true)) }));
    render(<DesignSystemProvider><StartProjectDialog workspaceId="w" caseId="c1" onClose={vi.fn()} /></DesignSystemProvider>);
    const ready = await screen.findByRole("dialog", { name: "Start project" });
    await within(ready).findByRole("textbox", { name: /Project name/ });
    expect(within(ready).getByRole("button", { name: "Start project" })).toBeDisabled();
    await userEvent.click(within(ready).getByRole("button", { name: /Project manager/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Omar Haddad" }));
    await userEvent.click(within(ready).getByRole("button", { name: "Start project" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/workspace/projects/p9"));
    expect(posts(fetcher)[0]).toMatchObject({ quoteId: "q1", templateId: "t1", name: "Villa 12", leadMembershipId: "m1" });
  });

  it("shows the live scope by package, moves items between packages and opens a line's history", async () => {
    const live: LiveScope = {
      lines: [
        { id: "a", position: 0, kind: "item", areaId: "k", areaName: "Kitchen", workPackageId: null, tradeName: null, title: "Kitchen cabinets", description: "", unit: "m", quantity: "6.5000", rate: "4200", net: "27300.0000", status: "active", packageId: "p1", origin: "R3", catalogImageId: null, imageAssetId: null },
        { id: "b", position: 1, kind: "item", areaId: "k", areaName: "Kitchen", workPackageId: null, tradeName: null, title: "Quartz worktop", description: "", unit: "m²", quantity: "4.2000", rate: "1850", net: "7770.0000", status: "active", packageId: null, origin: "R3", catalogImageId: null, imageAssetId: null },
      ],
      packages: [{ id: "p1", name: "Kitchen joinery", supply: "make", ownerMembershipId: "m2", ownerName: "Dana Karim", dueDate: null, version: 1 }],
      seals: [{ id: "s1", kind: "baseline", revisionLabel: "R3", quoteNumber: 14, total: "35070.00", currency: "AED", acceptedAt: "2026-09-20T10:00:00Z", acceptedBy: "Maya Rahman" }],
      currency: "AED", version: 4, canManage: true, members: [{ membershipId: "m2", name: "Dana Karim" }], variations: [], caseId: "c1", baselineQuoteId: "q1",
    };
    const fetcher = mount((url, body) => (body ? detail({ version: 5 }) : url.includes("/lines/") ? { history: [{ id: "h1", kind: "agreed", detail: { revision: "R3", quantity: "6.5" }, byName: "Omar", at: "2026-09-22T09:00:00Z" }] } : url.includes("/scope") ? live : detail()));
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="scope" /></DesignSystemProvider>);
    const table = await screen.findByRole("table", { name: "Scope items" });
    expect(within(table).getByText("Made in our factory")).toBeInTheDocument();
    expect(within(table).getByText("Not in a package")).toBeInTheDocument();
    expect(screen.getByText("AED 35,070.00")).toBeInTheDocument();
    await userEvent.click(within(table).getByRole("checkbox", { name: "Select Quartz worktop" }));
    await userEvent.click(screen.getByRole("button", { name: /Move to/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Kitchen joinery" }));
    await waitFor(() => expect(posts(fetcher)).toEqual([expect.objectContaining({ action: "assign_lines", lineIds: ["b"], packageId: "p1", version: 4 })]));
    await userEvent.click(within(table).getByText("Kitchen cabinets"));
    expect(await screen.findByText("Agreed in R3 · 6.5 m")).toBeInTheDocument();
  });

  it("lists the project's changes (and variations made in the builder before), and raises a new one from Changes", async () => {
    const live: LiveScope = { lines: [], packages: [], seals: [], currency: "AED", version: 4, canManage: true, members: [], caseId: "c1", baselineQuoteId: "q1", variations: [] };
    const changes = { canRaise: true, projectOpen: true,
      changes: [{ id: "11111111-1111-4111-8111-111111111111", reference: "CR-001", title: "Study wardrobe", reason: "client_request", status: "with_client", currency: "AED", value: "5251.05", days: 3,
        handoverBefore: "2031-11-06", handoverAfter: "2031-11-11", raisedByName: "Sam Site", raisedByClient: false, updatedAt: "2031-10-01T10:00:00Z", next: null, applyProblem: null }],
      legacy: [{ id: "v1", number: 3, title: "Additional work", status: "accepted", total: "350.00", appliedAs: "VO-1" }],
      money: { currency: "AED", sealed: { label: "R1", net: "7200.00", tax: "360.00", total: "7560.00" }, variations: [], variationsTotal: "350.00", variationsNet: "333.33", agreed: "7910.00" } };
    mount((url) => (url.startsWith("/api/project-changes/") ? (url.includes("/sources") ? { stages: [], rooms: [], scope: [], catalog: [] } : changes) : url.includes("/scope") ? live : detail()));
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="scope" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("tab", { name: "Changes" }));
    expect(await screen.findByText("CR-001 · Study wardrobe")).toBeInTheDocument();
    expect(screen.getByText("VO-1 · Additional work")).toBeInTheDocument();
    expect(screen.getByText("With client")).toBeInTheDocument();
    await userEvent.click(screen.getByText("CR-001 · Study wardrobe"));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/workspace/projects/${PID}/changes/11111111-1111-4111-8111-111111111111`));
    await userEvent.click(screen.getByRole("button", { name: "Raise a change" }));
    expect(await screen.findByRole("dialog", { name: "Raise a change" })).toBeInTheDocument();
  });

  it("sends the material list and records the client's decision, needing a reason for each rejection", async () => {
    const live: LiveScope = { lines: [], packages: [], seals: [], variations: [], currency: "AED", version: 4, canManage: true, members: [], caseId: "c1", baselineQuoteId: "q1" };
    const item = (id: string, name: string) => ({ id, position: 0, catalogItemId: null, name, code: "", specification: "", supplier: "", quantity: null, unit: "", note: "", boqLineIds: [], version: 1, clientChoice: true, usedIn: [], decision: null });
    let materials: MaterialsState = { state: "draft", items: [item("m1", "Quartz, Calacatta"), item("m2", "Oak veneer")], revisions: [], version: 4, canEdit: true };
    const fetcher = mount((url, body) => {
      if (body?.action === "send_materials") materials = { ...materials, state: "sent", revisions: [{ id: "r1", number: 1, status: "sent", sentAt: new Date().toISOString(), sentByName: "Dana", decidedAt: null, decidedBy: null, method: null, note: "" }] };
      if (body) return detail({ version: 5 });
      return url.includes("/materials") ? materials : url.includes("/scope") ? live : detail();
    });
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="scope" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("tab", { name: "Materials" }));
    expect(await screen.findByText("Not sent to the client yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send to the client" }));
    expect(await screen.findByText(/R1 is with the client/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Record the client's decision" }));
    const dialog = await screen.findByRole("dialog", { name: "Record the client's decision" });
    await userEvent.click(within(within(dialog).getByRole("radiogroup", { name: "Decision for Oak veneer" })).getByText("Reject"));
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Decided by/ }), "Maya");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "What they want instead of Oak veneer" }), "Smoked oak");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toMatchObject({ action: "record_materials_decision", decidedBy: "Maya", method: "signed_document",
      decisions: [{ itemId: "m1", decision: "approved", note: "" }, { itemId: "m2", decision: "rejected", note: "Smoked oak" }] }));
  });

  it("marks materials the client doesn't choose, so they don't wait for sign-off", async () => {
    const live: LiveScope = { lines: [], packages: [], seals: [], variations: [], currency: "AED", version: 4, canManage: true, members: [], caseId: "c1", baselineQuoteId: "q1" };
    const cement = { id: "m1", position: 0, catalogItemId: null, name: "Cement", code: "", specification: "", supplier: "", quantity: "5.0000", unit: "bags", note: "", boqLineIds: [], version: 1,
      clientChoice: false, usedIn: [], decision: null };
    const fetcher = mount((url, body) => (body ? detail({ version: 5 }) : url.includes("/materials") ? { state: "draft", items: [cement], revisions: [], version: 4, canEdit: true }
      : url.includes("/scope") ? live : detail()));
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="scope" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("tab", { name: "Materials" }));
    expect(await screen.findByText("No client choice")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Cement"));
    const sheet = await screen.findByRole("dialog", { name: "Cement" });
    const choice = within(sheet).getByRole("switch", { name: "The client chooses it (needs their sign-off)" });
    expect(choice).not.toBeChecked();
    await userEvent.click(choice);
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toMatchObject({ action: "save_material", id: "m1", name: "Cement", clientChoice: true }));
  });

  it("opens a sealed document from the Sealed list, with what the client didn't choose", async () => {
    const live: LiveScope = { lines: [], packages: [], currency: "AED", version: 4, canManage: false, members: [], variations: [], caseId: "c1", baselineQuoteId: "q1",
      seals: [{ id: "s1", kind: "baseline", revisionLabel: "R3", quoteNumber: 14, total: "27300.00", currency: "AED", acceptedAt: "2026-09-20T10:00:00Z", acceptedBy: "Maya Rahman" }] };
    const sealed: SealedScope = {
      snapshot: { quote: { id: "q1", number: 14, title: "Main quote", currency: "AED", decimals: 2 }, revisionLabel: "R3",
        lines: [{ id: "a", position: 0, kind: "item", areaId: "k", fromAreaId: null, workPackageId: null, title: "Kitchen cabinets", description: "", unit: "m", quantity: "6.5", rate: "4200", net: "27300.00", total: "27300.00", catalogImageId: null, imageAssetId: null }],
        declinedOptions: [{ id: "d", title: "Wine fridge", total: "3150.00" }], areas: [{ id: "k", name: "Kitchen" }], trades: [],
        pricing: { subtotal: "27300.00", discounts: "0.00", net: "27300.00", tax: "0.00", total: "27300.00", areas: [{ key: "k", net: "27300.00" }] },
        paymentTerms: [], terms: "", exclusions: "", acceptance: { decidedBy: "Maya Rahman", decidedAt: "2026-09-20T10:00:00Z", method: "signed_document", recordedBy: null, note: "" }, agreement: null,
        requirements: [
          { id: "r1", title: "Soft-close drawers", roomName: "Kitchen", priority: "must_have", source: "client", status: "included", note: "", lineIds: ["a"] },
          { id: "r2", title: "Steam room", roomName: null, priority: "optional", source: "client", status: "not_possible", note: "No drainage on this floor", lineIds: [] }] },
      contentHash: "a".repeat(64), sealedAt: "2026-09-22T09:00:00Z", sealedBy: "Omar", intact: true,
    };
    mount((url) => (url.includes("/seals/") ? sealed : url.includes("/scope") ? live : detail()));
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="scope" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("tab", { name: "Sealed" }));
    await userEvent.click(await screen.findByRole("button", { name: /R3 Accepted quotation/ }));
    expect(await screen.findByText("Unchanged")).toBeInTheDocument();
    expect(screen.getByText(/Sealed R3 · accepted by Maya Rahman/)).toBeInTheDocument();
    expect(screen.getByText("Options the client didn't choose")).toBeInTheDocument();
    expect(screen.getByText("Wine fridge")).toBeInTheDocument();
    // What the client asked for, and what became of it.
    await userEvent.click(screen.getByRole("tab", { name: "Requests" }));
    expect(within(screen.getByRole("region", { name: "Included" })).getByText("Covered by Kitchen cabinets")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Not possible" })).getByText("No drainage on this floor")).toBeInTheDocument();
  });

  it("splits a total by percent in whole minor units that always add up", () => {
    const parts = splitByPercent("1000.01", [33.33, 33.33, 33.34], 2);
    expect(parts).toEqual(["333.30", "333.30", "333.41"]);
    expect(parts.reduce((sum, part) => sum + Math.round(Number(part) * 100), 0)).toBe(100001);
    expect(splitByPercent("100", [50, 50], 3)).toEqual(["50.000", "50.000"]);
  });
});

describe("amounts", () => {
  it("adds decimal amounts exactly", async () => {
    const { addAmounts } = await import("./project-scope");
    expect(addAmounts(["0.1000", "0.2000"])).toBe("0.3000");
    expect(addAmounts(["27300.0000", "7770.0000", "-650.5"])).toBe("34419.5000");
    expect(addAmounts([])).toBe("0.0000");
  });
});
