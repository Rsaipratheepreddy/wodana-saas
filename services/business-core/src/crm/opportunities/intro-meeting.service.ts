import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { recordAudit } from "../../audit/record-audit";
import { notifyUserInApp, queueUserEmail } from "../../notifications/default-templates";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { assignDesignerToCase } from "./dedicated-designer";
import { OpportunityDiscoveryService } from "./discovery.service";
import { checkIntroSlot, introBlockers, meetingLocation, meetingWhen, type MeetingMode } from "./intro-meeting.domain";

export type BookIntroInput = {
  designerMembershipId: string; startsAt: string; endsAt: string; timezone: string; mode: MeetingMode;
  place?: string | null; note?: string | null; changeReason?: string | null;
};
export type ChangeDesignerInput = { membershipId: string; reason: string; version: number };
type Opportunity = { id: string; status: string; title: string; partyId: string; leadId: string | null; ownerMembershipId: string | null; clientName: string | null };
type Designer = { membershipId: string; name: string; introActivityId: string | null; version: number };

/**
 * PLM-043: the Account Manager books the intro meeting straight into a designer's calendar once the
 * floor plan, area and client email are in; the designer and the Account Manager are invited.
 * PLM-088: that designer becomes the opportunity's dedicated designer; changing them later needs a
 * reason and a CRM owner or admin.
 */
@Injectable()
export class IntroMeetingService {
  constructor(private readonly access: WorkspaceAccessService, private readonly events: CrmEventsService, private readonly discovery: OpportunityDiscoveryService) {}

