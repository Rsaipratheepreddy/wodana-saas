import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { decodeCursor, encodeCursor, normalizeName } from "../shared/crm-types";
import {
  AddQueueMemberDto,
  AssignLeadDto,
  CreateAssignmentPolicyDto,
  CreateQueueDto,
  CreateSlaPolicyDto,
  ListLeadsQueryDto,
  TransitionLeadDto,
  UpdateAssignmentPolicyDto,
  UpdateQueueDto,
  UpdateSlaPolicyDto,
  UpsertQualificationDto,
} from "./dto/leads.dto";
import { normalizeSlaSchedule, SlaSchedule, SlaScheduleValidationError } from "./sla-schedule";
import { CrmSlaLifecycleService } from "./crm-sla-lifecycle.service";
import { evaluateQualification, QualificationEvaluation } from "./qualification-evidence";
import { hasResolvedEnquiryType } from "./lead-options";

const ACTIVE_LEAD_STATUSES = ["new", "attempting_contact", "connected", "nurturing", "paused"];
const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const TRANSITIONS: Record<string, Set<string>> = {
  new: new Set(["attempting_contact", "connected", "nurturing", "qualified", "disqualified", "paused"]),
  attempting_contact: new Set(["new", "connected", "nurturing", "qualified", "disqualified", "paused"]),
  connected: new Set(["new", "attempting_contact", "nurturing", "qualified", "disqualified", "paused"]),
  nurturing: new Set(["new", "attempting_contact", "connected", "qualified", "disqualified", "paused"]),
  qualified: new Set(["new", "attempting_contact", "connected", "nurturing", "disqualified", "paused"]),
  disqualified: new Set(["new", "attempting_contact", "connected", "nurturing", "qualified", "paused"]),
  paused: new Set(["new", "attempting_contact", "connected", "nurturing", "qualified", "disqualified"]),
};

interface LeadContext {
  id: string;
  enquiry_id: string;
  party_id: string;
  owner_membership_id: string | null;
  queue_id: string | null;
  ownership_due_at?: Date | null;
  status: string;
  version: number;
  source: string;
  channel: string;
  service_type: string | null;
  intake_method?: string;
  business_unit_id: string | null;
  preferred_locale: string | null;
  party_owner_membership_id: string | null;
  qualification_evidence?: Record<string, unknown> | null;
  qualification_evidence_hash?: string | null;
  qualified_by?: string | null;
}

