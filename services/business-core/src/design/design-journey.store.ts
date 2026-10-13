import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { notApplicableRoles } from "../project-core/project-team";
import { projectRepository } from "../projects/project-repository";
import type { ProjectData } from "../projects/execution.types";
import { formatCalendarDay } from "../common/calendar-day";
import {
  addDays, CURRENT_FLOW, DEFAULT_SITE_VISIT_QUESTIONS, developmentWindowDays, journeyStages, nextStage, normaliseSiteQuestions, SITE_AND_MATERIALS_STAGES, stageDeadlines,
  STAGE_LABELS, TASK_LABELS, TASK_STAGE, type FlowVersion, type JourneyKind, type JourneyStage, type JourneyTask, type StageTimings,
} from "./design-journey.domain";
import { allocationSlots, DEFAULT_DESIGN_TEAM, type DesignTeamConfig } from "./design-team.domain";

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

/** Whether a member holds a role (or is in a team) with this code. */
export async function holdsRole(db: Db, workspaceId: string, membershipId: string | null | undefined, roleCode: string | null | undefined) {
  if (!membershipId || !roleCode?.trim()) return false;
  return (await membersWithRole(db, workspaceId, roleCode)).includes(membershipId);
}

/** The design team's role keys (PLM-151): the firm's configuration, else the defaults. */
export async function designTeamConfig(db: Db, workspaceId: string): Promise<DesignTeamConfig> {
  const row = (await db.query<Record<string, string | null>>(
    `SELECT lead_designer_role_key AS lead_designer, junior_designer_role_key AS junior_designer, sales_admin_role_key AS sales_admin, visualiser_role_key AS visualiser,
            draftsman_role_key AS draftsman, material_coordinator_role_key AS material_coordinator, technical_lead_role_code AS "technicalLeadRoleCode"
       FROM workspace_design_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
  return row ? { ...DEFAULT_DESIGN_TEAM, ...row, lead_designer: row.lead_designer || DEFAULT_DESIGN_TEAM.lead_designer } as DesignTeamConfig : { ...DEFAULT_DESIGN_TEAM };
}

/** Who holds a team role on the case (an active member), the first named. */
export async function caseRoleHolder(db: Db, workspaceId: string, caseId: string, roleKey: string | null | undefined): Promise<string | null> {
  if (!roleKey) return null;
  return (await db.query<{ id: string }>(
    `SELECT assignment.membership_id AS id FROM project_assignments assignment
       JOIN workspace_memberships member ON member.workspace_id = assignment.workspace_id AND member.id = assignment.membership_id AND member.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.case_id = $2 AND assignment.active AND $3::varchar = ANY(assignment.role_keys)
      ORDER BY assignment.id LIMIT 1`, [workspaceId, caseId, roleKey])).rows[0]?.id ?? null;
}

/** The case's lead designer: the allocated one, else the opportunity's dedicated designer (journeys before allocation existed). */
export async function leadDesigner(db: Db, workspaceId: string, caseId: string) {
  const config = await designTeamConfig(db, workspaceId);
  return (await caseRoleHolder(db, workspaceId, caseId, config.lead_designer)) ?? (await caseFacts(db, workspaceId, caseId))?.designerId ?? null;
}

/** The case's designers (lead and junior): any of them may do the design site measure (PLM-141). */
export async function caseDesigners(db: Db, workspaceId: string, caseId: string) {
  const config = await designTeamConfig(db, workspaceId);
  const keys = [config.lead_designer, config.junior_designer].filter((key): key is string => Boolean(key));
  const held = (await db.query<{ id: string }>(
    `SELECT DISTINCT assignment.membership_id AS id FROM project_assignments assignment
       JOIN workspace_memberships member ON member.workspace_id = assignment.workspace_id AND member.id = assignment.membership_id AND member.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.case_id = $2 AND assignment.active AND assignment.role_keys && $3::varchar[]`, [workspaceId, caseId, keys])).rows.map((row) => row.id);
  const dedicated = (await caseFacts(db, workspaceId, caseId))?.designerId;
  return [...new Set([...held, ...(dedicated ? [dedicated] : [])])];
}

/** The Sales Admin of a case (PLM-151: allocated per project), else the one named in the sales settings. */
export async function salesAdminMembership(db: Db, workspaceId: string, caseId?: string | null): Promise<string | null> {
  if (caseId) {
    const config = await designTeamConfig(db, workspaceId);
    const holder = await caseRoleHolder(db, workspaceId, caseId, config.sales_admin);
    if (holder) return holder;
  }
  return (await db.query<{ id: string | null }>(`SELECT sales_admin_membership_id AS id FROM workspace_sales_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.id ?? null;
}

type JourneyRow = StageTimings & {
  packageId: string | null; packageName: string | null; flowVersion: FlowVersion; includesRenders: boolean; reviewerRoleCode: string | null; siteMeasureDays: number;
  developmentMinDays: number; developmentMaxDays: number; developmentDaysPerRoom: number; renderSignoffDueOn: string | null;
};

export async function journeyTimings(db: Db, workspaceId: string, caseId: string): Promise<JourneyRow & { kind: JourneyKind }> {
  const row = (await db.query<JourneyRow>(
    `SELECT site_visit_hours AS "siteVisitHours", design_internal_days AS "designInternalDays", design_client_days AS "designClientDays", material_selection_days AS "materialSelectionDays",
            render_internal_days AS "renderInternalDays", render_client_days AS "renderClientDays", flow_version AS "flowVersion", kickoff_days AS "kickoffDays",
            concept_days AS "conceptDays", site_measure_days AS "siteMeasureDays", sample_collection_days AS "sampleCollectionDays", sample_meeting_days AS "sampleMeetingDays",
            development_min_days AS "developmentMinDays", development_max_days AS "developmentMaxDays", development_days_per_room AS "developmentDaysPerRoom",
            to_char(render_signoff_due_on, 'YYYY-MM-DD') AS "renderSignoffDueOn", includes_renders AS "includesRenders", reviewer_role_code AS "reviewerRoleCode",
            package_id AS "packageId", package_name AS "packageName" FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0];
  return { ...row, flowVersion: Number(row?.flowVersion ?? 1) as FlowVersion, kind: row?.packageId || row?.packageName ? "design" : "site_and_materials" };
}

export type StartOptions = {
  /**
   * The order to start in. Always the current one, except to rebuild a journey started before 13 Oct 2026 in the order
   * it used (an import of an in-flight journey, and the tests that keep that order working).
   */
  flow?: FlowVersion;
};

/**
 * Opens the journey of a case. With a design package (PLM-047, PLM-140): its stages, Inspiration active, and the design
 * team to allocate (PLM-151). Without one (a furniture/joinery order, PLM-080/081): the site visit, due within the
 * configured hours, then material selection. Idempotent. The package, the timings and the site-visit question list are
 * frozen on the journey so later configuration changes don't move a client's deadlines or checklist.
 */
export async function startJourney(db: Db, workspaceId: string, caseId: string, userId: string, options: StartOptions = {}) {
  const facts = await caseFacts(db, workspaceId, caseId);
  if (!facts) return false;
  const pkg = (await db.query<{ id: string; name: string; includedRevisions: number; includesSpacePlanning: boolean; includesRenders: boolean; reviewRoleCode: string | null }>(
    `SELECT package.id, package.name, package.included_revisions AS "includedRevisions", package.includes_space_planning AS "includesSpacePlanning",
            package.includes_renders AS "includesRenders", COALESCE(package.review_role_code, package.required_role_code) AS "reviewRoleCode"
       FROM crm_opportunity_discovery discovery JOIN design_packages package ON package.workspace_id = discovery.workspace_id AND package.id = discovery.design_package_id
      WHERE discovery.workspace_id = $1 AND discovery.opportunity_id = $2`, [workspaceId, facts.opportunityId])).rows[0];
  const settings = (await db.query<Record<string, number | null> & { questions: unknown }>(
    `SELECT inspiration_days AS "inspirationDays", site_visit_hours AS "siteVisitHours", design_internal_days AS "designInternalDays", design_client_days AS "designClientDays",
            render_internal_days AS "renderInternalDays", render_client_days AS "renderClientDays",
            material_selection_days AS "materialSelectionDays", estimate_days AS "estimateDays", site_visit_questions AS questions,
            kickoff_days AS "kickoffDays", concept_days AS "conceptDays", site_measure_days AS "siteMeasureDays", development_min_days AS "developmentMinDays",
            development_max_days AS "developmentMaxDays", development_days_per_room AS "developmentDaysPerRoom", sample_collection_days AS "sampleCollectionDays",
            sample_meeting_days AS "sampleMeetingDays", concept_options_max AS "conceptOptionsMax", allocation_days AS "allocationDays"
       FROM workspace_design_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
  const value = (key: string, fallback: number) => (settings?.[key] ?? fallback) as number;
  const questions = settings ? normaliseSiteQuestions(settings.questions) : DEFAULT_SITE_VISIT_QUESTIONS;
  const kind: JourneyKind = pkg ? "design" : "site_and_materials";
  const flow: FlowVersion = kind === "design" ? options.flow ?? CURRENT_FLOW : 1;
  const created = await db.query(
    `INSERT INTO design_journeys (workspace_id, case_id, package_id, package_name, included_revisions, includes_space_planning, includes_renders, reviewer_role_code, inspiration_days, site_visit_hours,
                                  design_internal_days, design_client_days, material_selection_days, estimate_days, site_visit_questions, started_by, render_internal_days, render_client_days,
                                  flow_version, kickoff_days, concept_days, site_measure_days, development_min_days, development_max_days, development_days_per_room,
                                  sample_collection_days, sample_meeting_days, concept_options_max)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28) ON CONFLICT (workspace_id, case_id) DO NOTHING`,
    [workspaceId, caseId, pkg?.id ?? null, pkg?.name ?? null, pkg?.includedRevisions ?? 2, pkg?.includesSpacePlanning ?? false, pkg?.includesRenders ?? false,
      pkg?.reviewRoleCode ?? null, value("inspirationDays", 7), value("siteVisitHours", 72), value("designInternalDays", 35), value("designClientDays", 56),
      value("materialSelectionDays", 7), value("estimateDays", 7), JSON.stringify(questions), userId, settings?.renderInternalDays ?? null, settings?.renderClientDays ?? null,
      flow, value("kickoffDays", 5), value("conceptDays", 7), value("siteMeasureDays", 3), value("developmentMinDays", 14), value("developmentMaxDays", 56),
      value("developmentDaysPerRoom", 7), value("sampleCollectionDays", 7), value("sampleMeetingDays", 7), settings?.conceptOptionsMax ?? null]);
  if (!created.rowCount) return false;
  const order = kind === "design" ? journeyStages({ includesSpacePlanning: pkg.includesSpacePlanning, includesRenders: pkg.includesRenders }, flow) : SITE_AND_MATERIALS_STAGES;
  const owner = flow === 2 ? await leadDesigner(db, workspaceId, caseId) ?? facts.accountManagerId : facts.designerId ?? facts.accountManagerId;
  for (const [index, stage] of order.entries()) {
    await db.query(
      `INSERT INTO design_journey_stages (workspace_id, case_id, stage, position, status, owner_membership_id) VALUES ($1, $2, $3, $4, 'locked', $5)`,
      [workspaceId, caseId, stage, index + 1, stage === "renders" && flow === 1 ? null : owner]);
  }
  await activateStage(db, workspaceId, caseId, order[0], userId);
  // PLM-151: the fee is paid, so the design team is allocated now (the kick-off is booked with them).
  if (flow === 2) await openAllocation(db, workspaceId, caseId, userId, value("allocationDays", 1), pkg?.reviewRoleCode ?? null);
  await recordAudit(db, { workspaceId, actorUserId: userId, action: "design.journey_started.v1", entityType: "pre_project_case", entityId: caseId, after: { kind, flow, packageId: pkg?.id ?? null, stages: order } });
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
  kickoff: "Kick-off meeting: book it with the client",
  site_visit: "Site visit: measurements, photos and the question list",
  material_selection: "Material selection: book the showroom appointment",
  renders: "Renders from the confirmed material list",
  samples: "Sample meeting: book it with the client",
};

const TASK_TITLES: Record<JourneyTask, string> = {
  team_allocation: "Allocate the design team",
  site_measure: "Design site measure: measurements, photos and the question list",
  sample_collection: "Collect the samples for every room",
  finishes_to_qs: "Mark the finishes on the render snapshots and send them to QS",
};

async function activateStage(db: Db, workspaceId: string, caseId: string, stage: JourneyStage, userId: string | null) {
  const timings = await journeyTimings(db, workspaceId, caseId);
  const now = new Date();
  const current = timings.flowVersion === 2;
  // The kick-off meeting the concept counts from, and the development window from the rooms in scope (PLM-142).
  const kickoffAt = current && stage === "concepts" ? await kickoffMoment(db, workspaceId, caseId) : null;
  const developmentDays = current && stage === "concepts" ? developmentWindowDays(await roomCount(db, workspaceId, caseId),
    { minDays: timings.developmentMinDays, maxDays: timings.developmentMaxDays, daysPerRoom: timings.developmentDaysPerRoom }) : null;
  const { dueAt, clientDueAt, bookingReminderAt } = stageDeadlines(stage, now, timings, { kickoffAt, developmentDays, renderSignoffDueOn: timings.renderSignoffDueOn });
  const facts = await caseFacts(db, workspaceId, caseId);
  let owner = (await db.query<{ owner: string | null }>(`SELECT owner_membership_id AS owner FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`, [workspaceId, caseId, stage])).rows[0]?.owner ?? null;
  if (current) owner = await leadDesigner(db, workspaceId, caseId) ?? owner;
  else if (stage === "renders" && !owner) {
    // PLM-051 (the old order): the render task goes to the Visualiser, unlocked now that the material list is confirmed.
    const roleCode = (await db.query<{ code: string }>(`SELECT visualiser_role_code AS code FROM workspace_design_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.code ?? "visualiser";
    owner = (await membersWithRole(db, workspaceId, roleCode))[0] ?? null;
  }
  let activityId: string | null = null;
  const title = stage === "renders" && current ? "Renders: tag the team and record the client's sign-off" : STAGE_TASKS[stage];
  if (title && facts && owner) activityId = await ownerTask(db, workspaceId, facts, title, owner, dueAt, userId);
  await db.query(
    `UPDATE design_journey_stages SET status = 'active', started_at = now(), due_at = $4, client_due_at = $5, booking_reminder_at = $6, owner_membership_id = COALESCE($7, owner_membership_id),
            activity_id = COALESCE($8, activity_id), version = version + 1
      WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`, [workspaceId, caseId, stage, dueAt, clientDueAt, bookingReminderAt, owner, activityId]);
  await event(db, workspaceId, caseId, stage, "started", null, userId);
  if (facts && dueAt) await tell(db, workspaceId, caseId, facts, "design.stage_started", { stage, due: dueAt }, `design:${caseId}:${stage}:started`, { extra: [owner] });
  if (!current || !facts) return;
  if (stage === "concepts") {
    // PLM-141: the design site measure runs beside the concept, due within its days of the kick-off.
    const due = addDays(kickoffAt && kickoffAt.getTime() < now.getTime() ? kickoffAt : now, (await db.query<{ days: number }>(
      `SELECT site_measure_days AS days FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0]?.days ?? 3);
    const designers = await caseDesigners(db, workspaceId, caseId);
    await openTask(db, workspaceId, caseId, "site_measure", { owner: owner ?? designers[0] ?? facts.accountManagerId, dueAt: due, userId });
    await tellMembers(db, workspaceId, designers.length ? designers : [owner], "design.site_measure_due", { clientName: facts.clientName, due: await dueText(db, workspaceId, due) },
      `/workspace/pre-projects/cases/${caseId}/site`, `design:${caseId}:site_measure:due`, true);
  }
  if (stage === "renders") {
    // PLM-143: whoever is already tagged on the renders hears they start now.
    const config = await designTeamConfig(db, workspaceId);
    for (const slot of ["visualiser", "draftsman"] as const) {
      const holder = await caseRoleHolder(db, workspaceId, caseId, config[slot]);
      if (holder) await tellRenderTag(db, workspaceId, caseId, holder, slot === "visualiser" ? "Visualiser" : "Draftsman", userId);
    }
    // The technical lead tags the Draftsman: with nobody tagged yet (and the job needing one), they hear the renders started.
    if (config.draftsman && dueAt && !(await caseRoleHolder(db, workspaceId, caseId, config.draftsman))
      && !(await notApplicableRoles(db, workspaceId, { caseId })).includes(config.draftsman)) {
      const leads = await membersWithRole(db, workspaceId, config.technicalLeadRoleCode);
      if (leads.length) await tell(db, workspaceId, caseId, facts, "design.stage_started", { stage, due: dueAt }, `design:${caseId}:${stage}:started`, { extra: leads });
    }
  }
  if (stage === "samples") {
    // PLM-144: the Material Coordinator collects the samples within the week; the meeting follows.
    const config = await designTeamConfig(db, workspaceId);
    const coordinator = await caseRoleHolder(db, workspaceId, caseId, config.material_coordinator)
      ?? (await membersWithRole(db, workspaceId, config.material_coordinator))[0] ?? owner;
    const due = addDays(now, timings.sampleCollectionDays ?? 7);
    await openTask(db, workspaceId, caseId, "sample_collection", { owner: coordinator ?? facts.accountManagerId, dueAt: due, userId });
    await tellMembers(db, workspaceId, [coordinator], "design.samples_to_collect", { clientName: facts.clientName, due: await dueText(db, workspaceId, due) },
      `/workspace/pre-projects/cases/${caseId}/overview`, `design:${caseId}:sample_collection:due`, true);
  }
  if (stage === "approval" && (await db.query(`SELECT 1 FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = 'samples' AND status = 'done'`, [workspaceId, caseId])).rowCount) {
    // PLM-146: the samples are approved; the lead designer marks the exact finishes on the render snapshots and sends
    // them to QS within the firm's days (Settings › Design; 3 when not set). The reminder engine chases it (design.stage_due).
    const days = (await db.query<{ days: number }>(`SELECT finishes_to_qs_days AS days FROM workspace_finish_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.days ?? 3;
    const due = addDays(now, days);
    const lead = await leadDesigner(db, workspaceId, caseId);
    await openTask(db, workspaceId, caseId, "finishes_to_qs", { owner: lead ?? owner ?? facts.accountManagerId, dueAt: due, userId });
    await tellMembers(db, workspaceId, [lead ?? owner], "finishes.to_mark",
      { clientName: facts.clientName, project: "", actor: "", title: "", count: "", items: "", note: "", due: await dueText(db, workspaceId, due) },
      `/workspace/pre-projects/cases/${caseId}/designs?stage=finishes`, `design:${caseId}:finishes_to_qs:due`, true);
  }
}

/** The kick-off meeting's start, when it was booked. */
export async function kickoffMoment(db: Db, workspaceId: string, caseId: string): Promise<Date | null> {
  const row = (await db.query<{ at: Date | null }>(
    `SELECT appointment.starts_at AS at FROM design_journey_stages stage
       JOIN crm_appointments appointment ON appointment.workspace_id = stage.workspace_id AND appointment.activity_id = stage.activity_id
      WHERE stage.workspace_id = $1 AND stage.case_id = $2 AND stage.stage = 'kickoff'`, [workspaceId, caseId])).rows[0];
  return row?.at ? new Date(row.at) : null;
}

async function roomCount(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM pre_project_rooms WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0]?.count ?? 0;
}

/** A task on the owner's list for a step or a piece of work in it. */
async function ownerTask(db: Db, workspaceId: string, facts: CaseFacts, title: string, owner: string, dueAt: Date | null, userId: string | null) {
  return (await db.query<{ id: string }>(
    `INSERT INTO crm_activities (workspace_id, party_id, lead_id, opportunity_id, type, interaction_direction, title, owner_membership_id, priority, due_at, is_next_action, customer_visible, created_by)
     VALUES ($1, $2, $3, $4, 'task'::crm_activity_type, 'internal', $5, $6, 'high', $7, false, false, $8) RETURNING id`,
    [workspaceId, facts.partyId, facts.leadId, facts.opportunityId, title, owner, dueAt, userId])).rows[0].id;
}

/** Opens a piece of work inside a step (idempotent per task): its owner's task, its deadline and its history line. */
export async function openTask(db: Db, workspaceId: string, caseId: string, task: JourneyTask, input: { owner: string | null; dueAt: Date | null; userId: string | null }) {
  const facts = await caseFacts(db, workspaceId, caseId);
  const exists = (await db.query(`SELECT 1 FROM design_journey_tasks WHERE workspace_id = $1 AND case_id = $2 AND task = $3`, [workspaceId, caseId, task])).rowCount;
  if (exists) return false;
  const activityId = facts && input.owner ? await ownerTask(db, workspaceId, facts, TASK_TITLES[task], input.owner, input.dueAt, input.userId) : null;
  await db.query(
    `INSERT INTO design_journey_tasks (workspace_id, case_id, task, stage, owner_membership_id, activity_id, due_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [workspaceId, caseId, task, TASK_STAGE[task], input.owner, activityId, input.dueAt]);
  await event(db, workspaceId, caseId, TASK_STAGE[task], `${task}_opened`, null, input.userId);
  return true;
}

/** Marks a piece of work done with who and when, and closes its task. */
export async function completeTask(db: Db, workspaceId: string, caseId: string, task: JourneyTask, userId: string | null, note: string | null) {
  const row = (await db.query<{ activityId: string | null }>(
    `UPDATE design_journey_tasks SET status = 'done', completed_at = now(), completed_by = $4, note = COALESCE($5, note), version = version + 1
      WHERE workspace_id = $1 AND case_id = $2 AND task = $3 AND status = 'open' RETURNING activity_id AS "activityId"`, [workspaceId, caseId, task, userId, note])).rows[0];
  if (!row) return false;
  if (row.activityId) await db.query(`UPDATE crm_activities SET status = 'completed', completed_at = now(), completion_outcome = 'Done', version = version + 1 WHERE workspace_id = $1 AND id = $2 AND status = 'pending'`,
    [workspaceId, row.activityId]);
  await event(db, workspaceId, caseId, TASK_STAGE[task], `${task}_done`, note, userId);
  return true;
}

export type TaskRow = { task: JourneyTask; status: "open" | "done"; ownerId: string | null; ownerName: string | null; dueAt: Date | null; completedAt: Date | null; completedByName: string | null; note: string | null; version: number };

export async function readTasks(db: Db, workspaceId: string, caseId: string): Promise<TaskRow[]> {
  return (await db.query<TaskRow>(
    `SELECT task.task, task.status, task.owner_membership_id AS "ownerId", account.display_name AS "ownerName", task.due_at AS "dueAt", task.completed_at AS "completedAt",
            completer.display_name AS "completedByName", task.note, task.version
       FROM design_journey_tasks task
       LEFT JOIN workspace_memberships member ON member.id = task.owner_membership_id LEFT JOIN users account ON account.id = member.user_id
       LEFT JOIN users completer ON completer.id = task.completed_by
      WHERE task.workspace_id = $1 AND task.case_id = $2 ORDER BY task.started_at`, [workspaceId, caseId])).rows;
}

/**
 * PLM-151: the design team to allocate once the fee is paid: a task for the Account Manager, and the package's reviewer
 * told they choose the lead designer. Nothing when nobody is to be chosen (the workspace configures no slots).
 */
async function openAllocation(db: Db, workspaceId: string, caseId: string, userId: string | null, days: number, reviewRoleCode: string | null) {
  const facts = await caseFacts(db, workspaceId, caseId);
  if (!facts) return;
  const config = await designTeamConfig(db, workspaceId);
  const slots = allocationSlots(config);
  if (!slots.length) return;
  const due = addDays(new Date(), days);
  await openTask(db, workspaceId, caseId, "team_allocation", { owner: facts.accountManagerId, dueAt: due, userId });
  const labels = await roleLabels(db, workspaceId);
  const label = (key: string | null) => (key ? labels.get(key) ?? key.replace(/_/g, " ") : "");
  const reviewers = reviewRoleCode ? await membersWithRole(db, workspaceId, reviewRoleCode) : [];
  const amSlots = reviewers.length ? slots.filter((slot) => slot !== "lead_designer") : slots;
  const variables = (list: typeof slots) => ({ clientName: facts.clientName, roles: list.map((slot) => label(config[slot])).join(", "), due: "" });
  const dueAt = await dueText(db, workspaceId, due);
  const link = `/workspace/pre-projects/cases/${caseId}/overview`;
  if (amSlots.length) await tellMembers(db, workspaceId, [facts.accountManagerId], "design.team_to_allocate", { ...variables(amSlots), due: dueAt }, link, `design:${caseId}:team:allocate`, true);
  if (reviewers.length) await tellMembers(db, workspaceId, reviewers, "design.team_to_allocate", { ...variables(["lead_designer"]), due: dueAt }, link, `design:${caseId}:team:lead`, true);
}

/** The workspace's role labels by key (Settings › Projects). */
export async function roleLabels(db: Db, workspaceId: string) {
  const roles = (await db.query<{ roles: Array<{ key: string; label: string }> | null }>(`SELECT roles FROM workspace_project_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.roles ?? [];
  return new Map(roles.map((role) => [role.key, role.label]));
}

/** Tells someone tagged on the renders (PLM-143) when they start and when the client signs them off. */
export async function tellRenderTag(db: Db, workspaceId: string, caseId: string, membershipId: string, role: string, userId: string | null) {
  const facts = await caseFacts(db, workspaceId, caseId);
  const stage = (await db.query<{ status: string; clientDueAt: Date | null; agreedOn: string | null; locale: string | null }>(
    `SELECT stage.status, stage.client_due_at AS "clientDueAt", to_char(journey.render_signoff_due_on, 'YYYY-MM-DD') AS "agreedOn", workspace.default_locale AS locale
       FROM design_journey_stages stage JOIN design_journeys journey ON journey.workspace_id = stage.workspace_id AND journey.case_id = stage.case_id
       JOIN workspaces workspace ON workspace.id = stage.workspace_id
      WHERE stage.workspace_id = $1 AND stage.case_id = $2 AND stage.stage = 'renders'`, [workspaceId, caseId])).rows[0];
  if (!facts || stage?.status !== "active") return;
  const actor = userId ? (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? "" : "";
  // The sign-off agreed at the kick-off is a day, not a time of day: say the day.
  const due = stage.agreedOn ? formatDay(stage.agreedOn, stage.locale ?? "en") : stage.clientDueAt ? await dueText(db, workspaceId, stage.clientDueAt) : "";
  await tellMembers(db, workspaceId, [membershipId], "design.render_tagged",
    { clientName: facts.clientName, role, actor, due },
    `/workspace/pre-projects/cases/${caseId}/designs?stage=renders`, `design:${caseId}:renders:tagged:${membershipId}`, true, userId);
}

/**
 * The worker's pass for one workspace (inside its tenant transaction): ends inspiration weeks that ran out, marks each
 * late stage or task overdue once in its history (the reminder engine tells the people, design.stage_due), reminds daily
 * until the material-selection or sample meeting is booked (PLM-050, PLM-144), and flags an estimate not sent within its
 * week of the design approval (PLM-053).
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
  const lateTasks = (await db.query<{ caseId: string; task: JourneyTask; stage: string }>(
    `SELECT case_id AS "caseId", task, stage FROM design_journey_tasks
      WHERE workspace_id = $1 AND status = 'open' AND due_at < $2 AND overdue_notified_at IS NULL FOR UPDATE`, [workspaceId, now])).rows;
  for (const row of lateTasks) {
    await db.query(`UPDATE design_journey_tasks SET overdue_notified_at = now() WHERE workspace_id = $1 AND case_id = $2 AND task = $3`, [workspaceId, row.caseId, row.task]);
    await event(db, workspaceId, row.caseId, row.stage, `${row.task}_overdue`, null, null);
    alerted++;
  }
  const unbooked = (await db.query<{ caseId: string; stage: "material_selection" | "samples"; dueAt: Date; owner: string | null }>(
    `SELECT stage.case_id AS "caseId", stage.stage, stage.due_at AS "dueAt", stage.owner_membership_id AS owner FROM design_journey_stages stage
       LEFT JOIN crm_appointments appointment ON appointment.workspace_id = stage.workspace_id AND appointment.activity_id = stage.activity_id
      WHERE stage.workspace_id = $1 AND stage.stage IN ('material_selection', 'samples') AND stage.status = 'active' AND stage.booking_reminder_at <= $2 AND appointment.activity_id IS NULL
      FOR UPDATE OF stage`, [workspaceId, now])).rows;
  for (const row of unbooked) {
    const facts = await caseFacts(db, workspaceId, row.caseId);
    const code = row.stage === "samples" ? "design.sample_meeting_unbooked" : "design.material_selection_unbooked";
    if (facts) await tell(db, workspaceId, row.caseId, facts, code, { stage: row.stage, due: row.dueAt }, `design:${row.caseId}:${row.stage}:unbooked:${now.toISOString().slice(0, 10)}`, { extra: [row.owner] });
    await db.query(`UPDATE design_journey_stages SET booking_reminder_at = $4 WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`, [workspaceId, row.caseId, row.stage, addDays(now, 1)]);
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
      { email: true, extra: [await salesAdminMembership(db, workspaceId, row.caseId)], deepLink: `/workspace/pre-projects/cases/${row.caseId}/quotations` });
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

/** Tells members (by membership) one notice, in the app and by email when asked; the person acting is left out. */
export async function tellMembers(db: Db, workspaceId: string, memberships: Array<string | null | undefined>, code: string, variables: Record<string, string>, deepLink: string, key: string,
  email = false, except: string | null = null) {
  const ids = [...new Set(memberships.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return 0;
  const recipients = (await db.query<{ userId: string }>(`SELECT DISTINCT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
    [workspaceId, ids])).rows.filter((row) => row.userId !== except);
  for (const recipient of recipients) {
    await notifyUserInApp(db, { workspaceId, recipientUserId: recipient.userId, code, eventType: code, variables, deepLink, idempotencyKey: `${key}:${recipient.userId}` });
    if (email) await queueUserEmail(db, { workspaceId, recipientUserId: recipient.userId, code, eventType: code, variables, deepLink, idempotencyKey: `${key}:${recipient.userId}:email` });
  }
  return recipients.length;
}

/** A deadline as people read it, in the firm's zone and language. */
export async function dueText(db: Db, workspaceId: string, due: Date) {
  const workspace = (await db.query<{ timezone: string; locale: string }>(`SELECT default_timezone AS timezone, default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
  return formatDue(due, workspace?.timezone ?? "UTC", workspace?.locale ?? "en");
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

/**
 * The "samples approved" fact other steps read (finishes for QS, value engineering, the procurement gate): when the
 * client's samples were approved on the case (or, on a journey of the old order or a furniture/joinery order, when the
 * material list was confirmed or recorded as not required). Null while they aren't.
 */
export async function samplesApprovedAt(db: Db, workspaceId: string, caseId: string): Promise<Date | null> {
  const row = (await db.query<{ at: Date | null }>(
    `SELECT max(completed_at) AS at FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage IN ('samples', 'material_selection') AND status = 'done'`,
    [workspaceId, caseId])).rows[0];
  return row?.at ? new Date(row.at) : null;
}

export const taskLabel = (task: JourneyTask) => TASK_LABELS[task];
