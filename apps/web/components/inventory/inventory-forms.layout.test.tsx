import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { inventoryApi } from "@/lib/inventory/client";
import type { StockState } from "@/lib/inventory/types";
import { MoveDialog } from "./move-dialog";
import { ReorderPointDialog } from "./reorder-point-dialog";
import { StockChangeDialog } from "./stock-change-dialog";

// §5c D.4: Inventory dialogs are one column, label above field, Save at the bottom end. Adding stock (the one long form)
// splits into the item, then a Stock section. FormRow stays only for a move's from and to.
const sectionTitles = (dialog: HTMLElement) => [...dialog.querySelectorAll(".wd-form-section-title")].map((title) => title.textContent);
const rows = (dialog: HTMLElement) => dialog.querySelectorAll(".wd-form-row").length;
const saveAtTheEnd = (dialog: HTMLElement, name: string) => {
  const actions = dialog.querySelector(".wd-form-footer .wd-dialog-actions");
  expect(actions?.lastElementChild?.textContent).toBe(name);
};

const warehouse = { id: "w1", kind: "warehouse" as const, name: "Warehouse", projectId: null, projectReference: null, address: "", isDefault: true, active: true };
const glue = { itemId: "i1", itemName: "Wood glue", itemCode: "", unit: "nos", catalogItemId: null, locationId: "w1", locationName: "Warehouse", locationKind: "warehouse" as const, projectId: null,
  projectReference: null, projectName: null, onHand: "17.0000", updatedAt: "2026-09-27T10:00:00Z", value: "204.0000", averageCost: "12.0000", currency: "AED" };
const stock = { rows: [glue], locations: [warehouse], projects: [{ id: "p1", reference: "PRJ-0007", name: "Villa 12" }], inTransit: 0, canManage: true, canAdjust: true, canReceive: true,
  pendingAdjustments: [], me: "u1", currency: "AED" } as StockState;
const api = inventoryApi("w");

describe("Inventory form dialogs", () => {
  it("adds stock in one column, the stock in its own section after the item", async () => {
    render(<DesignSystemProvider><StockChangeDialog api={api} state={stock} mode="add" row={null} onClose={vi.fn()} onDone={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Add stock" });
    expect(sectionTitles(dialog)).toEqual(["Stock"]);
    expect(dialog.querySelectorAll(".wd-form-section")).toHaveLength(2);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Add stock");
  });

  it("counts stock in one column without sections", async () => {
    render(<DesignSystemProvider><StockChangeDialog api={api} state={stock} mode="count" row={glue} onClose={vi.fn()} onDone={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Count" });
    expect(sectionTitles(dialog)).toEqual([]);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Save count");
  });

  it("sets a reorder point in one column", async () => {
    render(<DesignSystemProvider><ReorderPointDialog api={api} state={stock} item={glue} point={null} suppliers={[]} onClose={vi.fn()} onDone={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Reorder point" });
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Save");
  });

  it("moves stock with only from and to side by side", async () => {
    render(<DesignSystemProvider><MoveDialog api={api} state={stock} row={glue} onClose={vi.fn()} onSent={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Move stock" });
    expect(rows(dialog)).toBe(1);
    saveAtTheEnd(dialog, "Move");
  });

  it("keeps two-column grids out of the Inventory form styles, except line tables and read-only facts", () => {
    const twoColumns = /grid-template-columns:\s*(repeat\(2,|repeat\(auto-fit|1fr 1fr|minmax\(0, ?1fr\) minmax\(0, ?1fr\))/;
    // Allowed: the stock line table (item, on hand, quantity) folding to two columns on a phone; it isn't form fields.
    const allowed = /^\.lineHead\b/;
    const sheets = readdirSync(__dirname).filter((file) => file.endsWith(".module.css"));
    expect(sheets.length).toBeGreaterThan(0);
    for (const sheet of sheets) {
      const css = readFileSync(join(__dirname, sheet), "utf8");
      const offenders = css.split("\n").filter((line) => twoColumns.test(line) && !allowed.test(line.trim().replace(/^@media[^{]*\{\s*/, "")));
      expect(offenders, sheet).toEqual([]);
    }
  });
});
