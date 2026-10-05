import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { PayablesApi } from "@/lib/payables/client";
import type { Bill, SupplierState } from "@/lib/payables/types";
import { BillEditor } from "./bill-editor";
import { PaymentDialog } from "./payment-dialog";

// §5c D.4: Finance dialogs are one column, label above field, titled sections, Save at the bottom end. FormRow stays only
// for a start and its end (an invoice's date and its due date).
const sectionTitles = (dialog: HTMLElement) => [...dialog.querySelectorAll(".wd-form-section-title")].map((title) => title.textContent);
const rows = (dialog: HTMLElement) => dialog.querySelectorAll(".wd-form-row").length;
const saveAtTheEnd = (dialog: HTMLElement, name: string) => {
  const actions = dialog.querySelector(".wd-form-footer .wd-dialog-actions");
  expect(actions?.lastElementChild?.textContent).toBe(name);
};

const bill = (patch: Partial<Bill> = {}): Bill => ({
  id: "b1", vendorId: "v1", supplierName: "Nile Marble", legalEntityId: "e1", companyName: "Studio Furniture", number: "INV-1", invoiceDate: "2026-09-20", dueDate: "2099-10-20",
  currency: "AED", net: "540.0000", tax: "27.0000", total: "567.0000", statedTotal: null, status: "approved", holdReasons: "", approvedByName: null, approvedAt: "2026-09-21T10:00:00Z",
  approvalNote: "", cancelReason: null, fileName: null, createdBy: "u2", createdByName: "Dana Designer", createdAt: "2026-09-21T09:00:00Z", version: 2, paid: "0.0000", balance: "567.0000",
  orders: [], retention: "0.0000", retentionHeld: "0.0000", reserved: "0.0000", payable: "567.0000", ...patch,
});
const supplier: SupplierState = {
  supplier: { id: "v1", name: "Nile Marble", creditDays: 30, paymentTerms: "credit", bank: { bankName: "Emirates NBD", last4: "4321" }, bankChangePending: false },
  orders: [], balances: [], bills: [bill(), bill({ id: "b2", number: "INV-2" })], payments: [], debitNotes: [], runsRequired: false, canManage: true, canApprove: true,
} as unknown as SupplierState;
const api = { supplier: async () => supplier } as unknown as PayablesApi;

describe("Finance form dialogs", () => {
  it("enters a supplier's invoice in Invoice and Lines sections, the invoice and due dates side by side", async () => {
    render(<DesignSystemProvider><BillEditor api={api} vendors={[{ id: "v1", name: "Nile Marble", currency: "AED" }]} companies={[{ id: "e1", name: "Studio Furniture", currency: "AED" }]}
      onClose={vi.fn()} onSaved={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Enter invoice" });
    expect(sectionTitles(dialog)).toEqual(["Invoice", "Lines"]);
    expect(rows(dialog)).toBe(1);
    saveAtTheEnd(dialog, "Submit");
  });

  it("records a payment in one column, the invoices it pays in their own section", async () => {
    render(<DesignSystemProvider><PaymentDialog api={api} vendorId="v1" legalEntityId="e1" currency="AED" onClose={vi.fn()} onSaved={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: /Record payment/ });
    await screen.findByText("INV-2");
    expect(sectionTitles(dialog)).toEqual(["Payment", "Invoices it pays"]);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Record payment");
  });

  it("keeps two-column grids out of the finance form styles", () => {
    const twoColumns = /grid-template-columns:\s*(repeat\(2,|repeat\(auto-fit|1fr 1fr|minmax\(0, ?1fr\) minmax\(0, ?1fr\))/;
    // Nothing allowed: facts (label · value), totals, allocations and the invoice's line table use fixed tracks, never two equal field columns.
    for (const sheet of readdirSync(__dirname).filter((name) => name.endsWith(".module.css"))) {
      const offenders = readFileSync(join(__dirname, sheet), "utf8").split("\n").filter((line) => twoColumns.test(line));
      expect(offenders, sheet).toEqual([]);
    }
  });
});
