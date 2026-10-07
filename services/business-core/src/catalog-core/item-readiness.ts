import type { PoolClient } from "pg";
import { STANDARD_UNITS } from "./units";

type Db = Pick<PoolClient, "query">;

/**
 * Item readiness: per catalogue item (and per project line), one cell per thing a product needs before it can be
 * quoted, drawn, bought, made and delivered, each worked out from the records. Nothing here is stored: the cells are
 * read from the item's pictures, size, prices, drawing link, components and attributes every time.
 *
 * A cell is `done`, `missing`, `waiting` (in hand, not finished) or `not_needed` for that kind of item. A cell with
 * the record in hand is done whatever the item's kind; only a missing record depends on the kind.
 */
export const READINESS_COLUMNS = ["picture", "size", "price", "drawing", "materials", "labour", "selection", "purchase", "production", "delivery"] as const;
export type ReadinessColumn = (typeof READINESS_COLUMNS)[number];
/** The columns a catalogue item has by itself (the rest belong to a project's line). */
export const CATALOG_COLUMNS = ["picture", "size", "price", "drawing", "materials", "labour"] as const satisfies readonly ReadinessColumn[];
export type CatalogColumn = (typeof CATALOG_COLUMNS)[number];

export type CellState = "done" | "missing" | "waiting" | "not_needed";
/**
 * Why a cell reads as it does, for the screen's words: `from_sheet` (only the imported sheet's text says so),
 * `components`, `in_review`, and the project notes (drawing, selection, purchase, production and delivery steps).
 */
export type ReadinessCell = { state: CellState; note?: string; detail?: string };

/** Item kinds that are made (joinery and packages): they need their materials and labour worked out. */
const MADE = new Set(["assembly", "package"]);
/** Item kinds that are drawn (services and raw materials aren't). */
const NOT_DRAWN = new Set(["service", "material"]);
/** Item kinds with an outside size worth knowing (furniture, products, assemblies). */
const SIZED = new Set(["product", "ready_made", "assembly", "package"]);
/** Units of time: a component counted in them is labour. */
export const TIME_UNITS = STANDARD_UNITS.filter((unit) => unit.kind === "time").map((unit) => unit.code);

export type CatalogFacts = {
  itemType: string;
  /** The catalogue's purpose: a catalogue of materials we buy has no selling prices. */
  catalogPurpose: string;
  hasImage: boolean; hasSize: boolean; sizeNotes: string;
  /** `live`: a selling price is active; `pending`: one waits in draft or review. */
  price: "live" | "pending" | null;
  drawingUrl: string | null;
  materialComponents: number; labourComponents: number;
  /** What the configured sheet attributes say about materials and labour (empty when nothing). */
  materialText: string; labourText: string;
};

const done = (note?: string, detail?: string): ReadinessCell => ({ state: "done", ...(note ? { note } : {}), ...(detail ? { detail } : {}) });
const need = (needed: boolean): ReadinessCell => ({ state: needed ? "missing" : "not_needed" });

/** The catalogue cells of one item. */
export function catalogCells(facts: CatalogFacts): Record<CatalogColumn, ReadinessCell> {
  const type = facts.itemType;
  const made = MADE.has(type);
  return {
    picture: facts.hasImage ? done() : need(type !== "service"),
    size: facts.hasSize ? done() : facts.sizeNotes.trim() ? done("from_sheet", facts.sizeNotes.trim()) : need(SIZED.has(type)),
    price: facts.price === "live" ? done() : facts.price === "pending" ? { state: "waiting", note: "in_review" } : need(facts.catalogPurpose === "sell"),
    drawing: facts.drawingUrl ? done() : need(!NOT_DRAWN.has(type)),
    materials: facts.materialComponents > 0 ? done("components") : facts.materialText.trim() ? done("from_sheet", facts.materialText.trim()) : need(made),
    labour: facts.labourComponents > 0 ? done("components") : facts.labourText.trim() ? done("from_sheet", facts.labourText.trim()) : need(made),
  };
}

/** How many of the shown columns are missing. */
export function missingCount(cells: Partial<Record<ReadinessColumn, ReadinessCell>>, columns: readonly ReadinessColumn[]) {
  return columns.filter((column) => cells[column]?.state === "missing").length;
}

// ---------- settings (workspace configuration) ----------

export type ReadinessSettings = {
  /** The columns shown and counted, in the standard order. */
  columns: ReadinessColumn[];
  /** Catalogue attribute codes whose text counts as the item's materials, and as its trades and hours (an imported sheet's columns). */
  materialAttributes: string[]; labourAttributes: string[];
  version: number;
  /** False until someone saved the settings: the attributes are then guessed from their names. */
  saved: boolean;
};

