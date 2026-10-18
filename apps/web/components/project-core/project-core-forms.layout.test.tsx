import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { LabourRates, WorkBoard } from "@/lib/project-core/types";
import { LabourRatesSection } from "./labour-rates";
import { DatesDialog } from "./project-dialogs";
import { ProjectMaterials } from "./project-materials";
import { ProjectPlan } from "./project-plan";

// §5c D.4: project forms are one column, label above field, titled sections when there are more than about five fields,
// Save at the bottom end. Two fields share a row only when they are one thing: a start and its end, a quantity and its unit.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/workspace/projects/p1/plan", useSearchParams: () => new URLSearchParams() }));
afterEach(() => { vi.unstubAllGlobals(); });

const sectionTitles = (dialog: HTMLElement) => [...dialog.querySelectorAll(".wd-form-section-title")].map((title) => title.textContent);
const rows = (dialog: HTMLElement) => dialog.querySelectorAll(".wd-form-row").length;
const saveAtTheEnd = (dialog: HTMLElement, name: string) => {
  const actions = dialog.querySelector(".wd-form-footer .wd-dialog-actions") ?? dialog.querySelector(".wd-dialog-actions");
  expect(actions?.lastElementChild?.textContent).toBe(name);
};
const respond = (value: unknown) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => value })));

const board = (): WorkBoard => ({
  items: [], packages: [{ id: "k1", name: "Kitchen joinery", supply: "make", planned: false }], stages: [], lines: [],
  people: [{ membershipId: "m1", name: "Omar Haddad" }], me: "m1", canEdit: true, canManage: true, item: null,
  calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [] }, promiseDate: "2099-12-01", startDate: null, baseline: null, sprints: [], critical: { finish: null, float: {} },
  progress: { project: 0, packages: {} }, materials: {}, areas: [], aftercare: false,
});
const material = { id: "m1", name: "Oak veneer", code: "", supplier: "", specification: "Natural", usedIn: [], boqLineIds: [], clientChoice: true, decision: null, quantity: null, unit: "", note: "" };

describe("Project form dialogs", () => {
  it("adds a task in one column", async () => {
    respond(board());
    render(<DesignSystemProvider><ProjectPlan workspaceId="w" projectId="p1" /></DesignSystemProvider>);
    await userEvent.click((await screen.findAllByRole("button", { name: "New task" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "New task" });
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Save");
  });

  it("edits a material in Details, Supply and Usage sections, quantity beside its unit", async () => {
    respond({ state: "draft", items: [], revisions: [], version: 1, canEdit: true });
    render(<DesignSystemProvider><ProjectMaterials workspaceId="w" projectId="p1" version={1} run={vi.fn()} lines={[]} /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Add material" }));
    const sheet = await screen.findByRole("dialog", { name: "New material" });
    // Details holds brand, colour, size and finish (and the sample photo once the material is on a case).
    expect(sectionTitles(sheet)).toEqual(["Details", "Supply", "Usage"]);
    for (const name of ["Brand", "Colour", "Size", "Finish"]) expect(within(sheet).getByRole("textbox", { name })).toBeInTheDocument();
    expect(rows(sheet)).toBe(0);
    expect(within(sheet).getByRole("textbox", { name: "Quantity" }).closest("[class*=quantityUnit]")).toContainElement(within(sheet).getByRole("textbox", { name: "Unit" }));
    saveAtTheEnd(sheet, "Save");
  });

  it("records the client's material decision in Materials and Client decision sections", async () => {
    respond({ state: "sent", items: [material], revisions: [{ number: 1, sentAt: "2026-09-20T10:00:00Z" }], version: 1, canEdit: true });
    render(<DesignSystemProvider><ProjectMaterials workspaceId="w" projectId="p1" version={1} run={vi.fn()} lines={[]} /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Record the client's decision" }));
    const dialog = await screen.findByRole("dialog", { name: "Record the client's decision" });
    expect(sectionTitles(dialog)).toEqual(["Materials", "Client decision"]);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Save");
  });

  it("sets a trade's day rate in one column", async () => {
    const rates: LabourRates = { currency: "USD", today: "2026-09-27", canManage: true, trades: [{ key: "painters", name: "Painters", reports: 1, rates: [] }] };
    respond(rates);
    render(<DesignSystemProvider><LabourRatesSection workspaceId="w" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Set rate" }));
    const dialog = await screen.findByRole("dialog", { name: "Painters" });
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Save");
  });

  it("keeps the start and handover dates side by side", async () => {
    render(<DesignSystemProvider><DatesDialog startDate="2026-10-01" promiseDate="2026-12-01" onClose={vi.fn()} onSave={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Dates" });
    expect(rows(dialog)).toBe(1);
    saveAtTheEnd(dialog, "Save");
  });

  it("keeps two-column grids out of the project form styles, except coupled fields and read-only displays", () => {
    const twoColumns = /grid-template-columns:\s*(repeat\(2,|repeat\(auto-fit|1fr 1fr|minmax\(0, ?1fr\) minmax\(0, ?1fr\))/;
    const allowed: Record<string, RegExp> = {
      // A material's quantity and its unit; each dimension of the technical measure on a phone (a line table, not a form).
      "project-core.module.css": /^\.(quantityUnit|measureRow)$/,
      // KPI tiles and the before/after snag photos.
      "work.module.css": /^\.(kpis|snagPhotos)$/,
      // Each standard task's row in the task list editor (a line table, not a form).
      "project-settings.module.css": /^\.taskDetails$/,
      // Read-only money facts.
      "project-money.module.css": /^\.facts$/,
      "project-money-summary.module.css": /^\.facts$/,
      // The overview's at-a-glance panels and blocker cards.
      "project-overview.module.css": /^\.(glance|blockers ul)$/,
    };
    for (const sheet of readdirSync(__dirname).filter((name) => name.endsWith(".module.css"))) {
      const css = readFileSync(join(__dirname, sheet), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const offenders = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, , body]) => twoColumns.test(body))
        .map(([, selector]) => selector.trim())
        .filter((selector) => !allowed[sheet]?.test(selector));
      expect(offenders, sheet).toEqual([]);
    }
  });
});
