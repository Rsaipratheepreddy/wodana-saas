import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { StockState, TransferState } from "@/lib/inventory/types";
import { InventoryPage } from "./inventory-page";
import type { InventorySection } from "@/lib/inventory/sections";

const nav = vi.hoisted(() => ({ replace: vi.fn(), query: "" }));
vi.spyOn(window.history, "replaceState");
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace, push: vi.fn() }), usePathname: () => "/workspace/inventory", useSearchParams: () => new URLSearchParams(nav.query) }));

const warehouse = { id: "w1", kind: "warehouse" as const, name: "Warehouse", projectId: null, projectReference: null, address: "", isDefault: true, active: true };
const site = { id: "s1", kind: "site" as const, name: "PRJ-0007 · Villa 12", projectId: "p1", projectReference: "PRJ-0007", address: "", isDefault: false, active: true };
const stock = (patch: Partial<StockState> = {}): StockState => ({
  rows: [
    { itemId: "i1", itemName: "Wood glue", itemCode: "", unit: "nos", catalogItemId: null, locationId: "w1", locationName: "Warehouse", locationKind: "warehouse", projectId: null,
      projectReference: null, projectName: null, onHand: "17.0000", updatedAt: "2026-09-27T10:00:00Z", value: "204.0000", averageCost: "12.0000", currency: "AED" },
    { itemId: "i2", itemName: "Calacatta slab", itemCode: "CAL-20", unit: "m²", catalogItemId: null, locationId: "w1", locationName: "Warehouse", locationKind: "warehouse", projectId: "p1",
      projectReference: "PRJ-0007", projectName: "Villa 12", onHand: "10.0000", updatedAt: "2026-09-27T10:00:00Z", value: "3500.0000", averageCost: "350.0000", currency: "AED" }],
  locations: [warehouse, site], projects: [{ id: "p1", reference: "PRJ-0007", name: "Villa 12" }], inTransit: 1, canManage: true, canAdjust: true, canReceive: true,
  pendingAdjustments: [], me: "u1", currency: "AED", ...patch,
});
const move = (patch: Partial<TransferState["transfer"]> = {}): TransferState => ({
  transfer: { id: "t1", number: 3, status: "in_transit", fromLocationId: "w1", fromName: "Warehouse", toLocationId: "s1", toName: "PRJ-0007 · Villa 12", note: "", sentOn: "2026-09-27",
    sentBy: "u1", sentByName: "Sam Store", receivedOn: null, receivedByName: null, cancelReason: null, lines: 1, short: false, ...patch },
  lines: [{ id: "l1", itemId: "i2", itemName: "Calacatta slab", unit: "m²", projectId: "p1", projectReference: "PRJ-0007", quantity: "10.0000", received: null, lossReason: "" }],
  canManage: true, canAdjust: true, canReceive: true, canReceiveThis: patch.status === undefined || patch.status === "in_transit", canCancelThis: true,
});
const mount = (respond: (url: string, body: Record<string, unknown> | undefined) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const value = respond(url, typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
    return value instanceof Error ? { ok: false, status: 409, json: async () => ({ message: value.message }) } : { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const posts = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST").map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init!.body)) }));
const page = (section: InventorySection = "stock") => render(<DesignSystemProvider><InventoryPage workspaceId="w" section={section} /></DesignSystemProvider>);
const rowOf = async (name: string) => (await screen.findByText(name)).closest("tr")!;

describe("inventory", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(window.history.replaceState).mockClear(); nav.query = ""; });

  it("lists stock by place and owner, and reserves free stock for a project", async () => {
    const fetcher = mount((url) => (url.includes("/transfers") ? { transfers: [], locations: [], canManage: true, canAdjust: true, canReceive: true } : stock()));
    page();
    const glue = await rowOf("Wood glue");
    expect(glue).toHaveTextContent("Free stock");
    expect(glue).toHaveTextContent("17 nos");
    expect(await rowOf("Calacatta slab")).toHaveTextContent("PRJ-0007");
    expect(screen.getByRole("tab", { name: /^Moves\s*1$/ })).toBeInTheDocument();
    // One title under the shared page header, the one primary action, and the sections as tabs under it.
    expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual(["Inventory"]);
    expect(screen.getAllByRole("button", { name: "Move stock" })).toHaveLength(1);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Stock", "Moves1", "History"]);
    // A project's stock names its project as a link.
    expect(within(await rowOf("Calacatta slab")).getByRole("link", { name: "PRJ-0007" })).toHaveAttribute("href", "/workspace/projects/p1");
    await userEvent.click(within(glue).getByRole("button", { name: "Actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Reserve for a project" }));
    const dialog = await screen.findByRole("dialog", { name: "Reserve for a project" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Project/ }));
    await userEvent.click(await screen.findByRole("option", { name: "PRJ-0007 · Villa 12" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Quantity" }), "20");
    expect(within(dialog).getByText("Only 17 nos there.")).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Quantity" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Quantity" }), "5");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reserve for a project" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "allocate", itemId: "i1", locationId: "w1", projectId: null, forProjectId: "p1", quantity: "5" }));
  });

  it("lists a materials list imported without quantities at nothing on hand, with its category", async () => {
    const items = [
      { itemId: "m1", itemName: "Hinge", itemCode: "HW-1", unit: "pcs", catalogItemId: null, category: "Hardware" },
      { itemId: "m2", itemName: "Primer", itemCode: "PT-1", unit: "l", catalogItemId: null, category: "Paint" },
      { itemId: "m3", itemName: "Drawer runner", itemCode: "HW-2", unit: "pair", catalogItemId: null, category: "Hardware" },
    ];
    const fetcher = mount((url) => (url.includes("/transfers") ? { transfers: [], locations: [], canManage: true, canAdjust: true, canReceive: true } : stock({ rows: [], items })));
    page();
    const hinge = await rowOf("Hinge");
    expect(hinge).toHaveTextContent("0 pcs");
    expect(hinge).toHaveTextContent("Hardware");
    expect(screen.queryByText("Nothing in stock")).not.toBeInTheDocument();
    expect(screen.getByText("No quantities recorded yet. Count stock or import quantities.")).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Stock" })).getAllByRole("row")).toHaveLength(4);
    // Free stock keeps its filter: nothing is free yet.
    await userEvent.click(screen.getByRole("button", { name: "Free stock" }));
    expect(screen.queryByText("Hinge")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    // Adding stock of a listed item uses that item, never a new one.
    await userEvent.click(within(await rowOf("Primer")).getByRole("button", { name: "Actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Add stock" }));
    const dialog = await screen.findByRole("dialog", { name: "Add stock" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Quantity" }), "12");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Where it comes from/ }), "Opening count");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add stock" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "add", itemId: "m2", quantity: "12" }));
  });

  it("shows the empty state only when no stock item is kept at all", async () => {
    mount((url) => (url.includes("/transfers") ? { transfers: [], locations: [], canManage: true, canAdjust: true, canReceive: true } : stock({ rows: [], items: [] })));
    page();
    expect(await screen.findByText("Nothing in stock")).toBeInTheDocument();
    expect(screen.queryByText("No quantities recorded yet. Count stock or import quantities.")).not.toBeInTheDocument();
  });

  it("counts stock and asks why when the count is different", async () => {
    const fetcher = mount(() => stock());
    page();
    const glue = await rowOf("Wood glue");
    await userEvent.click(within(glue).getByRole("button", { name: "Actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Count" }));
    const dialog = await screen.findByRole("dialog", { name: "Count" });
    const counted = within(dialog).getByRole("textbox", { name: "Counted" });
    expect(counted).toHaveValue("17");
    await userEvent.clear(counted);
    await userEvent.type(counted, "16");
    const save = within(dialog).getByRole("button", { name: "Save count" });
    expect(save).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why it's different/ }), "One tube dried out");
    await userEvent.click(save);
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "count", itemId: "i1", locationId: "w1", counted: "16", reason: "One tube dried out" }));
  });

  it("moves a project's stock to its site and opens the move", async () => {
    const fetcher = mount((url, body) => (url.includes("/transfers") ? (body ? move() : { transfers: [], locations: [], canManage: true, canAdjust: true, canReceive: true }) : stock()));
    page();
    const slab = await rowOf("Calacatta slab");
    await userEvent.click(within(slab).getByRole("button", { name: "Actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Move" }));
    const dialog = await screen.findByRole("dialog", { name: "Move stock" });
    expect(within(dialog).getByRole("textbox", { name: "Move of Calacatta slab PRJ-0007" })).toHaveValue("10");
    await userEvent.click(within(dialog).getByRole("button", { name: /To$/ }));
    await userEvent.click(await screen.findByRole("option", { name: "PRJ-0007 · Villa 12" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Move" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ fromLocationId: "w1", toLocationId: "s1", lines: [{ itemId: "i2", projectId: "p1", quantity: "10" }] }));
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, "", "/workspace/inventory/moves?move=t1");
  });

  it("receives a move where it arrived and asks what happened to anything missing", async () => {
    nav.query = "move=t1";
    const fetcher = mount((url, body) => (url.includes("/transfers/t1") ? (body ? move({ status: "received", short: true, receivedOn: "2026-09-27", receivedByName: "Omar" }) : move())
      : url.includes("/transfers") ? { transfers: [move().transfer], locations: [], canManage: true, canAdjust: true, canReceive: true } : stock()));
    page("moves");
    const sheet = await screen.findByRole("dialog", { name: "Move 3" });
    const arrived = await within(sheet).findByRole("textbox", { name: "Arrived of Calacatta slab" });
    expect(arrived).toHaveValue("10");
    await userEvent.clear(arrived);
    await userEvent.type(arrived, "9");
    const receive = within(sheet).getByRole("button", { name: "Receive" });
    expect(receive).toBeDisabled();
    await userEvent.type(within(sheet).getByRole("textbox", { name: /What happened to the rest/ }), "Cracked in the truck");
    await userEvent.click(receive);
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "receive", lines: [{ id: "l1", received: "9", lossReason: "Cracked in the truck" }] }));
    expect(await within(sheet).findByText("Arrived short")).toBeInTheDocument();
  });

  it("shows what stock is worth, and lets someone else approve or refuse a large correction", async () => {
    const request = { id: "a0000000-0000-4000-8000-000000000001", itemName: "Calacatta slab", unit: "m²", locationName: "Warehouse", projectReference: "PRJ-0007", counted: "6.0000",
      difference: "-4.0000", value: "1400.0000", reason: "Two slabs broken", requestedBy: "u2", requestedByName: "Sam Store", requestedAt: "2026-09-27T09:00:00Z" };
    const fetcher = mount((url) => (url.includes("/transfers") ? { transfers: [], locations: [], canManage: true, canAdjust: true, canReceive: true }
      : url.includes("/adjustments/") ? stock() : stock({ pendingAdjustments: [request] })));
    page();
    expect(await rowOf("Calacatta slab")).toHaveTextContent(/3,500/);
    const waiting = screen.getByRole("region", { name: "Corrections waiting for approval" });
    expect(within(waiting).getByText(/Counted 6 m² \(-4\), worth .*1,400(\.00)?: Two slabs broken \(Sam Store\)/)).toBeInTheDocument();
    await userEvent.click(within(waiting).getByRole("button", { name: "Refuse" }));
    const dialog = await screen.findByRole("dialog", { name: "Refuse the correction" });
    expect(within(dialog).getByRole("button", { name: "Refuse" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why it's refused/ }), "Recount first");
    await userEvent.click(within(dialog).getByRole("button", { name: "Refuse" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toEqual({ url: expect.stringContaining(`/adjustments/${request.id}`), body: { action: "reject", note: "Recount first" } }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Corrections waiting for approval" })).not.toBeInTheDocument());
  });

  it("QA-006: shows no stock value or cost to someone who doesn't see stock costs (a site supervisor)", async () => {
    const request = { id: "a0000000-0000-4000-8000-000000000001", itemName: "Calacatta slab", unit: "m²", locationName: "Warehouse", projectReference: "PRJ-0007", counted: "6.0000",
      difference: "-4.0000", value: null, reason: "Two slabs broken", requestedBy: "u2", requestedByName: "Sam Store", requestedAt: "2026-09-27T09:00:00Z" };
    const hidden = stock({ canSeeCosts: false, pendingAdjustments: [request] });
    mount((url) => (url.includes("/transfers") ? { transfers: [], locations: [], canManage: false, canAdjust: false, canReceive: true }
      : { ...hidden, rows: hidden.rows.map((row) => ({ ...row, value: null, averageCost: null })) }));
    page();
    const slab = await rowOf("Calacatta slab");
    expect(slab).toHaveTextContent("10 m²");
    expect(slab).not.toHaveTextContent(/AED|3,500|350/);
    expect(screen.queryByRole("columnheader", { name: "Value" })).not.toBeInTheDocument();
    const waiting = screen.getByRole("region", { name: "Corrections waiting for approval" });
    expect(within(waiting).getByText("Counted 6 m² (-4): Two slabs broken (Sam Store)")).toBeInTheDocument();
  });

  it("does not let whoever counted approve their own correction", async () => {
    const request = { id: "a0000000-0000-4000-8000-000000000001", itemName: "Wood glue", unit: "nos", locationName: "Warehouse", projectReference: null, counted: "2.0000",
      difference: "-15.0000", value: "180.0000", reason: "Dried out", requestedBy: "u1", requestedByName: "Me", requestedAt: "2026-09-27T09:00:00Z" };
    mount((url) => (url.includes("/transfers") ? { transfers: [], locations: [], canManage: true, canAdjust: true, canReceive: true } : stock({ pendingAdjustments: [request] })));
    page();
    const waiting = await screen.findByRole("region", { name: "Corrections waiting for approval" });
    expect(within(waiting).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(within(waiting).getByText("Someone else approves it.")).toBeInTheDocument();
  });

  it("adds opening stock for a new item and says where it comes from", async () => {
    const fetcher = mount(() => stock());
    page();
    await userEvent.click(await screen.findByRole("button", { name: "Add stock" }));
    const dialog = await screen.findByRole("dialog", { name: "Add stock" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Hinges");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Unit" }), "pairs");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Quantity" }), "40");
    expect(within(dialog).getByRole("button", { name: "Add stock" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Where it comes from/ }), "Opening stock");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add stock" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "add", name: "Hinges", unit: "pairs", locationId: "w1", projectId: null, quantity: "40", reason: "Opening stock" }));
  });

  it("sets a reorder point on free stock, marks it low, and lists what to order in Low stock", async () => {
    const point = { id: "rp1", itemId: "i1", itemName: "Wood glue", itemCode: "", unit: "nos", locationId: "w1", locationName: "Warehouse", reorderAt: "20.0000", reorderQuantity: "24.0000",
      vendorId: null, vendorName: null, free: "17.0000", onOrder: "0.0000", low: true, short: true, lowSince: "2026-09-28T10:00:00Z", version: 1 };
    const fetcher = mount((url) => (url.includes("/reorder-points") ? stock({ reorderPoints: [point] }) : url.includes("/api/purchasing/suppliers")
      ? { suppliers: [{ id: "s1", name: "Nile Timber", status: "active" }] } : url.includes("/transfers") ? { transfers: [], locations: [], canManage: true, canAdjust: true, canReceive: true } : stock()));
    page();
    const glue = await rowOf("Wood glue");
    await userEvent.click(within(glue).getByRole("button", { name: "Actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Set reorder point" }));
    const dialog = await screen.findByRole("dialog", { name: "Reorder point" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Low at/ }), "20");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Order" }), "24");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /From/ })).toBeInTheDocument());
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toMatchObject({ url: expect.stringContaining("/api/inventory/reorder-points"),
      body: { itemId: "i1", locationId: "w1", reorderAt: "20", reorderQuantity: "24", vendorId: null } }));
    // Low now: the row says so, and Low stock lists it with what to order and where.
    expect(await within(await rowOf("Wood glue")).findByText("Low")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Low stock\s*1$/ }));
    const low = await screen.findByRole("grid", { name: "Low stock" }).catch(() => screen.findByRole("table", { name: "Low stock" }));
    expect(low).toHaveTextContent("Order now");
    expect(within(low).getByRole("link", { name: "Order 24 nos" })).toHaveAttribute("href", "/workspace/purchasing?view=restock");
  });

  it("refuses made goods where they arrive: they go back on a return trip to be made again", async () => {
    nav.query = "move=t1";
    const dispatch = move({ workOrderId: "wo1", workOrderNumber: 5, projects: [{ id: "p1", reference: "PRJ-0007" }] });
    const fetcher = mount((url, body) => (url.includes("/transfers/t1") ? (body ? { ...move({ status: "received", receivedOn: "2026-09-27", receivedByName: "Omar", rejected: true, returnId: "t2", returnNumber: 4 }),
      lines: [{ ...dispatch.lines[0], received: "10.0000", rejected: "2.0000", rejectReason: "Veneer lifted" }] } : dispatch)
      : url.includes("/transfers") ? { transfers: [dispatch.transfer], locations: [], canManage: true, canAdjust: true, canReceive: true } : stock()));
    page("moves");
    const sheet = await screen.findByRole("dialog", { name: "Move 3" });
    expect(await within(sheet).findByRole("link", { name: "WO-0005" })).toHaveAttribute("href", "/workspace/factory/orders?order=wo1");
    expect(within(sheet).getByText(/it goes back to the factory to be made again/)).toBeInTheDocument();
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Refused of Calacatta slab" }), "2");
    const receive = within(sheet).getByRole("button", { name: "Receive" });
    expect(receive).toBeDisabled();
    await userEvent.type(within(sheet).getByRole("textbox", { name: /Why Calacatta slab is refused/ }), "Veneer lifted");
    await userEvent.click(receive);
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "receive", lines: [{ id: "l1", received: "10", lossReason: "", rejected: "2", rejectReason: "Veneer lifted" }] }));
    expect(await within(sheet).findByText("Arrived, some refused")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Refused goods go back on move 4" })).toBeInTheDocument();
  });
});