const CODE = /^[a-z][a-z0-9_]{0,59}$/;
/** Attribute names that usually hold a sheet's materials, and its trades or hours (the first guess, until the firm chooses). */
const MATERIAL_WORDS = /(^|_)materials?(_|$)/;
const LABOUR_WORDS = /(^|_)(trades?|labou?r|hours?|manpower|man_hours?|man_days?)(_|$)/;

/** The first guess at the evidence attributes, from the codes a workspace's catalogues use. */
export function guessEvidence(codes: string[]) {
  const usable = codes.filter((code) => code !== "size_notes");
  return { materialAttributes: usable.filter((code) => MATERIAL_WORDS.test(code)).sort(), labourAttributes: usable.filter((code) => LABOUR_WORDS.test(code) && !MATERIAL_WORDS.test(code)).sort() };
}

/** Validates the settings sent to be saved. Throws a message for the person when something is wrong. */
export function parseReadinessSettings(input: Record<string, unknown>): Pick<ReadinessSettings, "columns" | "materialAttributes" | "labourAttributes"> {
  const list = (value: unknown, label: string) => {
    if (!Array.isArray(value) || value.length > 50 || value.some((entry) => typeof entry !== "string")) throw new ReadinessSettingsError(`${label} must be a list.`);
    return [...new Set(value as string[])];
  };
  const columns = list(input.columns, "Columns");
  if (columns.some((column) => !READINESS_COLUMNS.includes(column as ReadinessColumn))) throw new ReadinessSettingsError("Unknown readiness column.");
  if (!columns.length) throw new ReadinessSettingsError("Keep at least one column.");
  const materialAttributes = list(input.materialAttributes ?? [], "Material attributes");
  const labourAttributes = list(input.labourAttributes ?? [], "Labour attributes");
  if ([...materialAttributes, ...labourAttributes].some((code) => !CODE.test(code))) throw new ReadinessSettingsError("Unknown attribute.");
  return { columns: READINESS_COLUMNS.filter((column) => columns.includes(column)), materialAttributes: materialAttributes.sort(), labourAttributes: labourAttributes.sort() };
}

export class ReadinessSettingsError extends Error {}

