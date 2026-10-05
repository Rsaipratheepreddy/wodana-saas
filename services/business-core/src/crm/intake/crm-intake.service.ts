import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { DatabaseService } from "../../database/database.service";
import { ensureJobForSource } from "../../jobs/job-identity.store";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { assertClientIdentityChange, nameChanged, phoneChanged } from "../shared/client-identity-lock";
import {
  canonicalHash,
  correlationId,
  decodeCursor,
  encodeCursor,
  normalizeEmail,
  normalizeLoosePhone,
  normalizeName,
  stableHash,
} from "../shared/crm-types";
import {
  CreateIntakeEventDto,
  FailIntakeDto,
  ListEnquiriesQueryDto,
  ListIntakeQueryDto,
  ReviewDuplicateDto,
  UpdateLeadDetailsDto,
} from "./dto/intake.dto";

import { CrmLeadsService } from "../leads/crm-leads.service";
import { loadLeadOptions, validateLeadOptions } from "../leads/lead-options";
import { assertCustomerType, assertSourceAllowed, resolveReferral } from "../leads/intake-rules";
import { classifyRepeat } from "../leads/repeat-rules";
import { notifyUserInApp } from "../../notifications/default-templates";
import { enquiryTitle, refreshEnquiryTitlesForParty } from "../leads/enquiry-title";
import { countryFromLocale, needsWorkspacePhoneCountry, normalizeIntakePartyPhones } from "./intake-phone";
import { recordClientMessageSkipped, sendClientEvent } from "../conversations/inbox/client-messages";
import { loadSalesSettings, salesSchedule } from "../leads/sales-attention";
import { addSlaMinutes } from "../leads/sla-schedule";
import { memberRoleKeys } from "../../workspaces/role-vocabulary";
import { teamRolesByEnquiryType, teamRolesForType, writeLeadTeam } from "../leads/lead-team";
import { loadRequirementRows, ProblemList, requirementContext, requirementProblems, rulesByType, type EnquiryFacts } from "../leads/enquiry-problems";
import { canReadNotes, notesReader, redactNotes } from "../leads/internal-notes";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

