import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { decodeCursor, encodeCursor } from "../shared/crm-types";
import { CompleteActivityDto, CreateActivityDto, CreateAppointmentDto, ListActivitiesQueryDto, UpdateActivityDto, UpdateAppointmentDto } from "./dto/activities.dto";
import { CrmSlaLifecycleService } from "../leads/crm-sla-lifecycle.service";

@Injectable()
export class CrmActivitiesService {
  constructor(private readonly access: WorkspaceAccessService, private readonly events: CrmEventsService, private readonly slas: CrmSlaLifecycleService = new CrmSlaLifecycleService()) {}

  get(actor: RequestActor, workspaceId: string, activityId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.activities.view", async (client) => {
      const activity = await this.requireActivity(client, workspaceId, activityId, false);
      const context = await client.query(`SELECT party.display_name AS "partyName", enquiry.title AS "leadTitle", account.display_name AS "ownerName"
        FROM crm_activities activity
        LEFT JOIN crm_leads lead ON lead.id = activity.lead_id AND lead.workspace_id = activity.workspace_id
        LEFT JOIN crm_opportunities opportunity ON opportunity.id = activity.opportunity_id AND opportunity.workspace_id = activity.workspace_id
        LEFT JOIN crm_parties party ON party.id = COALESCE(activity.party_id, lead.party_id, opportunity.party_id) AND party.workspace_id = activity.workspace_id
        LEFT JOIN crm_enquiries enquiry ON enquiry.id = lead.enquiry_id AND enquiry.workspace_id = activity.workspace_id
        LEFT JOIN workspace_memberships member ON member.id = activity.owner_membership_id AND member.workspace_id = activity.workspace_id
        LEFT JOIN users account ON account.id = member.user_id
        WHERE activity.workspace_id = $1 AND activity.id = $2`, [workspaceId, activityId]);
      const appointment = await client.query(`SELECT id, starts_at AS "startsAt", ends_at AS "endsAt", timezone, location, version FROM crm_appointments WHERE workspace_id = $1 AND activity_id = $2`, [workspaceId, activityId]);
      return { ...this.mapActivity(activity), ...context.rows[0], appointment: appointment.rows[0] ?? null };
    });
  }

  list(actor: RequestActor, workspaceId: string, query: ListActivitiesQueryDto) {
    return this.access.withPermission(actor, workspaceId, "crm.activities.view", async (client) => {
      const cursor = decodeCursor(query.cursor);
      if (query.cursor && !cursor) throw new BadRequestException("Invalid page cursor");
      const values: unknown[] = [workspaceId];
      const clauses = ["activity.workspace_id = $1"];
      if (query.from && query.to && Date.parse(query.from) >= Date.parse(query.to)) throw new BadRequestException("Calendar end must be after start");
      if (query.from) { values.push(query.from); clauses.push(`COALESCE(appointment.ends_at, activity.due_at) >= $${values.length}::timestamptz`); }
      if (query.to) { values.push(query.to); clauses.push(`COALESCE(appointment.starts_at, activity.due_at) < $${values.length}::timestamptz`); }
      for (const [column, value] of [
        ["party_id", query.partyId], ["lead_id", query.leadId],
        ["opportunity_id", query.opportunityId], ["owner_membership_id", query.ownerMembershipId],
      ] as const) {
        if (value) { values.push(value); clauses.push(`activity.${column} = $${values.length}`); }
      }
      if (query.status) { values.push(query.status); clauses.push(`activity.status = $${values.length}::crm_activity_status`); }
      if (cursor) {
        values.push(cursor.value, cursor.id);
        clauses.push(`(activity.created_at, activity.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
      }
      values.push(query.limit + 1);
      const result = await client.query(
        `SELECT activity.id, activity.party_id AS "partyId", activity.lead_id AS "leadId",
                activity.opportunity_id AS "opportunityId", activity.type, activity.status,
                activity.title, activity.description, activity.interaction_direction AS "interactionDirection",
                party.display_name AS "partyName", enquiry.title AS "leadTitle",
                activity.owner_membership_id AS "ownerMembershipId", account.display_name AS "ownerName",
                activity.priority, activity.due_at AS "dueAt", activity.completed_at AS "completedAt",
                activity.completion_outcome AS "completionOutcome",
                activity.is_next_action AS "isNextAction", activity.customer_visible AS "customerVisible",
                activity.version, activity.created_at AS "createdAt", activity.updated_at AS "updatedAt",
                CASE WHEN appointment.id IS NULL THEN NULL ELSE jsonb_build_object(
                  'id', appointment.id, 'startsAt', appointment.starts_at, 'endsAt', appointment.ends_at,
                  'timezone', appointment.timezone, 'location', appointment.location,
                  'attendanceStatus', appointment.attendance_status, 'version', appointment.version
                ) END AS appointment
         FROM crm_activities activity
         LEFT JOIN crm_leads lead ON lead.id = activity.lead_id
          AND lead.workspace_id = activity.workspace_id
         LEFT JOIN crm_opportunities opportunity ON opportunity.id = activity.opportunity_id
          AND opportunity.workspace_id = activity.workspace_id
         LEFT JOIN crm_parties party ON party.id = COALESCE(activity.party_id, lead.party_id, opportunity.party_id)
          AND party.workspace_id = activity.workspace_id
         LEFT JOIN crm_enquiries enquiry ON enquiry.id = lead.enquiry_id
          AND enquiry.workspace_id = activity.workspace_id
         LEFT JOIN workspace_memberships membership ON membership.id = activity.owner_membership_id
         LEFT JOIN users account ON account.id = membership.user_id
         LEFT JOIN crm_appointments appointment ON appointment.activity_id = activity.id
          AND appointment.workspace_id = activity.workspace_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY activity.created_at DESC, activity.id DESC LIMIT $${values.length}`,
        values,
      );
      const hasMore = result.rows.length > query.limit;
      const data = hasMore ? result.rows.slice(0, query.limit) : result.rows;
      const last = data.at(-1) as { id: string; createdAt: Date } | undefined;
      return { data, nextCursor: hasMore && last ? encodeCursor({ value: new Date(last.createdAt).toISOString(), id: last.id }) : null };
    });
  }

  create(actor: RequestActor, workspaceId: string, input: CreateActivityDto) {
    return this.access.withPermission(actor, workspaceId, "crm.activities.manage", async (client, actorUser) => {
      if (!input.partyId && !input.leadId && !input.opportunityId) throw new UnprocessableEntityException("Activity requires a party, lead, or opportunity");
      this.validateInteractionDirection(input.type, input.interactionDirection);
      await this.assertTargets(client, workspaceId, input);
      if (input.appointment && input.type !== "meeting") throw new UnprocessableEntityException("Appointments require a meeting activity");
      const dueAt = this.date(input.appointment?.startsAt ?? input.dueAt, "dueAt");
      this.validateNextAction(input.type, Boolean(input.isNextAction), dueAt);
      if (input.isNextAction) await this.clearNextAction(client, workspaceId, input.leadId, input.opportunityId);
      const result = await client.query(
        `INSERT INTO crm_activities
          (workspace_id, party_id, lead_id, opportunity_id, type, interaction_direction, title, description,
           owner_membership_id, priority, due_at, is_next_action, customer_visible, created_by)
         VALUES ($1, $2, $3, $4, $5::crm_activity_type, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id, party_id AS "partyId", lead_id AS "leadId", opportunity_id AS "opportunityId",
                   type, interaction_direction AS "interactionDirection", status, title, description, owner_membership_id AS "ownerMembershipId",
                   priority, due_at AS "dueAt", is_next_action AS "isNextAction",
                   customer_visible AS "customerVisible", version,
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [
          workspaceId, input.partyId ?? null, input.leadId ?? null, input.opportunityId ?? null,
          input.type, input.interactionDirection ?? null, input.title, input.description ?? null, input.ownerMembershipId ?? null,
          input.priority ?? "normal", dueAt, input.isNextAction ?? false,
          input.customerVisible ?? false, actorUser.userId,
        ],
      );
      const response = result.rows[0] as Record<string, unknown>;
      if (input.appointment) response.appointment = await this.saveAppointment(client, workspaceId, String(response.id), input.appointment);
      if (input.isNextAction) await this.syncParentNextAction(client, workspaceId, response);
      await this.touchLead(client, workspaceId, String(response.id));
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.activity.created.v1", entityType: "crm_activity", entityId: String(response.id), after: response });
      return response;
    });
  }

  update(actor: RequestActor, workspaceId: string, activityId: string, input: UpdateActivityDto) {
    return this.access.withPermission(actor, workspaceId, "crm.activities.manage", async (client, actorUser) => {
      const before = await this.lockActivity(client, workspaceId, activityId);
      if (Number(before.version) !== input.version) throw new ConflictException("Activity changed; reload and try again");
      if (before.status !== "pending") throw new ConflictException("Only pending activities can be edited");
      this.validateInteractionDirection(
        String(before.type),
        input.interactionDirection !== undefined
          ? input.interactionDirection
          : before.interaction_direction as string | null | undefined,
      );
      if (input.ownerMembershipId) await this.requireMembership(client, workspaceId, input.ownerMembershipId);
      const dueAt = input.dueAt !== undefined ? this.date(input.dueAt ?? undefined, "dueAt") : before.due_at;
      this.validateNextAction(String(before.type), input.isNextAction ?? Boolean(before.is_next_action), dueAt);
      if (input.dueAt !== undefined) {
        const scheduled = await client.query(`SELECT id FROM crm_appointments WHERE workspace_id = $1 AND activity_id = $2 FOR UPDATE`, [workspaceId, activityId]);
        if (scheduled.rowCount && !dueAt) throw new UnprocessableEntityException("A scheduled meeting requires a start time");
        if (scheduled.rowCount) await client.query(`UPDATE crm_appointments SET ends_at = ends_at + ($1::timestamptz - starts_at), starts_at = $1::timestamptz, version = version + 1 WHERE workspace_id = $2 AND activity_id = $3 AND starts_at <> $1::timestamptz`, [dueAt, workspaceId, activityId]);
      }
      if (input.isNextAction ?? before.is_next_action) await this.assertOpenTargets(client, workspaceId, before.lead_id, before.opportunity_id);
      if (input.isNextAction) {
        await this.clearNextAction(
          client,
          workspaceId,
          typeof before.lead_id === "string" ? before.lead_id : null,
          typeof before.opportunity_id === "string" ? before.opportunity_id : null,
          activityId,
        );
      }
      const result = await client.query(
        `UPDATE crm_activities SET title = COALESCE($1, title),
           description = CASE WHEN $2::boolean THEN $3 ELSE description END,
           interaction_direction = CASE WHEN $4::boolean THEN $5 ELSE interaction_direction END,
           owner_membership_id = CASE WHEN $6::boolean THEN $7::uuid ELSE owner_membership_id END,
           priority = COALESCE($8, priority), due_at = $9,
           is_next_action = COALESCE($10, is_next_action), version = version + 1
         WHERE id = $11 AND workspace_id = $12 AND version = $13
         RETURNING *`,
        [
          input.title ?? null, input.description !== undefined, input.description ?? null,
          input.interactionDirection !== undefined, input.interactionDirection ?? null,
          input.ownerMembershipId !== undefined, input.ownerMembershipId ?? null,
          input.priority ?? null, dueAt, input.isNextAction ?? null,
          activityId, workspaceId, input.version,
        ],
      );
      if (!result.rowCount) throw new ConflictException("Activity changed; reload and try again");
      const response = this.mapActivity(result.rows[0] as Record<string, unknown>);
      if (before.is_next_action || response.isNextAction) await this.syncParentNextAction(client, workspaceId, response);
      await this.touchLead(client, workspaceId, activityId);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.activity.updated.v1", entityType: "crm_activity", entityId: activityId, before: this.mapActivity(before), after: response });
      return response;
    });
  }

  complete(actor: RequestActor, workspaceId: string, activityId: string, input: CompleteActivityDto) {
    return this.access.withPermission(actor, workspaceId, "crm.activities.manage", async (client, actorUser) => {
      const before = await this.lockActivity(client, workspaceId, activityId);
      if (Number(before.version) !== input.version) throw new ConflictException("Activity changed; reload and try again");
      if (before.status !== "pending") throw new ConflictException("Only pending activities can be completed");
      const result = await client.query(
        `UPDATE crm_activities SET status = 'completed', completed_at = now(),
           completion_outcome = $1, is_next_action = false, version = version + 1
         WHERE id = $2 AND workspace_id = $3 AND version = $4 RETURNING *`,
        [input.outcome ?? null, activityId, workspaceId, input.version],
      );
      const response = this.mapActivity(result.rows[0] as Record<string, unknown>);
      const isGeneratedResponseTask = Boolean(before.sla_instance_id);
      const isOutboundHumanInteraction = ["call", "email", "whatsapp", "sms", "portal"].includes(String(before.type))
        && before.interaction_direction === "outbound";
      if (before.lead_id && (isGeneratedResponseTask || isOutboundHumanInteraction)) {
        await this.slas.recordFirstResponse(client, workspaceId, String(before.lead_id), {
          sourceType: "activity",
          sourceId: activityId,
          actorUserId: actorUser.userId,
          respondedAt: new Date(String(result.rows[0].completed_at)),
          details: {
            activityType: before.type,
            interactionDirection: before.interaction_direction ?? null,
            outcome: input.outcome ?? null,
            attestation: isGeneratedResponseTask ? "completed_response_task" : "completed_outbound_interaction",
          },
        });
      }
      if (before.is_next_action) await this.syncParentNextAction(client, workspaceId, response);
      await this.touchLead(client, workspaceId, activityId);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.activity.completed.v1", entityType: "crm_activity", entityId: activityId, before: this.mapActivity(before), after: response });
      return response;
    });
  }

  createAppointment(actor: RequestActor, workspaceId: string, activityId: string, input: CreateAppointmentDto) {
    return this.access.withPermission(actor, workspaceId, "crm.activities.manage", async (client, actorUser) => {
      const activity = await this.lockActivity(client, workspaceId, activityId);
      if (activity.type !== "meeting") throw new UnprocessableEntityException("Appointments require a meeting activity");
      if (activity.status !== "pending") throw new ConflictException("Only pending meetings can be scheduled");
      const exists = await client.query(`SELECT id FROM crm_appointments WHERE workspace_id = $1 AND activity_id = $2`, [workspaceId, activityId]);
      if (exists.rowCount) throw new ConflictException("This meeting is already scheduled. Edit its appointment instead.");
      const appointment = await this.saveAppointment(client, workspaceId, activityId, input);
      const updated = await client.query(`UPDATE crm_activities SET due_at = $1, version = version + 1 WHERE workspace_id = $2 AND id = $3 RETURNING *`, [input.startsAt, workspaceId, activityId]);
      if (activity.is_next_action) await this.syncParentNextAction(client, workspaceId, this.mapActivity(updated.rows[0]));
      await this.touchLead(client, workspaceId, activityId);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.appointment.changed.v1", entityType: "crm_activity", entityId: activityId, after: appointment });
      return appointment;
    });
  }

  updateAppointment(actor: RequestActor, workspaceId: string, activityId: string, input: UpdateAppointmentDto) {
    return this.access.withPermission(actor, workspaceId, "crm.activities.manage", async (client, actorUser) => {
      const activity = await this.lockActivity(client, workspaceId, activityId);
      if (activity.status !== "pending") throw new ConflictException("Only pending meetings can be rescheduled");
      const appointment = await this.saveAppointment(client, workspaceId, activityId, input, input.version);
      const updated = await client.query(`UPDATE crm_activities SET due_at = $1, version = version + 1 WHERE workspace_id = $2 AND id = $3 RETURNING *`, [input.startsAt, workspaceId, activityId]);
      if (activity.is_next_action) await this.syncParentNextAction(client, workspaceId, this.mapActivity(updated.rows[0]));
      await this.touchLead(client, workspaceId, activityId);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.appointment.changed.v1", entityType: "crm_activity", entityId: activityId, after: appointment });
      return appointment;
    });
  }

  private async touchLead(client: PoolClient, workspaceId: string, activityId: string) {
    await client.query(`UPDATE crm_leads lead SET version=lead.version+1, updated_at=now()
      FROM crm_activities activity WHERE activity.workspace_id=$1 AND activity.id=$2
        AND lead.workspace_id=activity.workspace_id AND lead.id=activity.lead_id`, [workspaceId, activityId]);
  }

  private async saveAppointment(client: PoolClient, workspaceId: string, activityId: string, input: CreateAppointmentDto, version?: number) {
      const startsAt = this.date(input.startsAt, "startsAt");
      const endsAt = this.date(input.endsAt, "endsAt");
      if (!startsAt || !endsAt || endsAt <= startsAt) throw new UnprocessableEntityException("Appointment end must be after start");
      try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }); } catch { throw new UnprocessableEntityException("Choose a valid IANA timezone"); }
      for (const partyId of input.attendeePartyIds ?? []) await this.requireParty(client, workspaceId, partyId);
      for (const membershipId of input.attendeeMembershipIds ?? []) await this.requireMembership(client, workspaceId, membershipId);
      if (version !== undefined) {
        const updated = await client.query(`UPDATE crm_appointments SET starts_at = $1, ends_at = $2, timezone = $3, location = $4, version = version + 1 WHERE workspace_id = $5 AND activity_id = $6 AND version = $7 RETURNING id, starts_at AS "startsAt", ends_at AS "endsAt", timezone, location, version`, [startsAt, endsAt, input.timezone, input.location ?? {}, workspaceId, activityId, version]);
        if (!updated.rowCount) throw new ConflictException("Appointment changed; reload before rescheduling");
        return updated.rows[0] as Record<string, unknown>;
      }
      const result = await client.query(
        `INSERT INTO crm_appointments
          (workspace_id, activity_id, starts_at, ends_at, timezone, location,
           attendee_party_ids, attendee_membership_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, activity_id AS "activityId", starts_at AS "startsAt", ends_at AS "endsAt",
                   timezone, location, attendee_party_ids AS "attendeePartyIds",
                   attendee_membership_ids AS "attendeeMembershipIds", attendance_status AS "attendanceStatus", version`,
        [
          workspaceId,
          activityId,
          startsAt,
          endsAt,
          input.timezone,
          input.location ?? {},
          JSON.stringify(input.attendeePartyIds ?? []),
          JSON.stringify(input.attendeeMembershipIds ?? []),
        ],
      );
      return result.rows[0] as Record<string, unknown>;
  }

  private async assertTargets(client: PoolClient, workspaceId: string, input: CreateActivityDto) {
    if (input.partyId) await this.requireParty(client, workspaceId, input.partyId);
    let partyId = input.partyId;
    if (input.leadId) {
      const lead = await client.query(`SELECT party_id FROM crm_leads WHERE id = $1 AND workspace_id = $2 FOR UPDATE`, [input.leadId, workspaceId]);
      if (!lead.rowCount) throw new UnprocessableEntityException("Lead does not exist");
      if (partyId && partyId !== lead.rows[0].party_id) throw new UnprocessableEntityException("Activity customer must match the lead");
      partyId = lead.rows[0].party_id;
    }
    if (input.opportunityId) {
      const opportunity = await client.query(`SELECT party_id, lead_id FROM crm_opportunities WHERE id = $1 AND workspace_id = $2 FOR UPDATE`, [input.opportunityId, workspaceId]);
      if (!opportunity.rowCount) throw new UnprocessableEntityException("Opportunity does not exist");
      if (partyId && partyId !== opportunity.rows[0].party_id) throw new UnprocessableEntityException("Activity customer must match the opportunity");
      if (input.leadId && input.leadId !== opportunity.rows[0].lead_id) throw new UnprocessableEntityException("Activity lead must belong to the opportunity");
      partyId = opportunity.rows[0].party_id;
    }
    input.partyId = partyId;
    if (input.isNextAction) await this.assertOpenTargets(client, workspaceId, input.leadId, input.opportunityId);
    if (input.ownerMembershipId) await this.requireMembership(client, workspaceId, input.ownerMembershipId);
  }

  private validateNextAction(type: string, isNext: boolean, dueAt: unknown) {
    if (isNext && (!dueAt || type === "note")) throw new UnprocessableEntityException("A next action must be a scheduled activity, not a note");
  }

  private async assertOpenTargets(client: PoolClient, workspaceId: string, leadId: unknown, opportunityId: unknown) {
    if (opportunityId) {
      const result = await client.query(`SELECT status FROM crm_opportunities WHERE workspace_id = $1 AND id = $2`, [workspaceId, opportunityId]);
      if (result.rows[0]?.status !== "open") throw new UnprocessableEntityException("Reopen the opportunity before scheduling its next action");
    } else if (leadId) {
      const result = await client.query(`SELECT status FROM crm_leads WHERE workspace_id = $1 AND id = $2`, [workspaceId, leadId]);
      if (["qualified", "disqualified", "paused"].includes(result.rows[0]?.status)) throw new UnprocessableEntityException("Schedule follow-ups on the converted opportunity, or reopen this lead first");
    }
  }

  private async lockActivity(client: PoolClient, workspaceId: string, activityId: string) {
    const target = await this.requireActivity(client, workspaceId, activityId, false);
    // Lock parents before activities, matching create/conversion and serializing next-action changes.
    if (target.lead_id) await client.query(`SELECT id FROM crm_leads WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, target.lead_id]);
    const current = await this.requireActivity(client, workspaceId, activityId, false);
    if (current.opportunity_id) await client.query(`SELECT id FROM crm_opportunities WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, current.opportunity_id]);
    return this.requireActivity(client, workspaceId, activityId, true);
  }

  private async clearNextAction(client: PoolClient, workspaceId: string, leadId?: string | null, opportunityId?: string | null, exceptId?: string) {
    if (leadId) await client.query(`UPDATE crm_activities SET is_next_action = false, version = version + 1 WHERE workspace_id = $1 AND lead_id = $2 AND is_next_action AND status = 'pending' AND ($3::uuid IS NULL OR id <> $3)`, [workspaceId, leadId, exceptId ?? null]);
    if (opportunityId) await client.query(`UPDATE crm_activities SET is_next_action = false, version = version + 1 WHERE workspace_id = $1 AND opportunity_id = $2 AND is_next_action AND status = 'pending' AND ($3::uuid IS NULL OR id <> $3)`, [workspaceId, opportunityId, exceptId ?? null]);
  }

  private async syncParentNextAction(client: PoolClient, workspaceId: string, activity: Record<string, unknown>) {
    const leadId = String(activity.leadId ?? activity.lead_id ?? "");
    const opportunityId = String(activity.opportunityId ?? activity.opportunity_id ?? "");
    if (leadId && !opportunityId) await client.query(`UPDATE crm_leads SET next_action_at = (SELECT due_at FROM crm_activities WHERE workspace_id = $1 AND lead_id = $2 AND is_next_action AND status = 'pending' ORDER BY due_at NULLS LAST LIMIT 1), version = version + 1 WHERE id = $2 AND workspace_id = $1 AND status NOT IN ('qualified', 'disqualified', 'paused')`, [workspaceId, leadId]);
    if (opportunityId) await client.query(`UPDATE crm_opportunities SET next_action_at = (SELECT due_at FROM crm_activities WHERE workspace_id = $1 AND opportunity_id = $2 AND is_next_action AND status = 'pending' ORDER BY due_at NULLS LAST LIMIT 1), version = version + 1 WHERE id = $2 AND workspace_id = $1 AND status = 'open'`, [workspaceId, opportunityId]);
  }

  private async requireActivity(client: PoolClient, workspaceId: string, activityId: string, lock: boolean) {
    const result = await client.query<Record<string, unknown>>(`SELECT * FROM crm_activities WHERE id = $1 AND workspace_id = $2${lock ? " FOR UPDATE" : ""}`, [activityId, workspaceId]);
    if (!result.rowCount) throw new NotFoundException("Activity not found");
    return result.rows[0];
  }

  private mapActivity(row: Record<string, unknown>) {
    return { id: row.id, partyId: row.party_id, leadId: row.lead_id, opportunityId: row.opportunity_id, type: row.type, interactionDirection: row.interaction_direction, status: row.status, title: row.title, description: row.description, ownerMembershipId: row.owner_membership_id, priority: row.priority, dueAt: row.due_at, completedAt: row.completed_at, completionOutcome: row.completion_outcome, isNextAction: row.is_next_action, customerVisible: row.customer_visible, version: Number(row.version) };
  }

  private validateInteractionDirection(type: string, direction: string | null | undefined) {
    if (direction && !["call", "email", "whatsapp", "sms", "portal"].includes(type)) {
      throw new UnprocessableEntityException("Interaction direction is only valid for calls, email, WhatsApp, SMS, or portal messages");
    }
  }

  private date(value: string | undefined, field: string): Date | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} is invalid`);
    return date;
  }

  private async requireParty(client: PoolClient, workspaceId: string, partyId: string) {
    const result = await client.query(`SELECT 1 FROM crm_parties WHERE id = $1 AND workspace_id = $2 AND status = 'active'`, [partyId, workspaceId]);
    if (!result.rowCount) throw new UnprocessableEntityException("Party does not exist or is inactive");
  }

  private async requireMembership(client: PoolClient, workspaceId: string, membershipId: string) {
    const result = await client.query(`SELECT 1 FROM workspace_memberships WHERE id = $1 AND workspace_id = $2 AND status = 'active'`, [membershipId, workspaceId]);
    if (!result.rowCount) throw new UnprocessableEntityException("Member does not exist or is inactive");
  }
}
