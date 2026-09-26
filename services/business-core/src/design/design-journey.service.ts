import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { assertMemberFree } from "../crm/shared/calendar-clash";
import { checkIntroSlot, meetingLocation, meetingWhen } from "../crm/opportunities/intro-meeting.domain";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { siteEvidenceProblem, STAGE_LABELS, type JourneyStage } from "./design-journey.domain";
import { caseFacts, completeStage, recordProjectSiteVisit, startJourney } from "./design-journey.store";

export type ScheduleSiteVisitInput = { startsAt: string; endsAt: string; timezone: string; address?: string | null; version: number };

/** PLM-047/048: the design journey on a case — inspiration week, the site visit within its deadline, then design. */
@Injectable()
export class DesignJourneyService {
  constructor(private readonly access: WorkspaceAccessService) {}

  get(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client, user) => ({
      ...await this.view(client, workspaceId, caseId),
      canStart: await this.access.hasPermission(client, workspaceId, user.userId, "pre_projects.manage_lifecycle"),
    }));
  }

  start(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.manage_lifecycle"], async (client, user) => {
      await this.lockCase(client, workspaceId, caseId);
      if (!(await startJourney(client, workspaceId, caseId, user.userId))) throw new ConflictException("The design stages have already started");
      return this.view(client, workspaceId, caseId);
    });
  }

  /** The client or the designer can end the inspiration week early (PLM-047). */
  closeInspiration(actor: RequestActor, workspaceId: string, caseId: string, input: { note?: string | null; version: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      const stage = await this.activeStage(client, workspaceId, caseId, "inspiration", input.version);
      await completeStage(client, workspaceId, caseId, stage, userId, input.note?.trim() || null, "closed_early");
      return this.view(client, workspaceId, caseId);
    });
  }

  /** PLM-044/048: the designer books the visit; the Account Manager is invited with them. */
  scheduleSiteVisit(actor: RequestActor, workspaceId: string, caseId: string, input: ScheduleSiteVisitInput) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      await this.activeStage(client, workspaceId, caseId, "site_visit", input.version);
      const problem = checkIntroSlot({ ...input, mode: "in_person" });
      if (problem) throw new UnprocessableEntityException(problem);
      const facts = await caseFacts(client, workspaceId, caseId);
      const stage = (await client.query<{ activityId: string | null; owner: string | null }>(
        `SELECT activity_id AS "activityId", owner_membership_id AS owner FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = 'site_visit'`, [workspaceId, caseId])).rows[0];
      if (!facts || !stage?.activityId || !stage.owner) throw new UnprocessableEntityException("Choose the dedicated designer on the opportunity first");
      await assertMemberFree(client, workspaceId, stage.owner, input.startsAt, input.endsAt, "The designer", stage.activityId);
      const attendees = [...new Set([stage.owner, facts.accountManagerId].filter(Boolean))];
      const location = meetingLocation("in_person", input.address);
      await client.query(
        `INSERT INTO crm_appointments (workspace_id, activity_id, starts_at, ends_at, timezone, location, attendee_party_ids, attendee_membership_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (workspace_id, activity_id) DO UPDATE SET starts_at = excluded.starts_at, ends_at = excluded.ends_at, timezone = excluded.timezone,
           location = excluded.location, attendee_membership_ids = excluded.attendee_membership_ids, version = crm_appointments.version + 1`,
        [workspaceId, stage.activityId, input.startsAt, input.endsAt, input.timezone, location, JSON.stringify([facts.partyId]), JSON.stringify(attendees)]);
      await client.query(`UPDATE crm_activities SET type = 'meeting', due_at = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, stage.activityId, input.startsAt]);
      await client.query(`INSERT INTO design_journey_events (workspace_id, case_id, stage, action, actor_user_id) VALUES ($1, $2, 'site_visit', 'scheduled', $3)`, [workspaceId, caseId, userId]);
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.site_visit_scheduled.v1", entityType: "pre_project_case", entityId: caseId, after: { startsAt: input.startsAt, endsAt: input.endsAt, timezone: input.timezone, attendees } });

      const locale = (await client.query<{ locale: string }>(`SELECT default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.locale ?? "en";
      const bookedBy = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? "";
      const variables = { clientName: facts.clientName, when: meetingWhen(input.startsAt, input.endsAt, input.timezone, locale), place: location.address ?? "Site", bookedBy };
      const recipients = (await client.query<{ userId: string }>(`SELECT DISTINCT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`, [workspaceId, attendees])).rows;
      const at = Date.parse(input.startsAt);
      for (const recipient of recipients) {
        if (recipient.userId === userId) continue;
        const key = `design:${caseId}:site_visit:${at}:${recipient.userId}`;
        const deepLink = `/workspace/pre-projects/cases/${caseId}/overview`;
        await notifyUserInApp(client, { workspaceId, recipientUserId: recipient.userId, code: "design.site_visit_booked", eventType: "design.site_visit.booked", variables, deepLink, idempotencyKey: key });
        await queueUserEmail(client, { workspaceId, recipientUserId: recipient.userId, code: "design.site_visit_booked", eventType: "design.site_visit.booked", variables, deepLink, idempotencyKey: `${key}:email` });
      }
      return this.view(client, workspaceId, caseId);
    });
  }

  /** PLM-048: done only with every wall measured and photographed; the project's site-visit gate follows. */
  completeSiteVisit(actor: RequestActor, workspaceId: string, caseId: string, input: { summary: string; version: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      await this.activeStage(client, workspaceId, caseId, "site_visit", input.version);
      if (!input.summary?.trim()) throw new UnprocessableEntityException("Summarise what was found on site");
      const measurements = await this.measurements(client, workspaceId, caseId);
      const problem = siteEvidenceProblem(measurements);
      if (problem) throw new UnprocessableEntityException(problem);
      const files = measurements.reduce((sum, item) => sum + item.files, 0);
      await completeStage(client, workspaceId, caseId, "site_visit", userId, input.summary.trim());
      await recordProjectSiteVisit(client, workspaceId, caseId, input.summary.trim(), `${measurements.length} measurement sets, ${files} files`, userId);
      return this.view(client, workspaceId, caseId);
    });
  }

  private async view(client: PoolClient, workspaceId: string, caseId: string) {
    const journey = (await client.query(
      `SELECT package_name AS "packageName", included_revisions AS "includedRevisions", includes_space_planning AS "includesSpacePlanning", includes_renders AS "includesRenders",
              reviewer_role_code AS "reviewerRoleCode", inspiration_days AS "inspirationDays", site_visit_hours AS "siteVisitHours", started_at AS "startedAt"
         FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0] ?? null;
    const stages = journey ? (await client.query<{ stage: JourneyStage } & Record<string, unknown>>(
      `SELECT stage.stage, stage.position, stage.status, stage.owner_membership_id AS "ownerId", account.display_name AS "ownerName", stage.started_at AS "startedAt",
              stage.due_at AS "dueAt", stage.completed_at AS "completedAt", stage.note, stage.version, stage.activity_id AS "activityId",
              appointment.starts_at AS "scheduledAt", appointment.ends_at AS "scheduledEnd", appointment.timezone AS "scheduledTimezone", appointment.location AS "scheduledLocation"
         FROM design_journey_stages stage
         LEFT JOIN workspace_memberships member ON member.id = stage.owner_membership_id LEFT JOIN users account ON account.id = member.user_id
         LEFT JOIN crm_appointments appointment ON appointment.workspace_id = stage.workspace_id AND appointment.activity_id = stage.activity_id
        WHERE stage.workspace_id = $1 AND stage.case_id = $2 ORDER BY stage.position`, [workspaceId, caseId])).rows
      .map((row) => ({ ...row, label: STAGE_LABELS[row.stage], overdue: row.status === "active" && row.dueAt instanceof Date && row.dueAt.getTime() < Date.now() })) : [];
    const measurements = journey ? await this.measurements(client, workspaceId, caseId) : [];
    const timezone = (await client.query<{ timezone: string }>(`SELECT default_timezone AS timezone FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.timezone ?? "UTC";
    return { journey, stages, measurements, siteEvidenceProblem: journey ? siteEvidenceProblem(measurements) : null, timezone };
  }

  private async measurements(client: PoolClient, workspaceId: string, caseId: string) {
    return (await client.query<{ title: string; status: string; files: number }>(
      `SELECT COALESCE(NULLIF(record.title, ''), room.name, 'Measurement') AS title, record.status,
              COALESCE(jsonb_array_length(record.content->'assetIds'), 0)::int AS files
         FROM pre_project_site_records record LEFT JOIN pre_project_rooms room ON room.workspace_id = record.workspace_id AND room.case_id = record.case_id AND room.id = record.room_id
        WHERE record.workspace_id = $1 AND record.case_id = $2 AND record.kind = 'measurement' ORDER BY title`, [workspaceId, caseId])).rows;
  }

  private async activeStage(client: PoolClient, workspaceId: string, caseId: string, stage: JourneyStage, version: number) {
    const row = (await client.query<{ status: string; version: number }>(
      `SELECT status, version FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = $3 FOR UPDATE`, [workspaceId, caseId, stage])).rows[0];
    if (!row) throw new NotFoundException("This design stage is not part of the package");
    if (row.version !== version) throw new ConflictException("The design stage changed in another window. Reload and try again.");
    if (row.status !== "active") throw new ConflictException(`${STAGE_LABELS[stage]} is not the current stage`);
    return stage;
  }

  private async lockCase(client: PoolClient, workspaceId: string, caseId: string) {
    const found = await client.query(`SELECT status FROM pre_project_cases WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, caseId]);
    if (!found.rowCount) throw new NotFoundException("Case not found");
    if (found.rows[0].status !== "active") throw new ConflictException("Reactivate the case first");
  }

  private edit<T>(actor: RequestActor, workspaceId: string, caseId: string, work: (client: PoolClient, userId: string) => Promise<T>) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.edit"], async (client, user) => {
      await this.lockCase(client, workspaceId, caseId);
      return work(client, user.userId);
    });
  }
}
