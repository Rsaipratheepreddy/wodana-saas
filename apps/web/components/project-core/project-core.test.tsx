import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { LiveScope, ProjectDetail, ProjectRow, SealedScope, StartState } from "@/lib/project-core/types";
import { ProjectPage } from "./project-page";
import { splitByPercent } from "./sealed-document";
import { ProjectsPage } from "./projects-page";
import { StartProjectDialog } from "./start-project-dialog";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/workspace/projects/p1" }));

const PID = "0c6b0c7e-4c4d-4a9e-9d64-3b6f0f2d7a11";
const detail = (patch: Partial<ProjectDetail["project"]> = {}, stages?: ProjectDetail["stages"]): ProjectDetail => ({
  project: { id: PID, reference: "PRJ-0007", name: "Villa 12", clientName: "Maya Rahman", status: "active", priority: "normal", health: "on_track", promiseDate: "2099-12-12",
    currency: "AED", total: "412500.00", startedAt: "2026-09-22T09:00:00Z", caseId: "c1", opportunityId: "o1", opportunityReference: "O-1", holdReason: null, holdReviewOn: null,
    startDate: null, templateName: "Standard", version: 4, ...patch },
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
  updates: [], members: [{ membershipId: "m1", name: "Omar Haddad" }, { membershipId: "m2", name: "Dana Karim" }], canManage: true,
});
const mount = (respond: (url: string, body: Record<string, unknown> | undefined) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const value = respond(url, typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
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
    await userEvent.click(screen.getByRole("radio", { name: "On hold" }));
    expect(await screen.findByText("Marina Penthouse")).toBeInTheDocument();
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
    const finish = await screen.findByRole("button", { name: "Finish Kickoff" });
    expect(finish).toBeDisabled();
    // Read from the records, never ticked by hand.
    expect(screen.getByText("Project manager named")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Kickoff meeting held" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Finish Kickoff" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Finish Kickoff" }));
    await waitFor(() => expect(posts(fetcher).map((post) => [post.action, post.version])).toEqual([["confirm_check", 4], ["complete_stage", 5]]));
    expect(posts(fetcher)[0]).toMatchObject({ stageId: "s0", checkKey: "meeting" });
  });

  it("shows why a change was refused and reloads when someone else changed the project", async () => {
    let loads = 0;
    mount((url, body) => (body ? new Error("Someone else changed this project. Reload to see their changes.") : (loads++, detail())));
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

  it("lists variations and starts a new one on the accepted quotation, opening it in the project", async () => {
    const live: LiveScope = { lines: [], packages: [], seals: [], currency: "AED", version: 4, canManage: true, members: [], caseId: "c1", baselineQuoteId: "q1",
      variations: [{ id: "v1", number: 3, title: "Additional work", status: "accepted", total: "350.00", appliedAs: "VO-1" }] };
    const fetcher = mount((url, body) => {
      if (url.startsWith("/api/commercial/cases/c1")) return body ? { data: { revision: 8, quotes: [{ id: "q1", number: 1, kind: "quotation" }, { id: "v1", number: 3, kind: "variation" }, { id: "v2", number: 4, kind: "variation" }] } } : { data: { revision: 7, quotes: [] } };
      return url.includes("/scope") ? live : detail();
    });
    render(<DesignSystemProvider><ProjectPage workspaceId="w" projectId={PID} section="scope" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("tab", { name: "Changes" }));
    expect(await screen.findByRole("button", { name: /VO-1 Additional work/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New variation" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/workspace/projects/${PID}/changes/v2`));
    expect(posts(fetcher)).toEqual([{ action: "variation", revision: 7, quoteId: "q1" }]);
  });

  it("opens a sealed document from the Sealed list, with what the client didn't choose", async () => {
    const live: LiveScope = { lines: [], packages: [], currency: "AED", version: 4, canManage: false, members: [], variations: [], caseId: "c1", baselineQuoteId: "q1",
      seals: [{ id: "s1", kind: "baseline", revisionLabel: "R3", quoteNumber: 14, total: "27300.00", currency: "AED", acceptedAt: "2026-09-20T10:00:00Z", acceptedBy: "Maya Rahman" }] };
    const sealed: SealedScope = {
      snapshot: { quote: { id: "q1", number: 14, title: "Main quote", currency: "AED", decimals: 2 }, revisionLabel: "R3",
        lines: [{ id: "a", position: 0, kind: "item", areaId: "k", fromAreaId: null, workPackageId: null, title: "Kitchen cabinets", description: "", unit: "m", quantity: "6.5", rate: "4200", net: "27300.00", total: "27300.00", catalogImageId: null, imageAssetId: null }],
        declinedOptions: [{ id: "d", title: "Wine fridge", total: "3150.00" }], areas: [{ id: "k", name: "Kitchen" }], trades: [],
        pricing: { subtotal: "27300.00", discounts: "0.00", net: "27300.00", tax: "0.00", total: "27300.00", areas: [{ key: "k", net: "27300.00" }] },
        paymentTerms: [], terms: "", exclusions: "", acceptance: { decidedBy: "Maya Rahman", decidedAt: "2026-09-20T10:00:00Z", method: "signed_document", recordedBy: null, note: "" }, agreement: null },
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
