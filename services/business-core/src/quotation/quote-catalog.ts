import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { price, type PriceMethod } from "../catalog-core/pricing";

type Db = Pick<PoolClient, "query">;

export type CatalogHit = {
  id: string; code: string; name: string; itemType: string; unitCode: string; categoryName: string | null;
  description: string | null; rate: string | null; hasBuildUp: boolean;
};

/**
 * Items for the builder's autocomplete: every active catalog item matching the text, with its sell
 * price per unit from the price book used for this quote (the workspace's chosen book, or the newest
 * active book in the quote's currency). An item with no price still shows; its rate is empty.
 */
export async function searchCatalog(db: Db, workspaceId: string, input: { search: string; currency: string; priceBookId: string | null; limit?: number }): Promise<CatalogHit[]> {
  const search = input.search.trim();
  const rows = await db.query<CatalogHit & { method: string | null; price: string | null; entryRate: string | null; cost: string | null; markup: string | null }>(
    `SELECT item.id, item.code, item.name, item.item_type AS "itemType", item.unit_code AS "unitCode", category.name AS "categoryName",
            item.description, EXISTS (SELECT 1 FROM catalog_components component WHERE component.parent_item_id = item.id) AS "hasBuildUp",
            entry.method, entry.price::text AS price, entry.rate::text AS "entryRate", entry.cost::text AS cost, entry.markup_percent::text AS markup
       FROM catalog_items item
       LEFT JOIN catalog_categories category ON category.id = item.category_id
       LEFT JOIN LATERAL (
         SELECT entry.* FROM price_entries entry JOIN price_books book ON book.id = entry.price_book_id
          WHERE entry.workspace_id = item.workspace_id AND entry.item_id = item.id AND entry.variant_id IS NULL AND entry.status IN ('active', 'reviewed')
            AND (($3::uuid IS NOT NULL AND book.id = $3::uuid) OR ($3::uuid IS NULL AND book.status = 'active' AND book.currency = $4))
          ORDER BY book.effective_from DESC LIMIT 1) entry ON true
      WHERE item.workspace_id = $1 AND item.status = 'active'
        AND ($2 = '' OR item.name ILIKE '%' || $2 || '%' OR item.code ILIKE '%' || $2 || '%' OR category.name ILIKE '%' || $2 || '%')
      ORDER BY (item.name ILIKE $2 || '%') DESC, item.name
      LIMIT $5`,
    [workspaceId, search.replace(/[%_\\]/g, "\\$&"), input.priceBookId, input.currency, Math.min(Math.max(input.limit ?? 12, 1), 50)]);
  return rows.rows.map(({ method, price: fixedPrice, entryRate, cost, markup, ...hit }) => ({
    ...hit,
    rate: method === "fixed" || method === "attribute_surcharge" || method === "tiered" ? fixedPrice
      : method === "per_measure" ? entryRate
      : method === "cost_plus" && cost && markup ? Dec.of(cost).mul(Dec.of(markup).add(100)).div(100).toFixed(2)
      : null,
  }));
}

export type CatalogLine = {
  snapshot: { itemId: string; code: string; name: string; itemType: string; unitCode: string; categoryName: string | null; priceBookId: string | null; method: string | null; version: number; pricedAt: string };
  title: string; description: string; unit: string; kind: "item" | "service";
  rate: string | null; unitCost: string | null; priceReason: string | null;
  /** Priced as the sum of its parts: labour per unit and margin on top. */
  rollup: { labour: string | null; marginPercent: string | null } | null;
  components: Array<{ catalogItemId: string; name: string; kind: "material" | "labour" | "hardware" | "finish" | "other"; quantityFormula: string; unit: string; rate: string | null; unitCost: string | null; wastePercent: string | null }>;
};

/**
 * One catalog item as a quote line: title, unit, description, sell rate (and cost) from the price
 * book, and, for an assembly, what it's made of with each part's formula and price. A missing
 * price stays empty with the reason; nothing is guessed.
 */
