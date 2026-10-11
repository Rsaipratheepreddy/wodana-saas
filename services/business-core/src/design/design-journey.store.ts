import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { projectRepository } from "../projects/project-repository";
import type { ProjectData } from "../projects/execution.types";
import { formatCalendarDay } from "../common/calendar-day";
import { addDays, DEFAULT_SITE_VISIT_QUESTIONS, journeyStages, nextStage, normaliseSiteQuestions, SITE_AND_MATERIALS_STAGES, stageDeadlines, STAGE_LABELS, type JourneyKind, type JourneyStage, type StageTimings } from "./design-journey.domain";

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

/** Active members holding a role (or team) with this code, lower-case match. */
export async function membersWithRole(db: Db, workspaceId: string, roleCode: string | null | undefined): Promise<string[]> {
  if (!roleCode?.trim()) return [];
  return (await db.query<{ id: string }>(
    `SELECT DISTINCT membership.id FROM workspace_memberships membership
       JOIN effective_member_roles assigned ON assigned.membership_id = membership.id AND assigned.workspace_id = membership.workspace_id
       JOIN roles role ON role.id = assigned.role_id AND role.workspace_id = membership.workspace_id
      WHERE membership.workspace_id = $1 AND membership.status = 'active' AND lower(role.code) = lower($2)
     UNION
     SELECT DISTINCT membership.id FROM workspace_memberships membership
       JOIN workspace_team_members member ON member.membership_id = membership.id AND member.workspace_id = membership.workspace_id
       JOIN workspace_teams team ON team.id = member.team_id AND team.workspace_id = member.workspace_id AND team.status = 'active'
      WHERE membership.workspace_id = $1 AND membership.status = 'active' AND lower(team.code) = lower($2)
      ORDER BY 1`, [workspaceId, roleCode.trim()])).rows.map((row) => row.id);
}

