import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreProjectListItem } from "@/lib/pre-project/types";
import type { PortfolioRow } from "@/components/projects/project-portfolio";
import { PlanningList, planningRows, type WorkflowPhases } from "./planning-list";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
beforeEach(() => push.mockReset());
afterEach(() => vi.unstubAllGlobals());

const planning = { id: "case-1", title: "Villa interiors", customerName: "Amira", status: "active", phase: "design", leadManagerName: "Owner", amount: "48000.00", currencyCode: "AED" } as PreProjectListItem;
const project = { id: "project-1", caseId: "case-1", name: "Villa interiors", customer: "Amira", phase: "active", manager: "Owner", onHold: false, nextAction: "", reference: "PRJ-0007" } as PortfolioRow;
/** A deal-first route: design stages are planning, procurement onwards is delivery (from the workflow template). */
const workflow: WorkflowPhases = { design_build_deal_first: { site_visit: "planning", concept: "planning", procurement: "active", installation: "active" } };
const list = (items: PreProjectListItem[], extra: Partial<{ canCreate: boolean; canStartLead: boolean }> = {}) => ({ workspaceId: "workspace", items, total: items.length, canCreate: true, ...extra });

describe("Planning rows (D-31)", () => {
  it("lists cases with their stage, next step, owner and value, and leaves released projects out", () => {
    expect(planningRows([], [planning])).toEqual([expect.objectContaining({ title: "Villa interiors", stage: "Design", next: "Present the design", owner: "Owner", amount: "48000.00", currency: "AED",
      group: "before_deal", href: "/workspace/pre-projects/cases/case-1/requirements" })]);
    expect(planningRows([project], [planning])).toEqual([]);
    expect(planningRows([{ ...project, phase: "planning" }], [planning])).toEqual([expect.objectContaining({ stage: "Execution planning", href: "/workspace/pre-projects/cases/case-1/overview", amount: "48000.00" })]);
  });

  it("moves a case on once its quotation is sent: the next step waits for the client, not Send the quotation", () => {
    const sent = { ...planning, phase: "price", commercial: { data: { quotes: [{ id: "q1", number: 1, kind: "quotation", round: "main", status: "issued" }], agreement: null },
      quoteReferences: { q1: "PLM-QUO-2026-00001" } } } as PreProjectListItem;
    expect(planningRows([], [sent])).toEqual([expect.objectContaining({ stage: "Quotation", next: "Waiting for the client's decision" })]);
    render(<PlanningList projects={[]} planning={list([sent])} />);
    expect(within(screen.getByRole("table", { name: "Planning" })).getByText("Waiting for the client's decision")).toBeVisible();
    expect(screen.queryByText("Send the quotation")).not.toBeInTheDocument();
  });

  it("opens the planning case, never the project, when a project in planning has one; otherwise its plan", () => {
    const inPlanning = { ...project, phase: "planning" as const };
    expect(planningRows([inPlanning], [planning], {}, true)[0].href).toBe("/workspace/pre-projects/cases/case-1/overview");
    expect(planningRows([{ ...inPlanning, caseId: "" }], [], {}, true)[0].href).toMatch(/^\/workspace\/projects\/[^/]+\/plan\?/);
  });

  it("reads a project's stage from its workflow template, not a list of stage keys", () => {
    const paid = { ...project, workflow: { templateCode: "design_build_deal_first", currentStageKey: "site_visit", currentStageName: "Site visit & scope" }, nextAction: "Book the site visit" };
    expect(planningRows([paid], [planning], workflow, true)).toEqual([expect.objectContaining({ group: "in_design", stage: "Site visit & scope", next: "Book the site visit", reference: "PRJ-0007" })]);
    expect(planningRows([{ ...paid, workflow: { ...paid.workflow, currentStageKey: "procurement", currentStageName: "Procurement" } }], [planning], workflow, true)).toEqual([]);
    // A firm that renamed or added stages still works: the phase comes from its own template.
    expect(planningRows([{ ...paid, workflow: { templateCode: "our_route", currentStageKey: "moodboard", currentStageName: "Moodboard" } }], [], { our_route: { moodboard: "planning" } }, true))
      .toEqual([expect.objectContaining({ stage: "Moodboard" })]);
  });

  it("puts qualified enquiries first to start, and before-deal cases in their own group", () => {
    const qualified = { ...planning, id: "lead-1", qualifiedLead: true, status: "qualified", opportunityId: "deal-1" } as PreProjectListItem;
    const [row] = planningRows([], [qualified], {}, true);
    expect(row).toMatchObject({ group: "ready", stage: "Ready to start", next: "Start planning" });
    // No case yet: opening it makes the case.
    expect(row.href).toBeUndefined();
    expect(planningRows([], [planning], {}, true)).toEqual([expect.objectContaining({ group: "before_deal", stage: "Before deal" })]);
  });
});

