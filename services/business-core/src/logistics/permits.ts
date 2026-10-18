import { ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { permitCollected, permitProblem, type PermitFact, type PermitUse } from "./logistics.domain";

type Db = Pick<PoolClient, "query">;

/** Whose permit: a project, or a deal delivered without one (Furniture Only). */
export type PermitOwner = { projectId: string; opportunityId?: null } | { projectId?: null; opportunityId: string };

/**
 * The building permits of a project or a deal (PLM-136: buildings can't be entered without one). A permit recorded on
 * a project shows on its deal (the Deal File) and one recorded on the deal shows on its projects, so the delivery and
 * installation of the same order read the same permit.
 */
export async function readPermitFacts(db: Db, workspaceId: string, owner: PermitOwner): Promise<PermitFact[]> {
  return (await db.query<PermitFact>(
    `WITH linked AS (
       SELECT project.id AS project_id, pre_case.opportunity_id
         FROM delivery_projects project JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
        WHERE project.workspace_id = $1 AND (project.id = $2::uuid OR pre_case.opportunity_id = $3::uuid)
     )
     SELECT permit.id, permit.status, permit.valid_from::text AS "validFrom", permit.valid_to::text AS "validTo", permit.collect_on::text AS "collectOn"
       FROM building_permits permit
      WHERE permit.workspace_id = $1 AND permit.status <> 'cancelled'
        AND (permit.project_id = $2::uuid OR permit.opportunity_id = $3::uuid
             OR permit.project_id IN (SELECT project_id FROM linked) OR permit.opportunity_id IN (SELECT opportunity_id FROM linked))
      ORDER BY permit.created_at, permit.id`, [workspaceId, owner.projectId ?? null, owner.opportunityId ?? null])).rows;
}

/** The project's route holds the permit check on a stage that isn't skipped. */
export async function routeChecksPermit(db: Db, workspaceId: string, projectId: string) {
  return Boolean((await db.query(
    `SELECT 1 FROM project_stages stage, jsonb_array_elements(stage.checks) item
      WHERE stage.workspace_id = $1 AND stage.project_id = $2 AND stage.status <> 'skipped' AND item->>'kind' = 'permit_collected' LIMIT 1`, [workspaceId, projectId])).rowCount);
}

/**
 * Whether a permit is required: a project whose route checks it, or a deal delivered on a path with a delivery (not
 * taken home) in a workspace that asks deals for a permit too (configuration).
 */
export async function permitRequired(db: Db, workspaceId: string, owner: PermitOwner) {
  if (owner.projectId) return routeChecksPermit(db, workspaceId, owner.projectId);
  if ((await db.query(
    `SELECT 1 FROM workspace_logistics_settings settings JOIN crm_opportunities opportunity ON opportunity.workspace_id = settings.workspace_id AND opportunity.id = $2
      WHERE settings.workspace_id = $1 AND settings.deal_delivery_permit AND coalesce(opportunity.furniture_path, '') <> 'take_home_now'`, [workspaceId, owner.opportunityId])).rowCount) return true;
  // A deal whose project's route checks the permit (production orders delivered from the deal) needs it too.
  const projects = (await db.query<{ id: string }>(
    `SELECT project.id FROM delivery_projects project JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
      WHERE project.workspace_id = $1 AND pre_case.opportunity_id = $2 AND project.status <> 'cancelled'`, [workspaceId, owner.opportunityId])).rows;
  for (const project of projects) if (await routeChecksPermit(db, workspaceId, project.id)) return true;
  return false;
}

/** The "Building permit collected" check's fact: permits covering the booked delivery and installation days (or valid today before either). */
export async function readPermitCollected(db: Db, workspaceId: string, projectId: string) {
  const row = (await db.query<{ deliveryOn: string | null; installationOn: string | null; today: string }>(
    `SELECT project.delivery_on::text AS "deliveryOn", project.installation_on::text AS "installationOn",
            (now() AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date::text AS today
       FROM delivery_projects project JOIN workspaces workspace ON workspace.id = project.workspace_id WHERE project.workspace_id = $1 AND project.id = $2`,
    [workspaceId, projectId])).rows[0];
  if (!row) return false;
  return permitCollected(await readPermitFacts(db, workspaceId, { projectId }), [row.deliveryOn, row.installationOn], row.today);
}

/**
 * Refuses a delivery or installation day no collected permit covers, where the permit is required (PLM-136). Projects
 * whose route doesn't check it (the default route of existing workspaces) and deals in a workspace that doesn't ask
 * for it book as before.
 */
export async function assertPermitFor(db: Db, workspaceId: string, owner: PermitOwner, day: string, use: PermitUse) {
  if (!(await permitRequired(db, workspaceId, owner))) return;
  const locale = (await db.query<{ locale: string | null }>(`SELECT default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.locale || "en";
  const format = (value: string) => { try { return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00Z`)); } catch { return value; } };
  const problem = permitProblem(await readPermitFacts(db, workspaceId, owner), day, format, use);
  if (problem) throw new ConflictException(problem);
}
