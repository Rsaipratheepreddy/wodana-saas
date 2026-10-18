import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { factoryApi } from "@/lib/factory/client";
import type { FactoryState, WorkOrderState } from "@/lib/factory/types";
import { ToMake } from "./to-make";
import { ReportDialog, ScheduleDialog, SendOutDialog } from "./work-order-dialogs";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/workspace/factory", useSearchParams: () => new URLSearchParams() }));

// §5c D.4: Factory dialogs are one column, label above field, Save at the bottom end. Planning a work order (the one long
// form) splits into Work and Schedule sections. FormRow stays only for a start and its finish.
const sectionTitles = (dialog: HTMLElement) => [...dialog.querySelectorAll(".wd-form-section-title")].map((title) => title.textContent);
const rows = (dialog: HTMLElement) => dialog.querySelectorAll(".wd-form-row").length;
const saveAtTheEnd = (dialog: HTMLElement, name: string) => {
  const actions = dialog.querySelector(".wd-form-footer .wd-dialog-actions");
  expect(actions?.lastElementChild?.textContent).toBe(name);
};

const joinery = { id: "c1", name: "Joinery", hoursPerDay: "8.00", active: true };
const line = { lineId: "l1", projectId: "p1", projectReference: "PRJ-0007", projectName: "Villa 12", packageId: "k1", packageName: "Kitchen joinery", title: "Kitchen cabinets",
  specification: "Oak veneer", unit: "m", quantity: "4.5000", planned: "3.0000", left: "1.5000", suggestedStart: "2099-10-05", suggestedEnd: "2099-10-16" };
const factory = { toMake: [line], orders: [], workcenters: [joinery], batches: [], canManage: true, canReport: true, canApprove: true, canIssue: true } as unknown as FactoryState;
const order = {
  order: { id: "w1", number: 7, projectId: "p1", projectReference: "PRJ-0007", title: "Kitchen cabinets", quantity: "3.0000", unit: "m", status: "planned", workcenterId: "c1",
    plannedStart: "2099-10-05", plannedEnd: "2099-10-16", plannedHours: null, notes: "", drawingRef: "" },
  workcenters: [joinery], suppliers: [{ id: "s1", name: "Nile Marble", approved: true }], designs: [],
} as unknown as WorkOrderState;

describe("Factory form dialogs", () => {
  it("plans a work order in Work and Schedule sections, start and finish side by side", async () => {
    render(<DesignSystemProvider><ToMake api={factoryApi("w")} state={factory} error="" onReload={vi.fn()} onPlanned={vi.fn()} /></DesignSystemProvider>);
    await userEvent.click(await screen.findByText("Kitchen cabinets"));
    const dialog = await screen.findByRole("dialog", { name: "Plan work order" });
    expect(sectionTitles(dialog)).toEqual(["Work", "Schedule"]);
    expect(rows(dialog)).toBe(1);
    expect(within(dialog).queryByText("Left empty: the workcenter's hours a day over its working days.")).not.toBeInTheDocument();
    saveAtTheEnd(dialog, "Plan work order");
  });

  it("schedules a work order in one column, start and finish side by side", async () => {
    render(<DesignSystemProvider><ScheduleDialog state={order} onClose={vi.fn()} onSave={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Where and when" });
    expect(rows(dialog)).toBe(1);
    saveAtTheEnd(dialog, "Save");
  });

  it("reports output in one column", async () => {
    render(<DesignSystemProvider><ReportDialog unit="m" left="3" onClose={vi.fn()} onSave={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Report output" });
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Report output");
  });

  it("sends a step out in one column", async () => {
    render(<DesignSystemProvider><SendOutDialog state={order} onClose={vi.fn()} onSave={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Send a step out" });
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Create service order");
  });

  it("keeps two-column grids out of the Factory form styles", () => {
    const twoColumns = /grid-template-columns:\s*(repeat\(2,|repeat\(auto-fit|1fr 1fr|minmax\(0, ?1fr\) minmax\(0, ?1fr\))/;
    const sheets = readdirSync(__dirname).filter((file) => file.endsWith(".module.css"));
    expect(sheets.length).toBeGreaterThan(0);
    for (const sheet of sheets) {
      const css = readFileSync(join(__dirname, sheet), "utf8");
      expect(css.split("\n").filter((line) => twoColumns.test(line)), sheet).toEqual([]);
    }
  });
});