/** The Sales Admin named in the sales settings (PLM-053 tells them when a design is approved). */
export async function salesAdminMembership(db: Db, workspaceId: string): Promise<string | null> {
  return (await db.query<{ id: string | null }>(`SELECT sales_admin_membership_id AS id FROM workspace_sales_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.id ?? null;
}

export async function journeyTimings(db: Db, workspaceId: string, caseId: string): Promise<StageTimings & { kind: JourneyKind }> {
  const row = (await db.query<StageTimings & { packageId: string | null; packageName: string | null }>(
    `SELECT site_visit_hours AS "siteVisitHours", design_internal_days AS "designInternalDays", design_client_days AS "designClientDays", material_selection_days AS "materialSelectionDays",
            render_internal_days AS "renderInternalDays", render_client_days AS "renderClientDays",
            package_id AS "packageId", package_name AS "packageName" FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0];
  return { ...row, kind: row?.packageId || row?.packageName ? "design" : "site_and_materials" };
}

/**
 * Opens the journey of a case. With a design package (PLM-047): its stages, Inspiration active. Without one
 * (a furniture/joinery order, PLM-080/081): the site visit, due within the configured hours, then material
 * selection. Idempotent. The package, the timings and the site-visit question list are frozen on the
 * journey so later configuration changes don't move a client's deadlines or checklist.
 */
export async function startJourney(db: Db, workspaceId: string, caseId: string, userId: string) {
  const facts = await caseFacts(db, workspaceId, caseId);
  if (!facts) return false;
  const pkg = (await db.query<{ id: string; name: string; includedRevisions: number; includesSpacePlanning: boolean; includesRenders: boolean; requiredRoleCode: string | null }>(
    `SELECT package.id, package.name, package.included_revisions AS "includedRevisions", package.includes_space_planning AS "includesSpacePlanning",
            package.includes_renders AS "includesRenders", package.required_role_code AS "requiredRoleCode"
       FROM crm_opportunity_discovery discovery JOIN design_packages package ON package.workspace_id = discovery.workspace_id AND package.id = discovery.design_package_id
      WHERE discovery.workspace_id = $1 AND discovery.opportunity_id = $2`, [workspaceId, facts.opportunityId])).rows[0];
  const settings = (await db.query<{ inspirationDays: number; siteVisitHours: number; designInternalDays: number; designClientDays: number; materialSelectionDays: number; estimateDays: number; questions: unknown;
    renderInternalDays: number | null; renderClientDays: number | null }>(
    `SELECT inspiration_days AS "inspirationDays", site_visit_hours AS "siteVisitHours", design_internal_days AS "designInternalDays", design_client_days AS "designClientDays",
            render_internal_days AS "renderInternalDays", render_client_days AS "renderClientDays",
            material_selection_days AS "materialSelectionDays", estimate_days AS "estimateDays", site_visit_questions AS questions
       FROM workspace_design_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
  const questions = settings ? normaliseSiteQuestions(settings.questions) : DEFAULT_SITE_VISIT_QUESTIONS;
  const created = await db.query(
    `INSERT INTO design_journeys (workspace_id, case_id, package_id, package_name, included_revisions, includes_space_planning, includes_renders, reviewer_role_code, inspiration_days, site_visit_hours,
                                  design_internal_days, design_client_days, material_selection_days, estimate_days, site_visit_questions, started_by, render_internal_days, render_client_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) ON CONFLICT (workspace_id, case_id) DO NOTHING`,
    [workspaceId, caseId, pkg?.id ?? null, pkg?.name ?? null, pkg?.includedRevisions ?? 2, pkg?.includesSpacePlanning ?? false, pkg?.includesRenders ?? false,
      pkg?.requiredRoleCode ?? null, settings?.inspirationDays ?? 7, settings?.siteVisitHours ?? 72, settings?.designInternalDays ?? 35, settings?.designClientDays ?? 56,
      settings?.materialSelectionDays ?? 7, settings?.estimateDays ?? 7, JSON.stringify(questions), userId, settings?.renderInternalDays ?? null, settings?.renderClientDays ?? null]);
  if (!created.rowCount) return false;
  const kind: JourneyKind = pkg ? "design" : "site_and_materials";
  const order = kind === "design" ? journeyStages({ includesSpacePlanning: pkg.includesSpacePlanning, includesRenders: pkg.includesRenders }) : SITE_AND_MATERIALS_STAGES;
  for (const [index, stage] of order.entries()) {
    await db.query(
      `INSERT INTO design_journey_stages (workspace_id, case_id, stage, position, status, owner_membership_id) VALUES ($1, $2, $3, $4, 'locked', $5)`,
      [workspaceId, caseId, stage, index + 1, stage === "renders" ? null : facts.designerId ?? facts.accountManagerId]);
  }
  await activateStage(db, workspaceId, caseId, order[0], userId);
  await recordAudit(db, { workspaceId, actorUserId: userId, action: "design.journey_started.v1", entityType: "pre_project_case", entityId: caseId, after: { kind, packageId: pkg?.id ?? null, stages: order } });
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
    `UPDATE design_journey_stages SET status = 'done', completed_at = now(), completed_by = $4, note = COALESCE($5, note), booking_reminder_at = NULL, version = version + 1
      WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`, [workspaceId, caseId, stage, userId, note]);
  const done = (await db.query<{ activityId: string | null }>(`SELECT activity_id AS "activityId" FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`, [workspaceId, caseId, stage])).rows[0];
  if (done?.activityId) await db.query(`UPDATE crm_activities SET status = 'completed', completed_at = now(), completion_outcome = 'Stage completed', version = version + 1 WHERE workspace_id = $1 AND id = $2 AND status = 'pending'`, [workspaceId, done.activityId]);
  await event(db, workspaceId, caseId, stage, action, note, userId);
  const order = (await db.query<{ stage: JourneyStage }>(`SELECT stage FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 ORDER BY position`, [workspaceId, caseId])).rows.map((row) => row.stage);
  const next = nextStage(order, stage);
  if (next) await activateStage(db, workspaceId, caseId, next, userId);
  return next;
}

const STAGE_TASKS: Partial<Record<JourneyStage, string>> = {
  site_visit: "Site visit: measurements, photos and the question list",
  material_selection: "Material selection: book the showroom appointment",
  renders: "3D renders from the confirmed material list",
};

async function activateStage(db: Db, workspaceId: string, caseId: string, stage: JourneyStage, userId: string | null) {
  const timings = await journeyTimings(db, workspaceId, caseId);
  const now = new Date();
  const { dueAt, clientDueAt, bookingReminderAt } = stageDeadlines(stage, now, timings);
  const facts = await caseFacts(db, workspaceId, caseId);
  let owner = (await db.query<{ owner: string | null }>(`SELECT owner_membership_id AS owner FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`, [workspaceId, caseId, stage])).rows[0]?.owner ?? null;
  if (stage === "renders" && !owner) {
    // PLM-051: the render task goes to the Visualiser, unlocked now that the material list is confirmed.
    const roleCode = (await db.query<{ code: string }>(`SELECT visualiser_role_code AS code FROM workspace_design_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.code ?? "visualiser";
    owner = (await membersWithRole(db, workspaceId, roleCode))[0] ?? null;
  }
  let activityId: string | null = null;
  const title = STAGE_TASKS[stage];
  if (title && facts && owner) {
    activityId = (await db.query<{ id: string }>(
      `INSERT INTO crm_activities (workspace_id, party_id, lead_id, opportunity_id, type, interaction_direction, title, owner_membership_id, priority, due_at, is_next_action, customer_visible, created_by)
       VALUES ($1, $2, $3, $4, 'task'::crm_activity_type, 'internal', $5, $6, 'high', $7, false, false, $8) RETURNING id`,
      [workspaceId, facts.partyId, facts.leadId, facts.opportunityId, title, owner, dueAt, userId])).rows[0].id;
  }
  await db.query(
    `UPDATE design_journey_stages SET status = 'active', started_at = now(), due_at = $4, client_due_at = $5, booking_reminder_at = $6, owner_membership_id = COALESCE($7, owner_membership_id),
            activity_id = COALESCE($8, activity_id), version = version + 1
      WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`, [workspaceId, caseId, stage, dueAt, clientDueAt, bookingReminderAt, owner, activityId]);
  await event(db, workspaceId, caseId, stage, "started", null, userId);
  if (facts && dueAt) await tell(db, workspaceId, caseId, facts, "design.stage_started", { stage, due: dueAt }, `design:${caseId}:${stage}:started`, { extra: [owner] });
}

/**
 * The worker's pass for one workspace (inside its tenant transaction): ends inspiration weeks that ran
 * out, raises one overdue alert per late stage to its owner and the Account Manager, reminds daily until
 * the material-selection appointment is booked (PLM-050), and flags an estimate not sent within its week
 * of the design approval (PLM-053).
 */
export async function processDesignDeadlines(db: Db, workspaceId: string, now = new Date()) {
  let closed = 0; let alerted = 0; let reminded = 0; let estimates = 0;
  const expired = (await db.query<{ caseId: string }>(
    `SELECT case_id AS "caseId" FROM design_journey_stages WHERE workspace_id = $1 AND stage = 'inspiration' AND status = 'active' AND due_at <= $2 FOR UPDATE`, [workspaceId, now])).rows;
  for (const row of expired) { await completeStage(db, workspaceId, row.caseId, "inspiration", null, null, "timer_ended"); closed++; }
  const late = (await db.query<{ caseId: string; stage: JourneyStage; dueAt: Date }>(
    `SELECT case_id AS "caseId", stage, due_at AS "dueAt" FROM design_journey_stages
      WHERE workspace_id = $1 AND status = 'active' AND due_at < $2 AND overdue_notified_at IS NULL FOR UPDATE`, [workspaceId, now])).rows;
  for (const row of late) {
    // The designer and the account manager are reminded by the reminder engine (design.stage_due: before, on and
    // after the due day, then their lead); here the stage is marked overdue in its history once.
    await db.query(`UPDATE design_journey_stages SET overdue_notified_at = now() WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`, [workspaceId, row.caseId, row.stage]);
    await event(db, workspaceId, row.caseId, row.stage, "overdue", null, null);
    alerted++;
  }
  const unbooked = (await db.query<{ caseId: string; dueAt: Date; owner: string | null }>(
    `SELECT stage.case_id AS "caseId", stage.due_at AS "dueAt", stage.owner_membership_id AS owner FROM design_journey_stages stage
       LEFT JOIN crm_appointments appointment ON appointment.workspace_id = stage.workspace_id AND appointment.activity_id = stage.activity_id
      WHERE stage.workspace_id = $1 AND stage.stage = 'material_selection' AND stage.status = 'active' AND stage.booking_reminder_at <= $2 AND appointment.activity_id IS NULL FOR UPDATE OF stage`, [workspaceId, now])).rows;
  for (const row of unbooked) {
    const facts = await caseFacts(db, workspaceId, row.caseId);
    if (facts) await tell(db, workspaceId, row.caseId, facts, "design.material_selection_unbooked", { stage: "material_selection", due: row.dueAt }, `design:${row.caseId}:material_selection:unbooked:${now.toISOString().slice(0, 10)}`, { extra: [row.owner] });
    await db.query(`UPDATE design_journey_stages SET booking_reminder_at = $3 WHERE workspace_id = $1 AND case_id = $2 AND stage = 'material_selection'`, [workspaceId, row.caseId, addDays(now, 1)]);
    reminded++;
  }
  const estimateLate = (await db.query<{ caseId: string; dueAt: Date; approvedOn: string }>(
    `SELECT journey.case_id AS "caseId", journey.estimate_due_at AS "dueAt", to_char(journey.approved_on, 'YYYY-MM-DD') AS "approvedOn" FROM design_journeys journey
      WHERE journey.workspace_id = $1 AND journey.estimate_due_at < $2 AND journey.estimate_overdue_notified_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM commercial_quotes quote WHERE quote.workspace_id = journey.workspace_id AND quote.case_id = journey.case_id
                          AND quote.kind = 'quotation' AND (quote.id = journey.estimate_quote_id OR quote.round = 'main')
                          AND quote.status IN ('issued', 'accepted', 'changes_requested', 'declined')) FOR UPDATE OF journey`, [workspaceId, now])).rows;
  for (const row of estimateLate) {
    const facts = await caseFacts(db, workspaceId, row.caseId);
    // The estimate is Sales' job: the Account Manager and the Sales Admin hear it, not the designer.
    if (facts) await tell(db, workspaceId, row.caseId, { ...facts, designerId: null }, "design.estimate_overdue", { stage: "approval", due: row.dueAt, approvedOn: row.approvedOn }, `design:${row.caseId}:estimate:overdue`,
      { email: true, extra: [await salesAdminMembership(db, workspaceId)], deepLink: `/workspace/pre-projects/cases/${row.caseId}/quotations` });
    await db.query(`UPDATE design_journeys SET estimate_overdue_notified_at = now() WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, row.caseId]);
    await event(db, workspaceId, row.caseId, "approval", "estimate_overdue", null, null);
    estimates++;
  }
  return { closed, alerted, reminded, estimates };
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

type TellOptions = { email?: boolean; extra?: Array<string | null | undefined>; deepLink?: string };

/** Tells the case's designer and Account Manager (and any extra members) about a stage, in the workspace's time zone and locale. */
export async function tell(db: Db, workspaceId: string, caseId: string, facts: CaseFacts, code: string, data: { stage: JourneyStage; due: Date; approvedOn?: string }, key: string, options: TellOptions = {}) {
  const workspace = (await db.query<{ timezone: string; locale: string }>(`SELECT default_timezone AS timezone, default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
  const timeZone = workspace?.timezone ?? "UTC", locale = workspace?.locale ?? "en";
  const variables = { stage: STAGE_LABELS[data.stage], clientName: facts.clientName, due: formatDue(data.due, timeZone, locale), approvedOn: data.approvedOn ? formatDay(data.approvedOn, locale) : "" };
  const members = [...new Set([facts.designerId, facts.accountManagerId, ...(options.extra ?? [])].filter((id): id is string => Boolean(id)))];
  const recipients = (await db.query<{ userId: string }>(`SELECT DISTINCT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`, [workspaceId, members])).rows;
  const deepLink = options.deepLink ?? `/workspace/pre-projects/cases/${caseId}/overview`;
  const eventType = code === "design.stage_overdue" ? "design.stage.overdue" : code === "design.stage_started" ? "design.stage.started" : code;
  for (const recipient of recipients) {
    await notifyUserInApp(db, { workspaceId, recipientUserId: recipient.userId, code, eventType, variables, deepLink, idempotencyKey: `${key}:${recipient.userId}` });
    if (options.email) await queueUserEmail(db, { workspaceId, recipientUserId: recipient.userId, code, eventType, variables, deepLink, idempotencyKey: `${key}:${recipient.userId}:email` });
  }
}

export function formatDue(due: Date, timeZone: string, locale: string) {
  const options: Intl.DateTimeFormatOptions = { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
  try { return new Intl.DateTimeFormat(locale, options).format(due); } catch { return new Intl.DateTimeFormat("en", options).format(due); }
}

/** A calendar day (no time zone shift): "5 Oct 2026". */
export const formatDay = formatCalendarDay;

export async function event(db: Db, workspaceId: string, caseId: string, stage: string, action: string, note: string | null, userId: string | null) {
  await db.query(`INSERT INTO design_journey_events (workspace_id, case_id, stage, action, note, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6)`, [workspaceId, caseId, stage, action, note, userId]);
}

/** Today in the firm's time zone (a calendar day). */
export async function workspaceToday(db: Db, workspaceId: string) {
  return (await db.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
}
