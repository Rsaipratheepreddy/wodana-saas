import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { ProjectDetail, ProjectOverview, ProjectStage } from "@/lib/project-core/types";
import { ProjectPage } from "./project-page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/workspace/projects/p3", useSearchParams: () => new URLSearchParams() }));

/**
 * A project the way the owner saw it (PRJ-0003, nine stages, the sixth current, two roles nobody holds, an order
 * late, site reports missing, a handover pack waiting on the client): the Overview says each fact once.
 */
const PID = "5b0f3c1e-2d4a-4f7b-9a61-0d2e8c4b7a03";
const member = (membershipId: string, name: string) => ({ membershipId, name, email: `${membershipId}@example.test` });
const check = (kind: ProjectStage["checks"][number]["kind"], passed: boolean, extra: Partial<ProjectStage["checks"][number]> = {}) =>
  ({ key: `${kind}_1`, kind, passed, confirmedBy: null, confirmedAt: null, note: "", ...extra });
const STAGES: Array<[string, string, string]> = [
  ["kickoff", "Kickoff", "project_manager"], ["measure", "Site measurement", "site_supervisor"], ["drawings", "Technical drawings", "technical_designer"],
  ["materials", "Material sign-off", "designer"], ["production", "Production", "factory_lead"], ["permit", "Permit collection", "installation_lead"],
  ["install", "Delivery and installation", "installation_lead"], ["snags", "Snagging", "site_supervisor"], ["handover", "Handover", "project_manager"],
];
const ROLES = [["project_manager", "Project manager"], ["designer", "Designer"], ["technical_designer", "Technical designer"], ["site_supervisor", "Site supervisor"],
  ["factory_lead", "Factory lead"], ["procurement", "Procurement"], ["accounts", "Accounts"], ["quality", "Quality"], ["installation_lead", "Installation lead"]];
const PEOPLE: Record<string, ReturnType<typeof member> | null> = {
  project_manager: member("m1", "Omar Haddad"), designer: member("m2", "Lina Aziz"), technical_designer: null, site_supervisor: member("m3", "Ravi Menon"),
  factory_lead: member("m4", "Faris Saleh"), procurement: member("m5", "Noor Khan"), accounts: member("m6", "Sara Ali"), quality: member("m7", "Yusuf Omar"), installation_lead: null,
};

const detail = (patch: Partial<ProjectDetail> = {}): ProjectDetail => ({
  project: { id: PID, reference: "PRJ-0003", name: "Arabian Ranches Townhouse 7", clientName: "Hana Farouk", status: "active", priority: "normal", health: "on_track",
    promiseDate: "2099-10-30", currency: "AED", total: "412500.00", startedAt: "2026-08-02T09:00:00Z", caseId: "c3", opportunityId: "o3", opportunityReference: "O-0003",
    holdReason: null, holdReviewOn: null, startDate: "2026-08-02", templateName: "Joinery", version: 9, closedAt: null, closedByName: null, cancelReason: null },
  seal: { revisionLabel: "R2", quoteNumber: 31, acceptedAt: "2026-07-28T10:00:00Z", acceptedBy: "Hana Farouk", method: "signed_document", contentHash: "b".repeat(64), sealedAt: "2026-08-02T09:00:00Z" },
  roles: ROLES.map(([key, label]) => ({ key, label })),
  team: ROLES.map(([role, label]) => ({ role, label, member: PEOPLE[role] })),
  stages: STAGES.map(([key, name, ownerRole], position) => ({
    id: `s${position}`, position, key, name, ownerRole, status: position < 5 ? "done" : position === 5 ? "current" : "upcoming",
    startedAt: position <= 5 ? "2026-08-02T09:00:00Z" : null, completedAt: position < 5 ? `2026-09-${String(10 + position * 4).padStart(2, "0")}T09:00:00Z` : null,
    completedByName: position < 5 ? "Omar Haddad" : null, skipReason: null,
    checks: position === 5 ? [check("installation_scheduled", true), check("permit_collected", false)] : [check("confirm", position < 5, { label: `${name} done` })],
    ready: false, owner: PEOPLE[ownerRole], canWork: position === 5,
  })),
  next: { stage: "Permit collection", kind: "permit_collected", text: "Building permit collected", role: "installation_lead", owner: null },
  updates: [], members: Object.values(PEOPLE).filter((person): person is ReturnType<typeof member> => Boolean(person)),
  canManage: true, canClose: true, canSeeMoney: false, progress: 56,
  installation: { deliveryOn: "2099-10-20", installationOn: "2099-10-22", note: "", setByName: "Omar Haddad", setAt: "2026-10-01T09:00:00Z", delivery: "booked", installation: "not_started",
    siteStartedOn: null, siteFinishedOn: null, inRoute: true, late: false,
    permit: { required: true, valid: false, validTo: null, collectOn: "2099-10-15", plannedId: "pm1", collected: false } },
  canScheduleInstallation: true,
  ...patch,
});

