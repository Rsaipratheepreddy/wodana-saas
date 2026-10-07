import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { CatalogStructure } from "@/lib/workspace/catalog-v2";
import { CatalogItemInspector } from "./catalog-item-inspector";

const item = { id: "i1", code: "PLY-18", name: "Plywood 18mm", itemType: "material", unitCode: "sheet", categoryId: null, version: 3, description: null, wastePercent: "5.0000", purchaseRoundTo: null,
  values: { finish: "Oak" }, components: [], prices: [], suppliers: [], canViewCosts: false };
const structure: CatalogStructure = {
  categories: [{ id: "c1", parentId: null, code: "boards", name: "Boards" }],
  attributes: [{ id: "a1", code: "finish", label: "Finish", valueType: "text", required: false, choices: [], unitCode: null, categoryId: null }],
  units: [{ code: "sheet", label: "Sheet", kind: "count" }, { code: "sqm", label: "Square metre", kind: "area" }],
};

const mount = (answer: (init?: RequestInit, url?: string) => { status: number; body: unknown }) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => { const { status, body } = answer(init, url); return { ok: status < 400, status, json: async () => body }; });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const puts = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "PUT").map(([, init]) => JSON.parse(String(init!.body)));
const inspector = (canManage = true) => render(<DesignSystemProvider><CatalogItemInspector canManage={canManage} catalogId="k1" currency="AED" itemId="i1" structure={structure} workspaceId="w" /></DesignSystemProvider>);

describe("catalog item details", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("edits a fact in place and saves the whole item with its version", async () => {
    const fetcher = mount((init) => init?.method === "PUT" ? { status: 200, body: {} } : { status: 200, body: item });
    inspector();
    await userEvent.click(await screen.findByRole("button", { name: "Edit Waste" }));
    const waste = screen.getByRole("textbox", { name: "Waste" });
    await userEvent.clear(waste);
    await userEvent.type(waste, "8{Enter}");
    await waitFor(() => expect(puts(fetcher)).toEqual([{ version: 3, code: "PLY-18", name: "Plywood 18mm", itemType: "material", unitCode: "sheet", wastePercent: "8", values: { finish: "Oak" } }]));
  });

  it("refuses a waste that isn't a number before saving", async () => {
    const fetcher = mount(() => ({ status: 200, body: item }));
    inspector();
    await userEvent.click(await screen.findByRole("button", { name: "Edit Waste" }));
    const waste = screen.getByRole("textbox", { name: "Waste" });
    await userEvent.clear(waste);
    await userEvent.type(waste, "five{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a number, like 5 or 2.5.");
    expect(puts(fetcher)).toEqual([]);
  });

  it("says when someone else changed the item and loads the latest", async () => {
    let gets = 0;
    mount((init, url) => init?.method === "PUT" ? { status: 409, body: { message: "This item changed; reload and try again" } } : (url?.includes("/catalogs/k1/items/i1") && gets++, { status: 200, body: item }));
    inspector();
    await userEvent.click(await screen.findByRole("button", { name: "Edit Code" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Code" }), "-B{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("This item changed; reload and try again");
    await waitFor(() => expect(gets).toBe(2));
  });

  it("opens on Details, with one tab each for photos, size and prices", async () => {
    mount(() => ({ status: 200, body: item }));
    inspector();
    expect(await screen.findByRole("tab", { name: "Details", selected: true })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Details", "Photos", "Size", "Prices"]);
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("leaves attributes without a value to the edit form", async () => {
    mount(() => ({ status: 200, body: item }));
    const withColour = { ...structure, attributes: [...structure.attributes, { id: "a2", code: "colour", label: "Colour", valueType: "text" as const, required: false, choices: [], unitCode: null, categoryId: null }] };
    render(<DesignSystemProvider><CatalogItemInspector canManage catalogId="k1" currency="AED" itemId="i1" structure={withColour} workspaceId="w" /></DesignSystemProvider>);
    expect(await screen.findByRole("button", { name: "Edit Finish" })).toBeInTheDocument();
    expect(screen.queryByText("Colour")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("textbox", { name: "Colour" })).toBeInTheDocument();
  });

  it("shows size text from a sheet under Size, not with the details", async () => {
    const noted = { ...item, itemType: "ready_made", values: { finish: "Oak", size_notes: "Height: 75 cm - seating H 40cm" } };
    const withNotes = { ...structure, attributes: [...structure.attributes, { id: "a3", code: "size_notes", label: "Size notes", valueType: "text" as const, required: false, choices: [], unitCode: null, categoryId: null }] };
    mount((_, url) => url?.includes("items/i1/source") ? { status: 200, body: { size: { width: "300", depth: "120", height: null, diagonalDepth: null, unit: "cm", version: 1 }, defaultUnit: "cm", source: null } } : { status: 200, body: noted });
    render(<DesignSystemProvider><CatalogItemInspector canManage={false} catalogId="k1" currency="AED" itemId="i1" structure={withNotes} workspaceId="w" /></DesignSystemProvider>);
    expect(await screen.findByText("PLY-18")).toBeInTheDocument();
    expect(screen.queryByText("Height: 75 cm - seating H 40cm")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Size" }));
    expect(await screen.findByText("Height: 75 cm - seating H 40cm")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Width" })).toHaveValue("300");
    expect(screen.queryByRole("tab", { name: "Source" })).not.toBeInTheDocument();
  });

  it("shows plain facts to people who can't manage the catalog", async () => {
    mount(() => ({ status: 200, body: item }));
    inspector(false);
    expect(await screen.findByText("PLY-18")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Code" })).not.toBeInTheDocument();
  });
});