  get(actor: RequestActor, workspaceId: string, opportunityId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.view", async (client, user) => {
      await this.opportunity(client, workspaceId, opportunityId, false);
      return this.view(client, workspaceId, opportunityId, await this.access.hasPermission(client, workspaceId, user.userId, "crm.settings.manage"));
    });
  }

  book(actor: RequestActor, workspaceId: string, opportunityId: string, input: BookIntroInput) {
    return this.access.withPermissions(actor, workspaceId, ["crm.opportunities.manage", "crm.activities.manage"], async (client, user) => {
      const opportunity = await this.opportunity(client, workspaceId, opportunityId, true);
      if (opportunity.status !== "open") throw new ConflictException("Reopen the opportunity before booking a meeting");
      const blockers = introBlockers(await this.discovery.missing(client, workspaceId, opportunityId));
      if (blockers.length) throw new UnprocessableEntityException(`Add these on Discovery first: ${blockers.map((item) => item.label).join(", ")}`);
      const slotError = checkIntroSlot(input);
      if (slotError) throw new UnprocessableEntityException(slotError);

      const current = await this.designer(client, workspaceId, opportunityId, true);
      if (current?.introActivityId) {
        const pending = await client.query(`SELECT 1 FROM crm_activities WHERE workspace_id = $1 AND id = $2 AND status = 'pending'`, [workspaceId, current.introActivityId]);
        if (pending.rowCount) throw new ConflictException("The intro meeting is already booked. Reschedule it from the activity.");
      }
      const designer = await this.member(client, workspaceId, input.designerMembershipId);
      const changing = Boolean(current && current.membershipId !== designer.membershipId);
      if (changing) await this.assertCanChange(client, workspaceId, user.userId, input.changeReason);
      await this.assertPackageRole(client, workspaceId, opportunityId, designer.membershipId);
      await this.assertFree(client, workspaceId, designer.membershipId, input.startsAt, input.endsAt);

      const workspace = (await client.query<{ name: string; locale: string }>(`SELECT name, default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
      const title = `Intro to ${workspace?.name ?? "the studio"}`;
      const activity = (await client.query<{ id: string }>(
        `INSERT INTO crm_activities (workspace_id, party_id, lead_id, opportunity_id, type, interaction_direction, title, description, owner_membership_id, priority, due_at, is_next_action, customer_visible, created_by)
         VALUES ($1, $2, $3, $4, 'meeting'::crm_activity_type, 'outbound', $5, $6, $7, 'normal', $8, false, true, $9) RETURNING id`,
        [workspaceId, opportunity.partyId, opportunity.leadId, opportunityId, title, input.note?.trim() || null, designer.membershipId, input.startsAt, user.userId])).rows[0];
      const attendees = [...new Set([designer.membershipId, opportunity.ownerMembershipId].filter(Boolean))];
      const location = meetingLocation(input.mode, input.place);
      const appointment = (await client.query(
        `INSERT INTO crm_appointments (workspace_id, activity_id, starts_at, ends_at, timezone, location, attendee_party_ids, attendee_membership_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, starts_at AS "startsAt", ends_at AS "endsAt", timezone, location, version`,
        [workspaceId, activity.id, input.startsAt, input.endsAt, input.timezone, location, JSON.stringify([opportunity.partyId]), JSON.stringify(attendees)])).rows[0];

      await this.setDesigner(client, workspaceId, opportunityId, current, designer.membershipId, activity.id, user.userId, changing ? input.changeReason ?? null : null);
      await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: "crm.appointment.changed.v1", entityType: "crm_activity", entityId: activity.id, after: { ...appointment, purpose: "intro", opportunityId } });
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "crm.opportunity.intro_booked.v1", entityType: "crm_opportunity", entityId: opportunityId,
        before: current ? { designerMembershipId: current.membershipId } : null, after: { activityId: activity.id, designerMembershipId: designer.membershipId, startsAt: input.startsAt, endsAt: input.endsAt, timezone: input.timezone, mode: input.mode } });

      const bookedBy = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [user.userId])).rows[0]?.name ?? "";
      const variables = {
        meeting: title, clientName: opportunity.clientName ?? opportunity.title, bookedBy,
        when: meetingWhen(input.startsAt, input.endsAt, input.timezone, workspace?.locale ?? "en"),
        place: (location.mode === "online" ? location.url : location.address) ?? (input.mode === "online" ? "Online" : "In person"),
      };
      const recipients = await client.query<{ userId: string }>(`SELECT DISTINCT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`, [workspaceId, attendees]);
      for (const recipient of recipients.rows) {
        if (recipient.userId === user.userId) continue;
        const key = `crm:intro:${activity.id}:${recipient.userId}`;
        const deepLink = `/workspace/crm/opportunities?record=${opportunityId}`;
        await notifyUserInApp(client, { workspaceId, recipientUserId: recipient.userId, code: "crm.intro_booked", eventType: "crm.meeting.booked", variables, deepLink, idempotencyKey: key });
        await queueUserEmail(client, { workspaceId, recipientUserId: recipient.userId, code: "crm.intro_booked", eventType: "crm.meeting.booked", variables, deepLink, idempotencyKey: `${key}:email` });
      }
      return this.view(client, workspaceId, opportunityId, false);
    });
  }

  changeDesigner(actor: RequestActor, workspaceId: string, opportunityId: string, input: ChangeDesignerInput) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.manage", async (client, user) => {
      const opportunity = await this.opportunity(client, workspaceId, opportunityId, true);
      const current = await this.designer(client, workspaceId, opportunityId, true);
      if ((current?.version ?? 0) !== input.version) throw new ConflictException("The designer changed in another window. Reload and try again.");
      const designer = await this.member(client, workspaceId, input.membershipId);
      if (current?.membershipId === designer.membershipId) return this.view(client, workspaceId, opportunityId, true);
      if (current) await this.assertCanChange(client, workspaceId, user.userId, input.reason);
      await this.assertPackageRole(client, workspaceId, opportunityId, designer.membershipId);
      await this.setDesigner(client, workspaceId, opportunityId, current, designer.membershipId, current?.introActivityId ?? null, user.userId, input.reason?.trim() || null);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "crm.opportunity.designer_changed.v1", entityType: "crm_opportunity", entityId: opportunityId,
        before: current ? { designerMembershipId: current.membershipId } : null, after: { designerMembershipId: designer.membershipId, reason: input.reason } });
      const recipient = (await client.query<{ userId: string }>(`SELECT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = $2`, [workspaceId, designer.membershipId])).rows[0];
      const changedBy = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [user.userId])).rows[0]?.name ?? "";
      if (recipient && recipient.userId !== user.userId) {
        await notifyUserInApp(client, { workspaceId, recipientUserId: recipient.userId, code: "crm.designer_assigned", eventType: "crm.designer.assigned",
          variables: { clientName: opportunity.clientName ?? opportunity.title, changedBy, reason: input.reason?.trim() || "—" },
          deepLink: `/workspace/crm/opportunities?record=${opportunityId}`, idempotencyKey: `crm:designer:${opportunityId}:${(current?.version ?? 0) + 1}` });
      }
      return this.view(client, workspaceId, opportunityId, true);
    });
  }

  private async view(client: PoolClient, workspaceId: string, opportunityId: string, canChangeDesigner: boolean) {
    const designer = await this.designer(client, workspaceId, opportunityId, false);
    const intro = designer?.introActivityId ? (await client.query(
      `SELECT activity.id AS "activityId", activity.status, activity.title, appointment.starts_at AS "startsAt", appointment.ends_at AS "endsAt", appointment.timezone, appointment.location
         FROM crm_activities activity LEFT JOIN crm_appointments appointment ON appointment.workspace_id = activity.workspace_id AND appointment.activity_id = activity.id
        WHERE activity.workspace_id = $1 AND activity.id = $2`, [workspaceId, designer.introActivityId])).rows[0] ?? null : null;
    const history = (await client.query(
      `SELECT history.id, history.reason, history.changed_at AS "changedAt", source.display_name AS "fromName", target.display_name AS "toName", actor.display_name AS "changedByName"
         FROM crm_opportunity_designer_history history
         LEFT JOIN workspace_memberships source_member ON source_member.id = history.from_membership_id LEFT JOIN users source ON source.id = source_member.user_id
         JOIN workspace_memberships target_member ON target_member.id = history.to_membership_id JOIN users target ON target.id = target_member.user_id
         LEFT JOIN users actor ON actor.id = history.changed_by
        WHERE history.workspace_id = $1 AND history.opportunity_id = $2 ORDER BY history.changed_at DESC`, [workspaceId, opportunityId])).rows;
    const blockers = introBlockers(await this.discovery.missing(client, workspaceId, opportunityId));
    const timezone = (await client.query<{ timezone: string }>(`SELECT default_timezone AS timezone FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.timezone ?? "UTC";
    return { designer: designer ? { membershipId: designer.membershipId, name: designer.name, version: designer.version } : null, intro, history, blockers, timezone, canChangeDesigner };
  }

  private async setDesigner(client: PoolClient, workspaceId: string, opportunityId: string, current: Designer | null, membershipId: string, introActivityId: string | null, userId: string, reason: string | null) {
    await client.query(
      `INSERT INTO crm_opportunity_designer (workspace_id, opportunity_id, membership_id, intro_activity_id, assigned_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, opportunity_id) DO UPDATE SET membership_id = excluded.membership_id, intro_activity_id = excluded.intro_activity_id,
         assigned_by = excluded.assigned_by, assigned_at = CASE WHEN crm_opportunity_designer.membership_id = excluded.membership_id THEN crm_opportunity_designer.assigned_at ELSE now() END,
         version = crm_opportunity_designer.version + 1`,
      [workspaceId, opportunityId, membershipId, introActivityId, userId]);
    if (current?.membershipId === membershipId) return;
    await client.query(`INSERT INTO crm_opportunity_designer_history (workspace_id, opportunity_id, from_membership_id, to_membership_id, reason, changed_by, changed_at) VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
      [workspaceId, opportunityId, current?.membershipId ?? null, membershipId, reason, userId]);
    if (current) await client.query(`DELETE FROM crm_opportunity_team WHERE workspace_id = $1 AND opportunity_id = $2 AND membership_id = $3 AND role = 'designer'`, [workspaceId, opportunityId, current.membershipId]);
    await client.query(`INSERT INTO crm_opportunity_team (workspace_id, opportunity_id, membership_id, role) VALUES ($1, $2, $3, 'designer') ON CONFLICT DO NOTHING`, [workspaceId, opportunityId, membershipId]);
    const openCase = (await client.query<{ id: string }>(`SELECT id FROM pre_project_cases WHERE workspace_id = $1 AND opportunity_id = $2`, [workspaceId, opportunityId])).rows[0];
    if (openCase) await assignDesignerToCase(client, workspaceId, openCase.id);
  }

  private async assertCanChange(client: PoolClient, workspaceId: string, userId: string, reason: string | null | undefined) {
    if (!reason?.trim()) throw new UnprocessableEntityException("Give a reason for changing the designer");
    if (!(await this.access.hasPermission(client, workspaceId, userId, "crm.settings.manage")))
      throw new ForbiddenException("Only a CRM owner or admin can change the dedicated designer");
  }

  /** A package can require a role (for example a creative director); the designer must hold it. */
  private async assertPackageRole(client: PoolClient, workspaceId: string, opportunityId: string, membershipId: string) {
    const required = (await client.query<{ code: string | null; name: string }>(
      `SELECT package.required_role_code AS code, package.name FROM crm_opportunity_discovery discovery
         JOIN design_packages package ON package.workspace_id = discovery.workspace_id AND package.id = discovery.design_package_id
        WHERE discovery.workspace_id = $1 AND discovery.opportunity_id = $2`, [workspaceId, opportunityId])).rows[0];
    if (!required?.code) return;
    const holds = await client.query(
      `SELECT 1 FROM effective_member_roles assigned JOIN roles role ON role.id = assigned.role_id
        WHERE assigned.workspace_id = $1 AND assigned.membership_id = $2 AND role.code = $3`, [workspaceId, membershipId, required.code]);
    if (!holds.rowCount) throw new UnprocessableEntityException(`${required.name} needs a designer with the ${required.code.replace(/_/g, " ")} role`);
  }

  private async assertFree(client: PoolClient, workspaceId: string, membershipId: string, startsAt: string, endsAt: string) {
    const clash = await client.query<{ title: string }>(
      `SELECT activity.title FROM crm_appointments appointment
         JOIN crm_activities activity ON activity.workspace_id = appointment.workspace_id AND activity.id = appointment.activity_id
        WHERE appointment.workspace_id = $1 AND activity.status = 'pending'
          AND (activity.owner_membership_id = $2 OR appointment.attendee_membership_ids ? $2::text)
          AND tstzrange(appointment.starts_at, appointment.ends_at) && tstzrange($3::timestamptz, $4::timestamptz) LIMIT 1`,
      [workspaceId, membershipId, startsAt, endsAt]);
    if (clash.rowCount) throw new ConflictException(`The designer is busy then (${clash.rows[0].title}). Choose another time.`);
  }

  private async member(client: PoolClient, workspaceId: string, membershipId: string) {
    const row = (await client.query<{ membershipId: string; name: string }>(
      `SELECT membership.id AS "membershipId", account.display_name AS name FROM workspace_memberships membership JOIN users account ON account.id = membership.user_id
        WHERE membership.workspace_id = $1 AND membership.id = $2 AND membership.status = 'active'`, [workspaceId, membershipId])).rows[0];
    if (!row) throw new UnprocessableEntityException("Choose an active team member as the designer");
    return row;
  }

  private async designer(client: PoolClient, workspaceId: string, opportunityId: string, lock: boolean): Promise<Designer | null> {
    return (await client.query<Designer>(
      `SELECT designer.membership_id AS "membershipId", account.display_name AS name, designer.intro_activity_id AS "introActivityId", designer.version
         FROM crm_opportunity_designer designer JOIN workspace_memberships membership ON membership.id = designer.membership_id JOIN users account ON account.id = membership.user_id
        WHERE designer.workspace_id = $1 AND designer.opportunity_id = $2${lock ? " FOR UPDATE OF designer" : ""}`, [workspaceId, opportunityId])).rows[0] ?? null;
  }

  private async opportunity(client: PoolClient, workspaceId: string, opportunityId: string, lock: boolean): Promise<Opportunity> {
    const row = (await client.query<Opportunity>(
      `SELECT opportunity.id, opportunity.status::text AS status, opportunity.title, opportunity.party_id AS "partyId", opportunity.lead_id AS "leadId",
              opportunity.owner_membership_id AS "ownerMembershipId", party.display_name AS "clientName"
         FROM crm_opportunities opportunity LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
        WHERE opportunity.workspace_id = $1 AND opportunity.id = $2${lock ? " FOR UPDATE OF opportunity" : ""}`, [workspaceId, opportunityId])).rows[0];
    if (!row) throw new NotFoundException("Opportunity not found");
    return row;
  }
}
