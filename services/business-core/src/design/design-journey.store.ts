import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { projectRepository } from "../projects/project-repository";
import type { ProjectData } from "../projects/execution.types";
import { addHours, journeyStages, nextStage, STAGE_LABELS, type JourneyStage } from "./design-journey.domain";

type Db = Pick<PoolClient, "query">;
type CaseFacts = { caseId: string; opportunityId: string; clientName: string; designerId: string | null; accountManagerId: string | null; leadId: string | null; partyId: string };

/** The case, its client and its people: the dedicated designer (PLM-088) and the Account Manager. */
export async function caseFacts(db: Db, workspaceId: string, caseId: string): Promise<CaseFacts | null> {
  return (await db.query<CaseFacts>(
    `SELECT pre_case.id AS "caseId", opportunity.id AS "opportunityId", COALESCE(party.display_name, opportunity.title) AS "clientName",
            designer.membership_id AS "designerId", opportunity.owner_membership_id AS "accountManagerId", opportunity.lead_id AS "leadId", opportunity.party_id AS "partyId"
       FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN crm_opportunity_designer designer ON designer.workspace_id = opportunity.workspace_id AND designer.opportunity_id = opportunity.id
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0] ?? null;
}

/**
 * Opens the design journey of a case (PLM-047): the stages its package includes, Inspiration active.
 * Idempotent. The package and the timings are frozen on the journey so later configuration changes
 * don't move a client's deadlines.
 */
export async function startJourney(db: Db, workspaceId: string, caseId: string, userId: string) {
  const facts = await caseFacts(db, workspaceId, caseId);
  if (!facts) return false;
  const pkg = (await db.query<{ id: string; name: string; includedRevisions: number; includesSpacePlanning: boolean; includesRenders: boolean; requiredRoleCode: string | null }>(
    `SELECT package.id, package.name, package.included_revisions AS "includedRevisions", package.includes_space_planning AS "includesSpacePlanning",
            package.includes_renders AS "includesRenders", package.required_role_code AS "requiredRoleCode"
       FROM crm_opportunity_discovery discovery JOIN design_packages package ON package.workspace_id = discovery.workspace_id AND package.id = discovery.design_package_id
      WHERE discovery.workspace_id = $1 AND discovery.opportunity_id = $2`, [workspaceId, facts.opportunityId])).rows[0];
  const settings = (await db.query<{ inspirationDays: number; siteVisitHours: number }>(
    `SELECT inspiration_days AS "inspirationDays", site_visit_hours AS "siteVisitHours" FROM workspace_design_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
  const created = await db.query(
    `INSERT INTO design_journeys (workspace_id, case_id, package_id, package_name, included_revisions, includes_space_planning, includes_renders, reviewer_role_code, inspiration_days, site_visit_hours, started_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (workspace_id, case_id) DO NOTHING`,
    [workspaceId, caseId, pkg?.id ?? null, pkg?.name ?? null, pkg?.includedRevisions ?? 2, pkg?.includesSpacePlanning ?? false, pkg?.includesRenders ?? false,
      pkg?.requiredRoleCode ?? null, settings?.inspirationDays ?? 7, settings?.siteVisitHours ?? 72, userId]);
  if (!created.rowCount) return false;
  const order = journeyStages({ includesSpacePlanning: pkg?.includesSpacePlanning ?? false, includesRenders: pkg?.includesRenders ?? false });
  for (const [index, stage] of order.entries()) {
    await db.query(
      `INSERT INTO design_journey_stages (workspace_id, case_id, stage, position, status, owner_membership_id, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [workspaceId, caseId, stage, index + 1, index === 0 ? "active" : "locked", stage === "renders" ? null : facts.designerId, index === 0 ? new Date() : null]);
  }
  await event(db, workspaceId, caseId, "inspiration", "started", null, userId);
  await recordAudit(db, { workspaceId, actorUserId: userId, action: "design.journey_started.v1", entityType: "pre_project_case", entityId: caseId, after: { packageId: pkg?.id ?? null, stages: order } });
  return true;
}

/** PLM-077: the inspiration week starts when the first inspiration is added, not at payment. */
export async function startInspirationTimer(db: Db, workspaceId: string, caseId: string) {
  await db.query(
    `UPDATE design_journey_stages stage SET due_at = now() + make_interval(days => journey.inspiration_days), version = stage.version + 1
       FROM design_journeys journey
      WHERE stage.workspace_id = $1 AND stage.case_id = $2 AND stage.stage = 'inspiration' AND stage.status = 'active' AND stage.due_at IS NULL
        AND journey.workspace_id = stage.workspace_id AND journey.case_id = stage.case_id`, [workspaceId, caseId]);
}

/** Closes a stage and opens the next one with its deadline, owner task and notice. */
export async function completeStage(db: Db, workspaceId: string, caseId: string, stage: JourneyStage, userId: string | null, note: string | null, action = "completed") {
  await db.query(
    `UPDATE design_journey_stages SET status = 'done', completed_at = now(), completed_by = $4, note = COALESCE($5, note), version = version + 1
      WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`, [workspaceId, caseId, stage, userId, note]);
  const done = (await db.query<{ activityId: string | null }>(`SELECT activity_id AS "activityId" FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`, [workspaceId, caseId, stage])).rows[0];
  if (done?.activityId) await db.query(`UPDATE crm_activities SET status = 'completed', completed_at = now(), completion_outcome = 'Stage completed', version = version + 1 WHERE workspace_id = $1 AND id = $2 AND status = 'pending'`, [workspaceId, done.activityId]);
  await event(db, workspaceId, caseId, stage, action, note, userId);
  const order = (await db.query<{ stage: JourneyStage }>(`SELECT stage FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 ORDER BY position`, [workspaceId, caseId])).rows.map((row) => row.stage);
  const next = nextStage(order, stage);
  if (next) await activateStage(db, workspaceId, caseId, next, userId);
  return next;
}

async function activateStage(db: Db, workspaceId: string, caseId: string, stage: JourneyStage, userId: string | null) {
  const journey = (await db.query<{ siteVisitHours: number }>(`SELECT site_visit_hours AS "siteVisitHours" FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0];
  const now = new Date();
  const due = stage === "site_visit" ? addHours(now, journey?.siteVisitHours ?? 72) : null;
  const facts = await caseFacts(db, workspaceId, caseId);
  let activityId: string | null = null;
  if (stage === "site_visit" && facts?.designerId) {
    // PLM-048: a task in the designer's list, due within the configured hours.
    activityId = (await db.query<{ id: string }>(
      `INSERT INTO crm_activities (workspace_id, party_id, lead_id, opportunity_id, type, interaction_direction, title, owner_membership_id, priority, due_at, is_next_action, customer_visible, created_by)
       VALUES ($1, $2, $3, $4, 'task'::crm_activity_type, 'internal', 'Site visit: measurements and photos', $5, 'high', $6, false, false, $7) RETURNING id`,
      [workspaceId, facts.partyId, facts.leadId, facts.opportunityId, facts.designerId, due, userId])).rows[0].id;
  }
  await db.query(
    `UPDATE design_journey_stages SET status = 'active', started_at = now(), due_at = $4, activity_id = COALESCE($5, activity_id), version = version + 1
      WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`, [workspaceId, caseId, stage, due, activityId]);
  await event(db, workspaceId, caseId, stage, "started", null, userId);
  if (facts && due) await tell(db, workspaceId, caseId, facts, "design.stage_started", stage, due, `design:${caseId}:${stage}:started`);
}

/**
 * The worker's pass for one workspace (inside its tenant transaction): ends inspiration weeks that ran
 * out and raises one overdue alert per late stage to its owner and the Account Manager.
 */
export async function processDesignDeadlines(db: Db, workspaceId: string, now = new Date()) {
  let closed = 0; let alerted = 0;
  const expired = (await db.query<{ caseId: string }>(
    `SELECT case_id AS "caseId" FROM design_journey_stages WHERE workspace_id = $1 AND stage = 'inspiration' AND status = 'active' AND due_at <= $2 FOR UPDATE`, [workspaceId, now])).rows;
  for (const row of expired) { await completeStage(db, workspaceId, row.caseId, "inspiration", null, null, "timer_ended"); closed++; }
  const late = (await db.query<{ caseId: string; stage: JourneyStage; dueAt: Date }>(
    `SELECT case_id AS "caseId", stage, due_at AS "dueAt" FROM design_journey_stages
      WHERE workspace_id = $1 AND status = 'active' AND due_at < $2 AND overdue_notified_at IS NULL FOR UPDATE`, [workspaceId, now])).rows;
  for (const row of late) {
    const facts = await caseFacts(db, workspaceId, row.caseId);
    if (facts) await tell(db, workspaceId, row.caseId, facts, "design.stage_overdue", row.stage, row.dueAt, `design:${row.caseId}:${row.stage}:overdue`, true);
    await db.query(`UPDATE design_journey_stages SET overdue_notified_at = now() WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`, [workspaceId, row.caseId, row.stage]);
    await event(db, workspaceId, row.caseId, row.stage, "overdue", null, null);
    alerted++;
  }
  return { closed, alerted };
}

/** PLM-048: once the visit is recorded, the delivery project's site-visit gate is met from the same facts. */
export async function recordProjectSiteVisit(db: Db, workspaceId: string, caseId: string, summary: string, evidence: string, userId: string) {
  const project = (await db.query<{ id: string }>(`SELECT id FROM delivery_projects WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0];
  if (!project) return;
  const stored = await projectRepository.load(db, workspaceId, project.id, { forUpdate: true });
  const data = stored?.content as ProjectData | undefined;
  if (!data?.workflow || data.siteVisit) return;
  data.siteVisit = { visitedOn: new Date().toISOString().slice(0, 10), scopeSummary: summary, feeReviewNote: "", evidenceReference: evidence, recordedAt: new Date().toISOString(), recordedBy: userId };
  data.revision++;
  await projectRepository.save(db, workspaceId, project.id, data);
}

async function tell(db: Db, workspaceId: string, caseId: string, facts: CaseFacts, code: string, stage: JourneyStage, due: Date, key: string, email = false) {
  const workspace = (await db.query<{ timezone: string; locale: string }>(`SELECT default_timezone AS timezone, default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
  const variables = { stage: STAGE_LABELS[stage], clientName: facts.clientName, due: formatDue(due, workspace?.timezone ?? "UTC", workspace?.locale ?? "en") };
  const members = [...new Set([facts.designerId, facts.accountManagerId].filter((id): id is string => Boolean(id)))];
  const recipients = (await db.query<{ userId: string }>(`SELECT DISTINCT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`, [workspaceId, members])).rows;
  const deepLink = `/workspace/pre-projects/cases/${caseId}/overview`;
  const eventType = code === "design.stage_overdue" ? "design.stage.overdue" : "design.stage.started";
  for (const recipient of recipients) {
    await notifyUserInApp(db, { workspaceId, recipientUserId: recipient.userId, code, eventType, variables, deepLink, idempotencyKey: `${key}:${recipient.userId}` });
    if (email) await queueUserEmail(db, { workspaceId, recipientUserId: recipient.userId, code, eventType, variables, deepLink, idempotencyKey: `${key}:${recipient.userId}:email` });
  }
}

export function formatDue(due: Date, timeZone: string, locale: string) {
  const options: Intl.DateTimeFormatOptions = { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
  try { return new Intl.DateTimeFormat(locale, options).format(due); } catch { return new Intl.DateTimeFormat("en", options).format(due); }
}

async function event(db: Db, workspaceId: string, caseId: string, stage: string, action: string, note: string | null, userId: string | null) {
  await db.query(`INSERT INTO design_journey_events (workspace_id, case_id, stage, action, note, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6)`, [workspaceId, caseId, stage, action, note, userId]);
}

