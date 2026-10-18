import type { PoolClient } from "pg";
import { recordAudit } from "../../audit/record-audit";

type Db = Pick<PoolClient, "query">;
type Point = { latitude: number; longitude: number };

const same = (a: Point, b: Point) => Math.abs(a.latitude - b.latitude) < 1e-7 && Math.abs(a.longitude - b.longitude) < 1e-7;

/**
 * The job's site for check-in, from the property position on its opportunity: one `site` work location on the
 * planning case (on the project once it has started), with the workspace's default radius. Created once and never
 * duplicated: a site already there is kept. It follows a corrected property position only while it still sits on
 * the previous one; once someone moved it in Workplaces, it is theirs.
 */
export async function ensureSiteLocation(db: Db, input: { workspaceId: string; opportunityId: string; actorUserId: string | null; previous?: Point | null }) {
  const { workspaceId, opportunityId, actorUserId } = input;
  const row = (await db.query<{ caseId: string; projectId: string | null; name: string; address: string | null; latitude: number | null; longitude: number | null }>(
    `SELECT pre_case.id AS "caseId", project.id AS "projectId", left(coalesce(nullif(trim(opportunity.title), ''), party.display_name), 160) AS name,
            discovery.property_location AS address, discovery.latitude::float8 AS latitude, discovery.longitude::float8 AS longitude
       FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       JOIN crm_opportunity_discovery discovery ON discovery.workspace_id = pre_case.workspace_id AND discovery.opportunity_id = pre_case.opportunity_id
       LEFT JOIN delivery_projects project ON project.workspace_id = pre_case.workspace_id AND project.case_id = pre_case.id
      WHERE pre_case.workspace_id = $1 AND pre_case.opportunity_id = $2 AND pre_case.status <> 'cancelled'
      ORDER BY pre_case.created_at LIMIT 1`, [workspaceId, opportunityId])).rows[0];
  if (!row || row.latitude == null || row.longitude == null) return null;
  const point = { latitude: row.latitude, longitude: row.longitude };
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`site-location:${workspaceId}:${row.caseId}`]);
  const existing = (await db.query<{ id: string; latitude: number; longitude: number; address: string }>(
    `SELECT id, latitude, longitude, address FROM work_locations
      WHERE workspace_id = $1 AND kind = 'site' AND (case_id = $2 OR project_id = $3) ORDER BY active DESC, id LIMIT 1 FOR UPDATE`,
    [workspaceId, row.caseId, row.projectId])).rows[0];
  const address = (row.address ?? "").slice(0, 500);
  if (existing) {
    if (!input.previous || same(existing, point) || !same(existing, input.previous)) return existing.id;
    await db.query(`UPDATE work_locations SET latitude = $3, longitude = $4, address = CASE WHEN $5 <> '' THEN $5 ELSE address END, version = version + 1
      WHERE workspace_id = $1 AND id = $2`, [workspaceId, existing.id, point.latitude, point.longitude, address]);
    await recordAudit(db, { workspaceId, actorUserId, action: "work_location.moved_with_property", entityType: "work_location", entityId: existing.id,
      before: { latitude: existing.latitude, longitude: existing.longitude, address: existing.address }, after: { ...point, address: address || existing.address, opportunityId } });
    return existing.id;
  }
  const created = await db.query<{ id: string }>(
    `INSERT INTO work_locations (workspace_id, name, kind, project_id, case_id, address, latitude, longitude)
     VALUES ($1, $2, 'site', $3, $4, $5, $6, $7) RETURNING id`,
    [workspaceId, row.name || "Site", row.projectId, row.projectId ? null : row.caseId, address, point.latitude, point.longitude]);
  const id = created.rows[0].id;
  await recordAudit(db, { workspaceId, actorUserId, action: "work_location.created_from_property", entityType: "work_location", entityId: id,
    after: { kind: "site", caseId: row.projectId ? null : row.caseId, projectId: row.projectId, address, ...point, opportunityId } });
  return id;
}
