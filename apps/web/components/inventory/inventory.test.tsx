import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { StockState, TransferState } from "@/lib/inventory/types";
import { InventoryPage } from "./inventory-page";
import type { InventorySection } from "@/lib/inventory/sections";

const nav = vi.hoisted(() => ({ replace: vi.fn(), query: "" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace, push: vi.fn() }), usePathname: () => "/workspace/inventory", useSearchParams: () => new URLSearchParams(nav.query) }));

const warehouse = { id: "w1", kind: "warehouse" as const, name: "Warehouse", projectId: null, projectReference: null, address: "", isDefault: true, active: true };
const site = { id: "s1", kind: "site" as const, name: "PRJ-0007 · Villa 12", projectId: "p1", projectReference: "PRJ-0007", address: "", isDefault: false, active: true };
const stock = (patch: Partial<StockState> = {}): StockState => ({
  rows: [
    { itemId: "i1", itemName: "Wood glue", itemCode: "", unit: "nos", catalogItemId: null, locationId: "w1", locationName: "Warehouse", locationKind: "warehouse", projectId: null,
      projectReference: null, projectName: null, onHand: "17.0000", updatedAt: "2026-09-27T10:00:00Z" },
    { itemId: "i2", itemName: "Calacatta slab", itemCode: "CAL-20", unit: "m²", catalogItemId: null, locationId: "w1", locationName: "Warehouse", locationKind: "warehouse", projectId: "p1",
      projectReference: "PRJ-0007", projectName: "Villa 12", onHand: "10.0000", updatedAt: "2026-09-27T10:00:00Z" }],
  locations: [warehouse, site], projects: [{ id: "p1", reference: "PRJ-0007", name: "Villa 12" }], inTransit: 1, canManage: true, canAdjust: true, canReceive: true, ...patch,
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
  afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); nav.query = ""; });

  it("lists stock by place and owner, and reserves free stock for a project", async () => {
    const fetcher = mount((url) => (url.includes("/transfers") ? { transfers: [], locations: [], canManage: true, canAdjust: true, canReceive: true } : stock()));
    page();
    const glue = await rowOf("Wood glue");
    expect(glue).toHaveTextContent("Free stock");
    expect(glue).toHaveTextContent("17 nos");
    expect(await rowOf("Calacatta slab")).toHaveTextContent("PRJ-0007");
    expect(screen.getByRole("tab", { name: "Moves (1)" })).toBeInTheDocument();
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
    expect(nav.replace).toHaveBeenLastCalledWith("/workspace/inventory/moves?move=t1", { scroll: false });
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
});