describe("Planning list", () => {
  it("has one title, one primary action and a compact grid: case with client on a muted line, stage, next step, owner and value", () => {
    render(<PlanningList projects={[]} planning={list([planning])} />);
    expect(screen.getByRole("heading", { level: 1, name: "Planning" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Start planning" })).toHaveLength(1);
    const grid = screen.getByRole("table", { name: "Planning" });
    expect(within(grid).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Case", "Stage", "Next step", "Owner", "Value"]);
    expect(within(grid).getByRole("link", { name: "Villa interiors" })).toHaveAttribute("href", "/workspace/pre-projects/cases/case-1/requirements");
    expect(within(grid).getByText("Present the design")).toBeVisible();
    expect(within(grid).getByText(/48,000/)).toBeVisible();
  });

  it("renders the case cell without a control inside another, so the list hydrates cleanly (M1)", () => {
    const qualified = { ...planning, id: "lead-1", title: "Qualified lead", qualifiedLead: true, status: "qualified", opportunityId: "deal-1" } as PreProjectListItem;
    const { container } = render(<PlanningList projects={[]} planning={list([planning, qualified])} />);
    expect(container.querySelector("button button, button a, a button")).toBeNull();
    expect(screen.getByRole("link", { name: "Villa interiors" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Qualified lead" })).toBeEnabled();
  });

  it("opens the case with one click on its name: the link navigates and the row does not open it a second time (D7)", async () => {
    render(<PlanningList projects={[]} planning={list([planning])} />);
    const link = screen.getByRole("link", { name: "Villa interiors" });
    let prevented: boolean | null = null;
    const watch = (event: MouseEvent) => { prevented = event.defaultPrevented; event.preventDefault(); };
    document.addEventListener("click", watch);
    try { await userEvent.click(link); } finally { document.removeEventListener("click", watch); }
    // Nothing in the grid cancels the link's own navigation, and the row action is not fired as well.
    expect(prevented).toBe(false);
    expect(push).not.toHaveBeenCalled();
    // Anywhere else on the row opens the same case, once.
    await userEvent.click(screen.getByText("Present the design"));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/workspace/pre-projects/cases/case-1/requirements");
  });

  it("filters by planning stage and status, and says when nothing matches", async () => {
    const paid = { ...project, id: "project-2", caseId: "case-2", workflow: { templateCode: "design_build_deal_first", currentStageKey: "concept", currentStageName: "Concept" } };
    render(<PlanningList projects={[paid]} planning={list([planning, { ...planning, id: "case-3", title: "Paused office", status: "on_hold" } as PreProjectListItem])} workflow={workflow} servicePathEnabled />);
    await userEvent.click(screen.getByRole("button", { name: "In design" }));
    expect(screen.getByText(/PRJ-0007/)).toBeVisible();
    expect(screen.queryByText("Paused office")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Before deal" }));
    expect(screen.getByText("Paused office")).toBeVisible();
    expect(screen.getByText("On hold", { selector: ".wd-badge, [class*='badge'], span" })).toBeVisible();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search planning" }), "nothing like this");
    await userEvent.click(await screen.findByRole("button", { name: "Clear filters" }));
    expect(screen.getByText(/PRJ-0007/)).toBeVisible();
  });

  it("keeps the toolbar slim: status is a filter that shows as a removable chip only while used", async () => {
    render(<PlanningList projects={[]} planning={list([planning, { ...planning, id: "case-3", title: "Paused office", status: "on_hold" } as PreProjectListItem])} />);
    expect(screen.queryByRole("group", { name: "Filters in use" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
    await userEvent.click(screen.getByRole("button", { name: /Filter by status/ }));
    await userEvent.click(screen.getByRole("option", { name: "On hold" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(within(screen.getByRole("group", { name: "Filters in use" })).getByText("On hold")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Villa interiors" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove filter Status" }));
    expect(screen.getByRole("link", { name: "Villa interiors" })).toBeVisible();
  });

  it("opens a qualified enquiry's case the first time it's opened", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "saved-case" }) });
    vi.stubGlobal("fetch", fetcher);
    render(<PlanningList projects={[]} planning={list([{ ...planning, qualifiedLead: true, status: "qualified", opportunityId: "deal-1" } as PreProjectListItem])} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Villa interiors" })[0]);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/workspace/pre-projects/cases/saved-case/requirements"));
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ opportunityId: "deal-1" });
  });

  it("starts planning from an eligible opportunity at Requirements", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: "opportunity-1", title: "Villa fitout", customerName: "Amira", status: "open", caseId: null }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "new-case" }) });
    vi.stubGlobal("fetch", fetcher);
    render(<PlanningList projects={[]} planning={list([])} />);
    expect(screen.getByText("Nothing in planning yet")).toBeVisible();
    await userEvent.click(screen.getAllByRole("button", { name: "Start planning" })[0]);
    expect(await screen.findByRole("dialog", { name: "Start planning" })).toBeVisible();
    await userEvent.click(await screen.findByRole("button", { name: "Choose an opportunity Opportunity" }));
    await userEvent.click(screen.getByRole("option", { name: "Villa fitout · Amira" }));
    await userEvent.click(screen.getByRole("button", { name: "Start with requirements" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/workspace/pre-projects/cases/new-case/overview"));
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ opportunityId: "opportunity-1" });
  });

  it("explains missing permissions without pretending creation succeeded", async () => {
    render(<PlanningList projects={[]} planning={list([], { canCreate: false })} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Start planning" })[0]);
    expect(screen.getByText(/needs Planning create and Opportunities view permissions/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Start with requirements" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New enquiry" })).toHaveAttribute("href", "/workspace/crm/leads?create=true");
  });
});