@Injectable()
export class CrmIntakeService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
    private readonly leads: CrmLeadsService,
  ) {}

  /** The workspace's choices, and the caller's roles and teams in the one role vocabulary (sources limited to roles compare against them). */
  options(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.view", async (client, actorUser) => {
      const options = await loadLeadOptions(client, workspaceId);
      return {
        ...options,
        // PLM-100: the team roles each enquiry type asks for, from its own steps.
        teamRoles: await teamRolesByEnquiryType(client, workspaceId, options.enquiryTypes),
        // PLM-096: the fields each enquiry type requires, and from which gate.
        requirements: rulesByType(await loadRequirementRows(client, workspaceId), options.enquiryTypes.map((type) => type.id)),
        roleKeys: await memberRoleKeys(client, workspaceId, actorUser.userId),
      };
    });
  }

  /** PLM-096: what the enquiry form must hold when it is created or saved, for its enquiry type (gate `create`). */
  private async createProblems(client: PoolClient, workspaceId: string, input: Pick<CreateIntakeEventDto, "serviceType" | "summary" | "party" | "details" | "team">) {
    const answered = new Set((input.team ?? []).filter((entry) => entry.membershipId || entry.notApplicable).map((entry) => entry.role));
    const details = (input.details ?? {}) as unknown as Record<string, unknown>;
    const text = (value: unknown) => typeof value === "string" ? value : null;
    const facts: EnquiryFacts = {
      serviceType: input.serviceType ?? null, summary: input.summary ?? null, email: text(input.party?.email),
      area: text(details.area) || text(details.location), address: text(input.party?.address), budgetRange: text(details.budgetRange), customerType: text(details.customerType),
      team: answered, custom: new Set(),
    };
    const roles = await teamRolesForType(client, workspaceId, input.serviceType ?? null);
    return requirementProblems(facts, await requirementContext(client, workspaceId, input.serviceType ?? null, roles), "create");
  }

  updateDetails(actor: RequestActor, workspaceId: string, leadId: string, input: UpdateLeadDetailsDto) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.manage", async (client, actorUser) => {
      // PLM-092: every problem at once, each with its field; PLM-096: what this enquiry type requires from the start.
      new ProblemList()
        .when(!input.party?.displayName?.trim(), "displayName", "Enter a customer name")
        .when(!input.party?.mobile?.trim(), "mobile", "Enter a mobile number")
        .when(input.party?.email?.trim() && !/^\S+@\S+\.\S+$/.test(input.party.email.trim()), "email", "Enter a valid email")
        .addAll(await this.createProblems(client, workspaceId, input as never))
        .throwIfAny();
      const workspaceCountry = needsWorkspacePhoneCountry(input.party)
        ? countryFromLocale((await client.query<{ defaultLocale: string }>(`SELECT default_locale AS "defaultLocale" FROM workspaces WHERE id=$1`, [workspaceId])).rows[0]?.defaultLocale)
        : undefined;
      const party = normalizeIntakePartyPhones(input.party, workspaceCountry);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${workspaceId}:crm-identity`]);
      const found = await client.query(`SELECT lead.version, lead.party_id, lead.enquiry_id, enquiry.title,
        enquiry.reference, enquiry.summary, enquiry.service_type, enquiry.source, enquiry.channel, enquiry.details,
        CASE WHEN enquiry.referral_kind IS NULL THEN NULL ELSE jsonb_build_object('name', enquiry.referral_name, 'contact', enquiry.referral_contact,
          'membershipId', enquiry.referral_membership_id, 'option', enquiry.referral_option) END AS referral,
        (SELECT party.display_name FROM crm_parties party WHERE party.workspace_id=lead.workspace_id AND party.id=lead.party_id) AS party_name FROM crm_leads lead
        JOIN crm_enquiries enquiry ON enquiry.id=lead.enquiry_id AND enquiry.workspace_id=lead.workspace_id
        WHERE lead.workspace_id=$1 AND lead.id=$2 FOR UPDATE OF lead, enquiry`, [workspaceId, leadId]);
      if (!found.rowCount) throw new NotFoundException("Lead not found");
      const before = found.rows[0];
      if (Number(before.version) !== input.version) throw new ConflictException("Lead changed; reload before saving");
      // The client's name and phones are their identity: only those who may change it do (Sales edits everything else).
      await assertClientIdentityChange(this.access, client, workspaceId, actorUser.userId, nameChanged(before.party_name, party.displayName)
        || await this.phonesChanged(client, workspaceId, before.party_id, party));
      await validateLeadOptions(client, workspaceId, input, { serviceType: before.service_type, details: before.details });
      if (input.source && input.source !== before.source) await assertSourceAllowed(client, workspaceId, actorUser.userId, input.source);
      await assertCustomerType(client, workspaceId, input.details?.customerType ?? before.details?.customerType);
      const nextSource = input.source ?? before.source, nextChannel = input.source ? input.channel! : before.channel;
      // Keep the stored referrer when the edit does not touch it; re-check it when the source or referrer changes.
      const referral = input.referral || input.source ? await resolveReferral(client, workspaceId, nextSource, nextChannel, input.referral ?? before.referral) : undefined;
      // PLM-024: someone who can't read the internal notes can't change them either; they stay as they are.
      const leadOwner = (await client.query<{ owner: string | null }>(`SELECT owner_membership_id AS owner FROM crm_leads WHERE workspace_id=$1 AND id=$2`, [workspaceId, leadId])).rows[0]?.owner ?? null;
      const notesVisible = canReadNotes(await this.notesReaderFor(client, workspaceId, actorUser.userId, [leadId]), { id: leadId, ownerMembershipId: leadOwner });
      const details = { ...before.details, ...redactNotes(input.details, notesVisible), contact: party };
      const source = input.source ?? before.source, channel = input.source ? input.channel : before.channel;
      await client.query(`UPDATE crm_enquiries SET summary=$3, service_type=$4, details=$5, source=$6, channel=$7,
        version=version+1, updated_at=now() WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, before.enquiry_id, input.summary ?? null, input.serviceType, details, source, channel]);
      if (referral !== undefined) {
        await client.query(`UPDATE crm_enquiries SET referral_kind=$3, referral_name=$4, referral_contact=$5, referral_membership_id=$6, referral_option=$7
          WHERE workspace_id=$1 AND id=$2`, [workspaceId, before.enquiry_id, referral?.kind ?? null, referral?.name ?? null, referral?.contact ?? null, referral?.membershipId ?? null, referral?.option ?? null]);
      }
      await client.query(`UPDATE crm_parties SET display_name=$3, normalized_name=$4, version=version+1,
        updated_at=now() WHERE workspace_id=$1 AND id=$2`, [workspaceId, before.party_id, party.displayName.trim(), normalizeName(party.displayName)]);
      await refreshEnquiryTitlesForParty(client, workspaceId, before.party_id, party.displayName);
      await client.query(`UPDATE crm_person_profiles SET job_title=$3 WHERE workspace_id=$1 AND party_id=$2`, [workspaceId, before.party_id, party.jobPosition ?? null]);
      for (const [label, raw] of [["email", party.email], ["mobile", party.mobile], ["phone", party.phone]]) {
        const type = label === "email" ? "email" : "phone";
        const value = raw?.trim() || null;
        const normalized = value ? type === "email" ? normalizeEmail(value) : normalizeLoosePhone(value) : null;
        if (value && type === "email" && !/^\S+@\S+\.\S+$/.test(value)) throw new UnprocessableEntityException("Enter a valid email");
        const prior = await client.query(`SELECT id, normalized_value FROM crm_contact_points WHERE workspace_id=$1 AND party_id=$2
          AND type=$3::crm_contact_point_type AND status='active' AND (label=$4 OR (label IS NULL AND $4<>'mobile'))
          ORDER BY is_primary DESC, created_at LIMIT 1 FOR UPDATE`, [workspaceId, before.party_id, type, label]);
        if (prior.rowCount && prior.rows[0].normalized_value === normalized && value) continue;
        if (normalized) {
          const duplicate = await client.query(`SELECT 1 FROM crm_contact_points WHERE workspace_id=$1 AND party_id<>$2
            AND type=$3::crm_contact_point_type AND normalized_value=$4 AND status='active' LIMIT 1`, [workspaceId, before.party_id, type, normalized]);
          if (duplicate.rowCount) throw new ConflictException("This contact belongs to another customer. Review the existing customer before changing it here.");
        }
        if (prior.rowCount) await client.query(`UPDATE crm_contact_points SET status='archived', is_primary=false, version=version+1 WHERE workspace_id=$1 AND id=$2`, [workspaceId, prior.rows[0].id]);
        if (value) await client.query(`INSERT INTO crm_contact_points (workspace_id,party_id,type,label,raw_value,normalized_value,country_code,is_primary,invalid_reason)
          VALUES ($1,$2,$3::crm_contact_point_type,$4,$5,$6,$7,false,$8)`, [workspaceId, before.party_id, type, label, value, normalized, label === "mobile" ? party.mobileCountryCode ?? null : label === "phone" ? party.phoneCountryCode ?? null : null, normalized ? null : "unresolved_phone"]);
      }
      // PLM-100: the team tagged on the enquiry (a member per role, or Not applicable).
      const teamChanged = await writeLeadTeam(client, workspaceId, leadId, input.team, actorUser.userId);
      const result = await client.query(`UPDATE crm_leads SET version=version+1, updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING version`, [workspaceId, leadId]);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user",
        action: "crm.lead.details_updated.v1", entityType: "crm_lead", entityId: leadId,
        before, after: { serviceType: input.serviceType, summary: input.summary, source, channel, details, referral, ...(teamChanged.length ? { team: input.team } : {}) } });
      return { id: leadId, version: result.rows[0].version };
    });
  }

  /** Whether the edit changes a mobile or phone the client already has (adding a missing one is not a change). */
  private async phonesChanged(client: PoolClient, workspaceId: string, partyId: string, party: { mobile?: string | null; phone?: string | null }) {
    for (const [label, raw] of [["mobile", party.mobile], ["phone", party.phone]] as const) {
      const prior = await client.query<{ normalized_value: string | null; raw_value: string | null }>(`SELECT normalized_value, raw_value FROM crm_contact_points WHERE workspace_id=$1 AND party_id=$2
        AND type='phone'::crm_contact_point_type AND status='active' AND (label=$3 OR (label IS NULL AND $3<>'mobile'))
        ORDER BY is_primary DESC, created_at LIMIT 1`, [workspaceId, partyId, label]);
      const stored = prior.rows[0];
      if (!stored) continue;
      if (phoneChanged(stored.normalized_value ?? stored.raw_value, raw?.trim() || null)) return true;
    }
    return false;
  }

  listEnquiries(actor: RequestActor, workspaceId: string, query: ListEnquiriesQueryDto) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.view", async (client, actorUser) => {
      const cursor = this.intakeCursor(query.cursor);
      const values: unknown[] = [workspaceId];
      const clauses = ["enquiry.workspace_id = $1"];
      for (const [column, value] of [
        ["party_id", query.partyId], ["status", query.status],
        ["source", query.source], ["channel", query.channel],
      ] as const) {
        if (value) {
          values.push(value);
          clauses.push(`enquiry.${column} = $${values.length}`);
        }
      }
      if (cursor) {
        values.push(cursor.value, cursor.id);
        clauses.push(`(enquiry.received_at, enquiry.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
      }
      values.push(query.limit + 1);
      const result = await client.query(
        `SELECT enquiry.id, enquiry.party_id AS "partyId", party.display_name AS "partyName",
                enquiry.intake_event_id AS "intakeEventId", enquiry.reference, enquiry.details, enquiry.title, enquiry.summary,
                enquiry.service_type AS "serviceType", enquiry.source, enquiry.channel,
                enquiry.status, enquiry.received_at AS "receivedAt", enquiry.closed_at AS "closedAt",
                enquiry.version, lead.id AS "leadId", lead.status AS "leadStatus",
                lead.owner_membership_id AS "ownerMembershipId"
         FROM crm_enquiries enquiry
         JOIN crm_parties party ON party.workspace_id = enquiry.workspace_id AND party.id = enquiry.party_id
         LEFT JOIN crm_leads lead ON lead.workspace_id = enquiry.workspace_id AND lead.enquiry_id = enquiry.id
         WHERE ${clauses.join(" AND ")}
         ORDER BY enquiry.received_at DESC, enquiry.id DESC
         LIMIT $${values.length}`,
        values,
      );
      const hasMore = result.rows.length > query.limit;
      const page = hasMore ? result.rows.slice(0, query.limit) : result.rows;
      // PLM-024: internal notes only for those who may read them.
      const reader = await this.notesReaderFor(client, workspaceId, actorUser.userId, page.map((row) => row.leadId).filter(Boolean));
      const data = page.map((row) => ({ ...row, details: redactNotes(row.details, canReadNotes(reader, { id: row.leadId, ownerMembershipId: row.ownerMembershipId })) }));
      const last = data.at(-1) as { id: string; receivedAt: Date } | undefined;
      return {
        data,
        nextCursor: hasMore && last
          ? encodeCursor({ value: new Date(last.receivedAt).toISOString(), id: last.id })
          : null,
      };
    });
  }

  getEnquiry(actor: RequestActor, workspaceId: string, enquiryId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.view", async (client, actorUser) => {
      const result = await client.query<Record<string, unknown>>(
        `SELECT enquiry.id, enquiry.party_id AS "partyId", party.display_name AS "partyName",
                enquiry.intake_event_id AS "intakeEventId", enquiry.reference, enquiry.details, enquiry.title, enquiry.summary,
                enquiry.service_type AS "serviceType", enquiry.source, enquiry.channel,
                enquiry.status, enquiry.received_at AS "receivedAt", enquiry.closed_at AS "closedAt",
                enquiry.version, enquiry.created_at AS "createdAt", enquiry.updated_at AS "updatedAt",
                intake.intake_method AS "intakeMethod", intake.external_event_id AS "externalEventId",
                intake.payload_reference AS "payloadReference", intake.correlation_id AS "correlationId",
                CASE WHEN lead.id IS NULL THEN NULL ELSE jsonb_build_object(
                  'id', lead.id, 'status', lead.status,
                  'ownerMembershipId', lead.owner_membership_id, 'queueId', lead.queue_id,
                  'fitScore', lead.fit_score, 'engagementScore', lead.engagement_score,
                  'version', lead.version
                ) END AS lead
         FROM crm_enquiries enquiry
         JOIN crm_parties party ON party.workspace_id = enquiry.workspace_id AND party.id = enquiry.party_id
         JOIN crm_intake_events intake ON intake.workspace_id = enquiry.workspace_id AND intake.id = enquiry.intake_event_id
         LEFT JOIN crm_leads lead ON lead.workspace_id = enquiry.workspace_id AND lead.enquiry_id = enquiry.id
         WHERE enquiry.workspace_id = $1 AND enquiry.id = $2`,
        [workspaceId, enquiryId],
      );
      if (!result.rowCount) throw new NotFoundException("Enquiry not found");
      const attribution = await client.query(
        `SELECT id, source, medium, campaign, content, term, referrer,
                external_click_id AS "externalClickId", touched_at AS "touchedAt", metadata
         FROM crm_attribution_touches WHERE workspace_id = $1 AND enquiry_id = $2
         ORDER BY touched_at, id`,
        [workspaceId, enquiryId],
      );
      const lead = result.rows[0].lead as { id?: string; ownerMembershipId?: string | null } | null;
      const reader = await this.notesReaderFor(client, workspaceId, actorUser.userId, lead?.id ? [lead.id] : []);
      return { ...result.rows[0], details: redactNotes(result.rows[0].details, canReadNotes(reader, { id: lead?.id, ownerMembershipId: lead?.ownerMembershipId })), attribution: attribution.rows };
    });
  }

  private async notesReaderFor(client: PoolClient, workspaceId: string, userId: string, leadIds: string[]) {
    return notesReader(client, workspaceId, userId, await this.access.hasPermission(client, workspaceId, userId, "crm.leads.assign"), leadIds);
  }

  list(actor: RequestActor, workspaceId: string, query: ListIntakeQueryDto) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.view", async (client) => {
      const cursor = this.intakeCursor(query.cursor);
      const values: unknown[] = [workspaceId];
      const clauses = ["intake.workspace_id = $1"];
      if (query.status) {
        values.push(query.status);
        clauses.push(`intake.status = $${values.length}::crm_intake_status`);
      }
      if (cursor) {
        values.push(cursor.value, cursor.id);
        clauses.push(`(intake.received_at, intake.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
      }
      values.push(query.limit + 1);
      const result = await client.query(
        `SELECT intake.id, intake.source, intake.channel,
                intake.intake_method AS "intakeMethod",
                intake.external_event_id AS "externalEventId", intake.status,
                intake.failure_code AS "failureCode", intake.failure_message AS "failureMessage",
                intake.correlation_id AS "correlationId", intake.received_at AS "receivedAt",
                intake.processed_at AS "processedAt", intake.version,
                intake.resolution_type AS "resolutionType",
                intake.resolved_party_id AS "resolvedPartyId", intake.resolved_at AS "resolvedAt",
                enquiry.id AS "enquiryId", enquiry.title,
                enquiry.party_id AS "partyId", lead.id AS "leadId",
                (SELECT count(*)::int FROM crm_identity_candidates candidate
                  WHERE candidate.workspace_id=intake.workspace_id
                    AND candidate.intake_event_id = intake.id AND candidate.status = 'pending') AS "candidateCount"
         FROM crm_intake_events intake
         LEFT JOIN crm_enquiries enquiry ON enquiry.intake_event_id = intake.id
           AND enquiry.workspace_id = intake.workspace_id
         LEFT JOIN crm_leads lead ON lead.enquiry_id = enquiry.id
           AND lead.workspace_id = intake.workspace_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY intake.received_at DESC, intake.id DESC
         LIMIT $${values.length}`,
        values,
      );
      const hasMore = result.rows.length > query.limit;
      const data = hasMore ? result.rows.slice(0, query.limit) : result.rows;
      const last = data.at(-1) as { id: string; receivedAt: Date } | undefined;
      return {
        data,
        nextCursor: hasMore && last
          ? encodeCursor({ value: new Date(last.receivedAt).toISOString(), id: last.id })
          : null,
      };
    });
  }

  get(actor: RequestActor, workspaceId: string, intakeEventId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.view", async (client, actorUser) => {
      const result = await client.query(`SELECT id,status,source,channel,original_payload AS payload,version,
        resolution_type AS "resolutionType",resolved_party_id AS "resolvedPartyId",
        resolved_at AS "resolvedAt",resolution_evidence AS "resolutionEvidence"
        FROM crm_intake_events WHERE workspace_id = $1 AND id = $2`, [workspaceId, intakeEventId]);
      if (!result.rowCount) throw new NotFoundException("Intake event not found");
      const candidates = await client.query(`SELECT candidate.id,candidate.candidate_party_id AS "partyId",
        party.display_name AS "partyName",party.status AS "partyStatus",candidate.strength,candidate.score,
        candidate.reasons,candidate.status,candidate.decision,
        candidate.resolved_party_id AS "resolvedPartyId",candidate.reviewed_at AS "reviewedAt",
        candidate.decision_reason AS "decisionReason",candidate.version
        FROM crm_identity_candidates candidate
        JOIN crm_parties party ON party.id = candidate.candidate_party_id AND party.workspace_id = candidate.workspace_id
        WHERE candidate.workspace_id = $1 AND candidate.intake_event_id = $2
        ORDER BY candidate.score DESC,candidate.id`, [workspaceId, intakeEventId]);
      // PLM-024: the submission's internal notes follow the enquiry's rule.
      const lead = (await client.query<{ id: string; ownerMembershipId: string | null }>(
        `SELECT lead.id, lead.owner_membership_id AS "ownerMembershipId" FROM crm_enquiries enquiry JOIN crm_leads lead ON lead.workspace_id = enquiry.workspace_id AND lead.enquiry_id = enquiry.id
          WHERE enquiry.workspace_id = $1 AND enquiry.intake_event_id = $2 LIMIT 1`, [workspaceId, intakeEventId])).rows[0];
      const visible = canReadNotes(await this.notesReaderFor(client, workspaceId, actorUser.userId, lead ? [lead.id] : []), { id: lead?.id, ownerMembershipId: lead?.ownerMembershipId });
      const payload = result.rows[0].payload;
      return { ...result.rows[0], payload: payload && typeof payload === "object" ? { ...payload, details: redactNotes(payload.details, visible) } : payload, candidates: candidates.rows };
    });
  }

  createManual(
    actor: RequestActor,
    workspaceId: string,
    idempotencyKey: string | undefined,
    requestedCorrelationId: string | undefined,
    input: CreateIntakeEventDto,
  ) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.manage", async (client, actorUser) => {
      // Routing decides for itself, and a salesperson may own what they bring in (LF-1); giving an
      // enquiry to someone else needs the assignment permission.
      const owner = input.assignment?.mode === "manual" ? input.assignment.ownerMembershipId : undefined;
      if (owner) {
        const own = await client.query(
          `SELECT 1 FROM workspace_memberships WHERE workspace_id=$1 AND id=$2 AND user_id=$3 AND status='active'`,
          [workspaceId, owner, actorUser.userId]);
        if (!own.rowCount && !await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.leads.assign")) {
          throw new ForbiddenException("Lead assignment permission is required");
        }
      }
      await validateLeadOptions(client, workspaceId, input);
      await assertSourceAllowed(client, workspaceId, actorUser.userId, input.source);
      await assertCustomerType(client, workspaceId, input.details?.customerType);
      const referral = await resolveReferral(client, workspaceId, input.source, input.channel, input.referral);
      return this.ingest(client, workspaceId, actorUser.userId, "user", idempotencyKey, requestedCorrelationId, { ...input, referral: referral ?? undefined } as CreateIntakeEventDto);
    });
  }

  createFormIntake(client: PoolClient, workspaceId: string, key: string, input: CreateIntakeEventDto) {
    return this.ingest(client, workspaceId, null, "integration", key, undefined, input);
  }

  createInternal(
    workspaceId: string,
    idempotencyKey: string | undefined,
    requestedCorrelationId: string | undefined,
    input: CreateIntakeEventDto,
  ) {
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async client => {
      const controlled = { ...input, assignment: input.assignment ?? { mode: "automatic" } };
      await validateLeadOptions(client, workspaceId, controlled);
      return this.ingest(client, workspaceId, null, "integration", idempotencyKey, requestedCorrelationId, controlled);
    });
  }

  reviewDuplicate(
    actor: RequestActor,
    workspaceId: string,
    candidateId: string,
    input: ReviewDuplicateDto,
  ) {
    return this.access.withPermission(actor, workspaceId, "crm.parties.merge", async (client, actorUser) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${workspaceId}:crm-identity`]);
      const found = await client.query<Record<string, any>>(
        `SELECT candidate.*, intake.original_payload, intake.source, intake.channel,
                intake.intake_method, intake.received_at, intake.legal_entity_id,
                intake.business_unit_id, intake.version AS intake_version,
                intake.status AS intake_status, intake.correlation_id
         FROM crm_identity_candidates candidate
         JOIN crm_intake_events intake ON intake.id = candidate.intake_event_id
           AND intake.workspace_id = candidate.workspace_id
         WHERE candidate.id = $1 AND candidate.workspace_id = $2 FOR UPDATE OF candidate, intake`,
        [candidateId, workspaceId],
      );
      if (!found.rowCount) throw new NotFoundException("Duplicate candidate not found");
      const candidate = found.rows[0];
      if (candidate.status !== "pending") {
        return this.duplicateDecisionReplay(client, workspaceId, candidateId, candidate, input);
      }
      if (candidate.intake_status !== "duplicate_candidate") {
        throw new ConflictException("Intake is no longer awaiting duplicate review");
      }
      if (Number(candidate.version) !== input.version) throw new ConflictException("Candidate changed; reload and try again");
      if (input.decision === "attach" && !input.partyId) {
        throw new UnprocessableEntityException("partyId is required when attaching");
      }
      if (input.decision !== "attach" && input.partyId) {
        throw new UnprocessableEntityException("partyId is only allowed when attaching to an existing customer");
      }
      const reason = input.reason?.trim() || null;
      if (["create_new", "reject"].includes(input.decision) && !reason) {
        throw new UnprocessableEntityException("A review reason is required for this decision");
      }
      if (input.decision === "reject") {
        const rejected = await client.query(
          `UPDATE crm_identity_candidates SET status='rejected',decision='reject',resolved_party_id=NULL,
             reviewed_by=$1,reviewed_at=now(),decision_reason=$2,version=version+1,updated_at=now()
           WHERE workspace_id=$3 AND id=$4 AND status='pending' AND version=$5 RETURNING version`,
          [actorUser.userId, reason, workspaceId, candidateId, input.version],
        );
        if (!rejected.rowCount) throw new ConflictException("Candidate changed; reload and try again");
        const pending = await client.query(`SELECT 1 FROM crm_identity_candidates WHERE workspace_id = $1 AND intake_event_id = $2 AND status = 'pending' LIMIT 1`, [workspaceId, candidate.intake_event_id]);
        if (!pending.rowCount) throw new UnprocessableEntityException("This is the last possible match. Choose the existing customer or create a separate customer to resolve the intake.");
        await this.events.record(client, {
          workspaceId, actorUserId: actorUser.userId, source: "user",
          action: "crm.identity.candidate_rejected.v1", entityType: "crm_intake",
          entityId: String(candidate.intake_event_id), correlationId: String(candidate.correlation_id),
          before: { candidateId, status: "pending", version: input.version },
          after: { candidateId, status: "rejected", reason, version: rejected.rows[0].version },
        });
        return { candidateId, decision: "reject", intakeEventId: candidate.intake_event_id, version: rejected.rows[0].version };
      }
      const original = candidate.original_payload as Record<string, any>;
      let partyId: string;
      if (input.decision === "attach") {
        const party = await client.query<{ id: string }>(
          `SELECT id FROM crm_parties
           WHERE id=$1 AND workspace_id=$2 AND status='active' FOR KEY SHARE`,
          [input.partyId, workspaceId],
        );
        if (!party.rowCount) throw new UnprocessableEntityException("Selected party is no longer active");
        partyId = party.rows[0].id;
      } else {
        partyId = await this.createPartyFromPayload(client, workspaceId, actorUser.userId, original.party ?? {});
      }
      const records = await this.createReadyRecords(client, workspaceId, actorUser.userId, {
        intakeEventId: String(candidate.intake_event_id),
        partyId,
        source: String(candidate.source),
        channel: String(candidate.channel),
        receivedAt: new Date(candidate.received_at),
        title: String(original.title ?? ""),
        summary: typeof original.summary === "string" ? original.summary : null,
        serviceType: typeof original.serviceType === "string" ? original.serviceType : null,
        attribution: Array.isArray(original.attribution) ? original.attribution : [],
        consents: Array.isArray(original.consents) ? original.consents : [],
        legalEntityId: candidate.legal_entity_id as string | null,
      });
      const selectedStatus = input.decision === "attach" ? "accepted" : "rejected";
      const selected = await client.query(
        `UPDATE crm_identity_candidates SET status=$1,decision=$2,resolved_party_id=$3,
           reviewed_by=$4,reviewed_at=now(),decision_reason=$5,version=version+1,updated_at=now()
         WHERE workspace_id=$6 AND id=$7 AND status='pending' AND version=$8 RETURNING version`,
        [selectedStatus, input.decision, partyId, actorUser.userId, reason, workspaceId, candidateId, input.version],
      );
      if (!selected.rowCount) throw new ConflictException("Candidate changed; reload and try again");
      await client.query(
        `UPDATE crm_identity_candidates SET status='rejected',decision='resolved_elsewhere',
           resolved_party_id=$1,reviewed_by=$2,reviewed_at=now(),
           decision_reason='resolved_by_other_candidate',version=version+1,updated_at=now()
         WHERE workspace_id = $3 AND intake_event_id = $4 AND id <> $5 AND status = 'pending'`,
        [partyId, actorUser.userId, workspaceId, candidate.intake_event_id, candidateId],
      );
      await this.resolveIntake(client, workspaceId, {
        intakeEventId: String(candidate.intake_event_id),
        expectedStatus: "duplicate_candidate",
        resolutionType: input.decision === "attach" ? "review_attach" : "review_create_new",
        partyId,
        actorUserId: actorUser.userId,
        source: "user",
        correlationId: String(candidate.correlation_id),
        evidence: {
          candidateId,
          candidatePartyId: String(candidate.candidate_party_id),
          decision: input.decision,
          reason,
        },
      });
      return {
        candidateId,
        decision: input.decision,
        resolutionType: input.decision === "attach" ? "review_attach" : "review_create_new",
        ...records,
      };
    });
  }

  failInternal(workspaceId: string, intakeEventId: string, input: FailIntakeDto) {
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const result = await client.query(
        `UPDATE crm_intake_events SET status = 'failed', failure_code = $1,
           failure_message = $2, processed_at = now(), version = version + 1
         WHERE id = $3 AND workspace_id = $4 AND version = $5
           AND status IN ('received', 'processing')
         RETURNING id, status, failure_code AS "failureCode", version`,
        [input.code, input.message, intakeEventId, workspaceId, input.version],
      );
      if (!result.rowCount) throw new ConflictException("Intake event changed or is already resolved");
      return result.rows[0];
    });
  }

  private async ingest(
    client: PoolClient,
    workspaceId: string,
    actorUserId: string | null,
    sourceActor: "user" | "integration",
    idempotencyKey: string | undefined,
    requestedCorrelationId: string | undefined,
    input: CreateIntakeEventDto,
  ) {
    const normalizedIdempotencyKey = idempotencyKey?.trim();
    if (!normalizedIdempotencyKey || normalizedIdempotencyKey.length > 160) {
      throw new BadRequestException("A valid Idempotency-Key header is required");
    }
    if (input.workspaceId && input.workspaceId !== workspaceId) {
      throw new BadRequestException("Body workspaceId does not match route workspaceId");
    }
    // PLM-092: every problem at once, each with its field.
    new ProblemList()
      .when(!input.party?.displayName?.trim(), "displayName", "Enter a customer name")
      .when(input.party?.email?.trim() && !/^\S+@\S+\.\S+$/.test(input.party.email.trim()), "email", "Email address is invalid")
      .throwIfAny();
    const requestHash = canonicalHash(input);
    const legacyRequestHash = stableHash(input);
    const existing = await client.query<{ id: string; payload_hash: string; payload_hash_version: number }>(
      `SELECT id,payload_hash,payload_hash_version FROM crm_intake_events
       WHERE workspace_id = $1 AND idempotency_key = $2`,
      [workspaceId, normalizedIdempotencyKey],
    );
    if (existing.rowCount) {
      if (!this.payloadHashMatches(existing.rows[0], requestHash, legacyRequestHash)) {
        throw new ConflictException("Idempotency key was already used with different content");
      }
      return this.intakeResult(client, workspaceId, existing.rows[0].id);
    }
    const problems = new ProblemList()
      .when(!input.party.mobile?.trim(), "mobile", "Enter a mobile number")
      .when(!input.serviceType?.trim(), "serviceType", "Select an enquiry type")
      .when(!input.details?.emirate?.trim(), "emirate", "Select the region");
    // Staff entry is checked against what its enquiry type requires from the start; a form or import is the sender's.
    if (sourceActor === "user" && input.intakeMethod !== "import") problems.addAll(await this.createProblems(client, workspaceId, input));
    problems.throwIfAny();
    await validateLeadOptions(client, workspaceId, input);
    const submittedParty = input.party;
    const workspaceCountry = needsWorkspacePhoneCountry(input.party)
      ? countryFromLocale((await client.query<{ defaultLocale: string }>(`SELECT default_locale AS "defaultLocale" FROM workspaces WHERE id=$1`, [workspaceId])).rows[0]?.defaultLocale)
      : undefined;
    input = { ...input, party: normalizeIntakePartyPhones(input.party, workspaceCountry) };
    await this.assertScope(client, workspaceId, input.legalEntityId, input.businessUnitId);
    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
    if (Number.isNaN(receivedAt.getTime())) throw new BadRequestException("receivedAt is invalid");
    if (receivedAt.getTime() > Date.now() + 5 * 60_000) {
      throw new UnprocessableEntityException("receivedAt cannot be in the future");
    }
    const intakeEventId = randomUUID();
    const eventCorrelationId = correlationId(requestedCorrelationId);
    const externalEventId = input.externalEventId?.trim() || null;
    const originalPayload = {
      ...input.originalPayload,
      submittedParty,
      party: input.party,
      title: input.title?.trim() ?? "",
      summary: input.summary,
      serviceType: input.serviceType,
      attribution: input.attribution ?? [],
      consents: input.consents ?? [],
      details: input.details ?? {},
      assignment: input.assignment,
      referral: input.referral,
      ...(input.team?.length ? { team: input.team } : {}),
    };
    // A provider may retry concurrently or use a new request key for the same event.
    // Avoid a uniqueness exception: PostgreSQL would abort the transaction before
    // the existing intake could be read. ON CONFLICT waits for the first commit.
    const inserted = await client.query(
      `INSERT INTO crm_intake_events
        (id, workspace_id, legal_entity_id, business_unit_id, source, channel,
         intake_method, external_event_id, idempotency_key, payload_hash,
         payload_hash_version, original_payload, payload_reference, status, correlation_id,
         received_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 2, $11, $12,
               'processing', $13, $14, $15)
       ON CONFLICT DO NOTHING RETURNING id`,
      [
        intakeEventId, workspaceId, input.legalEntityId ?? null,
        input.businessUnitId ?? null, input.source, input.channel,
        input.intakeMethod, externalEventId, normalizedIdempotencyKey,
        requestHash, originalPayload, input.payloadReference ?? null,
        eventCorrelationId, receivedAt, actorUserId,
      ],
    );
    if (!inserted.rowCount) {
      const prior = await client.query<{ id: string; payload_hash: string; payload_hash_version: number }>(
        `SELECT id,payload_hash,payload_hash_version FROM crm_intake_events
         WHERE workspace_id = $1 AND (idempotency_key = $2
           OR (source = $3 AND external_event_id = $4))`,
        [workspaceId, normalizedIdempotencyKey, input.source, externalEventId],
      );
      if (prior.rowCount === 1 && this.payloadHashMatches(prior.rows[0], requestHash, legacyRequestHash)) {
        return this.intakeResult(client, workspaceId, prior.rows[0].id);
      }
      throw new ConflictException("Request or external event identifier was already used with different content");
    }
    await this.events.record(client, {
      workspaceId, actorUserId, source: sourceActor,
      action: "crm.intake.received.v1", entityType: "crm_intake", entityId: intakeEventId,
      correlationId: eventCorrelationId,
      after: { source: input.source, channel: input.channel, intakeMethod: input.intakeMethod, receivedAt: receivedAt.toISOString() },
    });

    // Serialize identity resolution within this workspace: simultaneous submissions with
    // different request keys must see the first committed contact, not create two people.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${workspaceId}:crm-identity`]);
    const recordsFor = (partyId: string) => this.createReadyRecords(client, workspaceId, actorUserId, {
      intakeEventId, partyId, source: input.source, channel: input.channel, receivedAt, title: input.title ?? "",
      summary: input.summary ?? null, serviceType: input.serviceType ?? null, attribution: input.attribution ?? [],
      consents: input.consents ?? [], legalEntityId: input.legalEntityId ?? null,
    });
    if (sourceActor === "user" && input.identity) {
      // LF-1: the person entering it already answered "is this an existing client?", so nothing waits for review.
      let partyId: string;
      if (input.identity === "existing") {
        const party = await client.query<{ id: string }>(
          `SELECT id FROM crm_parties WHERE workspace_id=$1 AND id=$2 AND status='active' FOR KEY SHARE`, [workspaceId, input.partyId ?? null]);
        if (!party.rowCount) throw new UnprocessableEntityException("The selected client is no longer active. Search again.");
        partyId = party.rows[0].id;
      } else {
        partyId = await this.createPartyFromPayload(client, workspaceId, actorUserId, input.party);
      }
      const records = await recordsFor(partyId);
      const resolutionType = input.identity === "existing" ? "review_attach" : "review_create_new";
      await this.resolveIntake(client, workspaceId, {
        intakeEventId, expectedStatus: "processing", resolutionType, partyId, actorUserId, source: sourceActor,
        correlationId: eventCorrelationId, evidence: { decision: input.identity === "existing" ? "staff_selected_existing" : "staff_confirmed_new" },
      });
      return { intakeEventId, status: "ready", resolutionType, matchedExistingParty: input.identity === "existing", ...records };
    }
    const matches = await this.identityMatches(client, workspaceId, input.party);
    const exact = matches.filter((match) => match.strength === "exact");
    if (exact.length === 1) {
      const records = await this.createReadyRecords(client, workspaceId, actorUserId, {
        intakeEventId, partyId: exact[0].partyId, source: input.source,
        channel: input.channel, receivedAt, title: input.title ?? "",
        summary: input.summary ?? null, serviceType: input.serviceType ?? null,
        attribution: input.attribution ?? [], consents: input.consents ?? [],
        legalEntityId: input.legalEntityId ?? null,
      });
      await this.resolveIntake(client, workspaceId, {
        intakeEventId,
        expectedStatus: "processing",
        resolutionType: "verified_contact",
        partyId: exact[0].partyId,
        actorUserId,
        source: sourceActor,
        correlationId: eventCorrelationId,
        evidence: { matchStrength: "exact", reasons: exact[0].reasons },
      });
      return { intakeEventId, status: "ready", resolutionType: "verified_contact", matchedExistingParty: true, ...records };
    }
    if (matches.length) {
      // S-3: a likely-but-unproven match never parks the enquiry. It is created at once on a provisional
      // client, routed and timed like any other; the possible matches wait on it as "Confirm client".
      const partyId = await this.createPartyFromPayload(client, workspaceId, actorUserId, input.party);
      const records = await recordsFor(partyId);
      for (const match of matches) {
        await client.query(
          `INSERT INTO crm_identity_candidates
            (workspace_id, intake_event_id, candidate_party_id, strength, score, reasons)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [workspaceId, intakeEventId, match.partyId, match.strength, match.score, JSON.stringify(match.reasons)],
        );
      }
      await this.resolveIntake(client, workspaceId, {
        intakeEventId, expectedStatus: "processing", resolutionType: "new_identity", partyId, actorUserId, source: sourceActor,
        correlationId: eventCorrelationId, evidence: { matchStrength: "fuzzy", provisional: true, candidateCount: matches.length },
      });
      const settings = await loadSalesSettings(client, workspaceId);
      await client.query(`UPDATE crm_leads SET client_review_due_at=$3 WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, records.leadId, addSlaMinutes(new Date(), settings.clientReviewMinutes, await salesSchedule(client, workspaceId))]);
      await this.events.record(client, {
        workspaceId, actorUserId, source: sourceActor,
        action: "crm.identity.review_required.v1", entityType: "crm_intake", entityId: intakeEventId,
        correlationId: eventCorrelationId,
        after: { candidateCount: matches.length, provisionalPartyId: partyId, leadId: records.leadId },
      });
      return { intakeEventId, status: "ready", resolutionType: "new_identity", matchedExistingParty: false, clientMatches: matches.length, ...records };
    }

    const partyId = await this.createPartyFromPayload(client, workspaceId, actorUserId, input.party);
    const records = await this.createReadyRecords(client, workspaceId, actorUserId, {
      intakeEventId, partyId, source: input.source, channel: input.channel,
      receivedAt, title: input.title ?? "", summary: input.summary ?? null,
      serviceType: input.serviceType ?? null, attribution: input.attribution ?? [],
      consents: input.consents ?? [], legalEntityId: input.legalEntityId ?? null,
    });
    await this.resolveIntake(client, workspaceId, {
      intakeEventId,
      expectedStatus: "processing",
      resolutionType: "new_identity",
      partyId,
      actorUserId,
      source: sourceActor,
      correlationId: eventCorrelationId,
      evidence: { matchStrength: "none" },
    });
    return { intakeEventId, status: "ready", resolutionType: "new_identity", matchedExistingParty: false, ...records };
  }

  private async identityMatches(client: PoolClient, workspaceId: string, party: CreateIntakeEventDto["party"]) {
    const email = party.email ? normalizeEmail(party.email) : null;
    const phones = [party.phone, party.mobile].filter(Boolean).map(value => normalizeLoosePhone(value!)).filter(Boolean);
    const exact = await client.query<{ id: string; reasons: string[] }>(
      `SELECT party.id,
              array_agg(DISTINCT CASE contact.type
                WHEN 'email' THEN 'verified_email' WHEN 'phone' THEN 'verified_phone'
                ELSE 'verified_contact' END) AS reasons
       FROM crm_parties party
       JOIN crm_contact_points contact ON contact.party_id = party.id
        AND contact.workspace_id = party.workspace_id
       WHERE party.workspace_id = $1 AND party.status = 'active'
         AND contact.status = 'active' AND contact.is_verified
         AND (($2::text IS NOT NULL AND contact.type = 'email' AND contact.normalized_value = $2)
           OR (contact.type = 'phone' AND contact.normalized_value = ANY($3::text[])))
       GROUP BY party.id`,
      [workspaceId, email, phones],
    );
    if (exact.rowCount) {
      return exact.rows.map((row) => ({ partyId: row.id, strength: "exact", score: 1, reasons: row.reasons }));
    }
    // An unverified matching contact needs review, even when the name differs.
    // Only a verified identity match above may attach a new enquiry automatically.
    const contactCandidates = await client.query<{ id: string; reasons: string[] }>(
      `SELECT party.id,
              array_agg(DISTINCT CASE contact.type
                WHEN 'email' THEN 'unverified_email' ELSE 'unverified_phone' END) AS reasons
       FROM crm_parties party
       JOIN crm_contact_points contact ON contact.party_id = party.id
        AND contact.workspace_id = party.workspace_id
       WHERE party.workspace_id = $1 AND party.status = 'active'
         AND contact.status = 'active' AND NOT contact.is_verified
         AND (($2::text IS NOT NULL AND contact.type = 'email' AND contact.normalized_value = $2)
           OR (contact.type = 'phone' AND contact.normalized_value = ANY($3::text[])))
       GROUP BY party.id ORDER BY party.id LIMIT 5`,
      [workspaceId, email, phones],
    );
    if (contactCandidates.rowCount) {
      return contactCandidates.rows.map((row) => ({ partyId: row.id, strength: "fuzzy", score: 0.95, reasons: row.reasons }));
    }
    const normalizedName = normalizeName(party.displayName);
    const fuzzy = await client.query<{ id: string; score: string }>(
      `SELECT id, similarity(normalized_name, $2)::text AS score
       FROM crm_parties
       WHERE workspace_id = $1 AND status = 'active'
         AND similarity(normalized_name, $2) >= 0.72
       ORDER BY similarity(normalized_name, $2) DESC, id
       LIMIT 5`,
      [workspaceId, normalizedName],
    );
    return fuzzy.rows.map((row) => ({
      partyId: row.id, strength: "fuzzy", score: Number(row.score), reasons: ["similar_name"],
    }));
  }

  private async createPartyFromPayload(
    client: PoolClient,
    workspaceId: string,
    actorUserId: string | null,
    party: Partial<CreateIntakeEventDto["party"]>,
  ): Promise<string> {
    if (!party.displayName?.trim()) throw new UnprocessableEntityException("Intake party name is required");
    const partyId = randomUUID();
    await client.query(
      `INSERT INTO crm_parties
        (id, workspace_id, type, display_name, normalized_name,
         preferred_locale, preferred_timezone, created_by)
       VALUES ($1, $2, 'person', $3, $4, $5, $6, $7)`,
      [
        partyId, workspaceId, party.displayName.trim(), normalizeName(party.displayName),
        party.preferredLocale ?? null, party.preferredTimezone ?? null, actorUserId,
      ],
    );
    await client.query(
      `INSERT INTO crm_person_profiles (party_id, workspace_id, job_title) VALUES ($1, $2, $3)`,
      [partyId, workspaceId, party.jobPosition ?? null],
    );
    if (party.email) {
      const email = normalizeEmail(party.email);
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new UnprocessableEntityException("Email address is invalid");
      await client.query(
        `INSERT INTO crm_contact_points
          (workspace_id, party_id, type, raw_value, normalized_value, is_primary)
         VALUES ($1, $2, 'email', $3, $4, true)`,
        [workspaceId, partyId, party.email.trim(), email],
      );
    }
    const contacts = [{ value: party.mobile, label: "mobile" }, { value: party.phone, label: "phone" }]
      .filter(contact => contact.value?.trim())
      .filter((contact, index, all) => all.findIndex(other => (normalizeLoosePhone(other.value!) ?? other.value!.trim()) === (normalizeLoosePhone(contact.value!) ?? contact.value!.trim())) === index);
    for (const [index, contact] of contacts.entries()) {
      const phone = normalizeLoosePhone(contact.value!);
      await client.query(`INSERT INTO crm_contact_points
        (workspace_id, party_id, type, label, raw_value, normalized_value, country_code, is_primary, invalid_reason)
        VALUES ($1, $2, 'phone', $3, $4, $5, upper($6), $7, $8)`,
        [workspaceId, partyId, contact.label, contact.value!.trim(), phone, contact.label === "mobile" ? party.mobileCountryCode ?? party.phoneCountryCode ?? null : party.phoneCountryCode ?? null, index === 0, phone ? null : "unresolved_phone"]);
    }
    await this.events.record(client, {
      workspaceId, actorUserId, source: actorUserId ? "user" : "integration",
      action: "crm.party.created.v1", entityType: "crm_party", entityId: partyId,
      after: { displayName: party.displayName, source: "intake" },
    });
    return partyId;
  }

  private async createReadyRecords(
    client: PoolClient,
    workspaceId: string,
    actorUserId: string | null,
    input: {
      intakeEventId: string;
      partyId: string;
      source: string;
      channel: string;
      receivedAt: Date;
      title: string;
      summary: string | null;
      serviceType: string | null;
      attribution: Array<Record<string, any>>;
      consents: Array<Record<string, any>>;
      legalEntityId: string | null;
    },
  ) {
    const enquiryId = randomUUID();
    const leadId = randomUUID();
    const intake = await client.query(`SELECT original_payload FROM crm_intake_events WHERE workspace_id=$1 AND id=$2`, [workspaceId, input.intakeEventId]);
    const original = intake.rows[0].original_payload;
    const details = { ...(original.details ?? {}), contact: original.party ?? {}, ...(original.formAnswers ? { formAnswers: original.formAnswers } : {}) };
    const choices = await loadLeadOptions(client, workspaceId);
    const title = enquiryTitle(String(original.party?.displayName ?? ""), details, choices);
    // Same contact with an open enquiry → duplicate; known contact otherwise → returning customer.
    const repeat = await classifyRepeat(client, workspaceId, input.partyId);
    const source = repeat?.kind === "returning" ? repeat.source : input.source;
    const channel = repeat?.kind === "returning" ? repeat.channel : input.channel;
    const enquiry = await client.query(
      `INSERT INTO crm_enquiries
        (id, workspace_id, intake_event_id, party_id, title, summary,
         service_type, source, channel, received_at, details,
         referral_kind, referral_name, referral_contact, referral_membership_id, referral_option, original_source, original_channel)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING reference`,
      [
        enquiryId, workspaceId, input.intakeEventId, input.partyId, title,
        input.summary, input.serviceType, source, channel, input.receivedAt, details,
        original.referral?.kind ?? null, original.referral?.name ?? null, original.referral?.contact ?? null,
        original.referral?.membershipId ?? null, original.referral?.option ?? null,
        repeat?.kind === "returning" ? input.source : null, repeat?.kind === "returning" ? input.channel : null,
      ],
    );
    await client.query(
      `INSERT INTO crm_leads (id, workspace_id, enquiry_id, party_id)
       VALUES ($1, $2, $3, $4)`,
      [leadId, workspaceId, enquiryId, input.partyId],
    );
    // PLM-100: the team tagged at intake (a member or Not applicable per role) travels with the enquiry.
    if (Array.isArray(original.team)) await writeLeadTeam(client, workspaceId, leadId, original.team, actorUserId);
    await ensureJobForSource(client, workspaceId, { type: "lead", id: leadId }, actorUserId);
    const reference = String(enquiry.rows[0]?.reference ?? "");
    const clientName = String(original.party?.displayName ?? "");
    const notifyOwner = async (membershipId: string | null, code: string, variables: Record<string, string>) => {
      if (!membershipId) return;
      const member = await client.query<{ userId: string }>(`SELECT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, membershipId]);
      if (member.rowCount) await notifyUserInApp(client, { workspaceId, recipientUserId: member.rows[0].userId, code, eventType: code, variables, deepLink: `/workspace/crm/leads?lead=${leadId}`, idempotencyKey: `${code}:${leadId}` });
    };
    if (repeat?.kind === "duplicate") {
      // Kept for the record and marketing reports, owned by the original's owner, never routed or timed.
      await client.query(`UPDATE crm_leads SET status = 'duplicate', duplicate_of_lead_id = $3, owner_membership_id = $4, closed_at = now()
        WHERE workspace_id = $1 AND id = $2`, [workspaceId, leadId, repeat.originalLeadId, repeat.ownerMembershipId]);
      await client.query(`INSERT INTO crm_assignment_history (workspace_id, lead_id, owner_membership_id, assignment_method, explanation, reason, assigned_by)
        VALUES ($1, $2, $3, 'manual', $4, $5, $6)`, [workspaceId, leadId, repeat.ownerMembershipId, { mode: "duplicate", originalLeadId: repeat.originalLeadId }, `Duplicate of ${repeat.originalReference ?? "an open enquiry"}`, actorUserId]);
      await this.events.record(client, { workspaceId, actorUserId, source: actorUserId ? "user" : "system", action: "crm.lead.duplicate_detected.v1", entityType: "crm_lead", entityId: leadId, after: { originalLeadId: repeat.originalLeadId, source: input.source, channel: input.channel } });
      await notifyOwner(repeat.ownerMembershipId, "crm.enquiry_duplicate", { clientName, reference, channel: input.channel, originalReference: repeat.originalReference ?? "" });
    } else {
      if (original.assignment) await this.leads.assignOnIntake(client, workspaceId, leadId, actorUserId, original.assignment);
      await this.leads.startSlaOnIntake(client, workspaceId, leadId, actorUserId);
      // The client's welcome on WhatsApp, when the firm has it on, an approved template and the client's consent.
      const welcome = await sendClientEvent(client, { workspaceId, event: "crm.enquiry.created", partyId: input.partyId, leadId, recordKey: leadId, actorUserId });
      if (!welcome.sent) await recordClientMessageSkipped(client, workspaceId, "crm.enquiry.created", leadId, welcome, false);
      if (repeat?.kind === "returning") {
        await this.events.record(client, { workspaceId, actorUserId, source: actorUserId ? "user" : "system", action: "crm.lead.returning_customer.v1", entityType: "crm_lead", entityId: leadId, after: { originalSource: input.source, originalChannel: input.channel } });
        await notifyOwner(repeat.previousOwnerMembershipId, "crm.returning_customer", { clientName, reference });
      }
    }
    for (const touch of input.attribution) {
      await client.query(
        `INSERT INTO crm_attribution_touches
          (workspace_id, enquiry_id, source, medium, campaign, content, term,
           referrer, external_click_id, touched_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          workspaceId, enquiryId, touch.source ?? input.source, touch.medium ?? null,
          touch.campaign ?? null, touch.content ?? null, touch.term ?? null,
          touch.referrer ?? null, touch.externalClickId ?? null,
          touch.touchedAt ?? input.receivedAt, touch.metadata ?? {},
        ],
      );
    }
    for (const consent of input.consents) {
      await client.query(
        `INSERT INTO crm_consents
          (workspace_id, party_id, legal_entity_id, purpose, channel, status,
           evidence, jurisdiction, withdrawn_at)
         VALUES ($1, $2, $3, $4, $5, $6::crm_consent_status, $7, $8,
                 CASE WHEN $6 = 'withdrawn' THEN now() ELSE NULL END)
         ON CONFLICT (workspace_id, party_id, legal_entity_id, purpose, channel)
         DO UPDATE SET status = EXCLUDED.status, evidence = EXCLUDED.evidence,
           jurisdiction = EXCLUDED.jurisdiction, captured_at = now(),
           withdrawn_at = EXCLUDED.withdrawn_at, version = crm_consents.version + 1`,
        [
          workspaceId, input.partyId, input.legalEntityId,
          consent.purpose, consent.channel, consent.status,
          consent.evidence ?? {}, consent.jurisdiction ?? null,
        ],
      );
    }
    await this.events.record(client, {
      workspaceId, actorUserId, source: actorUserId ? "user" : "integration",
      action: "crm.enquiry.ready.v1", entityType: "crm_lead", entityId: leadId,
      after: { partyId: input.partyId, leadId, enquiryId, source: input.source, channel: input.channel },
    });
    return { partyId: input.partyId, enquiryId, leadId, reference: enquiry.rows[0].reference };
  }

  private async resolveIntake(
    client: PoolClient,
    workspaceId: string,
    input: {
      intakeEventId: string;
      expectedStatus: "processing" | "duplicate_candidate";
      resolutionType: "verified_contact" | "new_identity" | "review_attach" | "review_create_new";
      partyId: string;
      actorUserId: string | null;
      source: "user" | "integration";
      correlationId: string;
      evidence: Record<string, unknown>;
    },
  ) {
    const result = await client.query<{ version: number; resolved_at: Date }>(
      `UPDATE crm_intake_events SET status='ready',processed_at=now(),failure_code=NULL,failure_message=NULL,
         resolution_type=$3,resolved_party_id=$4,resolved_by=$5,resolved_at=now(),resolution_evidence=$6,
         version=version+1,updated_at=now()
       WHERE workspace_id=$1 AND id=$2 AND status=$7::crm_intake_status
       RETURNING version,resolved_at`,
      [
        workspaceId, input.intakeEventId, input.resolutionType, input.partyId,
        input.actorUserId, input.evidence, input.expectedStatus,
      ],
    );
    if (!result.rowCount) throw new ConflictException("Intake changed while identity resolution was being completed");
    await this.events.record(client, {
      workspaceId,
      actorUserId: input.actorUserId,
      source: input.source,
      action: "crm.identity.resolved.v1",
      entityType: "crm_intake",
      entityId: input.intakeEventId,
      correlationId: input.correlationId,
      before: { status: input.expectedStatus },
      after: {
        status: "ready",
        resolutionType: input.resolutionType,
        resolvedPartyId: input.partyId,
        resolvedAt: result.rows[0].resolved_at,
        evidence: input.evidence,
        version: Number(result.rows[0].version),
      },
    });
    return result.rows[0];
  }

  private async duplicateDecisionReplay(
    client: PoolClient,
    workspaceId: string,
    candidateId: string,
    candidate: Record<string, any>,
    input: ReviewDuplicateDto,
  ) {
    const sameAttach = input.decision === "attach"
      && candidate.decision === "attach"
      && Boolean(input.partyId)
      && input.partyId === candidate.resolved_party_id;
    const sameCreate = input.decision === "create_new" && candidate.decision === "create_new" && !input.partyId;
    const sameReject = input.decision === "reject"
      && candidate.decision === "reject"
      && candidate.intake_status === "duplicate_candidate"
      && !input.partyId;
    if (!sameAttach && !sameCreate && !sameReject) {
      throw new ConflictException("Candidate was already reviewed with a different decision");
    }
    const result = await this.intakeResult(client, workspaceId, String(candidate.intake_event_id));
    return { candidateId, decision: input.decision, ...result, reviewReplay: true };
  }

  private payloadHashMatches(
    row: { payload_hash: string; payload_hash_version?: number },
    canonicalRequestHash: string,
    legacyRequestHash: string,
  ) {
    return row.payload_hash === (Number(row.payload_hash_version ?? 1) === 2 ? canonicalRequestHash : legacyRequestHash);
  }

  private async intakeResult(client: PoolClient, workspaceId: string, intakeEventId: string) {
    const result = await client.query(
      `SELECT intake.id AS "intakeEventId", intake.status,
              intake.resolution_type AS "resolutionType",
              intake.resolved_party_id AS "resolvedPartyId",intake.resolved_at AS "resolvedAt",
              enquiry.party_id AS "partyId", enquiry.id AS "enquiryId", enquiry.reference, lead.id AS "leadId"
       FROM crm_intake_events intake
       LEFT JOIN crm_enquiries enquiry ON enquiry.intake_event_id = intake.id
        AND enquiry.workspace_id = intake.workspace_id
       LEFT JOIN crm_leads lead ON lead.enquiry_id = enquiry.id
        AND lead.workspace_id = intake.workspace_id
       WHERE intake.id = $1 AND intake.workspace_id = $2`,
      [intakeEventId, workspaceId],
    );
    if (!result.rowCount) throw new NotFoundException("Intake event not found");
    return { ...result.rows[0], idempotentReplay: true };
  }

  private intakeCursor(value?: string) {
    const cursor = decodeCursor(value);
    if (value && (
      !cursor
      || Number.isNaN(Date.parse(cursor.value))
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id)
    )) {
      throw new BadRequestException("Invalid page cursor");
    }
    return cursor;
  }

  private async assertScope(
    client: PoolClient,
    workspaceId: string,
    legalEntityId?: string,
    businessUnitId?: string,
  ) {
    if (legalEntityId) {
      const entity = await client.query(
        `SELECT 1 FROM legal_entities WHERE id = $1 AND workspace_id = $2 AND status = 'active'`,
        [legalEntityId, workspaceId],
      );
      if (!entity.rowCount) throw new UnprocessableEntityException("Legal entity is not active");
    }
    if (businessUnitId) {
      const unit = await client.query(
        `SELECT 1 FROM business_units WHERE id = $1 AND workspace_id = $2
          AND status = 'active' AND ($3::uuid IS NULL OR legal_entity_id = $3)`,
        [businessUnitId, workspaceId, legalEntityId ?? null],
      );
      if (!unit.rowCount) throw new UnprocessableEntityException("Business unit is not active in the selected legal entity");
    }
  }
}
