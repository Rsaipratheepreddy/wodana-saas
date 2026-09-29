import { describe, expect, it } from "vitest";
import { priceShowcaseItems, type ShowcasePriceDeps } from "./showcase-prices";

/** An in-memory catalog: which items are priced, the books per catalog, and every call the seed made. */
function catalog(items: Array<{ itemId: string; catalogId: string; priced?: boolean }>, books: Array<{ id: string; catalogId: string; name: string; currency: string; status: string; version: number }> = []) {
  const calls: string[] = [];
  const priced = new Set(items.filter((item) => item.priced).map((item) => item.itemId));
  let drafted = 0;
  const deps: ShowcasePriceDeps = {
    read: async (itemIds, currency) => { calls.push(`read ${currency}`); return items.filter((item) => itemIds.includes(item.itemId)).map((item) => ({ ...item, priced: priced.has(item.itemId) })); },
    books: async (catalogId) => books.filter((book) => book.catalogId === catalogId),
    createBook: async (catalogId, input) => { const id = `book-${books.length + 1}`; books.push({ id, catalogId, ...input, status: "draft", version: 1 }); calls.push(`create ${input.name}`); return { id }; },
    activateBook: async (bookId) => { const book = books.find((row) => row.id === bookId)!; book.status = "active"; book.version += 1; calls.push(`activate ${bookId}`); },
    draft: async (bookId, itemId, input) => { calls.push(`draft ${itemId} ${input.price}/${input.cost}`); drafted += 1; return { id: `${itemId}:${drafted}` }; },
    review: async (entryId) => { priced.add(entryId.split(":")[0]); calls.push(`review ${entryId}`); },
  };
  return { deps, calls, books };
}

describe("the showcase's catalog prices", () => {
  it("prices every picked catalog item in the workspace currency, drafted then reviewed, in one book per catalog", async () => {
    const { deps, calls, books } = catalog([{ itemId: "sofa", catalogId: "core" }, { itemId: "tv", catalogId: "core" }, { itemId: "paint", catalogId: "core", priced: true }]);
    const result = await priceShowcaseItems(deps, { currency: "AED", bookName: "AED list prices", lines: [
      { itemId: "sofa", rate: "17100", unitCost: "9800" }, { itemId: "tv", rate: "320", unitCost: null }, { itemId: "paint", rate: "28", unitCost: "14" }, { itemId: "sofa", rate: "1", unitCost: null },
    ] });
    expect(result).toEqual({ priced: 2, books: ["book-1"] });
    expect(books).toEqual([expect.objectContaining({ name: "AED list prices", currency: "AED", status: "active" })]);
    // The firm's own price (paint) is kept; the first rate for an item is its price.
    expect(calls).toEqual(["read AED", "create AED list prices", "activate book-1", "draft sofa 17100/9800", "review sofa:1", "draft tv 320/null", "review tv:2"]);
  });

  it("changes nothing on a second run", async () => {
    const { deps, calls } = catalog([{ itemId: "sofa", catalogId: "core" }]);
    const input = { currency: "AED", bookName: "AED list prices", lines: [{ itemId: "sofa", rate: "17100", unitCost: "9800" }] };
    await priceShowcaseItems(deps, input);
    calls.length = 0;
    expect(await priceShowcaseItems(deps, input)).toEqual({ priced: 0, books: [] });
    expect(calls).toEqual(["read AED"]);
  });

  it("reuses its book and turns it back on; a free line is never priced", async () => {
    const { deps, calls } = catalog([{ itemId: "sofa", catalogId: "core" }], [{ id: "kept", catalogId: "core", name: "EUR list prices", currency: "EUR", status: "draft", version: 3 }]);
    await priceShowcaseItems(deps, { currency: "EUR", bookName: "EUR list prices", lines: [{ itemId: "sofa", rate: "900", unitCost: null }, { itemId: "free", rate: "0", unitCost: null }] });
    expect(calls).toEqual(["read EUR", "activate kept", "draft sofa 900/null", "review sofa:1"]);
  });
});