const activity = (count: number) => Array.from({ length: count }, (_, index) => ({
  id: `a${index}`, at: `2026-10-0${9 - index}T08:00:00Z`, action: "work.create", source: "user", actor: "Omar Haddad", subject: `#${40 + index} Fix hinge ${index + 1}`, detail: {},
}));
const overview = (patch: Partial<ProjectOverview> = {}): ProjectOverview => ({
  today: "2026-10-10", work: { open: 4, late: 0, blocked: 0, ready: 2, openSnags: 0, criticalSnags: 0, clientRequests: 0 },
  // In the order the server sends them.
  blockers: [
    { key: "late_orders", count: 1, items: ["IGOLO-PO-0012 · Gulf Joinery Supplies"], href: "/workspace/purchasing/orders?order=po12" },
    { key: "reports_missing", count: 2, items: ["2099-10-07", "2099-10-08"], href: `/workspace/projects/${PID}/site` },
    { key: "client_decisions", count: 1, items: ["Handover pack (R1)"], href: `/workspace/projects/${PID}/handover` },
  ],
  decisions: [], stagePlan: { s5: { start: "2026-10-01", end: "2099-10-15", open: 1, total: 3 } },
  dates: { start: "2026-08-02", promise: "2099-10-30", planEnd: "2099-10-28", siteStarted: "2026-09-20", siteFinished: null },
  money: { currency: "AED", agreed: "412500.00", invoiced: "371250.00", received: "371250.00", due: "41250.00", toInvoice: 1, next: null, spent: null, committed: null, available: null, costCurrency: null },
  activity: activity(5),
  siteReports: [1, 2, 3].map((index) => ({ id: `r${index}`, date: `2099-10-0${9 - index}`, status: "approved", byName: "Ravi Menon", text: `Kitchen carcasses fixed, day ${index}` })),
  health: { health: "at_risk", stated: "on_track", reasons: [{ key: "late_orders", count: 1 }] },
  contacts: { client: { phone: "+971501112233", email: "hana@example.test" }, sales: null },
  workforce: { date: "2099-10-08", people: 4, trades: [{ trade: "Carpenters", people: 3 }, { trade: "Helpers", people: 1 }] },
  ...patch,
});

const open = async (project: ProjectDetail = detail(), read: ProjectOverview = overview()) => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (url.includes("/overview") ? read
    : url.includes("/api/logistics/options") ? { projects: [], workOrders: [], workers: [], crews: [], vehicles: [], canBook: false, canAddPeople: false, permitWarningDays: 3 } : project) })));
  const view = render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="overview" /></DesignSystemProvider>);
  await screen.findByRole("region", { name: "Needs attention" }, { timeout: 5000 });
  return view;
};
/** Elements whose own text is exactly this (not their parents'). */
const exactly = (text: string) => screen.queryAllByText((_, element) => element?.textContent === text && ![...element.children].some((child) => child.textContent === text));

