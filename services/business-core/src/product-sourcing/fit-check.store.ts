import type { PoolClient } from "pg";
import { blocksOrdering, checkFit, fitInputsHash, type AccessPoint, type FitResult, type FitUnit, type ItemSize } from "./fit-check.domain";

type Db = Pick<PoolClient, "query">;

export type AccessPointRow = AccessPoint & { siteRecordId: string | null; note: string; version: number };
export type ItemFit = {
  itemId: string; name: string; size: (ItemSize & { version: number }) | null; result: FitResult; inputsHash: string;
  override: { id: string; reason: string; context: string; overriddenBy: string; overriddenByName: string | null; overriddenAt: string } | null;
  /** E5-6: ordering waits for an override when the check fails. */
  blocksOrdering: boolean;
};

const POINT_COLUMNS = `id, route, position, kind, label, unit, width::text AS width, height::text AS height, turn_width::text AS "turnWidth",
  cabin_width::text AS "cabinWidth", cabin_depth::text AS "cabinDepth", cabin_height::text AS "cabinHeight", site_record_id AS "siteRecordId", note, version`;

export async function readAccessPoints(db: Db, workspaceId: string, caseId: string): Promise<AccessPointRow[]> {
  return (await db.query<AccessPointRow>(`SELECT ${POINT_COLUMNS} FROM site_access_points WHERE workspace_id = $1 AND case_id = $2 AND archived_at IS NULL ORDER BY route, position, created_at`,
    [workspaceId, caseId])).rows;
}

export async function readAccessPoint(db: Db, workspaceId: string, caseId: string, pointId: string, lock = false): Promise<(AccessPointRow & { archived: boolean }) | null> {
  return (await db.query<AccessPointRow & { archived: boolean }>(`SELECT ${POINT_COLUMNS}, archived_at IS NOT NULL AS archived FROM site_access_points WHERE workspace_id = $1 AND case_id = $2 AND id = $3${lock ? " FOR UPDATE" : ""}`,
    [workspaceId, caseId, pointId])).rows[0] ?? null;
}

export async function readItemSizes(db: Db, workspaceId: string, itemIds: string[]) {
  const rows = (await db.query<{ itemId: string; name: string; width: string | null; depth: string | null; height: string | null; diagonalDepth: string | null; unit: FitUnit | null; version: number | null }>(
    `SELECT item.id AS "itemId", item.name, size.width::text AS width, size.depth::text AS depth, size.height::text AS height, size.diagonal_depth::text AS "diagonalDepth", size.unit, size.version
       FROM catalog_items item LEFT JOIN catalog_item_dimensions size ON size.workspace_id = item.workspace_id AND size.item_id = item.id
      WHERE item.workspace_id = $1 AND item.id = ANY($2::uuid[])`, [workspaceId, itemIds])).rows;
  return new Map(rows.map((row) => [row.itemId, { name: row.name, size: row.unit ? { width: row.width, depth: row.depth, height: row.height, diagonalDepth: row.diagonalDepth, unit: row.unit, version: row.version ?? 1 } : null }]));
}

/** The fit of each item through a case's access points, with any override made for exactly these inputs. */
export async function fitForCase(db: Db, workspaceId: string, caseId: string, itemIds: string[]): Promise<ItemFit[]> {
  const unique = [...new Set(itemIds)];
  if (!unique.length) return [];
  const points = await readAccessPoints(db, workspaceId, caseId);
  const sizes = await readItemSizes(db, workspaceId, unique);
  const overrides = (await db.query<{ id: string; itemId: string; inputsHash: string; reason: string; context: string; overriddenBy: string; overriddenByName: string | null; overriddenAt: string }>(
    `SELECT override.id, override.item_id AS "itemId", override.inputs_hash AS "inputsHash", override.reason, override.context, override.overridden_by AS "overriddenBy",
            person.display_name AS "overriddenByName", override.overridden_at AS "overriddenAt"
       FROM fit_check_overrides override LEFT JOIN users person ON person.id = override.overridden_by
      WHERE override.workspace_id = $1 AND override.case_id = $2 AND override.item_id = ANY($3::uuid[])`, [workspaceId, caseId, unique])).rows;
  return unique.filter((itemId) => sizes.has(itemId)).map((itemId) => {
    const { name, size } = sizes.get(itemId)!;
    const item: ItemSize = size ?? { width: null, depth: null, height: null, diagonalDepth: null, unit: "mm" };
    const result = checkFit(item, points);
    const inputsHash = fitInputsHash(item, points);
    const found = overrides.find((override) => override.itemId === itemId && override.inputsHash === inputsHash) ?? null;
    const override = found ? { id: found.id, reason: found.reason, context: found.context, overriddenBy: found.overriddenBy, overriddenByName: found.overriddenByName, overriddenAt: new Date(found.overriddenAt).toISOString() } : null;
    return { itemId, name, size, result, inputsHash, override, blocksOrdering: blocksOrdering(result.status) && !override };
  });
}

/**
 * E5-6 for purchasing: the first catalog item on an order that doesn't fit its project's site and has no override
 * for the current size and access points, as a message; null when nothing blocks.
 */
export async function orderFitProblem(db: Db, workspaceId: string, orderId: string): Promise<string | null> {
  const lines = (await db.query<{ caseId: string; itemId: string }>(
    `SELECT DISTINCT project.case_id AS "caseId", coalesce(material.catalog_item_id, scope.catalog_item_id) AS "itemId"
       FROM purchase_order_lines line
       JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
       LEFT JOIN project_material_items material ON material.workspace_id = line.workspace_id AND material.id = line.material_item_id
       LEFT JOIN project_boq_lines scope ON scope.workspace_id = line.workspace_id AND scope.id = line.boq_line_id
      WHERE line.workspace_id = $1 AND line.order_id = $2 AND coalesce(material.catalog_item_id, scope.catalog_item_id) IS NOT NULL`, [workspaceId, orderId])).rows;
  const byCase = new Map<string, string[]>();
  for (const line of lines) byCase.set(line.caseId, [...(byCase.get(line.caseId) ?? []), line.itemId]);
  for (const [caseId, itemIds] of byCase) {
    const blocked = (await fitForCase(db, workspaceId, caseId, itemIds)).find((fit) => fit.blocksOrdering);
    if (blocked) return `${blocked.name} doesn't fit through the site's measured access. Record a fit check override with a reason to order it.`;
  }
  return null;
}