@Injectable()
export class CrmLeadsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
    private readonly slas: CrmSlaLifecycleService = new CrmSlaLifecycleService(),
  ) {}

  processDueSlasInternal(workspaceId: string, limit = 100) {
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const safeLimit = Math.min(Math.max(limit, 1), 500);
      const breached = await client.query<Record<string, unknown>>(
        `WITH due AS (
           SELECT id,status FROM crm_sla_instances
           WHERE workspace_id = $1 AND status IN ('active', 'warning') AND due_at <= now()
           ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT $2
         )
         UPDATE crm_sla_instances instance
            SET status = 'breached',
                warned_at = COALESCE(instance.warned_at, instance.warning_at),
                breached_at = COALESCE(instance.breached_at, instance.due_at),
                version = version + 1, updated_at = now()
           FROM due
          WHERE instance.id = due.id
         RETURNING instance.id, due.status AS "fromStatus", instance.lead_id AS "leadId", instance.target_type AS "targetType",
                   instance.target_id AS "targetId", instance.event_type AS "eventType",
                   instance.warning_at AS "warningAt", instance.due_at AS "dueAt",
                   instance.owner_membership_id AS "ownerMembershipId", instance.queue_id AS "queueId",
                   instance.status, instance.version`,
        [workspaceId, safeLimit],
      );
      for (const row of breached.rows) {
        const escalation = row.leadId && row.eventType === "first_response"
          ? await this.escalateFirstResponseTask(client, workspaceId, {
            instanceId: String(row.id), leadId: String(row.leadId),
            ownerMembershipId: row.ownerMembershipId ? String(row.ownerMembershipId) : null,
            queueId: row.queueId ? String(row.queueId) : null,
            dueAt: new Date(row.dueAt as string | Date), level: "breach",
          })
          : null;
        if (row.fromStatus === "active") {
          await this.slas.recordTransition(
            client, workspaceId, String(row.id), "warning", "active", "warning",
            "SLA warning threshold elapsed before the deadline worker ran",
            { warningAt: row.warningAt, dueAt: row.dueAt, delayedProcessing: true },
            null, new Date(row.warningAt as string | Date),
          );
        }
        await this.slas.recordTransition(
          client, workspaceId, String(row.id), "breached",
          row.fromStatus === "active" ? "warning" : String(row.fromStatus), "breached",
          "SLA deadline elapsed", { dueAt: row.dueAt, escalation }, null,
          new Date(row.dueAt as string | Date),
        );
        await this.events.record(client, {
          workspaceId,
          actorUserId: null,
          source: "automation",
          action: "crm.sla.breached.v1",
          entityType: row.leadId ? "crm_lead" : `crm_${String(row.targetType)}`,
          entityId: String(row.leadId ?? row.targetId),
          after: { ...row, escalation },
        });
      }
      const remaining = safeLimit - (breached.rowCount ?? 0);
      const warnings = remaining > 0
        ? await client.query<Record<string, unknown>>(
          `WITH due AS (
             SELECT id,status FROM crm_sla_instances
             WHERE workspace_id = $1 AND status = 'active' AND warning_at <= now() AND due_at > now()
             ORDER BY warning_at FOR UPDATE SKIP LOCKED LIMIT $2
           )
           UPDATE crm_sla_instances instance
              SET status = 'warning', warned_at = COALESCE(instance.warned_at, instance.warning_at),
                  version = version + 1, updated_at = now()
             FROM due
            WHERE instance.id = due.id
           RETURNING instance.id, due.status AS "fromStatus", instance.lead_id AS "leadId", instance.target_type AS "targetType",
                     instance.target_id AS "targetId", instance.event_type AS "eventType", instance.warning_at AS "warningAt",
                     instance.due_at AS "dueAt", instance.owner_membership_id AS "ownerMembershipId",
                     instance.queue_id AS "queueId", instance.status, instance.version`,
          [workspaceId, remaining],
        )
        : { rows: [], rowCount: 0 };
      for (const row of warnings.rows) {
        const escalation = row.leadId && row.eventType === "first_response"
          ? await this.escalateFirstResponseTask(client, workspaceId, {
            instanceId: String(row.id), leadId: String(row.leadId),
            ownerMembershipId: row.ownerMembershipId ? String(row.ownerMembershipId) : null,
            queueId: row.queueId ? String(row.queueId) : null,
            dueAt: new Date(row.warningAt as string | Date), level: "warning",
          })
          : null;
        await this.slas.recordTransition(
          client, workspaceId, String(row.id), "warning", String(row.fromStatus), "warning",
          "SLA warning threshold elapsed", { warningAt: row.warningAt, dueAt: row.dueAt, escalation },
          null, new Date(row.warningAt as string | Date),
        );
        await this.events.record(client, {
          workspaceId,
          actorUserId: null,
          source: "automation",
          action: "crm.sla.warning.v1",
          entityType: row.leadId ? "crm_lead" : `crm_${String(row.targetType)}`,
          entityId: String(row.leadId ?? row.targetId),
          after: { ...row, escalation },
        });
      }
      return { warnings: warnings.rows, breaches: breached.rows };
    });
  }

  processDueTakeoversInternal(workspaceId: string, limit = 100) {
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${workspaceId}:lead-assignment`]);
      const due = await client.query<{ id: string }>(
        `SELECT lead.id FROM crm_leads lead
         WHERE lead.workspace_id=$1 AND lead.ownership_due_at<=now()
           AND lead.owner_membership_id IS NOT NULL
           AND lead.status IN ('new','attempting_contact','connected','nurturing')
         ORDER BY lead.ownership_due_at,lead.id
         FOR UPDATE OF lead SKIP LOCKED LIMIT $2`,
        [workspaceId, Math.min(Math.max(limit, 1), 100)],
      );
      const reassigned: Array<{ leadId: string; ownerMembershipId: string | null; queueId: string | null }> = [];
      const engaged: string[] = [];
      for (const item of due.rows) {
        const lead = await this.requireLead(client, workspaceId, item.id, false);
        if (!lead.owner_membership_id || !lead.queue_id) {
          await this.clearOwnershipDeadline(client, workspaceId, lead.id);
          continue;
        }
        const assignment = await client.query<{ assignedAt: Date; userId: string | null }>(
          `SELECT history.assigned_at AS "assignedAt", membership.user_id AS "userId"
           FROM crm_assignment_history history
           LEFT JOIN workspace_memberships membership ON membership.id=history.owner_membership_id
             AND membership.workspace_id=history.workspace_id
           WHERE history.workspace_id=$1 AND history.lead_id=$2
             AND history.owner_membership_id=$3
           ORDER BY history.assigned_at DESC,history.id DESC LIMIT 1`,
          [workspaceId, lead.id, lead.owner_membership_id],
        );
        if (!assignment.rowCount || !assignment.rows[0].userId) {
          await this.clearOwnershipDeadline(client, workspaceId, lead.id);
          continue;
        }
        const { assignedAt, userId } = assignment.rows[0];
        const response = await client.query(
          `SELECT 1 FROM crm_sla_instances
           WHERE workspace_id=$1 AND lead_id=$2 AND event_type='first_response'
             AND responded_at >= $3::timestamptz LIMIT 1`,
          [workspaceId, lead.id, assignedAt],
        );
        const activity = response.rowCount ? response : await client.query(
          `SELECT 1 FROM audit_events event
           WHERE event.workspace_id=$1 AND event.actor_user_id=$2
             AND event.occurred_at >= $3::timestamptz
             AND (
               (event.action='crm.lead.requirement_note_saved.v1'
                 AND event.entity_id=$4::uuid
                 AND event.after->'note'->>'archived'='false'
                 AND length(trim(COALESCE(event.after->'note'->>'note','')))>0)
               OR (event.action IN ('crm.activity.created.v1','crm.activity.completed.v1')
                 AND event.after->>'leadId'=$4::text
                 AND ((event.action='crm.activity.created.v1' AND event.after->>'type'='note')
                   OR (event.action='crm.activity.completed.v1' AND event.after->>'type'='call')))
             ) LIMIT 1`,
          [workspaceId, userId, assignedAt, lead.id],
        );
        if (activity.rowCount) {
          await this.clearOwnershipDeadline(client, workspaceId, lead.id);
          engaged.push(lead.id);
          await this.events.record(client, {
            workspaceId, actorUserId: null, source: "automation",
            action: "crm.lead.takeover_cancelled.v1", entityType: "crm_lead", entityId: lead.id,
            after: { ownerMembershipId: lead.owner_membership_id, reason: "Owner recorded a call, note, or verified response" },
          });
          continue;
        }
        const selection = await this.selectAssignment(client, workspaceId, lead, true, {
          queueId: lead.queue_id, excludedOwnerId: lead.owner_membership_id,
        });
        const changed = await this.applyAssignment(
          client, workspaceId, lead, selection, null, "automatic",
          "No call or note was logged before the ownership deadline",
        );
        reassigned.push({ leadId: lead.id, ownerMembershipId: changed.assignment.ownerMembershipId,
          queueId: changed.assignment.queueId });
      }
      return { reassigned, engaged };
    });
  }

  private async clearOwnershipDeadline(client: PoolClient, workspaceId: string, leadId: string) {
    await client.query(
      `UPDATE crm_leads SET ownership_due_at=NULL WHERE workspace_id=$1 AND id=$2 AND ownership_due_at IS NOT NULL`,
      [workspaceId, leadId],
    );
  }

  list(actor: RequestActor, workspaceId: string, query: ListLeadsQueryDto) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.view", async (client) => {
      const cursor = decodeCursor(query.cursor);
      if (query.cursor && !cursor) throw new BadRequestException("Invalid page cursor");
      const values: unknown[] = [workspaceId];
      const clauses = ["lead.workspace_id = $1"];
      if (query.status) {
        values.push(query.status);
        clauses.push(`lead.status = $${values.length}::crm_lead_status`);
      }
      if (query.ownerMembershipId) {
        values.push(query.ownerMembershipId);
        clauses.push(`lead.owner_membership_id = $${values.length}`);
      }
      if (query.queueId) {
        values.push(query.queueId);
        clauses.push(`lead.queue_id = $${values.length}`);
      }
      if (query.search) {
        values.push(normalizeName(query.search));
        clauses.push(`(party.normalized_name % $${values.length} OR party.normalized_name LIKE '%' || $${values.length} || '%' OR lower(enquiry.reference) LIKE '%' || $${values.length} || '%' OR lower(enquiry.title) LIKE '%' || $${values.length} || '%')`);
      }
      if (cursor) {
        values.push(cursor.value, cursor.id);
        clauses.push(`(lead.created_at, lead.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
      }
      values.push(query.limit + 1);
      const result = await client.query(
        `SELECT lead.id, lead.status, lead.priority, lead.fit_score AS "fitScore",
                lead.engagement_score AS "engagementScore",
                COALESCE(converted_owner.owner_membership_id, lead.owner_membership_id) AS "ownerMembershipId", lead.queue_id AS "queueId",
                lead.next_action_at AS "nextActionAt", lead.version,
                lead.ownership_due_at AS "ownershipDueAt",
                EXISTS (SELECT 1 FROM crm_opportunities converted WHERE converted.workspace_id = lead.workspace_id AND converted.lead_id = lead.id) AS "isConverted",
                lead.created_at AS "createdAt", lead.updated_at AS "updatedAt",
                party.id AS "partyId", party.display_name AS "partyName",
                enquiry.id AS "enquiryId", enquiry.reference, enquiry.details, enquiry.title, enquiry.source, enquiry.channel,
                intake.intake_method AS "intakeMethod",
                intake.original_payload->>'formId' AS "formId",
                intake.original_payload->'formAnswers' AS "formAnswers",
                enquiry.service_type AS "serviceType",
                user_account.display_name AS "ownerName", queue.name AS "queueName",
                sla.status AS "slaStatus", sla.warning_at AS "slaWarningAt", sla.due_at AS "slaDueAt"
         FROM crm_leads lead
         JOIN crm_parties party ON party.id = lead.party_id AND party.workspace_id = lead.workspace_id
         JOIN crm_enquiries enquiry ON enquiry.id = lead.enquiry_id AND enquiry.workspace_id = lead.workspace_id
         JOIN crm_intake_events intake ON intake.id=enquiry.intake_event_id AND intake.workspace_id=lead.workspace_id
         LEFT JOIN LATERAL (SELECT opportunity.owner_membership_id FROM crm_opportunities opportunity WHERE opportunity.workspace_id=lead.workspace_id AND opportunity.lead_id=lead.id ORDER BY opportunity.created_at,opportunity.id LIMIT 1) converted_owner ON true
         LEFT JOIN workspace_memberships membership ON membership.id = COALESCE(converted_owner.owner_membership_id, lead.owner_membership_id)
         LEFT JOIN users user_account ON user_account.id = membership.user_id
         LEFT JOIN crm_queues queue ON queue.id = lead.queue_id AND queue.workspace_id = lead.workspace_id
         LEFT JOIN LATERAL (
           SELECT status, warning_at, due_at FROM crm_sla_instances
           WHERE workspace_id = lead.workspace_id AND lead_id = lead.id AND status IN ('active', 'warning', 'breached')
           ORDER BY due_at LIMIT 1
         ) sla ON true
         WHERE ${clauses.join(" AND ")}
         ORDER BY lead.created_at DESC, lead.id DESC
         LIMIT $${values.length}`,
        values,
      );
      const hasMore = result.rows.length > query.limit;
      const data = hasMore ? result.rows.slice(0, query.limit) : result.rows;
      const last = data.at(-1) as { id: string; createdAt: Date } | undefined;
      return {
        data,
        nextCursor: hasMore && last
          ? encodeCursor({ value: new Date(last.createdAt).toISOString(), id: last.id })
          : null,
      };
    });
  }

  get(actor: RequestActor, workspaceId: string, leadId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.view", async (client, actorUser) => {
      const lead = await this.requireLead(client, workspaceId, leadId, false);
      const qualification = await client.query(
          `SELECT question_key AS "questionKey", value, captured_at AS "capturedAt"
           FROM crm_lead_qualification_values WHERE workspace_id = $1 AND lead_id = $2
           ORDER BY question_key`, [workspaceId, leadId],
        );
      const assignments = await client.query(
          `SELECT history.id, history.previous_owner_membership_id AS "previousOwnerMembershipId",
                  history.owner_membership_id AS "ownerMembershipId", history.queue_id AS "queueId",
                  history.assignment_method AS "assignmentMethod", history.rule_id AS "ruleId",
                  history.explanation, history.reason, history.assigned_at AS "assignedAt"
           FROM crm_assignment_history history
           WHERE history.workspace_id = $1 AND history.lead_id = $2
           ORDER BY history.assigned_at DESC`, [workspaceId, leadId],
        );
      const sla = await client.query(
          `SELECT id, event_type AS "eventType", status, started_at AS "startedAt", warning_at AS "warningAt",
                  due_at AS "dueAt", warned_at AS "warnedAt", breached_at AS "breachedAt",
                  stopped_at AS "stoppedAt", responded_at AS "respondedAt",
                  response_source_type AS "responseSourceType", response_source_id AS "responseSourceId",
                  response_elapsed_minutes AS "responseElapsedMinutes",
                  owner_membership_id AS "ownerMembershipId", queue_id AS "queueId", cycle
           FROM crm_sla_instances WHERE workspace_id = $1 AND lead_id = $2
           ORDER BY started_at DESC`, [workspaceId, leadId],
        );
      const enquiry = await client.query(`SELECT enquiry.id, enquiry.reference, enquiry.details, enquiry.title,
        enquiry.summary, enquiry.service_type AS "serviceType", enquiry.source, enquiry.channel, enquiry.original_source AS "originalSource", enquiry.original_channel AS "originalChannel",
        CASE WHEN enquiry.referral_kind IS NULL THEN NULL ELSE jsonb_build_object('kind', enquiry.referral_kind, 'name', enquiry.referral_name,
          'contact', enquiry.referral_contact, 'membershipId', enquiry.referral_membership_id, 'option', enquiry.referral_option,
          'memberName', (SELECT person.display_name FROM workspace_memberships member JOIN users person ON person.id = member.user_id WHERE member.id = enquiry.referral_membership_id)) END AS referral,
        intake.intake_method AS "intakeMethod", intake.received_at AS "receivedAt",
        intake.processed_at AS "processedAt", intake.original_payload AS "originalSubmission",
        intake.external_event_id AS "externalEventId", intake.correlation_id AS "correlationId",
        intake.payload_reference AS "payloadReference",
        (SELECT raw_value FROM crm_contact_points cp WHERE cp.workspace_id=party.workspace_id AND cp.party_id=party.id AND cp.type='email' AND cp.status='active' ORDER BY cp.is_primary DESC,cp.created_at DESC LIMIT 1) AS "primaryEmail",
        (SELECT raw_value FROM crm_contact_points cp WHERE cp.workspace_id=party.workspace_id AND cp.party_id=party.id AND cp.type='phone' AND cp.status='active' AND cp.label='mobile' ORDER BY cp.is_primary DESC,cp.created_at DESC LIMIT 1) AS "primaryMobile",
        (SELECT raw_value FROM crm_contact_points cp WHERE cp.workspace_id=party.workspace_id AND cp.party_id=party.id AND cp.type='phone' AND cp.status='active' AND cp.label IS DISTINCT FROM 'mobile' ORDER BY cp.is_primary DESC,cp.created_at DESC LIMIT 1) AS "primaryPhone",
        party.display_name AS "partyName" FROM crm_leads lead
        JOIN crm_enquiries enquiry ON enquiry.id=lead.enquiry_id AND enquiry.workspace_id=lead.workspace_id
        JOIN crm_parties party ON party.id=lead.party_id AND party.workspace_id=lead.workspace_id
        JOIN crm_intake_events intake ON intake.id=enquiry.intake_event_id AND intake.workspace_id=lead.workspace_id
        WHERE lead.workspace_id=$1 AND lead.id=$2`, [workspaceId, leadId]);
      const attribution = await client.query(
        `SELECT id, source, medium, campaign, content, term, referrer,
                external_click_id AS "externalClickId", touched_at AS "touchedAt", metadata
           FROM crm_attribution_touches
          WHERE workspace_id = $1 AND enquiry_id = $2
          ORDER BY touched_at, id`,
        [workspaceId, lead.enquiry_id],
      );
      const canViewOpportunities = await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.opportunities.view");
      const opportunities = canViewOpportunities ? await client.query(`SELECT opportunity.id, opportunity.title, opportunity.status,
          source_case.id AS "preProjectCaseId", commercial_case.content #>> '{dealFile,reference}' AS "dealFileReference"
        FROM crm_opportunities opportunity
        LEFT JOIN pre_project_cases source_case ON source_case.workspace_id=opportunity.workspace_id AND source_case.opportunity_id=opportunity.id
        LEFT JOIN commercial_cases_view commercial_case ON commercial_case.workspace_id=source_case.workspace_id AND commercial_case.case_id=source_case.id
        WHERE opportunity.workspace_id = $1 AND opportunity.lead_id = $2`, [workspaceId, leadId]) : { rows: [] };
      const frozenQualification = lead.status === "qualified" && lead.qualification_evidence
        ? lead.qualification_evidence as Record<string, unknown>
        : null;
      // Valid frozen decisions retain their exact form snapshot even after
      // settings change; invalid provisional-type snapshots must be rechecked.
      const frozenTypeResolved = frozenQualification ? hasResolvedEnquiryType(String(frozenQualification.serviceType ?? "")) : false;
      // Older qualified leads may have been frozen with the provisional type.
      // Recheck those against the current enquiry so correcting the type can
      // unblock conversion without treating their invalid snapshot as ready.
      const qualificationState = frozenQualification && frozenTypeResolved
        ? null
        : await evaluateQualification(client, workspaceId, leadId);
      return {
        ...this.mapLead(lead), enquiry: { ...enquiry.rows[0], attribution: attribution.rows }, opportunities: opportunities.rows,
        qualification: qualification.rows, assignments: assignments.rows, sla: sla.rows,
        qualificationState: {
          ready: qualificationState ? qualificationState.ready : true,
          missingRequired: qualificationState ? qualificationState.missingRequired : [],
          selection: qualificationState ? qualificationState.evidence.selection : frozenQualification!.selection,
          form: qualificationState ? qualificationState.evidence.form : frozenQualification!.form,
          frozen: Boolean(frozenQualification && frozenTypeResolved),
        },
      };
    });
  }

  createQueue(actor: RequestActor, workspaceId: string, input: CreateQueueDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      if (input.businessUnitId) {
        const unit = await client.query(`SELECT 1 FROM business_units WHERE id = $1 AND workspace_id = $2 AND status = 'active'`, [input.businessUnitId, workspaceId]);
        if (!unit.rowCount) throw new UnprocessableEntityException("Business unit is not active");
      }
      if (input.isFallback) {
        await client.query(`UPDATE crm_queues SET is_fallback = false, version = version + 1 WHERE workspace_id = $1 AND is_fallback`, [workspaceId]);
      }
      const result = await client.query(
        `INSERT INTO crm_queues (workspace_id, business_unit_id, code, name, is_fallback, takeover_after_minutes)
         VALUES ($1, $2, lower($3), $4, $5, $6)
         RETURNING id, business_unit_id AS "businessUnitId", code, name, status,
                   is_fallback AS "isFallback", takeover_after_minutes AS "takeoverAfterMinutes",
                   round_robin_cursor AS "roundRobinCursor", version`,
        [workspaceId, input.businessUnitId ?? null, input.code, input.name, input.isFallback ?? false, input.takeoverAfterMinutes ?? null],
      );
      const response = result.rows[0] as Record<string, unknown>;
      await this.events.record(client, {
        workspaceId, actorUserId: actorUser.userId, source: "user",
        action: "crm.queue.created.v1", entityType: "crm_queue", entityId: String(response.id), after: response,
      });
      return response;
    });
  }

  listQueues(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.view", async (client) => {
      const result = await client.query(
        `SELECT queue.id, queue.code, queue.name, queue.status,
                queue.business_unit_id AS "businessUnitId", queue.is_fallback AS "isFallback",
                queue.takeover_after_minutes AS "takeoverAfterMinutes",
                queue.round_robin_cursor AS "roundRobinCursor", queue.version,
                COALESCE(jsonb_agg(jsonb_build_object(
                  'membershipId', member.membership_id, 'name', account.display_name,
                  'capacity', member.capacity, 'weight', member.weight,
                  'isAvailable', member.is_available, 'skills', member.skills,
                  'languages', member.languages, 'territories', member.territories,
                  'unavailableUntil', member.unavailable_until, 'teamId', member.team_id
                ) ORDER BY account.display_name) FILTER (WHERE member.membership_id IS NOT NULL), '[]'::jsonb) AS members
         FROM crm_queues queue
         LEFT JOIN crm_effective_queue_members member ON member.queue_id = queue.id AND member.workspace_id = queue.workspace_id
         LEFT JOIN workspace_memberships membership ON membership.id = member.membership_id
         LEFT JOIN users account ON account.id = membership.user_id
         WHERE queue.workspace_id = $1 AND queue.status = 'active'
         GROUP BY queue.id ORDER BY queue.name`, [workspaceId],
      );
      return result.rows;
    });
  }

  updateQueue(actor: RequestActor, workspaceId: string, queueId: string, input: UpdateQueueDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const existing = await client.query<Record<string, unknown>>(`SELECT * FROM crm_queues WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, queueId]);
      if (!existing.rowCount) throw new NotFoundException("Queue not found");
      const before = existing.rows[0];
      if (Number(before.version) !== input.version) throw new ConflictException("Queue changed; reload and try again");
      if (input.businessUnitId) {
        const unit = await client.query(`SELECT 1 FROM business_units WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, input.businessUnitId]);
        if (!unit.rowCount) throw new UnprocessableEntityException("Business unit is not active");
      }
      if (input.status === "archived") {
        const references = await client.query(`SELECT EXISTS (SELECT 1 FROM crm_leads WHERE workspace_id = $1 AND queue_id = $2 AND status = ANY($3::crm_lead_status[])) OR EXISTS (SELECT 1 FROM crm_assignment_policies WHERE workspace_id = $1 AND fallback_queue_id = $2 AND status = 'active') OR EXISTS (SELECT 1 FROM crm_assignment_rules WHERE workspace_id = $1 AND queue_id = $2 AND status = 'active') AS blocked`, [workspaceId, queueId, ACTIVE_LEAD_STATUSES]);
        if (references.rows[0]?.blocked) throw new ConflictException("Reassign active leads and policies before archiving this queue");
      }
      if (input.isFallback) await client.query(`UPDATE crm_queues SET is_fallback = false, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id <> $2 AND is_fallback`, [workspaceId, queueId]);
      const result = await client.query(
        `UPDATE crm_queues SET
           name = COALESCE($1, name),
           business_unit_id = CASE WHEN $2::boolean THEN $3::uuid ELSE business_unit_id END,
           is_fallback = COALESCE($4, is_fallback), status = COALESCE($5, status),
           takeover_after_minutes = CASE WHEN $9::boolean THEN $10::integer ELSE takeover_after_minutes END,
           version = version + 1, updated_at = now()
         WHERE workspace_id = $6 AND id = $7 AND version = $8
         RETURNING id, business_unit_id AS "businessUnitId", code, name, status,
                   is_fallback AS "isFallback", takeover_after_minutes AS "takeoverAfterMinutes",
                   round_robin_cursor AS "roundRobinCursor", version`,
        [input.name?.trim() ?? null, input.businessUnitId !== undefined, input.businessUnitId ?? null, input.isFallback ?? null, input.status ?? null, workspaceId, queueId, input.version, input.takeoverAfterMinutes !== undefined, input.takeoverAfterMinutes ?? null],
      );
      if (!result.rowCount) throw new ConflictException("Queue changed; reload and try again");
      if (input.takeoverAfterMinutes !== undefined) {
        await client.query(
          `UPDATE crm_leads lead SET ownership_due_at = CASE WHEN $3::integer IS NULL THEN NULL
             ELSE COALESCE((SELECT history.assigned_at FROM crm_assignment_history history
               WHERE history.workspace_id=lead.workspace_id AND history.lead_id=lead.id
                 AND history.owner_membership_id=lead.owner_membership_id
               ORDER BY history.assigned_at DESC,history.id DESC LIMIT 1),now()) + $3::integer * interval '1 minute' END
           WHERE lead.workspace_id=$1 AND lead.queue_id=$2 AND lead.owner_membership_id IS NOT NULL
             AND lead.status IN ('new','attempting_contact','connected','nurturing')`,
          [workspaceId, queueId, input.takeoverAfterMinutes ?? null],
        );
      }
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.queue.updated.v1", entityType: "crm_queue", entityId: queueId, before, after: result.rows[0] as Record<string, unknown> });
      return result.rows[0];
    });
  }

  addQueueMember(actor: RequestActor, workspaceId: string, queueId: string, input: AddQueueMemberDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      await this.requireQueue(client, workspaceId, queueId);
      const member = await client.query(`SELECT 1 FROM workspace_memberships WHERE id = $1 AND workspace_id = $2 AND status = 'active'`, [input.membershipId, workspaceId]);
      if (!member.rowCount) throw new UnprocessableEntityException("Queue member is not an active workspace member");
      const unavailableUntil = input.unavailableUntil ? new Date(input.unavailableUntil) : null;
      if (unavailableUntil && Number.isNaN(unavailableUntil.getTime())) throw new BadRequestException("unavailableUntil is invalid");
      const result = await client.query(
        `INSERT INTO crm_queue_members
          (workspace_id, queue_id, membership_id, capacity, weight, is_available,
           skills, languages, territories, unavailable_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (queue_id, membership_id) DO UPDATE SET
           capacity = EXCLUDED.capacity, weight = EXCLUDED.weight,
           is_available = EXCLUDED.is_available, skills = EXCLUDED.skills,
           languages = EXCLUDED.languages, territories = EXCLUDED.territories,
           unavailable_until = EXCLUDED.unavailable_until
         RETURNING membership_id AS "membershipId", capacity, weight,
                   is_available AS "isAvailable", skills, languages, territories,
                   unavailable_until AS "unavailableUntil"`,
        [
          workspaceId, queueId, input.membershipId, input.capacity, input.weight ?? 1,
          input.isAvailable ?? true, JSON.stringify(input.skills ?? []), JSON.stringify(input.languages ?? []),
          JSON.stringify(input.territories ?? []), unavailableUntil,
        ],
      );
      await this.events.record(client, {
        workspaceId, actorUserId: actorUser.userId, source: "user",
        action: "crm.queue.member_updated.v1", entityType: "crm_queue", entityId: queueId,
        after: result.rows[0] as Record<string, unknown>,
      });
      return result.rows[0];
    });
  }

  addDefaultManagers(actor: RequestActor, workspaceId: string, queueId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      await this.requireQueue(client, workspaceId, queueId);
      const result = await client.query(`INSERT INTO crm_queue_members(workspace_id,queue_id,membership_id,capacity,weight,is_available,skills,languages,territories)
        SELECT DISTINCT $1::uuid,$2::uuid,m.id,30,1,true,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb
        FROM workspace_memberships m JOIN effective_member_roles mr ON mr.membership_id=m.id AND mr.workspace_id=m.workspace_id JOIN roles r ON r.id=mr.role_id AND r.workspace_id=m.workspace_id
        WHERE m.workspace_id=$1 AND m.status='active' AND r.code IN ('owner','administrator','sales_executive')
        ON CONFLICT(queue_id,membership_id) DO NOTHING RETURNING membership_id AS "membershipId"`, [workspaceId, queueId]);
      if (result.rowCount) await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source:'user', action:'crm.queue.default_managers_added.v1', entityType:'crm_queue', entityId:queueId, after:{members:result.rows} });
      return { added:result.rowCount ?? 0 };
    });
  }

  removeQueueMember(actor: RequestActor, workspaceId: string, queueId: string, membershipId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      await this.requireQueue(client, workspaceId, queueId);
      const active = await client.query(`SELECT 1 FROM crm_leads WHERE workspace_id = $1 AND queue_id = $2 AND owner_membership_id = $3 AND status = ANY($4::crm_lead_status[]) LIMIT 1`, [workspaceId, queueId, membershipId, ACTIVE_LEAD_STATUSES]);
      if (active.rowCount) throw new ConflictException("Reassign this member's active leads before removing them from the queue");
      const result = await client.query(`DELETE FROM crm_queue_members WHERE workspace_id = $1 AND queue_id = $2 AND membership_id = $3 RETURNING membership_id AS "membershipId"`, [workspaceId, queueId, membershipId]);
      if (!result.rowCount) throw new NotFoundException("Queue member not found");
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.queue.member_removed.v1", entityType: "crm_queue", entityId: queueId, before: result.rows[0] as Record<string, unknown> });
      return { removed: true };
    });
  }

  createAssignmentPolicy(actor: RequestActor, workspaceId: string, input: CreateAssignmentPolicyDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      await this.requireQueue(client, workspaceId, input.fallbackQueueId);
      for (const rule of input.rules ?? []) await this.requireQueue(client, workspaceId, rule.queueId);
      const policy = await client.query(
        `INSERT INTO crm_assignment_policies
          (workspace_id, name, priority, fallback_queue_id, preserve_relationship_owner)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, priority, fallback_queue_id AS "fallbackQueueId",
                   preserve_relationship_owner AS "preserveRelationshipOwner", status, version`,
        [workspaceId, input.name, input.priority, input.fallbackQueueId, input.preserveRelationshipOwner ?? true],
      );
      const policyId = String(policy.rows[0].id);
      const rules = [];
      for (const rule of input.rules ?? []) {
        this.assertRuleConditions(rule.conditions);
        const inserted = await client.query(
          `INSERT INTO crm_assignment_rules
            (workspace_id, policy_id, queue_id, name, priority, conditions)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, queue_id AS "queueId", name, priority, conditions, status, version`,
          [workspaceId, policyId, rule.queueId, rule.name, rule.priority, rule.conditions],
        );
        rules.push(inserted.rows[0]);
      }
      const response = { ...policy.rows[0], rules };
      await this.events.record(client, {
        workspaceId, actorUserId: actorUser.userId, source: "user",
        action: "crm.assignment_policy.created.v1", entityType: "crm_assignment_policy",
        entityId: policyId, after: response,
      });
      return response;
    });
  }

  listAssignmentPolicies(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.view", async (client) => {
      const result = await client.query(
        `SELECT policy.id,policy.name,policy.priority,policy.status,
                policy.fallback_queue_id AS "fallbackQueueId",
                policy.preserve_relationship_owner AS "preserveRelationshipOwner",policy.version,
                COALESCE(jsonb_agg(jsonb_build_object(
                  'id',rule.id,'name',rule.name,'priority',rule.priority,'queueId',rule.queue_id,
                  'conditions',rule.conditions,'status',rule.status,'version',rule.version
                ) ORDER BY rule.priority,rule.id) FILTER (WHERE rule.id IS NOT NULL),'[]'::jsonb) AS rules
         FROM crm_assignment_policies policy
         LEFT JOIN crm_assignment_rules rule ON rule.workspace_id=policy.workspace_id AND rule.policy_id=policy.id
         WHERE policy.workspace_id=$1 GROUP BY policy.id ORDER BY policy.priority,policy.name`,
        [workspaceId],
      );
      return result.rows;
    });
  }

  updateAssignmentPolicy(actor: RequestActor, workspaceId: string, policyId: string, input: UpdateAssignmentPolicyDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const existing = await client.query<Record<string, unknown>>(`SELECT * FROM crm_assignment_policies WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, policyId]);
      if (!existing.rowCount) throw new NotFoundException("Assignment policy not found");
      const before = existing.rows[0];
      if (Number(before.version) !== input.version) throw new ConflictException("Assignment policy changed; reload and try again");
      const fallbackQueueId = input.fallbackQueueId ?? (before.fallback_queue_id ? String(before.fallback_queue_id) : null);
      if (!fallbackQueueId) throw new UnprocessableEntityException("An active fallback queue is required");
      await this.requireQueue(client, workspaceId, fallbackQueueId);
      if (input.rules) {
        const priorities = new Set(input.rules.map((rule) => rule.priority));
        if (priorities.size !== input.rules.length) throw new UnprocessableEntityException("Assignment rule priorities must be unique");
        for (const rule of input.rules) { await this.requireQueue(client, workspaceId, rule.queueId); this.assertRuleConditions(rule.conditions); }
      }
      const result = await client.query(
        `UPDATE crm_assignment_policies SET name = COALESCE($1, name), priority = COALESCE($2, priority),
           fallback_queue_id = COALESCE($3, fallback_queue_id),
           preserve_relationship_owner = COALESCE($4, preserve_relationship_owner),
           status = COALESCE($5, status), version = version + 1, updated_at = now()
         WHERE workspace_id = $6 AND id = $7 AND version = $8
         RETURNING id, name, priority, fallback_queue_id AS "fallbackQueueId",
                   preserve_relationship_owner AS "preserveRelationshipOwner", status, version`,
        [input.name?.trim() ?? null, input.priority ?? null, input.fallbackQueueId ?? null, input.preserveRelationshipOwner ?? null, input.status ?? null, workspaceId, policyId, input.version],
      );
      if (!result.rowCount) throw new ConflictException("Assignment policy changed; reload and try again");
      if (input.rules) {
        await client.query(`UPDATE crm_assignment_rules SET status = 'archived', version = version + 1, updated_at = now() WHERE workspace_id = $1 AND policy_id = $2 AND status = 'active'`, [workspaceId, policyId]);
        for (const rule of input.rules) {
          await client.query(`INSERT INTO crm_assignment_rules (workspace_id, policy_id, queue_id, name, priority, conditions) VALUES ($1,$2,$3,$4,$5,$6)`, [workspaceId, policyId, rule.queueId, rule.name, rule.priority, rule.conditions]);
        }
      }
      const rules = await client.query(`SELECT id, queue_id AS "queueId", name, priority, conditions, status, version FROM crm_assignment_rules WHERE workspace_id = $1 AND policy_id = $2 AND status = 'active' ORDER BY priority, id`, [workspaceId, policyId]);
      const response = { ...result.rows[0], rules: rules.rows };
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.assignment_policy.updated.v1", entityType: "crm_assignment_policy", entityId: policyId, before, after: response });
      return response;
    });
  }

  createSlaPolicy(actor: RequestActor, workspaceId: string, input: CreateSlaPolicyDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      if (input.breachAfterMinutes <= input.warningAfterMinutes) {
        throw new UnprocessableEntityException("Breach time must be later than warning time");
      }
      const existingActive = await client.query(
        `SELECT 1 FROM crm_sla_policies WHERE workspace_id=$1 AND event_type=$2 AND status='active' LIMIT 1`,
        [workspaceId, input.eventType.trim()],
      );
      if (existingActive.rowCount) throw new ConflictException("An active SLA policy already exists for this event type");
      let schedule: SlaSchedule;
      try {
        schedule = normalizeSlaSchedule(input.schedule, input.calculationMode);
      } catch (error) {
        if (error instanceof SlaScheduleValidationError) throw new UnprocessableEntityException(error.message);
        throw error;
      }
      const result = await client.query(
        `INSERT INTO crm_sla_policies
          (workspace_id, name, event_type, warning_after_minutes,
           breach_after_minutes, calculation_mode, schedule_version, schedule)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7)
         RETURNING id, name, event_type AS "eventType",
                   warning_after_minutes AS "warningAfterMinutes",
                   breach_after_minutes AS "breachAfterMinutes",
                   calculation_mode AS "calculationMode", schedule_version AS "scheduleVersion",
                   schedule, status, version`,
        [workspaceId, input.name.trim(), input.eventType.trim(), input.warningAfterMinutes, input.breachAfterMinutes, schedule.mode, schedule],
      );
      await this.events.record(client, {
        workspaceId, actorUserId: actorUser.userId, source: "user",
        action: "crm.sla_policy.created.v1", entityType: "crm_sla_policy",
        entityId: String(result.rows[0].id), after: result.rows[0] as Record<string, unknown>,
      });
      return result.rows[0];
    });
  }

  listSlaPolicies(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.view", async (client) => {
      const result = await client.query(
        `SELECT id,name,event_type AS "eventType",warning_after_minutes AS "warningAfterMinutes",
                breach_after_minutes AS "breachAfterMinutes",calculation_mode AS "calculationMode",
                schedule_version AS "scheduleVersion",schedule,status,version,
                created_at AS "createdAt",updated_at AS "updatedAt"
         FROM crm_sla_policies WHERE workspace_id=$1 ORDER BY name`,
        [workspaceId],
      );
      return result.rows;
    });
  }

  updateSlaPolicy(actor: RequestActor, workspaceId: string, policyId: string, input: UpdateSlaPolicyDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const existing = await client.query<Record<string, unknown>>(`SELECT * FROM crm_sla_policies WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, policyId]);
      if (!existing.rowCount) throw new NotFoundException("SLA policy not found");
      const before = existing.rows[0];
      if (Number(before.version) !== input.version) throw new ConflictException("SLA policy changed; reload and try again");
      const warning = input.warningAfterMinutes ?? Number(before.warning_after_minutes);
      const breach = input.breachAfterMinutes ?? Number(before.breach_after_minutes);
      if (breach <= warning) throw new UnprocessableEntityException("Breach time must be later than warning time");
      const resultingEventType = input.eventType?.trim() ?? String(before.event_type);
      const resultingStatus = input.status ?? String(before.status);
      if (resultingStatus === "active") {
        const conflicting = await client.query(
          `SELECT 1 FROM crm_sla_policies
           WHERE workspace_id=$1 AND event_type=$2 AND status='active' AND id<>$3 LIMIT 1`,
          [workspaceId, resultingEventType, policyId],
        );
        if (conflicting.rowCount) throw new ConflictException("An active SLA policy already exists for this event type");
      }
      let schedule = before.schedule;
      let calculationMode = String(before.calculation_mode);
      if (input.schedule !== undefined || input.calculationMode !== undefined) {
        try {
          const normalized = normalizeSlaSchedule(input.schedule ?? before.schedule, input.calculationMode ?? before.calculation_mode);
          schedule = normalized;
          calculationMode = normalized.mode;
        } catch (error) {
          if (error instanceof SlaScheduleValidationError) throw new UnprocessableEntityException(error.message);
          throw error;
        }
      }
      const result = await client.query(
        `UPDATE crm_sla_policies SET name = COALESCE($1, name), event_type = COALESCE($2, event_type),
           warning_after_minutes = $3, breach_after_minutes = $4,
           calculation_mode = $5, schedule_version = 1, schedule = $6,
           status = COALESCE($7, status),
           version = version + 1, updated_at = now()
         WHERE workspace_id = $8 AND id = $9 AND version = $10
         RETURNING id, name, event_type AS "eventType", warning_after_minutes AS "warningAfterMinutes",
                   breach_after_minutes AS "breachAfterMinutes", calculation_mode AS "calculationMode",
                   schedule_version AS "scheduleVersion", schedule, status, version`,
        [input.name?.trim() ?? null, input.eventType?.trim() ?? null, warning, breach, calculationMode, schedule, input.status ?? null, workspaceId, policyId, input.version],
      );
      if (!result.rowCount) throw new ConflictException("SLA policy changed; reload and try again");
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.sla_policy.updated.v1", entityType: "crm_sla_policy", entityId: policyId, before, after: result.rows[0] as Record<string, unknown> });
      return result.rows[0];
    });
  }

  simulateAssignment(actor: RequestActor, workspaceId: string, leadId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.view", async (client) => {
      const lead = await this.requireLead(client, workspaceId, leadId, false);
      return this.selectAssignment(client, workspaceId, lead, false);
    });
  }

  autoAssign(actor: RequestActor, workspaceId: string, leadId: string, expectedVersion: number) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.assign", async (client, actorUser) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${workspaceId}:lead-assignment`]);
      const lead = await this.requireLead(client, workspaceId, leadId, true);
      if (lead.version !== expectedVersion) throw new ConflictException("Lead changed; reload and try again");
      const selection = await this.selectAssignment(client, workspaceId, lead, true);
      return this.applyAssignment(client, workspaceId, lead, selection, actorUser.userId, "automatic", null);
    });
  }

  async assignOnIntake(client: PoolClient, workspaceId: string, leadId: string, actorUserId: string | null,
    input: { mode: string; ownerMembershipId?: string; queueId?: string }) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${workspaceId}:lead-assignment`]);
    const lead = await this.requireLead(client, workspaceId, leadId, true);
    if (input.mode === "automatic") {
      const selection = await this.selectAssignment(client, workspaceId, lead, true);
      return this.applyAssignment(client, workspaceId, lead, selection, actorUserId, "automatic", "Initial routing");
    }
    if (input.mode === "manual" && !input.ownerMembershipId) throw new UnprocessableEntityException("Choose a salesperson");
    if (input.queueId) await this.requireQueue(client, workspaceId, input.queueId);
    if (input.ownerMembershipId) {
      await this.requireEligibleOwner(client, workspaceId, input.ownerMembershipId, input.queueId ?? null);
    }
    if (input.mode === "unassigned") {
      await client.query(`INSERT INTO crm_assignment_history (workspace_id, lead_id, assignment_method, explanation, reason, assigned_by)
        VALUES ($1,$2,'manual',$3,'Left unassigned during creation',$4)`, [workspaceId, leadId, { mode: "unassigned" }, actorUserId]);
      return this.mapLead(lead);
    }
    return this.applyAssignment(client, workspaceId, lead, {
      ownerMembershipId: input.ownerMembershipId ?? null, queueId: input.queueId ?? null,
      ruleId: null, explanation: { mode: "manual", origin: "intake" },
    }, actorUserId, "manual", "Selected during creation");
  }

  async startSlaOnIntake(client: PoolClient, workspaceId: string, leadId: string, actorUserId: string | null) {
    const lead = await this.requireLead(client, workspaceId, leadId, false);
    return this.startFirstResponseSla(client, workspaceId, leadId, lead.owner_membership_id, actorUserId, false, "Lead became ready after intake");
  }

  async autoAssignForAutomation(client: PoolClient, workspaceId: string, leadId: string) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${workspaceId}:lead-assignment`]);
    const lead = await this.requireLead(client, workspaceId, leadId, true);
    const alreadyRouted = await client.query(`SELECT 1 FROM crm_assignment_history WHERE workspace_id=$1 AND lead_id=$2 LIMIT 1`, [workspaceId, leadId]);
    if (alreadyRouted.rowCount || lead.owner_membership_id) return this.mapLead(lead);
    const selection = await this.selectAssignment(client, workspaceId, lead, true);
    return this.applyAssignment(client, workspaceId, lead, selection, null, "automatic", "automation");
  }

  manualAssign(actor: RequestActor, workspaceId: string, leadId: string, input: AssignLeadDto) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.assign", async (client, actorUser) => {
      if (!input.ownerMembershipId && !input.queueId) throw new UnprocessableEntityException("Choose an owner or queue");
      const lead = await this.requireLead(client, workspaceId, leadId, true);
      if (lead.version !== input.version) throw new ConflictException("Lead changed; reload and try again");
      if (input.queueId) await this.requireQueue(client, workspaceId, input.queueId);
      if (input.ownerMembershipId) {
        await this.requireEligibleOwner(client, workspaceId, input.ownerMembershipId, input.queueId ?? null);
      }
      return this.applyAssignment(client, workspaceId, lead, {
        ownerMembershipId: input.ownerMembershipId ?? null,
        queueId: input.queueId ?? null,
        ruleId: null,
        explanation: { mode: "manual", reason: input.reason },
      }, actorUser.userId, "manual", input.reason);
    });
  }

  transition(actor: RequestActor, workspaceId: string, leadId: string, input: TransitionLeadDto) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.manage", async (client, actorUser) => {
      const before = await this.requireLead(client, workspaceId, leadId, true);
      if (before.version !== input.version) throw new ConflictException("Lead changed; reload and try again");
      if (before.status === input.status) return this.mapLead(before);
      const linked = await client.query(`SELECT 1 FROM crm_opportunities WHERE workspace_id = $1 AND lead_id = $2 LIMIT 1`, [workspaceId, leadId]);
      if (linked.rowCount) throw new ConflictException("This lead has been converted. Continue work in its opportunity or create a new enquiry.");
      if (!TRANSITIONS[before.status]?.has(input.status)) {
        throw new UnprocessableEntityException(`Lead cannot move from ${before.status} to ${input.status}`);
      }
      if (["disqualified", "paused"].includes(input.status) && !input.reason?.trim()) {
        throw new UnprocessableEntityException("A reason is required for this status");
      }
      const qualification: QualificationEvaluation | null = input.status === "qualified"
        ? await evaluateQualification(client, workspaceId, leadId, {}, true)
        : null;
      const retainedAction = (before as unknown as Record<string, unknown>).next_action_at;
      const nextActionAt = ["qualified", "disqualified", "paused"].includes(input.status) ? null : input.nextActionAt ? new Date(input.nextActionAt) : retainedAction ? new Date(String(retainedAction)) : null;
      if (nextActionAt && Number.isNaN(nextActionAt.getTime())) throw new BadRequestException("nextActionAt is invalid");
      if (ACTIVE_LEAD_STATUSES.includes(input.status) && input.status !== "paused" && !nextActionAt && !before.owner_membership_id) {
        throw new UnprocessableEntityException("An active unowned lead requires a next action or assignment");
      }
      const result = await client.query(
        `UPDATE crm_leads SET status = $1::crm_lead_status,
           disqualification_reason = CASE WHEN $1 = 'disqualified' THEN $2 ELSE NULL END,
           paused_reason = CASE WHEN $1 = 'paused' THEN $2 ELSE NULL END,
           next_action_at = $3,
           qualified_at = CASE WHEN $1 = 'qualified' THEN now() ELSE NULL END,
           qualification_evidence = CASE WHEN $1 = 'qualified' THEN $7::jsonb ELSE NULL END,
           qualification_evidence_hash = CASE WHEN $1 = 'qualified' THEN $8 ELSE NULL END,
           qualified_by = CASE WHEN $1 = 'qualified' THEN $9::uuid ELSE NULL END,
           closed_at = CASE WHEN $1 IN ('qualified', 'disqualified') THEN now() ELSE NULL END,
           version = version + 1
         WHERE id = $4 AND workspace_id = $5 AND version = $6
         RETURNING *`,
        [
          input.status, input.reason?.trim() || null, nextActionAt, leadId, workspaceId, input.version,
          qualification?.evidence ?? null, qualification?.evidenceHash ?? null, actorUser.userId,
        ],
      );
      if (!result.rowCount) throw new ConflictException("Lead changed; reload and try again");
      const response = this.mapLead(result.rows[0] as LeadContext);
      if (input.status === "paused") {
        const paused = await this.slas.pauseFirstResponse(client, workspaceId, leadId, actorUser.userId, input.reason?.trim() || "Lead paused");
        if (paused) {
          await client.query(
            `UPDATE crm_activities SET due_at=NULL,is_next_action=false,version=version+1,updated_at=now()
             WHERE workspace_id=$1 AND sla_instance_id=$2 AND status='pending'`,
            [workspaceId, paused.id],
          );
        }
      } else if (before.status === "paused" && ["new", "attempting_contact"].includes(input.status)) {
        const resumed = await this.slas.resumeFirstResponse(client, workspaceId, leadId, actorUser.userId, "Lead reopened from pause");
        if (resumed) {
          const makeNextAction = !input.nextActionAt;
          await client.query(
            `UPDATE crm_activities SET due_at=$3,is_next_action=$4,version=version+1,updated_at=now()
             WHERE workspace_id=$1 AND sla_instance_id=$2 AND status='pending'`,
            [workspaceId, resumed.id, resumed.warning_at, makeNextAction],
          );
          if (makeNextAction) await client.query(`UPDATE crm_leads SET next_action_at=$3 WHERE workspace_id=$1 AND id=$2`, [workspaceId, leadId, resumed.warning_at]);
        }
      } else if (["connected", "nurturing", "qualified"].includes(input.status)) {
        await this.slas.recordFirstResponse(client, workspaceId, leadId, {
          sourceType: "lead_status",
          sourceId: leadId,
          actorUserId: actorUser.userId,
          respondedAt: new Date(),
          details: { fromStatus: before.status, toStatus: input.status },
        });
      } else if (input.status === "disqualified") {
        const stopped = await this.slas.stopFirstResponse(client, workspaceId, leadId, actorUser.userId, `lead_status_${input.status}`, {
          type: "lead_status",
          fromStatus: before.status,
          toStatus: input.status,
        });
        if (stopped) {
          const completed = ["connected", "nurturing"].includes(input.status);
          await client.query(
            `UPDATE crm_activities SET status=$3::crm_activity_status,
               completed_at=CASE WHEN $3='completed' THEN now() ELSE completed_at END,
               completion_outcome=CASE WHEN $3='completed' THEN 'Lead response recorded' ELSE completion_outcome END,
               is_next_action=false,version=version+1,updated_at=now()
             WHERE workspace_id=$1 AND sla_instance_id=$2 AND status='pending'`,
            [workspaceId, stopped.id, completed ? "completed" : "cancelled"],
          );
          await client.query(
            `UPDATE crm_leads SET next_action_at=(
               SELECT due_at FROM crm_activities
               WHERE workspace_id=$1 AND lead_id=$2 AND status='pending' AND is_next_action
               ORDER BY due_at NULLS LAST,id LIMIT 1
             ) WHERE workspace_id=$1 AND id=$2`,
            [workspaceId, leadId],
          );
        }
      } else if (["qualified", "disqualified"].includes(before.status) && ["new", "attempting_contact"].includes(input.status)) {
        await this.startFirstResponseSla(client, workspaceId, leadId, response.ownerMembershipId as string | null, actorUser.userId, true, "Closed lead reopened for a new response cycle");
      }
      if (["qualified", "disqualified"].includes(input.status)) {
        // Response reconciliation can derive a pending follow-up after the status
        // update. Closed leads keep their activities as history, but no activity or
        // denormalized timestamp may remain as the lead's next action.
        await client.query(
          `UPDATE crm_activities SET is_next_action=false,version=version+1,updated_at=now()
           WHERE workspace_id=$1 AND lead_id=$2 AND status='pending' AND is_next_action`,
          [workspaceId, leadId],
        );
        await client.query(`UPDATE crm_leads SET next_action_at=NULL WHERE workspace_id=$1 AND id=$2`, [workspaceId, leadId]);
        await client.query(`UPDATE crm_enquiries SET status = $3, closed_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = (SELECT enquiry_id FROM crm_leads WHERE workspace_id = $1 AND id = $2)`, [workspaceId, leadId, input.status]);
      } else if (["qualified", "disqualified"].includes(before.status)) {
        // Reopening a lead must reopen the same enquiry as well; history remains in audit events.
        await client.query(`UPDATE crm_enquiries SET status = 'open', closed_at = NULL, version = version + 1 WHERE workspace_id = $1 AND id = (SELECT enquiry_id FROM crm_leads WHERE workspace_id = $1 AND id = $2)`, [workspaceId, leadId]);
      }
      const event = input.status === "qualified"
        ? "crm.lead.qualified.v1"
        : input.status === "disqualified"
          ? "crm.lead.disqualified.v1"
          : "crm.lead.status_changed.v1";
      await this.events.record(client, {
        workspaceId, actorUserId: actorUser.userId, source: "user",
        action: event, entityType: "crm_lead", entityId: leadId,
        before: this.mapLead(before), after: response,
      });
      return response;
    });
  }

  upsertQualification(actor: RequestActor, workspaceId: string, leadId: string, input: UpsertQualificationDto) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.manage", async (client, actorUser) => {
      const lead = await this.requireLead(client, workspaceId, leadId, true);
      if (lead.version !== input.version) throw new ConflictException("Lead changed; reload and try again");
      if (lead.status === "qualified") throw new ConflictException("Reopen the lead before changing its frozen qualification");
      const converted = await client.query(`SELECT 1 FROM crm_opportunities WHERE workspace_id=$1 AND lead_id=$2 LIMIT 1`, [workspaceId, leadId]);
      if (converted.rowCount) throw new ConflictException("This lead has been converted; its qualification evidence is frozen");
      const keys = Object.keys(input.values);
      if (keys.some(key => key === 'requirement_notes' || key.startsWith('requirement_asset_'))) throw new UnprocessableEntityException('Use Requirement notes to edit shared notes.');
      if (keys.length > 200) throw new UnprocessableEntityException("Too many qualification answers");
      const qualificationState = await evaluateQualification(client, workspaceId, leadId, input.values);
      for (const [key, value] of Object.entries(input.values)) {
        if (!/^[a-z][a-z0-9_.-]{0,99}$/.test(key)) throw new UnprocessableEntityException(`Invalid question key: ${key}`);
        await client.query(
          `INSERT INTO crm_lead_qualification_values
            (workspace_id, lead_id, question_key, value, captured_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (workspace_id, lead_id, question_key)
           DO UPDATE SET value = EXCLUDED.value, captured_by = EXCLUDED.captured_by,
                         captured_at = now()`,
          [workspaceId, leadId, key, JSON.stringify(value), actorUser.userId],
        );
      }
      const result = await client.query(
        `UPDATE crm_leads SET fit_score = COALESCE($1, fit_score),
           engagement_score = COALESCE($2, engagement_score), version = version + 1
         WHERE id = $3 AND workspace_id = $4 AND version = $5
         RETURNING *`,
        [input.fitScore ?? null, input.engagementScore ?? null, leadId, workspaceId, input.version],
      );
      if (!result.rowCount) throw new ConflictException("Lead changed; reload and try again");
      const response = this.mapLead(result.rows[0] as LeadContext);
      await this.events.record(client, {
        workspaceId, actorUserId: actorUser.userId, source: "user",
        action: "crm.lead.qualification_updated.v1", entityType: "crm_lead", entityId: leadId,
        after: { ...response, updatedKeys: keys },
      });
      return {
        ...response,
        qualificationState: {
          ready: qualificationState.ready,
          missingRequired: qualificationState.missingRequired,
          selection: qualificationState.evidence.selection,
          form: qualificationState.evidence.form,
          frozen: false,
        },
      };
    });
  }

  private async selectAssignment(client: PoolClient, workspaceId: string, lead: LeadContext, advanceCursor: boolean,
    takeover?: { queueId: string; excludedOwnerId: string }) {
    const policies = takeover ? { rows: [] as Record<string, any>[] } : await client.query<Record<string, any>>(
      `SELECT policy.*, COALESCE(jsonb_agg(jsonb_build_object(
          'id', rule.id, 'queueId', rule.queue_id, 'name', rule.name,
          'priority', rule.priority, 'conditions', rule.conditions
        ) ORDER BY rule.priority) FILTER (WHERE rule.id IS NOT NULL), '[]'::jsonb) AS rules
       FROM crm_assignment_policies policy
       LEFT JOIN crm_assignment_rules rule ON rule.policy_id = policy.id
        AND rule.workspace_id = policy.workspace_id AND rule.status = 'active'
       WHERE policy.workspace_id = $1 AND policy.status = 'active'
       GROUP BY policy.id ORDER BY policy.priority, policy.id`,
      [workspaceId],
    );
    let policy = policies.rows[0];
    if (takeover) policy = { id: null, fallback_queue_id: takeover.queueId, rules: [], preserve_relationship_owner: false };
    if (!policy) {
      const fallback = await client.query<{ id: string }>(
        `SELECT id FROM crm_queues WHERE workspace_id = $1 AND status = 'active' AND is_fallback ORDER BY created_at LIMIT 1`,
        [workspaceId],
      );
      if (!fallback.rowCount) throw new ConflictException("No active assignment policy or fallback queue is configured");
      // A default queue is sufficient for basic auto-assignment. Apply the same
      // availability, capacity and round-robin checks used by custom policies.
      policy = { id: null, fallback_queue_id: fallback.rows[0].id, rules: [], preserve_relationship_owner: false };
    }
    if (policy.preserve_relationship_owner && lead.party_owner_membership_id) {
      const relationshipOwner = await client.query(
        `SELECT membership.id FROM workspace_memberships membership
         WHERE membership.id = $1 AND membership.workspace_id = $2 AND membership.status = 'active'`,
        [lead.party_owner_membership_id, workspaceId],
      );
      if (relationshipOwner.rowCount) {
        return {
          ownerMembershipId: lead.party_owner_membership_id,
          queueId: null,
          ruleId: null,
          explanation: { reason: "eligible_relationship_owner", policyId: policy.id, excluded: [] },
        };
      }
    }
    const context = {
      source: lead.source,
      channel: lead.channel,
      serviceType: lead.service_type,
      intakeMethod: lead.intake_method,
      businessUnitId: lead.business_unit_id,
      locale: lead.preferred_locale,
    };
    const rules = policy.rules as Array<Record<string, any>>;
    const matchedRule = rules.find((rule) => this.matchesRule(rule.conditions ?? {}, context));
    const queueId = String(matchedRule?.queueId ?? policy.fallback_queue_id);
    const candidates = await client.query<Record<string, any>>(
      `SELECT member.membership_id AS "membershipId", account.display_name AS name,
              member.capacity, member.weight, member.skills, member.languages,
              member.territories, member.is_available AS "isAvailable",
              member.unavailable_until AS "unavailableUntil",
              count(active.id)::int AS "activeLoad",
              (count(active.id)::numeric / member.capacity / member.weight) AS "loadRatio"
       FROM crm_effective_queue_members member
       JOIN workspace_memberships membership ON membership.id = member.membership_id
        AND membership.workspace_id = member.workspace_id AND membership.status = 'active'
       JOIN users account ON account.id = membership.user_id AND account.status = 'active'
       LEFT JOIN crm_leads active ON active.owner_membership_id = member.membership_id
        AND active.workspace_id = member.workspace_id
        AND active.status = ANY($3::crm_lead_status[])
       WHERE member.workspace_id = $1 AND member.queue_id = $2
       GROUP BY member.membership_id, account.display_name, member.capacity,
                member.weight, member.skills, member.languages, member.territories,
                member.is_available, member.unavailable_until
       ORDER BY "loadRatio", member.membership_id`,
      [workspaceId, queueId, ACTIVE_LEAD_STATUSES],
    );
    const serviceType = lead.service_type?.toLowerCase();
    const language = lead.preferred_locale?.split("-")[0]?.toLowerCase();
    const eligible = candidates.rows.filter((candidate) => {
      if (takeover?.excludedOwnerId === candidate.membershipId) return false;
      if (!candidate.isAvailable) return false;
      if (candidate.unavailableUntil && new Date(candidate.unavailableUntil) > new Date()) return false;
      if (Number(candidate.activeLoad) >= Number(candidate.capacity)) return false;
      if (serviceType && candidate.skills.length && !candidate.skills.map((value: string) => value.toLowerCase()).includes(serviceType)) return false;
      if (language && candidate.languages.length && !candidate.languages.map((value: string) => value.toLowerCase()).includes(language)) return false;
      return true;
    });
    if (!eligible.length) {
      return {
        ownerMembershipId: null, queueId,
        ruleId: matchedRule?.id ?? null,
        explanation: {
          reason: takeover ? "no_eligible_alternate" : "no_eligible_member", policyId: policy.id,
          ruleId: matchedRule?.id ?? null,
          considered: candidates.rows.map((candidate) => ({
            membershipId: candidate.membershipId,
            activeLoad: candidate.activeLoad,
            capacity: candidate.capacity,
            available: candidate.isAvailable,
          })),
        },
      };
    }
    const bestRatio = Number(eligible[0].loadRatio);
    const tied = eligible.filter((candidate) => Number(candidate.loadRatio) === bestRatio);
    const queue = await client.query<{ round_robin_cursor: number }>(
      `SELECT round_robin_cursor FROM crm_queues WHERE id = $1 AND workspace_id = $2${advanceCursor ? " FOR UPDATE" : ""}`,
      [queueId, workspaceId],
    );
    const cursor = Number(queue.rows[0]?.round_robin_cursor ?? 0);
    const selected = tied[cursor % tied.length];
    if (advanceCursor) {
      await client.query(`UPDATE crm_queues SET round_robin_cursor = round_robin_cursor + 1, version = version + 1 WHERE id = $1 AND workspace_id = $2`, [queueId, workspaceId]);
    }
    return {
      ownerMembershipId: selected.membershipId as string,
      queueId,
      ruleId: matchedRule?.id ?? null,
      explanation: {
        reason: takeover ? "unanswered_takeover" : matchedRule ? "matching_rule" : policy.id ? "policy_fallback" : "workspace_fallback",
        policyId: policy.id, ruleId: matchedRule?.id ?? null, queueId,
        selected: { membershipId: selected.membershipId, activeLoad: selected.activeLoad, capacity: selected.capacity, loadRatio: selected.loadRatio },
        eligible: eligible.map((candidate) => ({ membershipId: candidate.membershipId, activeLoad: candidate.activeLoad, capacity: candidate.capacity })),
      },
    };
  }

  private async requireEligibleOwner(
    client: PoolClient,
    workspaceId: string,
    membershipId: string,
    queueId: string | null,
  ) {
    const eligible = await client.query(
      `SELECT 1
       FROM workspace_memberships membership
       JOIN users account ON account.id=membership.user_id AND account.status='active'
       WHERE membership.workspace_id=$1 AND membership.id=$2 AND membership.status='active'
         AND (SELECT count(DISTINCT permission.code)
              FROM effective_member_roles assigned
              JOIN role_permissions granted ON granted.role_id=assigned.role_id
              JOIN permissions permission ON permission.id=granted.permission_id
              WHERE assigned.workspace_id=membership.workspace_id
                AND assigned.membership_id=membership.id
                AND permission.code=ANY($3::text[]))=$4
         AND ($5::uuid IS NULL OR EXISTS (
           SELECT 1 FROM crm_effective_queue_members queue_member
           WHERE queue_member.workspace_id=membership.workspace_id
             AND queue_member.queue_id=$5 AND queue_member.membership_id=membership.id
             AND queue_member.is_available
             AND (queue_member.unavailable_until IS NULL OR queue_member.unavailable_until<=now())
         ))`,
      [workspaceId, membershipId, ["crm.leads.view", "crm.leads.manage", "crm.activities.manage"], 3, queueId],
    );
    if (!eligible.rowCount) {
      throw new UnprocessableEntityException(
        "Choose an active sales owner with enquiry and follow-up access in the selected queue",
      );
    }
  }

  private async applyAssignment(
    client: PoolClient,
    workspaceId: string,
    lead: LeadContext,
    selection: { ownerMembershipId: string | null; queueId: string | null; ruleId: string | null; explanation: Record<string, unknown> },
    actorUserId: string | null,
    method: string,
    reason: string | null,
  ) {
    if (["qualified", "disqualified"].includes(lead.status)) throw new UnprocessableEntityException("Closed leads cannot be routed. Continue in the opportunity or reopen the lead first.");
    const takeoverPolicy = selection.ownerMembershipId && selection.queueId
      ? await client.query<{ takeover_after_minutes: number | null }>(
        `SELECT takeover_after_minutes FROM crm_queues WHERE workspace_id=$1 AND id=$2 AND status='active'`,
        [workspaceId, selection.queueId],
      ) : null;
    const takeoverMinutes = takeoverPolicy?.rows[0]?.takeover_after_minutes ?? null;
    const result = await client.query(
      `UPDATE crm_leads SET owner_membership_id = $1, queue_id = $2,
         next_action_at = COALESCE(next_action_at, now()),
         ownership_due_at = CASE WHEN $6::integer IS NULL THEN NULL ELSE now() + $6::integer * interval '1 minute' END,
         version = version + 1
       WHERE id = $3 AND workspace_id = $4 AND version = $5
       RETURNING *`,
      [selection.ownerMembershipId, selection.queueId, lead.id, workspaceId, lead.version, takeoverMinutes],
    );
    if (!result.rowCount) throw new ConflictException("Lead changed; reload and try again");
    await client.query(
      `INSERT INTO crm_assignment_history
        (workspace_id, lead_id, previous_owner_membership_id, owner_membership_id,
         queue_id, assignment_method, rule_id, explanation, reason, assigned_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        workspaceId, lead.id, lead.owner_membership_id, selection.ownerMembershipId,
        selection.queueId, method, selection.ruleId, selection.explanation, reason, actorUserId,
      ],
    );
    await client.query(`UPDATE crm_activities SET owner_membership_id = $3, version = version + 1 WHERE workspace_id = $1 AND lead_id = $2 AND opportunity_id IS NULL AND status = 'pending' AND (owner_membership_id IS NULL OR owner_membership_id IS NOT DISTINCT FROM $4::uuid)`, [workspaceId, lead.id, selection.ownerMembershipId, lead.owner_membership_id]);
    await this.slas.transferFirstResponseResponsibility(client, workspaceId, lead.id, {
      ownerMembershipId: selection.ownerMembershipId,
      queueId: selection.queueId,
      actorUserId,
      reason: reason || "Lead responsibility changed",
    });
    if (["new", "attempting_contact"].includes(lead.status)) await this.startFirstResponseSla(client, workspaceId, lead.id, selection.ownerMembershipId, actorUserId);
    const response = this.mapLead(await this.requireLead(client, workspaceId, lead.id, false));
    await this.events.record(client, {
      workspaceId, actorUserId, source: actorUserId ? "user" : "automation",
      action: lead.owner_membership_id ? "crm.lead.reassigned.v1" : "crm.lead.assigned.v1",
      entityType: "crm_lead", entityId: lead.id,
      before: this.mapLead(lead), after: { ...response, assignment: selection },
    });
    await this.notifyLeadAssignment(client, workspaceId, lead.id, Number(response.version), selection);
    return { ...response, assignment: selection };
  }

  private async notifyLeadAssignment(
    client: PoolClient,
    workspaceId: string,
    leadId: string,
    assignmentVersion: number,
    selection: { ownerMembershipId: string | null; queueId: string | null },
  ) {
    const recipients = await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId"
       FROM workspace_memberships membership
       JOIN users account ON account.id=membership.user_id AND account.status='active'
       WHERE membership.workspace_id=$1 AND membership.status='active'
         AND (membership.id=$2::uuid OR ($2::uuid IS NULL AND EXISTS (
           SELECT 1 FROM crm_effective_queue_members member
           WHERE member.workspace_id=$1 AND member.queue_id=$3::uuid
             AND member.membership_id=membership.id AND member.is_available
             AND (member.unavailable_until IS NULL OR member.unavailable_until<=now())
         )))`,
      [workspaceId, selection.ownerMembershipId, selection.queueId],
    );
    const eventType = selection.ownerMembershipId ? "crm.lead.assigned" : "crm.lead.queue_waiting";
    const subject = selection.ownerMembershipId ? "New enquiry assigned" : "New enquiry in your queue";
    const correlationId = randomUUID();
    for (const recipient of recipients.rows) {
      const preference = await client.query<{ enabled: boolean }>(
        `SELECT enabled FROM notification_preferences
         WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2
           AND channel='in_app' AND event_type IN ($3,'crm.lead.*','*')
         ORDER BY CASE event_type WHEN $3 THEN 0 WHEN 'crm.lead.*' THEN 1 ELSE 2 END LIMIT 1`,
        [workspaceId, recipient.userId, eventType],
      );
      if (preference.rows[0]?.enabled === false) continue;
      await client.query(
        `INSERT INTO notifications
          (workspace_id,recipient_type,recipient_id,channel,event_type,status,subject,body,
           deep_link,idempotency_key,correlation_id,delivered_at)
         VALUES ($1,'user',$2,'in_app',$3,'delivered',$4,$5,$6,$7,$8,now())
         ON CONFLICT (workspace_id,idempotency_key) DO NOTHING`,
        [workspaceId, recipient.userId, eventType, subject,
          "Please review this enquiry and record your next action.",
          `/workspace/crm/leads?lead=${leadId}`,
          `crm:assignment:${leadId}:${assignmentVersion}:${recipient.userId}`, correlationId],
      );
    }
  }

  private async startFirstResponseSla(
    client: PoolClient,
    workspaceId: string,
    leadId: string,
    ownerMembershipId: string | null,
    actorUserId: string | null,
    newCycle = false,
    reason = "Lead assigned for first response",
  ) {
    const instance = await this.slas.startFirstResponse(client, workspaceId, leadId, {
      actorUserId,
      ownerMembershipId,
      reason,
      newCycle,
    });
    if (!instance) return null;
    const linked = await client.query<{ id: string; status: string }>(
      `SELECT id,status FROM crm_activities
       WHERE workspace_id=$1 AND sla_instance_id=$2 LIMIT 1 FOR UPDATE`,
      [workspaceId, instance.id],
    );
    const next = await client.query<{ id: string; due_at: Date | null }>(
      `SELECT id,due_at FROM crm_activities
       WHERE workspace_id=$1 AND lead_id=$2 AND is_next_action AND status='pending' LIMIT 1 FOR UPDATE`,
      [workspaceId, leadId],
    );
    const currentNext = next.rows[0];
    const makeNextAction = !currentNext
      || currentNext.id === linked.rows[0]?.id
      || !currentNext.due_at
      || instance.warningAt < new Date(currentNext.due_at);
    if (makeNextAction && currentNext && currentNext.id !== linked.rows[0]?.id) {
      await client.query(
        `UPDATE crm_activities SET is_next_action=false,version=version+1,updated_at=now()
         WHERE workspace_id=$1 AND id=$2 AND status='pending'`,
        [workspaceId, currentNext.id],
      );
    }
    let responseTask: { rows: { id: string }[]; rowCount: number | null } = linked;
    if (linked.rowCount) {
      responseTask = await client.query<{ id: string }>(
        `UPDATE crm_activities SET status='pending',completed_at=NULL,completion_outcome=NULL,
           owner_membership_id=$3,priority='high',due_at=$4,
           is_next_action=$5,version=version+1,updated_at=now()
         WHERE workspace_id=$1 AND id=$2 RETURNING id`,
        [workspaceId, linked.rows[0].id, instance.ownerMembershipId, instance.warningAt, makeNextAction],
      );
    } else {
      responseTask = await client.query<{ id: string }>(
        `INSERT INTO crm_activities
        (workspace_id, lead_id, sla_instance_id, type, title, owner_membership_id,
         priority, due_at, is_next_action, created_by, party_id)
       SELECT $1,$2,$6,'task','Respond to new enquiry',$3,'high',$4,$7,$5,party_id
       FROM crm_leads WHERE workspace_id=$1 AND id=$2
       ON CONFLICT (workspace_id,sla_instance_id) WHERE sla_instance_id IS NOT NULL DO NOTHING
       RETURNING id`,
        [workspaceId, leadId, instance.ownerMembershipId, instance.warningAt, actorUserId, instance.id, makeNextAction],
      );
    }
    if (responseTask.rowCount || currentNext) {
      await client.query(
        `UPDATE crm_leads SET next_action_at=(
           SELECT due_at FROM crm_activities
           WHERE workspace_id=$1 AND lead_id=$2 AND status='pending' AND is_next_action
           ORDER BY due_at NULLS LAST,id LIMIT 1
         ) WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, leadId],
      );
    }
    return instance;
  }

  private async escalateFirstResponseTask(
    client: PoolClient,
    workspaceId: string,
    input: {
      instanceId: string;
      leadId: string;
      ownerMembershipId: string | null;
      queueId: string | null;
      dueAt: Date;
      level: "warning" | "breach";
    },
  ) {
    const priority = input.level === "breach" ? "urgent" : "high";
    let task = await client.query<{ id: string }>(
      `UPDATE crm_activities SET owner_membership_id=$3,priority=$4,due_at=$5,
         version=version+1,updated_at=now()
       WHERE workspace_id=$1 AND sla_instance_id=$2 AND status='pending'
       RETURNING id`,
      [workspaceId, input.instanceId, input.ownerMembershipId, priority, input.dueAt],
    );
    if (!task.rowCount) {
      task = await client.query<{ id: string }>(
        `INSERT INTO crm_activities(
           workspace_id,lead_id,sla_instance_id,type,title,owner_membership_id,
           priority,due_at,is_next_action,party_id
         )
         SELECT $1,$2,$3,'task','Respond to new enquiry',$4,$5,$6,false,party_id
         FROM crm_leads WHERE workspace_id=$1 AND id=$2
         ON CONFLICT (workspace_id,sla_instance_id) WHERE sla_instance_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [workspaceId, input.leadId, input.instanceId, input.ownerMembershipId, priority, input.dueAt],
      );
    }
    if (!task.rowCount) {
      task = await client.query<{ id: string }>(
        `UPDATE crm_activities SET status='pending',completed_at=NULL,completion_outcome=NULL,
           owner_membership_id=$3,priority=$4,due_at=$5,is_next_action=false,
           version=version+1,updated_at=now()
         WHERE workspace_id=$1 AND sla_instance_id=$2 RETURNING id`,
        [workspaceId, input.instanceId, input.ownerMembershipId, priority, input.dueAt],
      );
    }
    if (task.rowCount) {
      await client.query(
        `UPDATE crm_activities SET is_next_action=false,version=version+1,updated_at=now()
         WHERE workspace_id=$1 AND lead_id=$2 AND status='pending' AND is_next_action AND id<>$3`,
        [workspaceId, input.leadId, task.rows[0].id],
      );
      await client.query(
        `UPDATE crm_activities SET is_next_action=true,version=version+1,updated_at=now()
         WHERE workspace_id=$1 AND id=$2 AND status='pending'`,
        [workspaceId, task.rows[0].id],
      );
      await client.query(
        `UPDATE crm_leads SET next_action_at=$3,updated_at=now()
         WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, input.leadId, input.dueAt],
      );
    }
    return {
      level: input.level,
      taskId: task.rows[0]?.id ?? null,
      ownerMembershipId: input.ownerMembershipId,
      queueId: input.queueId,
      dueAt: input.dueAt,
    };
  }

  private matchesRule(conditions: Record<string, unknown>, context: Record<string, unknown>): boolean {
    const allowed = new Set(["source", "channel", "serviceType", "intakeMethod", "businessUnitId", "locale"]);
    for (const [key, expected] of Object.entries(conditions)) {
      if (!allowed.has(key)) return false;
      const actual = context[key];
      if (Array.isArray(expected)) {
        if (!expected.map(String).map((value) => value.toLowerCase()).includes(String(actual ?? "").toLowerCase())) return false;
      } else if (String(expected ?? "").toLowerCase() !== String(actual ?? "").toLowerCase()) {
        return false;
      }
    }
    return true;
  }

  private assertRuleConditions(conditions: Record<string, unknown>) {
    const allowed = new Set(["source", "channel", "serviceType", "intakeMethod", "businessUnitId", "locale"]);
    for (const [key, value] of Object.entries(conditions)) {
      if (!allowed.has(key)) throw new UnprocessableEntityException(`Unsupported assignment condition: ${key}`);
      if (!(typeof value === "string" || (Array.isArray(value) && value.every((item) => typeof item === "string")))) {
        throw new UnprocessableEntityException(`Assignment condition ${key} must be a string or string array`);
      }
    }
  }

  private async requireLead(client: PoolClient, workspaceId: string, leadId: string, lock: boolean): Promise<LeadContext> {
    const result = await client.query<LeadContext>(
      `SELECT lead.*, enquiry.source, enquiry.channel, enquiry.service_type,
              intake.business_unit_id, intake.intake_method, party.preferred_locale,
              party.owner_membership_id AS party_owner_membership_id
       FROM crm_leads lead
       JOIN crm_enquiries enquiry ON enquiry.id = lead.enquiry_id AND enquiry.workspace_id = lead.workspace_id
       JOIN crm_intake_events intake ON intake.id = enquiry.intake_event_id AND intake.workspace_id = lead.workspace_id
       JOIN crm_parties party ON party.id = lead.party_id AND party.workspace_id = lead.workspace_id
       WHERE lead.id = $1 AND lead.workspace_id = $2${lock ? " FOR UPDATE OF lead" : ""}`,
      [leadId, workspaceId],
    );
    if (!result.rowCount) throw new NotFoundException("Lead not found");
    return { ...result.rows[0], version: Number(result.rows[0].version) };
  }

  private mapLead(row: LeadContext): Record<string, unknown> {
    const source = row as unknown as Record<string, unknown>;
    return {
      id: row.id,
      partyId: row.party_id,
      status: row.status,
      duplicateOfLeadId: source.duplicate_of_lead_id ?? null,
      ownerMembershipId: row.owner_membership_id,
      queueId: row.queue_id,
      priority: source.priority,
      fitScore: source.fit_score,
      engagementScore: source.engagement_score,
      nextActionAt: source.next_action_at,
      ownershipDueAt: source.ownership_due_at ?? null,
      disqualificationReason: source.disqualification_reason,
      pausedReason: source.paused_reason,
      qualifiedAt: source.qualified_at,
      qualificationEvidence: source.qualification_evidence,
      qualificationEvidenceHash: source.qualification_evidence_hash,
      qualifiedBy: source.qualified_by,
      closedAt: source.closed_at,
      createdAt: source.created_at,
      updatedAt: source.updated_at,
      version: Number(row.version),
    };
  }

  private async requireQueue(client: PoolClient, workspaceId: string, queueId: string) {
    const result = await client.query(`SELECT 1 FROM crm_queues WHERE id = $1 AND workspace_id = $2 AND status = 'active'`, [queueId, workspaceId]);
    if (!result.rowCount) throw new UnprocessableEntityException("Queue is not active");
  }
}
