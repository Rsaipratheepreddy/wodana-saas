import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;
export const SUPPLIES = ["make", "buy", "ready_made", "subcontract", "client", "site_work"] as const;
export type Supply = (typeof SUPPLIES)[number];

/** Months of warranty by how a package is delivered, until the workspace sets its own (what the client supplies isn't ours to cover). */
export const DEFAULT_WARRANTY_MONTHS: Record<Supply, number> = { make: 12, buy: 12, ready_made: 12, subcontract: 12, client: 0, site_work: 12 };

export async function warrantyMonths(db: Db, workspaceId: string): Promise<Record<Supply, number>> {
  const rows = (await db.query<{ supply: Supply; months: number }>(`SELECT supply, months FROM warranty_defaults WHERE workspace_id = $1`, [workspaceId])).rows;
  return { ...DEFAULT_WARRANTY_MONTHS, ...Object.fromEntries(rows.map((row) => [row.supply, row.months])) };
}

/**
 * Starts the warranty of every scope line a handover covers (its areas, or the whole project) that hasn't
 * started yet: from the day the client accepted it, for its package's months. It ends the day before the
 * same date that many months later.
 */
export async function startWarranty(db: Db, workspaceId: string, input: { projectId: string; packId: string; areaIds: string[]; startsOn: string }) {
  const months = await warrantyMonths(db, workspaceId);
  const lines = (await db.query<{ id: string; supply: Supply | null }>(
    `SELECT line.id, package.supply FROM project_boq_lines line LEFT JOIN project_packages package ON package.workspace_id = line.workspace_id AND package.id = line.package_id
      WHERE line.workspace_id = $1 AND line.project_id = $2 AND line.status = 'active' AND (cardinality($3::uuid[]) = 0 OR line.area_id = ANY($3::uuid[]))
        AND NOT EXISTS (SELECT 1 FROM warranty_items item WHERE item.workspace_id = line.workspace_id AND item.boq_line_id = line.id)`,
    [workspaceId, input.projectId, input.areaIds])).rows;
  for (const line of lines) {
    const term = months[line.supply ?? "site_work"];
    await db.query(
      `INSERT INTO warranty_items (id, workspace_id, project_id, boq_line_id, pack_id, months, starts_on, ends_on)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::date, ($6::date + make_interval(months => $5) - interval '1 day')::date)`,
      [workspaceId, input.projectId, line.id, input.packId, term, input.startsOn]);
  }
  return lines.length;
}
