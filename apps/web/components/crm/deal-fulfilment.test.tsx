import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { DealFulfilment } from "@/lib/fulfilment/types";
import { DealFulfilmentCard } from "./deal-fulfilment";

vi.mock("next/font/google", () => ({ Caveat: () => ({ variable: "note-font" }) }));
afterEach(() => vi.unstubAllGlobals());

const deal = (patch: Partial<DealFulfilment> = {}): DealFulfilment => ({
  opportunityId: "o1", status: "won", furniturePath: "in_stock_delivery", projectId: null, version: 3,
  rule: { reserveOn: "quote_accepted", deductOn: "won", leadMinDays: 3, leadMaxDays: 4, leadFrom: "won", leadFromCatalogue: false, takeFromLocationId: null },
  boq: { chosen: null, byDefault: false, required: false },
  plan: { steps: [{ key: "delivery_booked", state: "current", at: null }, { key: "delivered", state: "pending", at: null }], expected: { from: "2026-10-06", by: "2026-10-08" },
    handedOver: false, late: true, cancelled: false },
  reservations: [{ id: "r1", source: "quote_line", itemId: "i1", itemName: "Linen sofa", unit: "pcs", locationName: "Showroom", quantity: "2.0000", status: "deducted", deducted: "1.0000",
    returned: "0.0000", short: "1" }],
  orders: [], items: [], transfer: null, delivery: null, cancelled: null, can: { fulfil: true, boq: true, cancel: true, order: false }, ...patch,
});

function mount(state: DealFulfilment, sent: Array<Record<string, unknown>>) {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit = {}) => {
    if (init.method === "POST") sent.push(JSON.parse(String(init.body)));
    return { ok: true, status: 200, json: async () => state };
  }));
  return render(<DesignSystemProvider><DealFulfilmentCard workspaceId="w1" opportunityId="o1" won open onToggle={() => undefined} /></DesignSystemProvider>);
}

describe("a won order's fulfilment on the deal (PLM-126)", () => {
  it("shows the path's steps, when it's expected and that it's late, and what the order took from stock", async () => {
    mount(deal(), []);
    expect(await screen.findByText("Delivery booked")).toBeInTheDocument();
    expect(screen.getByText("Late")).toBeInTheDocument();
    expect(screen.getByText("Linen sofa · 2 pcs")).toBeInTheDocument();
    expect(screen.getByText("Taken from stock · Showroom · 1 pcs short")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask the factory to send it" })).toBeInTheDocument();
  });

  it("books the delivery with its own command id and the version it saw", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const user = userEvent.setup();
    mount(deal(), sent);
    await user.click(await screen.findByRole("button", { name: "Book delivery" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ action: "book_delivery", version: 3, date: "2026-10-08" });
    expect(typeof sent[0].commandId).toBe("string");
  });

  it("reads only, with no next step, for someone who can't move the order", async () => {
    mount(deal({ can: { fulfil: false, boq: false, cancel: false, order: false } }), []);
    expect(await screen.findByText("BOQ required")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Book delivery" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel the order" })).toBeNull();
  });
});
