import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { purchasingApi } from "@/lib/purchasing/client";
import { forgetAiReady } from "@/lib/workspace/ai-settings";
import type { ReceivingForm, SupplierState } from "@/lib/purchasing/types";
import { ShipmentDialog } from "./order-dialogs";
import { ReceiveDialog } from "./receive-dialog";
import { SupplierSheet } from "./supplier-sheet";
import { RecordUnmatchedDialog } from "./unmatched-deliveries";

// §5c D.4: Purchasing dialogs are one column, label above field, sections divided by a hairline under a title, Save at the
// bottom end. FormRow stays only for two tightly coupled fields (when a shipment ships and when it's expected).
afterEach(() => { vi.unstubAllGlobals(); forgetAiReady(); });

const sectionTitles = (dialog: HTMLElement) => [...dialog.querySelectorAll(".wd-form-section-title")].map((title) => title.textContent);
const rows = (dialog: HTMLElement) => dialog.querySelectorAll(".wd-form-row").length;
const saveAtTheEnd = (dialog: HTMLElement, name: string) => {
  const actions = dialog.querySelector(".wd-form-footer .wd-dialog-actions");
  expect(actions?.lastElementChild?.textContent).toBe(name);
};
const respond = (value: unknown) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => value })));
const suppliers: SupplierState = { suppliers: [], categories: [], entities: [{ id: "f", code: "FAC", name: "Studio Furniture" }], canManage: true, canApprove: true };

describe("Purchasing form dialogs", () => {
  it("follows a shipment in Shipment and Progress sections, shipped and expected side by side", async () => {
    render(<DesignSystemProvider><ShipmentDialog shipment={null} onClose={vi.fn()} onSave={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Add shipment" });
    expect(sectionTitles(dialog)).toEqual(["Shipment", "Progress"]);
    expect(rows(dialog)).toBe(1);
    saveAtTheEnd(dialog, "Save");
  });

  it("adds a supplier in one column with Supplier and Payment sections", async () => {
    respond({});
    render(<DesignSystemProvider><SupplierSheet api={purchasingApi("w")} state={suppliers} supplier={null} onState={vi.fn()} onClose={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "New supplier" });
    expect(sectionTitles(dialog)).toEqual(["Supplier", "Payment"]);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Add supplier");
  });

  it("records goods without an order in Delivery, What arrived and Photos sections", async () => {
    respond(suppliers);
    render(<DesignSystemProvider><RecordUnmatchedDialog api={purchasingApi("w")} onClose={vi.fn()} onRecorded={vi.fn()}
      locations={[{ id: "w1", kind: "warehouse", name: "Warehouse", projectId: null, projectReference: null, address: "", isDefault: true, active: true }]} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Goods without an order" });
    expect(sectionTitles(dialog)).toEqual(["Delivery", "What arrived", "Photos"]);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Save");
  });

  it("receives a delivery in one column: where and when, what arrived, photos", async () => {
    const form = {
      order: { id: "o1", number: "FAC-PO-2026-00001" },
      lines: [{ id: "a", description: "Calacatta slab", specification: "", projectReference: "PRJ-0007", unit: "m²", quantity: "10", outstanding: "10", receivable: "10" }],
      places: [{ key: "warehouse", kind: "warehouse", name: null, projectReference: null }], defaultPlace: "warehouse", requireInspection: true, receiveTolerancePercent: "0", requireSitePhoto: false,
    } as unknown as ReceivingForm;
    respond(form);
    render(<DesignSystemProvider><ReceiveDialog api={purchasingApi("w")} orderId="o1" onClose={vi.fn()} onReceived={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Receive FAC-PO-2026-00001" });
    await screen.findByRole("textbox", { name: "Delivery note" });
    expect(sectionTitles(dialog)).toEqual(["Delivery", "What arrived", "Photos"]);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Receive");
  });

  it("keeps two-column grids out of the Purchasing form styles, except line tables and read-only facts", () => {
    const twoColumns = /grid-template-columns:\s*(repeat\(2,|repeat\(auto-fit|1fr 1fr|minmax\(0, ?1fr\) minmax\(0, ?1fr\))/;
    // Allowed: draft order lines on a phone (a line table: item and quantity, then price and remove), not form fields.
    const allowed = /^\.draftLines\b/;
    const sheets = readdirSync(__dirname).filter((file) => file.endsWith(".module.css"));
    expect(sheets.length).toBeGreaterThan(0);
    for (const sheet of sheets) {
      const css = readFileSync(join(__dirname, sheet), "utf8");
      const offenders = css.split("\n").filter((line) => twoColumns.test(line) && !allowed.test(line.trim().replace(/^@media[^{]*\{\s*/, "")));
      expect(offenders, sheet).toEqual([]);
    }
  });
});