/** The workspace's readiness settings, or the defaults (every column; attributes guessed from their names). */
export async function readReadinessSettings(db: Db, workspaceId: string): Promise<ReadinessSettings> {
  const row = (await db.query<{ columns: string[]; materialAttributes: string[]; labourAttributes: string[]; version: number }>(
    `SELECT columns, material_attributes AS "materialAttributes", labour_attributes AS "labourAttributes", version
       FROM workspace_readiness_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
  if (row) return { columns: READINESS_COLUMNS.filter((column) => row.columns.includes(column)), materialAttributes: row.materialAttributes, labourAttributes: row.labourAttributes, version: row.version, saved: true };
  const codes = (await db.query<{ code: string }>(`SELECT DISTINCT code FROM catalog_attributes WHERE workspace_id = $1 AND status = 'active'`, [workspaceId])).rows.map((entry) => entry.code);
  return { columns: [...READINESS_COLUMNS], ...guessEvidence(codes), version: 0, saved: false };
}

// ---------- catalogue reads ----------

export type ReadinessItem = {
  id: string; catalogId: string; code: string; name: string; itemType: string; unitCode: string; categoryName: string | null;
  image: { id: string; hasPreview: boolean } | null;
};
type FactRow = ReadinessItem & Omit<CatalogFacts, "materialText" | "labourText" | "sizeNotes"> & { values: Record<string, string> };

/** The text of the chosen attributes, in the order chosen ("Wood, fabric, foam · 2 sheets"). */
export function evidenceText(values: Record<string, string>, codes: string[]) {
  return codes.map((code) => (values[code] ?? "").trim()).filter(Boolean).join(" · ");
}

/**
 * The facts of catalogue items: those of one catalogue (optionally a category and below, or matching a search), or
 * the given items. Archived items are left out of a catalogue's list.
 */
export async function readCatalogFacts(db: Db, workspaceId: string, scope: { catalogId: string; categoryId?: string | null; search?: string | null; limit?: number } | { itemIds: string[] }) {
  const values: unknown[] = [workspaceId, TIME_UNITS];
  const where = ["item.workspace_id = $1"];
  if ("itemIds" in scope) {
    if (!scope.itemIds.length) return [];
    values.push(scope.itemIds); where.push(`item.id = ANY($${values.length}::uuid[])`);
  } else {
    values.push(scope.catalogId); where.push(`item.catalog_id = $${values.length}`, "item.status <> 'archived'");
    if (scope.categoryId) {
      values.push(scope.categoryId);
      where.push(`item.category_id IN (WITH RECURSIVE tree AS (SELECT id FROM catalog_categories WHERE workspace_id = $1 AND id = $${values.length}
        UNION ALL SELECT child.id FROM catalog_categories child JOIN tree ON child.parent_id = tree.id) SELECT id FROM tree)`);
    }
    if (scope.search?.trim()) { values.push(`%${scope.search.trim().replace(/[%_\\]/g, "\\$&")}%`); where.push(`(item.name ILIKE $${values.length} OR item.code ILIKE $${values.length})`); }
  }
  values.push(Math.min(Math.max("itemIds" in scope ? scope.itemIds.length : scope.limit ?? 1000, 1), 2000));
  return (await db.query<FactRow>(
    `SELECT item.id, item.catalog_id AS "catalogId", item.code, item.name, item.item_type AS "itemType", item.unit_code AS "unitCode", category.name AS "categoryName",
            catalog.purpose AS "catalogPurpose",
            (SELECT jsonb_build_object('id', image.id, 'hasPreview', image.preview_key IS NOT NULL) FROM catalog_item_images image
              WHERE image.workspace_id = item.workspace_id AND image.item_id = item.id ORDER BY image.sort_order, image.created_at LIMIT 1) AS image,
            EXISTS (SELECT 1 FROM catalog_item_images image WHERE image.workspace_id = item.workspace_id AND image.item_id = item.id) AS "hasImage",
            EXISTS (SELECT 1 FROM catalog_item_dimensions size WHERE size.workspace_id = item.workspace_id AND size.item_id = item.id
                      AND (size.width IS NOT NULL OR size.depth IS NOT NULL OR size.height IS NOT NULL)) AS "hasSize",
            (SELECT CASE WHEN bool_or(entry.status = 'active' AND book.status = 'active') THEN 'live' WHEN count(*) > 0 THEN 'pending' END
               FROM price_entries entry JOIN price_books book ON book.workspace_id = entry.workspace_id AND book.id = entry.price_book_id
              WHERE entry.workspace_id = item.workspace_id AND entry.item_id = item.id AND entry.variant_id IS NULL AND entry.status <> 'expired' AND book.status <> 'expired') AS price,
            nullif(btrim(coalesce(item.technical_drawing_url, '')), '') AS "drawingUrl",
            (SELECT count(*)::int FROM catalog_components component JOIN catalog_items part ON part.workspace_id = component.workspace_id AND part.id = component.component_item_id
              WHERE component.workspace_id = item.workspace_id AND component.parent_item_id = item.id AND part.item_type <> 'service' AND NOT component.unit_code = ANY($2::text[])) AS "materialComponents",
            (SELECT count(*)::int FROM catalog_components component JOIN catalog_items part ON part.workspace_id = component.workspace_id AND part.id = component.component_item_id
              WHERE component.workspace_id = item.workspace_id AND component.parent_item_id = item.id AND (part.item_type = 'service' OR component.unit_code = ANY($2::text[]))) AS "labourComponents",
            coalesce((SELECT jsonb_object_agg(attribute.code, value.value) FROM catalog_item_values value
                        JOIN catalog_attributes attribute ON attribute.workspace_id = value.workspace_id AND attribute.id = value.attribute_id
                       WHERE value.workspace_id = item.workspace_id AND value.item_id = item.id AND btrim(value.value) <> ''), '{}'::jsonb) AS "values"
       FROM catalog_items item
       JOIN catalogs catalog ON catalog.workspace_id = item.workspace_id AND catalog.id = item.catalog_id
       LEFT JOIN catalog_categories category ON category.workspace_id = item.workspace_id AND category.id = item.category_id
      WHERE ${where.join(" AND ")}
      ORDER BY item.name, item.id LIMIT $${values.length}`, values)).rows;
}

export type CatalogReadinessRow = ReadinessItem & { cells: Record<CatalogColumn, ReadinessCell>; missing: number };

/** Readiness rows from the facts and the settings. */
export function catalogRows(facts: FactRow[], settings: Pick<ReadinessSettings, "columns" | "materialAttributes" | "labourAttributes">): CatalogReadinessRow[] {
  const shown = CATALOG_COLUMNS.filter((column) => settings.columns.includes(column));
  return facts.map(({ values, catalogPurpose, hasImage, hasSize, price, drawingUrl, materialComponents, labourComponents, ...item }) => {
    const cells = catalogCells({
      itemType: item.itemType, catalogPurpose, hasImage, hasSize, sizeNotes: values.size_notes ?? "", price, drawingUrl, materialComponents, labourComponents,
      materialText: evidenceText(values, settings.materialAttributes), labourText: evidenceText(values, settings.labourAttributes),
    });
    return { ...item, cells, missing: missingCount(cells, shown) };
  });
}
