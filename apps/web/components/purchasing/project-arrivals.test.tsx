import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { ArrivalsState } from "@/lib/purchasing/types";
import { ProjectArrivals } from "./project-arrivals";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/workspace/projects/p1/site", useSearchParams: () => new URLSearchParams() }));

const order = {
  id: "o1", number: "FAC-PO-2026-00003", status: "confirmed", supplierName: "Nile Marble & Granite", due: "2099-10-10", projects: [{ id: "p1", reference: "PRJ-0007" }],
  shipment: { status: "delayed", carrier: "Aramex", eta: "2099-10-12" }, items: [{ description: "Calacatta slab", left: "4.0000", unit: "m²", due: "2099-10-10" }],
} as unknown as ArrivalsState["orders"][number];
const move = { id: "t1", number: 12, status: "in_transit" as const, fromName: "Factory", toName: "PRJ-0007 site", sentOn: "2099-10-08", items: "Kitchen cabinets", workOrderId: "w1",
  workOrderNumber: 7, note: "" };
const serve = (value: ArrivalsState) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => value })));
const mount = () => render(<DesignSystemProvider><ProjectArrivals workspaceId="w" projectId="p1" /></DesignSystemProvider>);

describe("what's on its way to a project's site (D-20)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists supplier deliveries and moves from the factory, each received where it arrives", async () => {
    serve({ orders: [order], moves: [move], canReceive: true, canReceiveMoves: true });
    mount();
    const suppliers = await screen.findByRole("region", { name: "From suppliers" });
    expect(within(suppliers).getByText("Calacatta slab · 4 m²")).toBeInTheDocument();
    expect(within(suppliers).getByRole("link", { name: "FAC-PO-2026-00003" })).toHaveAttribute("href", "/workspace/purchasing/orders?order=o1");
    expect(within(suppliers).getByText(/Delayed Aramex/)).toBeInTheDocument();
    expect(within(suppliers).getByRole("button", { name: "Receive FAC-PO-2026-00003" })).toBeInTheDocument();
    const moves = screen.getByRole("region", { name: "From our stock and factory" });
    expect(within(moves).getByRole("link", { name: "Move 12" })).toHaveAttribute("href", "/workspace/inventory/moves?move=t1");
    expect(within(moves).getByText(/WO-0007/)).toBeInTheDocument();
    expect(within(moves).getByRole("button", { name: "Receive move 12" })).toBeInTheDocument();
  });

  it("shows what's coming without a Receive button to someone who doesn't receive goods, and says when nothing is", async () => {
    serve({ orders: [order], moves: [], canReceive: false, canReceiveMoves: false });
    const { unmount } = mount();
    const suppliers = await screen.findByRole("region", { name: "From suppliers" });
    expect(within(suppliers).queryByRole("button", { name: /Receive/ })).toBeNull();
    unmount();
    serve({ orders: [], moves: [], canReceive: true, canReceiveMoves: true });
    mount();
    expect(await screen.findByText("Nothing on its way to site")).toBeInTheDocument();
  });
});
