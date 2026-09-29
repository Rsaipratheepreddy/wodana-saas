import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { financeGatePaymentsReady } from "../commercial/release-integrity";
import { commercialRepository } from "../commercial/commercial-repository";
import type { CommercialData } from "../commercial/commercial.types";
import { everythingMade } from "../factory/factory";
import { projectHandedOver } from "../site/handover";
import { everythingOrdered } from "../purchasing/orders";
import { materialsSignedOff } from "./project-materials";
import { checkPasses, DEFAULT_ROLES, DEFAULT_STAGES, LEAD_ROLE, type ProjectRole, type StageCheck, type TemplateStage } from "./project-checks";

type Db = Pick<PoolClient, "query">;

export type ProjectSettings = {
  requireAgreement: boolean; requirePayment: boolean; requireApproval: boolean; requireVariationPayment: boolean; referencePrefix: string; roles: ProjectRole[]; version: number;
  /** D-7: the project finishes by itself once the client accepts the handover and its last stage's checks pass. */
  autoFinish: boolean;
  /** D-40: hours after which a drafted client update nobody sent or discarded goes to the client by itself; null keeps it manual. */
  clientUpdateAutoSendHours: number | null;
  /** When the day's site report is due (HH:MM, the workspace's time): reminders start then. */
  reportDueTime: string;
  /** With "Send by itself" on, daily reports nobody reviewed also go (as written) after its hours. */
  autoSendPendingReports: boolean;
  /** The week's sent days go to the client as one digest on the last working day (instead of the weekly draft). */
  weeklyRollup: boolean;
};

