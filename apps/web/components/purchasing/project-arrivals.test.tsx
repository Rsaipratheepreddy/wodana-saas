import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    serve({ orders: [order], moves: [move], canReceive: true, canReceiveMoves: true, canArrange: false, today: "2099-10-01" });
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
    serve({ orders: [order], moves: [], canReceive: false, canReceiveMoves: false, canArrange: false, today: "2099-10-01" });
    const { unmount } = mount();
    const suppliers = await screen.findByRole("region", { name: "From suppliers" });
    expect(within(suppliers).queryByRole("button", { name: /Receive/ })).toBeNull();
    unmount();
    serve({ orders: [], moves: [], canReceive: true, canReceiveMoves: true, canArrange: false, today: "2099-10-01" });
    mount();
    expect(await screen.findByText("Nothing on its way to site")).toBeInTheDocument();
  });

  it("shows whether the client confirmed site access, and the manager moves the delivery with why (D-29)", async () => {
    const access = { id: "a1", date: "2099-10-10", items: "Calacatta slab", status: "move_asked" as const, answeredBy: "Maya Client", answeredAt: "2099-10-02T08:00:00.000Z",
      clientReason: "Nobody home", clientDate: "2099-10-14", movedFrom: null, moveReason: null, chargeable: false, version: 2 };
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ orders: [{ ...order, access }], moves: [], canReceive: true, canReceiveMoves: true, canArrange: true, today: "2099-10-01" }) }));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    mount();
    const suppliers = await screen.findByRole("region", { name: "From suppliers" });
    expect(within(suppliers).getByText("Client asked to move")).toBeInTheDocument();
    await user.click(within(suppliers).getByRole("button", { name: "Site access for FAC-PO-2026-00003" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Why: Nobody home")).toBeInTheDocument();
    // The client's reason and day come in; the manager says whether the new delivery is charged.
    await user.click(within(dialog).getByRole("checkbox", { name: "The new delivery is charged" }));
    await user.click(within(dialog).getByRole("button", { name: "Move delivery" }));
    const call = fetcher.mock.calls.find((args) => String((args as unknown[])[0]).includes("/access/")) as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/site/projects/p1/access/a1?workspaceId=w");
    expect(JSON.parse(String(call[1].body))).toEqual({ action: "reschedule", version: 2, date: "2099-10-14", reason: "Nobody home", chargeable: true });
  });
});
