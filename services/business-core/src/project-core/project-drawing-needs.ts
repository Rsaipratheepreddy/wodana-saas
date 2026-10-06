import type { PoolClient } from "pg";
import { DRAWING_CHECKS, type StageCheck } from "./project-checks";

type Db = Pick<PoolClient, "query">;

/**
 * Which of a project's items need technical drawings (PLM-057/059, Palm's answers of 6 Oct): bespoke furniture and
 * everything made to order (joinery) always do; a standard item (in stock, from a supplier, a catalogue piece made
 * as-is) doesn't when its catalogue item already has its technical drawing attached, and does without one. The team
 * can decide otherwise per item, with the reason (who and when are kept). The drawing checks and the production gate
 * apply only while at least one item needs drawings; a stage holding only drawing checks is skipped by itself then.
 */
export type DrawingReason = "bespoke" | "made_to_order" | "no_catalogue_drawing" | "catalogue_drawing";

export type DrawingLine = {
  kind: string; catalogItemId: string | null; itemType: string | null; catalogDrawingUrl: string | null;
  /** The team's decision for this item; null follows the rule. */
  override: boolean | null;
};

/** Item kinds that are drawn: furniture and joinery (services, materials and allowances aren't). */
const NOT_DRAWN = new Set(["service", "material"]);
const MADE_TO_ORDER = new Set(["assembly", "package"]);

/** What the rule says for one line, and what applies after the team's decision. Null `rule` when the line isn't drawn at all. */
export function drawingNeed(line: DrawingLine, bespokeOrder: boolean): { applies: boolean; rule: { needed: boolean; reason: DrawingReason } | null; needed: boolean } {
  if (line.kind !== "item" || (line.itemType && NOT_DRAWN.has(line.itemType))) return { applies: false, rule: null, needed: false };
  const rule: { needed: boolean; reason: DrawingReason } = bespokeOrder || !line.catalogItemId ? { needed: true, reason: "bespoke" }
    : line.itemType && MADE_TO_ORDER.has(line.itemType) ? { needed: true, reason: "made_to_order" }
      : line.catalogDrawingUrl ? { needed: false, reason: "catalogue_drawing" } : { needed: true, reason: "no_catalogue_drawing" };
  return { applies: true, rule, needed: line.override ?? rule.needed };
}

/** A stage that holds nothing but drawing checks (it has no work left when no item needs drawings). */
export function drawingOnlyStage(stage: { checks: StageCheck[] }) {
  return stage.checks.length > 0 && stage.checks.every((check) => DRAWING_CHECKS.includes(check.kind));
}

export const NO_DRAWINGS_REASON = "No item needs technical drawings.";

export type DrawingItem = {
  lineId: string; title: string; area: string | null; catalogItemId: string | null; catalogId: string | null; catalogName: string | null; catalogDrawingUrl: string | null;
  rule: { needed: boolean; reason: DrawingReason }; needed: boolean;
  override: { needed: boolean; reason: string; byName: string | null; at: string | null } | null; version: number;
};

/** Whether the job is bespoke as a whole (its furniture path), so every item is drawn. */
async function bespokeOrder(db: Db, workspaceId: string, projectId: string) {
  return (await db.query<{ path: string | null }>(
    `SELECT opportunity.furniture_path AS path FROM delivery_projects project
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
      WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, projectId])).rows[0]?.path === "bespoke";
}

/** The project's drawn items (active scope lines), what the rule says, the team's decision and the catalogue drawing. */
export async function readDrawingItems(db: Db, workspaceId: string, projectId: string): Promise<DrawingItem[]> {
  const bespoke = await bespokeOrder(db, workspaceId, projectId);
  const rows = (await db.query<{ lineId: string; title: string; kind: string; area: string | null; catalogItemId: string | null; catalogId: string | null; catalogName: string | null;
    itemType: string | null; catalogDrawingUrl: string | null; override: boolean | null; overrideReason: string; overrideBy: string | null; overrideAt: string | null; version: number }>(
    `SELECT line.id AS "lineId", line.title, line.kind, room.name AS area, item.id AS "catalogItemId", item.catalog_id AS "catalogId", item.name AS "catalogName",
            item.item_type AS "itemType", item.technical_drawing_url AS "catalogDrawingUrl", line.drawing_needed AS override, line.drawing_reason AS "overrideReason",
            setter.display_name AS "overrideBy", line.drawing_set_at AS "overrideAt", line.version
       FROM project_boq_lines line
       JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = project.case_id AND room.id = line.area_id
       LEFT JOIN catalog_items item ON item.workspace_id = line.workspace_id AND item.id = line.catalog_item_id
       LEFT JOIN users setter ON setter.id = line.drawing_set_by
      WHERE line.workspace_id = $1 AND line.project_id = $2 AND line.status = 'active'
      ORDER BY line.position, line.id`, [workspaceId, projectId])).rows;
  const items: DrawingItem[] = [];
  for (const row of rows) {
    const need = drawingNeed({ kind: row.kind, catalogItemId: row.catalogItemId, itemType: row.itemType, catalogDrawingUrl: row.catalogDrawingUrl, override: row.override }, bespoke);
    if (!need.applies || !need.rule) continue;
    items.push({ lineId: row.lineId, title: row.title, area: row.area, catalogItemId: row.catalogItemId, catalogId: row.catalogId, catalogName: row.catalogName,
      catalogDrawingUrl: row.catalogDrawingUrl, rule: need.rule, needed: need.needed,
      override: row.override === null ? null : { needed: row.override, reason: row.overrideReason, byName: row.overrideBy, at: row.overrideAt ? new Date(row.overrideAt).toISOString() : null },
      version: Number(row.version) });
  }
  return items;
}

/** Whether any item of the project needs technical drawings. */
export async function projectNeedsDrawings(db: Db, workspaceId: string, projectId: string) {
  return (await readDrawingItems(db, workspaceId, projectId)).some((item) => item.needed);
}