/** The workspace's project settings, created with the defaults the first time they're read. */
export async function ensureSettings(db: Db, workspaceId: string): Promise<ProjectSettings> {
  await db.query(`INSERT INTO workspace_project_settings (workspace_id, roles) VALUES ($1, $2::jsonb) ON CONFLICT (workspace_id) DO NOTHING`,
    [workspaceId, JSON.stringify(DEFAULT_ROLES)]);
  return (await db.query<ProjectSettings>(
    `SELECT require_agreement AS "requireAgreement", require_payment AS "requirePayment", require_approval AS "requireApproval",
            require_variation_payment AS "requireVariationPayment", reference_prefix AS "referencePrefix", roles, version, auto_finish AS "autoFinish",
            client_update_auto_send_hours AS "clientUpdateAutoSendHours", to_char(report_due_time, 'HH24:MI') AS "reportDueTime",
            auto_send_pending_reports AS "autoSendPendingReports", weekly_rollup AS "weeklyRollup"
       FROM workspace_project_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
}

export type TemplateRow = { id: string; name: string; isDefault: boolean; version: number; stages: TemplateStage[] };

/** Active stage templates; the generic one is created when the workspace has none. */
export async function ensureTemplates(db: Db, workspaceId: string, actorUserId: string | null): Promise<TemplateRow[]> {
  const exists = (await db.query(`SELECT 1 FROM project_templates WHERE workspace_id = $1 AND status = 'active' LIMIT 1`, [workspaceId])).rowCount;
  if (!exists) await writeTemplate(db, workspaceId, randomUUID(), "Standard", true, DEFAULT_STAGES, actorUserId, true);
  return readTemplates(db, workspaceId);
}

export async function readTemplates(db: Db, workspaceId: string): Promise<TemplateRow[]> {
  return (await db.query<TemplateRow>(
    `SELECT template.id, template.name, template.is_default AS "isDefault", template.version,
            coalesce((SELECT jsonb_agg(jsonb_build_object('key', stage.key, 'name', stage.name, 'ownerRole', stage.owner_role, 'checks', stage.checks) ORDER BY stage.position)
                        FROM project_template_stages stage WHERE stage.workspace_id = template.workspace_id AND stage.template_id = template.id), '[]'::jsonb) AS stages
       FROM project_templates template WHERE template.workspace_id = $1 AND template.status = 'active'
      ORDER BY template.is_default DESC, lower(template.name)`, [workspaceId])).rows;
}

export async function writeTemplate(db: Db, workspaceId: string, id: string, name: string, isDefault: boolean, stages: TemplateStage[], actorUserId: string | null, create: boolean) {
  if (isDefault) await db.query(`UPDATE project_templates SET is_default = false WHERE workspace_id = $1 AND is_default AND id <> $2`, [workspaceId, id]);
  if (create) {
    await db.query(`INSERT INTO project_templates (id, workspace_id, name, is_default, created_by) VALUES ($1, $2, $3, $4, $5)`, [id, workspaceId, name, isDefault, actorUserId]);
  } else {
    await db.query(`UPDATE project_templates SET name = $3, is_default = $4, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, name, isDefault]);
    await db.query(`DELETE FROM project_template_stages WHERE workspace_id = $1 AND template_id = $2`, [workspaceId, id]);
  }
  for (const [position, stage] of stages.entries())
    await db.query(`INSERT INTO project_template_stages (id, workspace_id, template_id, position, key, name, owner_role, checks) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [randomUUID(), workspaceId, id, position, stage.key, stage.name, stage.ownerRole, JSON.stringify(stage.checks)]);
}

export type ProjectRow = {
  id: string; caseId: string; reference: string; name: string; status: "active" | "on_hold" | "completed" | "cancelled" | "archived";
  quoteId: string; templateName: string | null; priority: "normal" | "high" | "critical"; health: "on_track" | "at_risk" | "off_track";
  startDate: string | null; promiseDate: string | null; currency: string; startedAt: string; holdReason: string | null; holdReviewOn: string | null;
  heldAt: string | null; version: number; clientName: string; opportunityId: string; opportunityReference: string | null; total: string;
  completedAt: string | null; cancelledAt: string | null; cancelReason: string | null; closedByName: string | null;
};

const PROJECT_SELECT = `SELECT project.id, project.case_id AS "caseId", project.reference, project.name, project.status, project.quote_id AS "quoteId",
  project.template_name AS "templateName", project.priority, project.health, project.start_date::text AS "startDate", project.promise_date::text AS "promiseDate",
  project.currency, project.started_at AS "startedAt", project.hold_reason AS "holdReason", project.hold_review_on::text AS "holdReviewOn", project.held_at AS "heldAt",
  project.version, project.completed_at AS "completedAt", project.cancelled_at AS "cancelledAt", project.cancel_reason AS "cancelReason",
  (SELECT closer.display_name FROM users closer WHERE closer.id = coalesce(project.cancelled_by, project.completed_by)) AS "closedByName",
  coalesce(party.display_name, opportunity.title) AS "clientName", opportunity.id AS "opportunityId", opportunity.reference AS "opportunityReference",
  -- Agreed value: the sealed baseline plus every sealed variation.
  (SELECT sum(seal.total)::text FROM project_scope_seals seal WHERE seal.workspace_id = project.workspace_id AND seal.project_id = project.id) AS total
  FROM delivery_projects project
  JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
  JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
  LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id`;

export async function readProject(db: Db, workspaceId: string, projectId: string, lock = false): Promise<ProjectRow | undefined> {
  if (lock) await db.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, projectId]);
  return (await db.query<ProjectRow>(`${PROJECT_SELECT} WHERE project.workspace_id = $1 AND project.id = $2 AND project.started_at IS NOT NULL`, [workspaceId, projectId])).rows[0];
}

/** Projects the person may see: every started project with projects.manage, otherwise the ones they're on. */
export async function readProjects(db: Db, workspaceId: string, membershipId: string | null, all: boolean): Promise<ProjectRow[]> {
  return (await db.query<ProjectRow>(
    `${PROJECT_SELECT} WHERE project.workspace_id = $1 AND project.started_at IS NOT NULL
       AND ($2 OR EXISTS (SELECT 1 FROM project_assignments assignment WHERE assignment.workspace_id = project.workspace_id
                           AND assignment.project_id = project.id AND assignment.membership_id = $3 AND assignment.active))
     ORDER BY CASE project.status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END, project.promise_date NULLS LAST, project.started_at DESC`,
    [workspaceId, all, membershipId])).rows;
}

export type TeamMember = { membershipId: string; name: string; roles: string[]; lead: boolean };

export async function readTeam(db: Db, workspaceId: string, projectIds: string[]) {
  const rows = (await db.query<TeamMember & { projectId: string }>(
    `SELECT assignment.project_id AS "projectId", assignment.membership_id AS "membershipId", coalesce(person.display_name, person.primary_email) AS name,
            assignment.role_keys AS roles, assignment.is_manager AS lead
       FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id
       JOIN users person ON person.id = membership.user_id
      WHERE assignment.workspace_id = $1 AND assignment.project_id = ANY($2::uuid[]) AND assignment.active AND cardinality(assignment.role_keys) > 0
      ORDER BY person.display_name`, [workspaceId, projectIds])).rows;
  const byProject = new Map<string, TeamMember[]>();
  for (const { projectId, ...member } of rows) byProject.set(projectId, [...(byProject.get(projectId) ?? []), member]);
  return byProject;
}

export type StageRow = {
  id: string; projectId: string; position: number; key: string; name: string; ownerRole: string | null; checks: StageCheck[];
  status: "upcoming" | "current" | "done" | "skipped"; startedAt: string | null; completedAt: string | null; completedByName: string | null; skipReason: string | null;
  /** Finished by itself (D-7) on behalf of `completedByName`. */
  finishedAutomatically: boolean;
};

export async function readStages(db: Db, workspaceId: string, projectIds: string[], currentOnly = false): Promise<StageRow[]> {
  return (await db.query<StageRow>(
    `SELECT stage.id, stage.project_id AS "projectId", stage.position, stage.key, stage.name, stage.owner_role AS "ownerRole", stage.checks, stage.status,
            stage.started_at AS "startedAt", stage.completed_at AS "completedAt", finisher.display_name AS "completedByName", stage.skip_reason AS "skipReason",
            stage.finished_automatically AS "finishedAutomatically"
       FROM project_stages stage LEFT JOIN users finisher ON finisher.id = stage.completed_by
      WHERE stage.workspace_id = $1 AND stage.project_id = ANY($2::uuid[]) ${currentOnly ? "AND stage.status = 'current'" : ""}
      ORDER BY stage.project_id, stage.position`, [workspaceId, projectIds])).rows;
}

export type Confirmation = { stageId: string; checkKey: string; note: string; byName: string; at: string };

export async function readConfirmations(db: Db, workspaceId: string, stageIds: string[]): Promise<Confirmation[]> {
  if (!stageIds.length) return [];
  return (await db.query<Confirmation>(
    `SELECT confirmation.stage_id AS "stageId", confirmation.check_key AS "checkKey", confirmation.note, person.display_name AS "byName", confirmation.confirmed_at AS at
       FROM project_stage_confirmations confirmation JOIN users person ON person.id = confirmation.confirmed_by
      WHERE confirmation.workspace_id = $1 AND confirmation.stage_id = ANY($2::uuid[])`, [workspaceId, stageIds])).rows;
}

/** Payments the accepted quote marks "before production" are finance-verified (true when it marks none). */
export async function productionPaid(db: Db, workspaceId: string, caseId: string, quoteId: string) {
  const row = await commercialRepository.load(db, workspaceId, caseId);
  if (!row) return false;
  return financeGatePaymentsReady({ ...(row.content as CommercialData), revision: row.revision }, "production", quoteId);
}

/** Each stage's checks with whether they pass, who confirmed them, and whether the stage can finish. */
export async function evaluateStages(db: Db, workspaceId: string, project: Pick<ProjectRow, "id" | "caseId" | "quoteId">, stages: StageRow[], team: TeamMember[]) {
  const confirmations = await readConfirmations(db, workspaceId, stages.map((stage) => stage.id));
  const filledRoles = new Set(team.flatMap((member) => member.roles));
  const needsPayment = stages.some((stage) => stage.status === "current" && stage.checks.some((check) => check.kind === "payment_verified"));
  const paid = needsPayment ? await productionPaid(db, workspaceId, project.caseId, project.quoteId) : false;
  const needsMaterials = stages.some((stage) => stage.status === "current" && stage.checks.some((check) => check.kind === "material_list_signed_off"));
  const materialsDone = needsMaterials ? await materialsSignedOff(db, workspaceId, project.id) : false;
  const needsOrders = stages.some((stage) => stage.status === "current" && stage.checks.some((check) => check.kind === "everything_ordered"));
  const ordered = needsOrders ? await everythingOrdered(db, workspaceId, project.id) : false;
  const needsMade = stages.some((stage) => stage.status === "current" && stage.checks.some((check) => check.kind === "everything_made"));
  const made = needsMade ? await everythingMade(db, workspaceId, project.id) : false;
  const needsHandover = stages.some((stage) => stage.status === "current" && stage.checks.some((check) => check.kind === "handover_accepted"));
  const handover = needsHandover ? await projectHandedOver(db, workspaceId, project) : false;
  const snags = (await db.query<{ open: number; critical: number }>(
    `SELECT count(*)::int AS open, count(*) FILTER (WHERE severity = 'critical')::int AS critical FROM work_items
      WHERE workspace_id = $1 AND project_id = $2 AND type = 'snag' AND status NOT IN ('done', 'cancelled')`, [workspaceId, project.id])).rows[0];
  return stages.map((stage) => {
    const mine = confirmations.filter((confirmation) => confirmation.stageId === stage.id);
    const facts = { filledRoles, confirmed: new Set(mine.map((confirmation) => confirmation.checkKey)), productionPaid: paid, materialsSignedOff: materialsDone, everythingOrdered: ordered,
      everythingMade: made, openSnags: snags.open, openCriticalSnags: snags.critical, handedOver: handover };
    const checks = stage.checks.map((check) => {
      const confirmation = mine.find((item) => item.checkKey === check.key);
      return { ...check, passed: stage.status === "done" ? true : checkPasses(check, facts), confirmedBy: confirmation?.byName ?? null, confirmedAt: confirmation?.at ?? null, note: confirmation?.note ?? "" };
    });
    const owners = stage.ownerRole ? team.filter((member) => member.roles.includes(stage.ownerRole!)) : [];
    return { ...stage, checks, ready: checks.every((check) => check.passed), owner: owners[0] ? { membershipId: owners[0].membershipId, name: owners[0].name } : null };
  });
}

export async function membershipOf(db: Db, workspaceId: string, userId: string) {
  return (await db.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, userId])).rows[0]?.id ?? null;
}

export async function activeMembers(db: Db, workspaceId: string) {
  return (await db.query<{ membershipId: string; name: string }>(
    `SELECT membership.id AS "membershipId", coalesce(person.display_name, person.primary_email) AS name
       FROM workspace_memberships membership JOIN users person ON person.id = membership.user_id
      WHERE membership.workspace_id = $1 AND membership.status = 'active' ORDER BY lower(coalesce(person.display_name, person.primary_email))`, [workspaceId])).rows;
}

/** Names a person for a role (replacing whoever held it) or clears the role. Keeps the lead flag and access in step. */
export async function setRole(db: Db, workspaceId: string, projectId: string, role: string, membershipId: string | null) {
  await db.query(
    `UPDATE project_assignments SET role_keys = array_remove(role_keys, $3::varchar)
      WHERE workspace_id = $1 AND project_id = $2 AND $3::varchar = ANY(role_keys) AND membership_id IS DISTINCT FROM $4::uuid`,
    [workspaceId, projectId, role, membershipId]);
  if (membershipId)
    await db.query(
      `INSERT INTO project_assignments (workspace_id, project_id, membership_id, is_manager, active, role_keys)
       VALUES ($1, $2, $3, $4::varchar = $5::varchar, true, ARRAY[$4::varchar])
       ON CONFLICT (workspace_id, project_id, membership_id) WHERE project_id IS NOT NULL
       DO UPDATE SET active = true, role_keys = CASE WHEN $4::varchar = ANY(project_assignments.role_keys) THEN project_assignments.role_keys ELSE array_append(project_assignments.role_keys, $4::varchar) END`,
      [workspaceId, projectId, membershipId, role, LEAD_ROLE]);
  // The lead flag follows the project manager role; people without a role keep their access.
  await db.query(`UPDATE project_assignments SET is_manager = $3::varchar = ANY(role_keys) WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId, LEAD_ROLE]);
}
