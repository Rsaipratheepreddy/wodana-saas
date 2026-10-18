/**
 * The showcase's catalog prices: every catalog item a seeded quotation picks gets a live price in the
 * workspace's currency, so a picked line reads its rate from a price book (as a real quote does) instead of
 * "No active price book". Items the firm already priced keep their price; only the unpriced ones are priced,
 * at the showcase's own demonstration rate, in one price book per catalog. Each price is drafted by one person
 * and reviewed by another (the catalog's own rule). A second run finds everything priced and changes nothing.
 */
export type ShowcasePriceLine = { itemId: string; rate: string; unitCost: string | null };

export type ShowcasePriceDeps = {
  /** Each item's catalog, and whether it already has a live price (active or reviewed) in an active book in this currency. */
  read: (itemIds: string[], currency: string) => Promise<Array<{ itemId: string; catalogId: string; priced: boolean }>>;
  books: (catalogId: string) => Promise<Array<{ id: string; name: string; currency: string; status: string; version: number }>>;
  createBook: (catalogId: string, input: { name: string; currency: string }) => Promise<{ id: string }>;
  activateBook: (bookId: string, version: number) => Promise<unknown>;
  draft: (bookId: string, itemId: string, input: { method: "fixed"; price: string; cost: string | null }) => Promise<{ id: string }>;
  review: (entryId: string) => Promise<unknown>;
};

export async function priceShowcaseItems(deps: ShowcasePriceDeps, input: { currency: string; bookName: string; lines: ShowcasePriceLine[] }) {
  const byItem = new Map<string, ShowcasePriceLine>();
  for (const line of input.lines) if (Number(line.rate) > 0 && !byItem.has(line.itemId)) byItem.set(line.itemId, line);
  if (!byItem.size) return { priced: 0, books: [] as string[] };
  const unpriced = (await deps.read([...byItem.keys()], input.currency)).filter((item) => !item.priced);
  const books: string[] = [];
  let priced = 0;
  for (const catalogId of [...new Set(unpriced.map((item) => item.catalogId))]) {
    const existing = (await deps.books(catalogId)).find((book) => book.name === input.bookName && book.currency === input.currency && book.status !== "expired");
    const bookId = existing?.id ?? (await deps.createBook(catalogId, { name: input.bookName, currency: input.currency })).id;
    if (existing?.status !== "active") await deps.activateBook(bookId, existing?.version ?? 1);
    books.push(bookId);
    for (const item of unpriced.filter((row) => row.catalogId === catalogId)) {
      const line = byItem.get(item.itemId)!;
      const entry = await deps.draft(bookId, item.itemId, { method: "fixed", price: line.rate, cost: line.unitCost });
      await deps.review(entry.id);
      priced += 1;
    }
  }
  return { priced, books };
}