describe("project overview, each fact once", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the key numbers as KPI tiles, each opening its section, and the health once, on the header", async () => {
    await open();
    const strip = screen.getByLabelText("Where the project stands");
    const terms = within(strip).getAllByRole("term").map((term) => term.textContent);
    expect(terms).toEqual(["Stage", "Handover", "Progress", "Paid", "Needs attention"]);
    const tile = (label: string) => within(strip).getByText(label, { selector: "dt" }).closest(".wd-kpi-tile")!;
    expect(tile("Stage")).toHaveTextContent("Permit collectionStage 6 of 9");
    // The stage tile opens the Stages sub-tab.
    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    await userEvent.click(within(tile("Stage") as HTMLElement).getByRole("button"));
    expect(screen.getByRole("tab", { name: "Stages" })).toHaveAttribute("aria-selected", "true");
    expect(tile("Progress")).toHaveTextContent("56% done");
    expect(tile("Paid")).toHaveTextContent("90%");
    // Four things wait (1 late order, 2 missing reports, 1 client decision); a late order makes it danger.
    expect(tile("Needs attention")).toHaveTextContent("4");
    expect(tile("Needs attention")).toHaveAttribute("data-tone", "danger");
    expect(within(tile("Needs attention") as HTMLElement).getByRole("link")).toHaveAttribute("href", "#project-attention");
    expect(screen.getByRole("region", { name: "Needs attention" })).toHaveAttribute("id", "project-attention");
    // Health is the header's badge; why is the attention list, not the strip.
    expect(screen.getByRole("heading", { level: 1, name: "Arabian Ranches Townhouse 7" }).closest("header")).toHaveTextContent("At risk");
    expect(screen.getAllByText("At risk")).toHaveLength(1);
    expect(strip).not.toHaveTextContent(/order late|Tasks|Health/);
    // The share paid is on the strip, so the money section shows the amounts only.
    expect(screen.queryByText("90% paid")).toBeNull();
    expect(within(screen.getByRole("region", { name: "Money" })).getByText("Received")).toBeInTheDocument();
    // The handover date is on the strip, so key dates don't repeat it.
    expect(within(screen.getByRole("region", { name: "Key dates" })).queryByText("Handover")).toBeNull();
  });

  it("names the stage once and keeps the next step to its one action, without the stage or the unnamed owner", async () => {
    await open();
    expect(within(screen.getByLabelText("Where the project stands")).getAllByText("Permit collection")).toHaveLength(1);
    const card = screen.getByRole("heading", { level: 3, name: "Collect the building permit" }).closest("section")!;
    // The card is headed as the next step, apart from the history.
    // §0.3 P10: the job's step now is the Now bar above; this card is the stage's own checks.
    expect(within(card).getByText("This stage")).toBeInTheDocument();
    expect(card).not.toHaveTextContent(/6 of 9|Permit collection|not named/);
    expect(within(card).getByRole("button", { name: "Record the building permit" })).toBeInTheDocument();
    // The same action isn't offered again in the sidebar.
    expect(screen.getAllByRole("button", { name: "Record the building permit" })).toHaveLength(1);
  });

  it("lists the roles nobody holds once, on the team, with the way to name someone", async () => {
    await open();
    expect(screen.getAllByText(/not named/i).map((element) => element.textContent)).toEqual(["Not named: Technical designer, Installation lead"]);
    const team = screen.getByRole("region", { name: "Team" });
    const people = within(team).getByRole("list", { name: "Team" });
    // Compact: avatar, name and role; the ways to reach someone come up on hover or focus.
    expect(people).toHaveAttribute("data-compact");
    expect(within(people).getByRole("link", { name: "Call Hana Farouk" })).toHaveAttribute("href", "tel:+971501112233");
    expect(within(people).getByText("Omar Haddad")).toBeInTheDocument();
    expect(within(team).getByText("4 workers on site")).toBeInTheDocument();
    expect(within(team).getByRole("button", { name: "Name someone" })).toBeInTheDocument();
  });

  it("doesn't offer Name someone twice when naming the role is the next step", async () => {
    const project = detail();
    const stages = project.stages.map((stage) => stage.position === 5 ? { ...stage, checks: [check("role_assigned", false, { role: "installation_lead" }), check("permit_collected", false)] } : stage);
    await open({ ...project, stages, next: { stage: "Permit collection", kind: "role_assigned", text: "Installation lead named", role: "installation_lead", owner: null } });
    expect(screen.getAllByRole("button", { name: "Name someone" })).toHaveLength(1);
    expect(within(screen.getByRole("region", { name: "Team" })).queryByRole("button", { name: "Name someone" })).toBeNull();
  });

  it("puts what needs attention in one list, most severe first, each row linked to where it's fixed", async () => {
    await open();
    const list = within(screen.getByRole("region", { name: "Needs attention" })).getByRole("list");
    const rows = within(list).getAllByRole("link");
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "1 order late · IGOLO-PO-0012 · Gulf Joinery Supplies",
      "1 waiting on the client · Handover pack (R1)",
      expect.stringMatching(/^2 site reports missing · .*7.* · .*8/),
    ]);
    expect(rows[0]).toHaveAttribute("href", "/workspace/purchasing/orders?order=po12");
    expect(rows[1]).toHaveAttribute("href", `/workspace/projects/${PID}/handover`);
    // The health reason is the first row, not a second line elsewhere.
    expect(screen.queryByText("1 order late")).toBeNull();
  });

  it("adds what the health stands on that no blocker shows, and orders danger before waiting", async () => {
    const read = overview({
      blockers: [
        { key: "late_work", count: 2, items: ["#41 Fit doors", "#42 Fix plinth"], href: `/workspace/projects/${PID}/plan?filter=late` },
        { key: "materials_not_in", count: 1, items: ["#43 Worktop"], href: `/workspace/projects/${PID}/plan?filter=materials` },
        { key: "late_orders", count: 1, items: ["IGOLO-PO-0012 · Gulf Joinery Supplies"], href: "/workspace/purchasing/orders?order=po12" },
        { key: "reports_missing", count: 1, items: ["2099-10-08"], href: `/workspace/projects/${PID}/site` },
        { key: "client_decisions", count: 1, items: ["Handover pack (R1)"], href: `/workspace/projects/${PID}/handover` },
        { key: "critical_snags", count: 1, items: ["#44 Cracked worktop"], href: `/workspace/projects/${PID}/plan?filter=snags` },
        { key: "funds_short", count: 1, items: ["AED 1,200.00"], href: `/workspace/projects/${PID}/money` },
      ],
      health: { health: "off_track", stated: "off_track", reasons: [{ key: "stated" }, { key: "plan_after_handover", days: 4 }, { key: "late_work", count: 2 }, { key: "late_orders", count: 1 }, { key: "critical_snags", count: 1 }] },
    });
    const project = detail({ updates: [{ id: "u1", health: "off_track", note: "Client delayed the kitchen approval", byName: "Omar Haddad", at: "2026-10-09T08:00:00Z", kind: "status" }] });
    await open(project, read);
    const list = within(screen.getByRole("region", { name: "Needs attention" })).getByRole("list");
    expect(within(list).getAllByRole("listitem").map((row) => row.getAttribute("data-key"))).toEqual([
      "critical_snags", "funds_short", "plan_after_handover", "late_orders", "late_work", "stated", "materials_not_in", "client_decisions", "reports_missing",
    ]);
    expect(within(list).getByRole("link", { name: "The plan ends 4 days after the handover" })).toHaveAttribute("href", `/workspace/projects/${PID}/plan`);
    expect(within(list).getByRole("link", { name: "Set by the project manager · Client delayed the kitchen approval" })).toHaveAttribute("href", `/workspace/projects/${PID}/updates`);
    expect(within(list).getAllByRole("listitem").slice(0, 6).every((row) => row.getAttribute("data-tone") === "danger")).toBe(true);
    // Shown once: as a row here, not also as a red date under key dates.
    const planEnds = within(screen.getByRole("region", { name: "Key dates" })).getByText("Plan ends").nextElementSibling!;
    expect(planEnds).not.toHaveAttribute("data-tone");
  });

  it("shows every stage as a step in the first sub-tab (done, now, to come), without a progress bar or per-stage owner lines", async () => {
    const { container } = await open();
    expect(container.querySelector('ol[aria-hidden="true"]')).toBeNull();
    // The long lists are sub-tabs under the next step; the small facts stay cards beside them.
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent).filter((name) => ["Stages", "Site updates", "History"].includes(name ?? ""))).toEqual(["Stages", "Site updates", "History"]);
    const section = screen.getByRole("tabpanel", { name: "Stages" });
    const stages = within(section).getByRole("list", { name: "Stages" });
    expect(stages.closest("[data-layout]")).toHaveAttribute("data-layout", "list");
    const items = within(stages).getAllByRole("listitem");
    expect(items).toHaveLength(9);
    expect(items.map((item) => item.getAttribute("data-state"))).toEqual(["done", "done", "done", "done", "done", "current", "upcoming", "upcoming", "upcoming"]);
    // Whole names (a long one keeps its full name as its tooltip), the current stage marked, no "not named" lines.
    const label = within(items[6]).getByText("Delivery and installation");
    expect(label).toHaveAttribute("title", "Delivery and installation");
    expect(items[5]).toHaveAttribute("aria-current", "step");
    expect(stages).not.toHaveTextContent(/not named/i);
  });

  it("shows delivery, installation and the permit as state chips, each with its icon", async () => {
    await open();
    const section = screen.getByRole("region", { name: "Delivery and installation" });
    const chip = (text: string) => within(section).getByText(text).closest(".wd-badge")!;
    expect(chip("Booked")).toHaveAttribute("data-state", "in_progress");
    expect(chip("Not started")).toHaveAttribute("data-state", "upcoming");
    expect(chip("Missing")).toHaveAttribute("data-state", "missing");
    expect(chip("Missing").querySelector("svg")).not.toBeNull();
  });

  it("keeps the latest three site updates, the rest a click away, and the project's History, each in its sub-tab", async () => {
    await open();
    await userEvent.click(screen.getByRole("tab", { name: "Site updates" }));
    const site = screen.getByRole("tabpanel", { name: "Site updates" });
    expect(within(site).getAllByRole("listitem")).toHaveLength(3);
    expect(within(site).getByRole("link", { name: "View all" })).toHaveAttribute("href", `/workspace/projects/${PID}/site`);
    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByRole("tabpanel", { name: "History" })).toBeInTheDocument();
  });

  it("wraps stage names only between words and lays the overview out with logical properties (LTR and RTL)", () => {
    const parts = readFileSync(join(__dirname, "../record/record-parts.module.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(parts).not.toMatch(/hyphens:\s*auto/);
    for (const rule of parts.match(/\.stepLabel \{[^}]*\}/g)!.filter((body) => body.includes("text-xs"))) expect(rule).toMatch(/overflow-wrap: normal/);
    for (const sheet of ["project-overview.module.css", "../record/record-parts.module.css", "../record/record.module.css"]) {
      const css = readFileSync(join(__dirname, sheet), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css, sheet).not.toMatch(/(^|[\s;{])(margin|padding|border)-(left|right)\s*:|(^|[\s;{])(left|right)\s*:|text-align:\s*(left|right)/);
    }
  });
});
