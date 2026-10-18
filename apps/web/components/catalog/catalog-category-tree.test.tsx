import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { CatalogStructure } from "@/lib/workspace/catalog-v2";
import { CatalogPage } from "./catalog-page";

afterEach(() => vi.unstubAllGlobals());

// The server counts each category with everything below it; the page loads only a page of items.
const structure: CatalogStructure = {
  categories: [
    { id: "chairs", parentId: null, code: "chairs", name: "Chairs", version: 2, itemCount: 50 },
    { id: "dining", parentId: "chairs", code: "dining-chairs", name: "Dining Chairs", version: 1, itemCount: 19 },
    { id: "lounge", parentId: "chairs", code: "lounge-chairs", name: "Lounge Chairs", version: 3, itemCount: 31 },
    { id: "sofa", parentId: null, code: "sofa", name: "Sofa", version: 1, itemCount: 53 },
    { id: "lamps", parentId: null, code: "lamps", name: "Lamps", version: 4, itemCount: 0 },
  ],
  attributes: [],
  units: [{ code: "pcs", label: "Piece", kind: "count" }],
};
const catalog = { id: "k1", code: "core", name: "Core Collection", purpose: "sell" as const, itemCount: 103, version: 1 };
const item = (index: number) => ({ id: `i${index}`, code: `S${index}`, name: `Sofa ${index}`, itemType: "product", unitCode: "pcs", status: "active", version: 1, categoryId: "sofa", categoryName: "Sofa", values: {}, sellPrice: null });

function mount() {
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => ({ ok: true, status: 200,
    json: async () => url.includes("/structure") ? structure : url.includes("/items") ? { items: [item(1), item(2)] } : { id: "ok" } }));
  vi.stubGlobal("fetch", fetcher);
  render(<DesignSystemProvider><CatalogPage workspaceId="w" canManage currency="USD" initialCatalogs={[catalog]} /></DesignSystemProvider>);
  return fetcher;
}
const tree = () => screen.getByRole("navigation", { name: "Categories" });
const rowOf = (name: string) => within(tree()).getByRole("button", { name: new RegExp(`^${name}(\\s*\\d+)?$`) }).parentElement!;

describe("catalog categories", () => {
  it("counts each category on the server, never from the loaded page, and nests sub-categories", async () => {
    const user = userEvent.setup();
    const fetcher = mount();
    expect(await within(tree()).findByRole("button", { name: /^Sofa\s*53$/ })).toBeInTheDocument();
    expect(within(tree()).getByRole("button", { name: /^Chairs\s*50$/ })).toBeInTheDocument();
    expect(within(tree()).queryByRole("button", { name: /Dining Chairs/ })).not.toBeInTheDocument();
    await user.click(within(tree()).getByRole("button", { name: "Expand Chairs" }));
    expect(within(tree()).getByRole("button", { name: /^Dining Chairs\s*19$/ })).toBeInTheDocument();
    expect(rowOf("Dining Chairs")).toHaveAttribute("data-depth", "1");
    // Opening a parent lists its items and its sub-categories' (the list query includes them).
    await user.click(within(tree()).getByRole("button", { name: /^Chairs\s*50$/ }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("/items?categoryId=chairs"))).toBe(true));
    // Counts stay the server's while a category is open.
    expect(within(tree()).getByRole("button", { name: /^Sofa\s*53$/ })).toBeInTheDocument();
  });

  it("renames and moves, merges and deletes a category through version-checked commands", async () => {
    const user = userEvent.setup();
    const fetcher = mount();
    await within(tree()).findByRole("button", { name: /^Sofa\s*53$/ });
    const sent = () => fetcher.mock.calls.filter(([, init]) => init?.method && init.method !== "GET").map(([url, init]) => ({ url: String(url), method: init!.method, body: init!.body ? JSON.parse(String(init!.body)) : undefined }));

    await user.click(within(rowOf("Lamps")).getByRole("button", { name: "Actions for Lamps" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename or move" }));
    let dialog = await screen.findByRole("dialog", { name: "Rename or move" });
    await user.clear(within(dialog).getByRole("textbox", { name: "Name" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Lighting");
    await user.click(within(dialog).getByRole("button", { name: /Inside/ }));
    await user.click(await screen.findByRole("option", { name: "Chairs" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent().at(-1)).toMatchObject({ method: "PATCH", body: { version: 4, name: "Lighting", parentId: "chairs" } }));
    expect(sent().at(-1)!.url).toContain("/api/workspace/catalogs/k1/categories/lamps?");

    await user.click(within(rowOf("Sofa")).getByRole("button", { name: "Actions for Sofa" }));
    // A category with items can't be deleted, only merged.
    expect(await screen.findByRole("menuitem", { name: "Delete" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("menuitem", { name: "Merge into another category" }));
    dialog = await screen.findByRole("dialog", { name: "Merge Sofa" });
    await user.click(within(dialog).getByRole("button", { name: /Merge into/ }));
    // Never into itself.
    expect(screen.queryByRole("option", { name: "Sofa" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: "Lounge Chairs" }));
    expect(within(dialog).getByText("53 items move to Lounge Chairs, and Sofa is removed.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(sent().at(-1)).toMatchObject({ method: "POST", body: { version: 1, intoId: "lounge" } }));
    expect(sent().at(-1)!.url).toContain("/categories/sofa/merge?");

    await user.click(within(rowOf("Lamps")).getByRole("button", { name: "Actions for Lamps" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    dialog = await screen.findByRole("dialog", { name: "Delete Lamps?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(sent().at(-1)).toMatchObject({ method: "DELETE" }));
    expect(sent().at(-1)!.url).toContain("/categories/lamps?version=4&workspaceId=w");
  });

  it("never offers a category its own sub-category as a parent", async () => {
    const user = userEvent.setup();
    mount();
    await within(tree()).findByRole("button", { name: /^Chairs\s*50$/ });
    await user.click(within(rowOf("Chairs")).getByRole("button", { name: "Actions for Chairs" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename or move" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename or move" });
    await user.click(within(dialog).getByRole("button", { name: /Inside/ }));
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual(["Top level", "Lamps", "Sofa"]);
  });
});
