import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { MovePrint } from "../inventory/move-print";
import { OrderPrint } from "./order-print";

const orderId = "6d0f2b67-6f6a-4a22-8cb0-3f2d5d77a33a";
const moveId = "7e1f3c78-7a7b-4b33-9dc1-4a3e6e88b44b";
const serve = (value: unknown) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => value })));

describe("printed orders and moves carry the code that opens their receive screen (D-46)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prints the order for the supplier with its lines, totals and code", async () => {
    serve({
      order: { id: orderId, number: "FAC-PO-2026-00003", status: "sent", supplierName: "Nile Timber", companyName: "Studio Furniture", currency: "USD", deliverTo: "site",
        deliveryAddress: "Villa 12, Palm Road", createdAt: "2026-09-28T08:00:00.000Z", sentAt: "2026-09-29T08:00:00.000Z", expectedDate: "2026-10-09", promisedDate: null,
        projects: [{ id: "p1", reference: "PRJ-0007" }], supplierReference: "", notes: "Call before delivery", subtotal: "1800.0000", discountTotal: "0.0000", taxTotal: "90.0000", total: "1890.0000" },
      lines: [{ id: "l1", description: "Oak veneer", specification: "Crown cut", quantity: "20.0000", unit: "sheets", unitPrice: "90.0000", total: "1890.0000", projectReference: "PRJ-0007" }],
      supplier: { id: "v1", name: "Nile Timber", email: "orders@nile.example", phone: null, contactName: "Sara" },
    });
    render(<DesignSystemProvider><OrderPrint workspaceId="w" orderId={orderId} /></DesignSystemProvider>);
    const document = await screen.findByRole("article", { name: "Purchase order FAC-PO-2026-00003" });
    expect(within(document).getByRole("heading", { name: "Purchase order" })).toBeInTheDocument();
    expect(within(document).getByText(/Sara/)).toBeInTheDocument();
    expect(within(document).getByRole("row", { name: /Oak veneer/ })).toHaveTextContent("20 sheets");
    expect(within(document).getByText("Call before delivery")).toBeInTheDocument();
    const code = await within(document).findByRole("img", { name: "Scan to receive" });
    expect(code.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(screen.getByRole("button", { name: "Print or save as PDF" })).toBeInTheDocument();
  });

  it("prints a move with what's on it and for which project", async () => {
    serve({
      transfer: { id: moveId, number: 12, status: "in_transit", fromName: "Main store", toName: "PRJ-0007 site", sentOn: "2026-09-29", sentByName: "Dana", note: "", projects: [{ id: "p1", reference: "PRJ-0007" }] },
      lines: [{ id: "t1", itemId: "i1", itemName: "Wood glue", unit: "nos", projectId: "p1", projectReference: "PRJ-0007", quantity: "4.0000", received: null, lossReason: "" }],
      canManage: true, canAdjust: false, canReceive: true, canReceiveThis: true, canCancelThis: false,
    });
    render(<DesignSystemProvider><MovePrint workspaceId="w" moveId={moveId} /></DesignSystemProvider>);
    const document = await screen.findByRole("article", { name: "Move 12" });
    expect(within(document).getByRole("row", { name: /Wood glue/ })).toHaveTextContent("4 nos");
    expect(await within(document).findByRole("img", { name: "Scan to receive" })).toBeInTheDocument();
  });
});