export async function catalogLine(db: Db, workspaceId: string, input: { itemId: string; currency: string; priceBookId: string | null; decimals: number; quantity?: string }): Promise<CatalogLine | null> {
  const item = (await db.query<{ id: string; code: string; name: string; itemType: string; unitCode: string; description: string | null; categoryName: string | null; version: number }>(
    `SELECT item.id, item.code, item.name, item.item_type AS "itemType", item.unit_code AS "unitCode", item.description, category.name AS "categoryName", item.version
       FROM catalog_items item LEFT JOIN catalog_categories category ON category.id = item.category_id
      WHERE item.workspace_id = $1 AND item.id = $2 AND item.status = 'active'`, [workspaceId, input.itemId])).rows[0];
  if (!item) return null;
  const book = (await db.query<{ id: string }>(
    `SELECT book.id FROM price_books book JOIN price_entries entry ON entry.price_book_id = book.id AND entry.item_id = $2 AND entry.variant_id IS NULL AND entry.status IN ('active', 'reviewed')
      WHERE book.workspace_id = $1 AND (($3::uuid IS NOT NULL AND book.id = $3::uuid) OR ($3::uuid IS NULL AND book.status = 'active' AND book.currency = $4))
      ORDER BY book.effective_from DESC LIMIT 1`, [workspaceId, item.id, input.priceBookId, input.currency])).rows[0];
  const entryOf = async (itemId: string) => book ? (await db.query<{ id: string; method: string; price: string | null; cost: string | null; markupPercent: string | null; rate: string | null; minimumCharge: string | null; labour: string | null; marginPercent: string | null }>(
    `SELECT id, method, price::text AS price, cost::text AS cost, markup_percent::text AS "markupPercent", rate::text AS rate,
            minimum_charge::text AS "minimumCharge", labour::text AS labour, margin_percent::text AS "marginPercent"
       FROM price_entries WHERE workspace_id = $1 AND price_book_id = $2 AND item_id = $3 AND variant_id IS NULL AND status IN ('active', 'reviewed') LIMIT 1`,
    [workspaceId, book.id, itemId])).rows[0] ?? null : null;
  const supplierCost = async (itemId: string) => (await db.query<{ cost: string | null }>(
    `SELECT cost::text AS cost FROM catalog_supplier_links WHERE workspace_id = $1 AND item_id = $2 AND variant_id IS NULL AND cost IS NOT NULL AND currency = $3
      ORDER BY preferred DESC, cost LIMIT 1`, [workspaceId, itemId, input.currency])).rows[0]?.cost ?? null;
  const unitRate = (entry: Awaited<ReturnType<typeof entryOf>>) => {
    if (!entry) return null;
    const method: PriceMethod | null = entry.method === "fixed" || entry.method === "attribute_surcharge" || entry.method === "tiered"
      ? (entry.price ? { method: "fixed", price: entry.price } : null)
      : entry.method === "per_measure" ? { method: "per_measure", rate: entry.rate! }
      : entry.method === "cost_plus" ? { method: "cost_plus", cost: entry.cost!, markupPercent: entry.markupPercent! }
      : null;
    const result = price(method, { quantity: "1", currencyDecimals: input.decimals });
    return result.available ? result.unitPrice : null;
  };

  const parts = await db.query<{ componentItemId: string; name: string; itemType: string; quantityFormula: string; unitCode: string; wastePercent: string | null }>(
    `SELECT component.component_item_id AS "componentItemId", child.name, child.item_type AS "itemType", component.quantity_formula AS "quantityFormula",
            component.unit_code AS "unitCode", child.waste_percent::text AS "wastePercent"
       FROM catalog_components component JOIN catalog_items child ON child.id = component.component_item_id
      WHERE component.workspace_id = $1 AND component.parent_item_id = $2 ORDER BY component.sort_order`, [workspaceId, item.id]);
  const components = [];
  for (const part of parts.rows) {
    const entry = await entryOf(part.componentItemId);
    components.push({
      catalogItemId: part.componentItemId, name: part.name,
      kind: (part.itemType === "service" ? "labour" : "material") as "labour" | "material",
      quantityFormula: part.quantityFormula, unit: part.unitCode, rate: unitRate(entry),
      unitCost: entry?.cost ?? await supplierCost(part.componentItemId), wastePercent: part.wastePercent,
    });
  }

  const entry = await entryOf(item.id);
  let rate = unitRate(entry), reason: string | null = null;
  // An assembly priced as a roll-up sells for the sum of its parts (+ labour and margin).
  if (entry?.method === "assembly_rollup") rate = null;
  if (!entry) reason = book ? "No price in this price book" : `No active price book in ${input.currency}`;
  else if (rate === null && entry.method !== "assembly_rollup") reason = "Price incomplete";
  return {
    snapshot: { itemId: item.id, code: item.code, name: item.name, itemType: item.itemType, unitCode: item.unitCode, categoryName: item.categoryName, priceBookId: book?.id ?? null, method: entry?.method ?? null, version: item.version, pricedAt: new Date().toISOString() },
    title: item.name, description: item.description ?? "", unit: item.unitCode, kind: item.itemType === "service" ? "service" : "item",
    rate, unitCost: entry?.cost ?? await supplierCost(item.id), priceReason: reason, components,
    rollup: entry?.method === "assembly_rollup" || (!entry && components.length) ? { labour: entry?.labour ?? null, marginPercent: entry?.marginPercent ?? null } : null,
  };
}
