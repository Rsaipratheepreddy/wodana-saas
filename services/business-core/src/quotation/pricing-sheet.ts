import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";

type Db = Pick<PoolClient, "query">;

/** What a quotation line takes from the job: its size (L / H / D, depth kept as the line's width), materials and picture. */
export type SheetFill = {
  size: { length: string | null; width: string | null; height: string | null; unit: string; from: "site_measure" | "catalog" | "estimate" } | null;
  material: string;
  imageAssetId: string | null;
};

const TO_METRES: Record<string, string> = { mm: "0.001", cm: "0.01", m: "1", in: "0.0254", ft: "0.3048" };

/** Which side of the line a named dimension is: length (or width across), height, or depth. */
export function dimensionSide(name: string): "length" | "height" | "width" | null {
  const word = name.trim().toLowerCase();
  if (/depth|deep|^d$/.test(word)) return "width";
  if (/height|high|tall|^h$/.test(word)) return "height";
  if (/length|long|width|wide|^l$|^w$/.test(word)) return "length";
  return null;
}

type Dimension = { name?: unknown; measured?: unknown; approximate?: unknown; unit?: unknown };

/**
 * A requirement's dimensions as a line's size, in the unit of the first one: measured values (the site measure) when
 * every side found is measured, else the approximate ones. Null when no dimension names a side.
 */
export function sizeFromDimensions(dimensions: Dimension[]): SheetFill["size"] {
  const sides = dimensions.flatMap((dimension) => {
    const side = typeof dimension.name === "string" ? dimensionSide(dimension.name) : null;
    const unit = typeof dimension.unit === "string" && TO_METRES[dimension.unit] ? dimension.unit : null;
    return side && unit ? [{ side, unit, measured: typeof dimension.measured === "number" ? dimension.measured : null, approximate: typeof dimension.approximate === "number" ? dimension.approximate : null }] : [];
  });
  if (!sides.length) return null;
  const measured = sides.every((side) => side.measured !== null);
  const unit = sides[0].unit;
  const size: NonNullable<SheetFill["size"]> = { length: null, width: null, height: null, unit, from: measured ? "site_measure" : "estimate" };
  for (const side of sides) {
    const value = measured ? side.measured : side.approximate;
    if (value === null || size[side.side] !== null) continue;
    size[side.side] = Dec.of(String(value)).mul(TO_METRES[side.unit]).div(TO_METRES[unit]).round(4).toFixed(4).replace(/\.?0+$/, "");
  }
  return size.length || size.width || size.height ? size : null;
}

/**
 * Guide step 12 (the pricing request sheet): a line added to the quotation takes, where it has none of its own,
 * - its L / H / D from the site measure of the requirement it covers (joinery), else the catalogue item's standard size
 *   (furniture), else the requirement's estimate;
 * - its materials from the requirement's specification, else the materials the client chose for its room;
 * - its picture from the render referenced by the requirement, else the room's approved render.
 */
export async function pricingSheetFill(db: Db, workspaceId: string, caseId: string, line: { scopeId: string | null; areaId: string | null; catalogItemId: string | null }): Promise<SheetFill> {
  const spec = line.scopeId ? (await db.query<{ version: number; content: { dimensions?: Dimension[]; materials?: Array<Record<string, unknown>> } }>(
    `SELECT version, content FROM pre_project_item_specifications WHERE workspace_id = $1 AND case_id = $2 AND entry_id = $3 ORDER BY version DESC LIMIT 1`,
    [workspaceId, caseId, line.scopeId])).rows[0] ?? null : null;
  const fromSpec = sizeFromDimensions(Array.isArray(spec?.content.dimensions) ? spec!.content.dimensions : []);
  let size = fromSpec?.from === "site_measure" ? fromSpec : null;
  if (!size && line.catalogItemId) {
    const standard = (await db.query<{ width: string | null; depth: string | null; height: string | null; unit: string }>(
      `SELECT width::text, depth::text, height::text, unit FROM catalog_item_dimensions WHERE workspace_id = $1 AND item_id = $2`, [workspaceId, line.catalogItemId])).rows[0];
    if (standard && (standard.width || standard.depth || standard.height))
      size = { length: standard.width, width: standard.depth, height: standard.height, unit: standard.unit, from: "catalog" };
  }
  size ??= fromSpec;

  const specMaterials = (Array.isArray(spec?.content.materials) ? spec!.content.materials : []).map((material) =>
    [material.productName, material.finishCode].filter((part) => typeof part === "string" && part.trim()).join(" ")).filter(Boolean);
  const chosen = specMaterials.length || !line.areaId ? [] : (await db.query<{ text: string }>(
    `SELECT concat_ws(' · ', nullif(btrim(version.title), ''), nullif(btrim(version.specification), '')) AS text
       FROM design_ledger_entries entry
       JOIN LATERAL (SELECT title, specification, status FROM design_ledger_versions version WHERE version.workspace_id = entry.workspace_id AND version.entry_id = entry.id
                      AND version.status IN ('proposed', 'confirmed') ORDER BY version.number DESC LIMIT 1) version ON version.status = 'confirmed'
      WHERE entry.workspace_id = $1 AND entry.case_id = $2 AND entry.room_id = $3 AND entry.kind = 'material' AND entry.archived_at IS NULL
      ORDER BY entry.position, entry.created_at`, [workspaceId, caseId, line.areaId])).rows.map((row) => row.text).filter(Boolean);
  const material = (specMaterials.length ? specMaterials : chosen).join(" / ").slice(0, 500);

  const picture = async (sql: string, values: unknown[]) => (await db.query<{ id: string }>(sql, values)).rows[0]?.id ?? null;
  const imageAssetId = (spec && line.scopeId ? await picture(
    `SELECT asset.id FROM pre_project_item_design_refs ref
       JOIN pre_project_design_versions version ON version.workspace_id = ref.workspace_id AND version.id = ref.design_version_id
       JOIN pre_project_brief_assets asset ON asset.workspace_id = version.workspace_id AND asset.case_id = version.case_id AND asset.id = version.asset_id AND asset.mime_type LIKE 'image/%'
      WHERE ref.workspace_id = $1 AND ref.case_id = $2 AND ref.entry_id = $3 AND ref.version = $4
      ORDER BY CASE ref.usage WHEN '3d' THEN 0 WHEN '2d' THEN 1 ELSE 2 END LIMIT 1`, [workspaceId, caseId, line.scopeId, spec.version]) : null)
    ?? (line.areaId ? await picture(
      `SELECT asset.id FROM pre_project_designs design
         JOIN pre_project_design_versions version ON version.workspace_id = design.workspace_id AND version.design_id = design.id AND version.status = 'approved'
         JOIN pre_project_brief_assets asset ON asset.workspace_id = version.workspace_id AND asset.case_id = version.case_id AND asset.id = version.asset_id AND asset.mime_type LIKE 'image/%'
        WHERE design.workspace_id = $1 AND design.case_id = $2 AND design.room_id = $3 AND design.archived_at IS NULL
        ORDER BY version.created_at DESC LIMIT 1`, [workspaceId, caseId, line.areaId]) : null);

  return { size, material, imageAssetId };
}
