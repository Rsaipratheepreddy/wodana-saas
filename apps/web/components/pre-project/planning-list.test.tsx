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
  it("has one title, one primary action and a grid with stage, owner, value and next step", () => {
    render(<PlanningList projects={[]} planning={list([planning])} />);
    expect(screen.getByRole("heading", { level: 1, name: "Planning" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Start planning" })).toHaveLength(1);
    const grid = screen.getByRole("table", { name: "Planning" });
    expect(within(grid).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(expect.arrayContaining(["Case", "Client", "Stage", "Owner", "Value", "Next step"]));
    expect(within(grid).getByRole("link", { name: "Villa interiors" })).toHaveAttribute("href", "/workspace/pre-projects/cases/case-1/requirements");
    expect(within(grid).getByText("Present the design")).toBeVisible();
    expect(within(grid).getByText(/48,000/)).toBeVisible();
  });

  it("filters by planning stage and status, and says when nothing matches", async () => {
    const paid = { ...project, id: "project-2", caseId: "case-2", workflow: { templateCode: "design_build_deal_first", currentStageKey: "concept", currentStageName: "Concept" } };
    render(<PlanningList projects={[paid]} planning={list([planning, { ...planning, id: "case-3", title: "Paused office", status: "on_hold" } as PreProjectListItem])} workflow={workflow} servicePathEnabled />);
    await userEvent.click(screen.getByRole("radio", { name: "In design" }));
    expect(screen.getByText("PRJ-0007")).toBeVisible();
    expect(screen.queryByText("Paused office")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Before deal" }));
    expect(screen.getByText("Paused office")).toBeVisible();
    expect(screen.getByText("On hold", { selector: ".wd-badge, [class*='badge'], span" })).toBeVisible();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search planning" }), "nothing like this");
    await userEvent.click(await screen.findByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("PRJ-0007")).toBeVisible();
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
