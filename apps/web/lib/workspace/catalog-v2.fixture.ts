import type { CatalogItemRow, CatalogStructure, CatalogSummary, ImportPlan, ImportRow } from "./catalog-v2";

// Development-only data for E2E_AUTH_BYPASS: a small joinery and materials catalog.
const catalog: CatalogSummary = { id: "7a1c0000-0000-4000-8000-000000000001", code: "materials", name: "Materials", purpose: "buy", itemCount: 4, version: 1 };
const structure: CatalogStructure = {
  categories: [
    { id: "7a1c0000-0000-4000-8000-0000000000c1", parentId: null, code: "timber", name: "Timber & boards" },
    { id: "7a1c0000-0000-4000-8000-0000000000c2", parentId: null, code: "hardware", name: "Channels & hinges" },
    { id: "7a1c0000-0000-4000-8000-0000000000c3", parentId: null, code: "electrical", name: "Switches & sockets" },
    { id: "7a1c0000-0000-4000-8000-0000000000c4", parentId: null, code: "joinery", name: "Joinery" },
  ],
  attributes: [
    { id: "a1", code: "size", label: "Size", valueType: "text", required: false, choices: [], unitCode: null, categoryId: null },
    { id: "a2", code: "colour", label: "Colour", valueType: "text", required: false, choices: [], unitCode: null, categoryId: null },
  ],
  units: [{ code: "pcs", label: "piece", kind: "count" }, { code: "sqft", label: "square foot", kind: "area" }, { code: "sheet", label: "sheet", kind: "count" }],
};
const items: CatalogItemRow[] = [
  { id: "7a1c0000-0000-4000-8000-0000000000i1", code: "W00134", name: "Birch plywood (Sveza) 12mm", itemType: "material", unitCode: "sheet", status: "active", version: 1, categoryId: structure.categories[0].id, categoryName: "Timber & boards", values: { size: "4' X 8' X 12MM" }, sellPrice: null },
  { id: "7a1c0000-0000-4000-8000-0000000000i2", code: "HNG-0001", name: "Salice soft-close hinge", itemType: "product", unitCode: "pcs", status: "active", version: 1, categoryId: structure.categories[1].id, categoryName: "Channels & hinges", values: { colour: "G.I. metal" }, sellPrice: { method: "fixed", price: "12.500000", rate: null, currency: "AED", status: "active" } },
  { id: "7a1c0000-0000-4000-8000-0000000000i3", code: "E8331L2_WG", name: "Schneider Avatar On 1 gang 2 way switch", itemType: "product", unitCode: "pcs", status: "active", version: 1, categoryId: structure.categories[2].id, categoryName: "Switches & sockets", values: { colour: "Wine gold" }, sellPrice: { method: "fixed", price: "45.500000", rate: null, currency: "AED", status: "active" } },
  { id: "7a1c0000-0000-4000-8000-0000000000i4", code: "WR-001", name: "Hinged wardrobe", itemType: "assembly", unitCode: "pcs", status: "active", version: 1, categoryId: structure.categories[3].id, categoryName: "Joinery", values: {}, sellPrice: null },
];

export function e2eCatalogResponse(method: string, path: string[], body: unknown, query: URLSearchParams): unknown {
  const [first, section, itemId] = path;
  if (method === "GET" && path.length === 0) return [catalog];
  if (method === "GET" && section === "structure") return structure;
  if (method === "GET" && section === "items" && !itemId) {
    const search = (query.get("search") ?? "").toLowerCase(), categoryId = query.get("categoryId");
    return { items: items.filter((item) => (!search || item.name.toLowerCase().includes(search) || item.code.toLowerCase().includes(search)) && (!categoryId || item.categoryId === categoryId)), nextCursor: null };
  }
  if (method === "GET" && section === "items" && itemId) {
    const item = items.find((row) => row.id === itemId) ?? items[0];
    return { ...item, description: null, wastePercent: null, purchaseRoundTo: null, conversions: [], suppliers: [], canViewCosts: true,
      components: item.itemType === "assembly" ? [{ componentItemId: items[0].id, name: items[0].name, quantityFormula: "width * height / 2973000 * 2", unitCode: "sheet" }, { componentItemId: items[1].id, name: items[1].name, quantityFormula: "ceil(height / 450) * 2", unitCode: "pcs" }] : [],
      prices: item.sellPrice ? [{ id: "p1", priceBookId: "7a1c0000-0000-4000-8000-0000000000b1", variantId: null, method: "fixed", status: "active", version: 2, price: item.sellPrice.price, currency: "AED" }] : [] };
  }
  if (method === "GET" && section === "price-books") return [{ id: "7a1c0000-0000-4000-8000-0000000000b1", name: "Standard prices", currency: "AED", status: "active", version: 1 }];
  if (method === "PUT" && first === "price-books") return { id: "p-new", status: "draft" };
  if (method === "POST" && first === "prices") return { id: section, status: (body as { decision: string }).decision };
  if (method === "POST" && section === "import" && itemId === "ai-clean") {
    const rows = (body as { rows: ImportRow[] }).rows;
    return { suggestions: rows.filter((row) => /[A-Z]{4,}/.test(row.name ?? "")).map((row) => ({ line: row.line, name: (row.name ?? "").toLowerCase().replace(/^./, (c) => c.toUpperCase()).replace(/\s*\[.*$/, ""), unit: row.unit ? undefined : "roll", note: /\d+\s*%/.test(row.name ?? "") ? "Mix ratio in the name" : undefined })) };
  }
  if (method === "POST" && section === "import") {
    const rows = (body as { rows: ImportRow[] }).rows;
    const plan: ImportPlan = {
      rows: rows.map((row, index) => ({ line: row.line, sheet: row.sheet, action: index === 1 ? "error" : "create", code: row.code || `AUTO-${String(index + 1).padStart(4, "0")}`, name: row.name ?? "", category: row.category ?? null, unit: (row.unit ?? "pcs").toLowerCase(), messages: index === 1 ? ["Code is also used on line 3 for a different item"] : row.unit ? [] : ["Unit not given, set to pieces"] })),
      summary: { create: rows.length - 1, update: 0, skip: 0, error: Math.min(1, rows.length), newUnits: [], newCategories: [...new Set(rows.map((row) => row.category ?? ""))].filter(Boolean), newAttributes: [] },
    };
    return plan;
  }
  if (method === "POST" && path.length === 0) return { id: catalog.id };
  if (method === "POST" && section === "items") return items[0];
  return { ok: true, first };
}
