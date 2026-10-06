import { assignDesignerToCase } from "../crm/opportunities/dedicated-designer";
import { carryTeamToCase, readCaseTeam } from "../project-core/project-team";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { PoolClient } from "pg";
import { RequestActor } from "../auth/actor";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { CrmOpportunitiesService } from "../crm/opportunities/crm-opportunities.service";
import { ensureJobForSource } from "../jobs/job-identity.store";
import { ensureSiteLocation } from "../crm/opportunities/site-location";
import { canonicalHash } from "../crm/shared/crm-types";
import { transitionEngagement, type EngagementLifecycleState } from "./engagement-lifecycle";
import { ListPreProjectsDto, StartFromQualifiedLeadDto, TransitionEngagementDto, UpdateEngagementProfileDto } from "./pre-projects.dto";

const caseSelect = `SELECT c.id, c.status::text AS status, c.created_at AS "createdAt", c.updated_at AS "updatedAt",
  o.id AS "opportunityId", o.title, o.description, o.status::text AS "opportunityStatus",
  o.party_id AS "customerId", p.display_name AS "customerName", o.lead_id AS "leadId",
  o.amount, o.currency_code AS "currencyCode", u.display_name AS "leadManagerName",
  false AS "qualifiedLead", NULL::int AS "leadVersion", c.owner_membership_id AS "ownerMembershipId",
  c.phase, c.version, c.target_date::text AS "targetDate", c.priority, c.risk_level AS "riskLevel",
  c.activated_at AS "activatedAt", c.hold_reason AS "holdReason", c.held_at AS "heldAt", c.held_by AS "heldBy",
  c.status = 'on_hold' AS "isOnHold", c.cancellation_reason AS "cancellationReason",
  c.cancelled_at AS "cancelledAt", c.cancelled_by AS "cancelledBy", c.released_at AS "releasedAt",
  c.released_by AS "releasedBy", engagement_owner.display_name AS "engagementOwnerName",
  o.conversion_origin AS "conversionOrigin", o.converted_at AS "convertedAt",
  o.qualification_evidence AS "qualificationEvidence", o.qualification_evidence_hash AS "qualificationEvidenceHash",
  project.id AS "projectId",
  o.reference AS "reference", o.owner_membership_id AS "salesMembershipId", enquiry_type.name AS "enquiryTypeName",
  discovery.property_location AS "siteAddress", discovery.latitude::float8 AS "siteLatitude", discovery.longitude::float8 AS "siteLongitude",
  EXISTS (SELECT 1 FROM project_workflow_templates workflow
    WHERE workflow.workspace_id = c.workspace_id AND workflow.status = 'active'
      AND workflow.is_default AND workflow.code = 'design_build_deal_first') AS "servicePathEnabled"
  FROM pre_project_cases c
  JOIN crm_opportunities o ON o.id = c.opportunity_id AND o.workspace_id = c.workspace_id
  JOIN crm_parties p ON p.id = o.party_id AND p.workspace_id = c.workspace_id
  LEFT JOIN workspace_memberships m ON m.id = o.owner_membership_id AND m.workspace_id = c.workspace_id
  LEFT JOIN users u ON u.id = m.user_id
  LEFT JOIN workspace_memberships engagement_membership ON engagement_membership.id = c.owner_membership_id AND engagement_membership.workspace_id = c.workspace_id
  LEFT JOIN users engagement_owner ON engagement_owner.id = engagement_membership.user_id
  LEFT JOIN delivery_projects project ON project.workspace_id = c.workspace_id AND project.case_id = c.id
  LEFT JOIN crm_opportunity_discovery discovery ON discovery.workspace_id = c.workspace_id AND discovery.opportunity_id = c.opportunity_id
  LEFT JOIN crm_flow_versions flow_version ON flow_version.workspace_id = o.workspace_id AND flow_version.id = o.flow_version_id
  LEFT JOIN crm_flows enquiry_type ON enquiry_type.workspace_id = flow_version.workspace_id AND enquiry_type.id = flow_version.flow_id`;

type LifecycleRow = EngagementLifecycleState & {
  id: string;
  version: number;
  opportunityStatus: string;
};

@Injectable()
export class PreProjectsService {
  constructor(private readonly access: WorkspaceAccessService, private readonly events: CrmEventsService, private readonly opportunities: CrmOpportunitiesService) {}

  list(actor: RequestActor, workspaceId: string, query: ListPreProjectsDto) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client, user) => {
      const status = query.status === "archived" ? "cancelled" : (query.status ?? "all");
      const values = [workspaceId, query.search?.trim() ?? "", status, query.pendingDeal === "true"];
      // Qualified leads are visible immediately, including records qualified before this release.
      // A linked case replaces its incoming lead row; cancelled cases never reappear as new leads.
      const records = `WITH records AS (
        ${caseSelect} WHERE c.workspace_id = $1
        UNION ALL
        SELECT lead.id, 'qualified', COALESCE(lead.qualified_at, lead.created_at), lead.updated_at,
          opportunity.id, COALESCE(opportunity.title, enquiry.title), COALESCE(opportunity.description, enquiry.summary), opportunity.status::text,
          party.id, party.display_name, lead.id, opportunity.amount, opportunity.currency_code,
          manager.display_name, true, lead.version, COALESCE(opportunity.owner_membership_id, lead.owner_membership_id),
          'discover', 1, NULL::text, 'normal', 'none', NULL::timestamptz, NULL::varchar, NULL::timestamptz,
          NULL::uuid, false, NULL::varchar, NULL::timestamptz, NULL::uuid, NULL::timestamptz, NULL::uuid,
          manager.display_name, opportunity.conversion_origin, opportunity.converted_at,
          COALESCE(opportunity.qualification_evidence, lead.qualification_evidence),
          COALESCE(opportunity.qualification_evidence_hash, lead.qualification_evidence_hash),
          NULL::uuid, opportunity.reference, opportunity.owner_membership_id, NULL::varchar, NULL::varchar, NULL::float8, NULL::float8,
          EXISTS (SELECT 1 FROM project_workflow_templates workflow
            WHERE workflow.workspace_id = lead.workspace_id AND workflow.status = 'active'
              AND workflow.is_default AND workflow.code = 'design_build_deal_first')
        FROM crm_leads lead
        JOIN crm_enquiries enquiry ON enquiry.id = lead.enquiry_id AND enquiry.workspace_id = lead.workspace_id
        JOIN crm_parties party ON party.id = lead.party_id AND party.workspace_id = lead.workspace_id
        LEFT JOIN LATERAL (SELECT o.* FROM crm_opportunities o WHERE o.workspace_id = lead.workspace_id AND o.lead_id = lead.id ORDER BY o.created_at, o.id LIMIT 1) opportunity ON true
        LEFT JOIN workspace_memberships membership ON membership.id = COALESCE(opportunity.owner_membership_id, lead.owner_membership_id) AND membership.workspace_id = lead.workspace_id
        LEFT JOIN users manager ON manager.id = membership.user_id
        WHERE lead.workspace_id = $1 AND lead.status = 'qualified'
          AND NOT EXISTS (SELECT 1 FROM pre_project_cases existing JOIN crm_opportunities linked ON linked.id = existing.opportunity_id AND linked.workspace_id = existing.workspace_id WHERE existing.workspace_id = lead.workspace_id AND linked.lead_id = lead.id)
      )`;
      const where = ` WHERE ($2 = '' OR strpos(lower(title || ' ' || "customerName"), lower($2)) > 0) AND ($3 = 'all' OR status = $3) AND (NOT $4 OR "projectId" IS NULL)`;
      const total = await client.query(`${records} SELECT count(*)::int AS total FROM records${where}`, values);
      const items = await client.query(`${records} SELECT * FROM records${where} ORDER BY "updatedAt" DESC, id DESC LIMIT 24 OFFSET $5`, [...values, ((query.page ?? 1) - 1) * 24]);
      const canCreate = await this.access.hasPermission(client, workspaceId, user.userId, "pre_projects.create")
        && await this.access.hasPermission(client, workspaceId, user.userId, "crm.opportunities.view");
      const canStartLead = canCreate && await this.access.hasPermission(client, workspaceId, user.userId, "crm.opportunities.manage")
        && await this.access.hasPermission(client, workspaceId, user.userId, "crm.leads.manage");
      return { items: items.rows, total: total.rows[0].total, canCreate, canStartLead };
    });
  }

  candidates(actor: RequestActor, workspaceId: string, query: ListPreProjectsDto) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.create", "crm.opportunities.view"], async (client) => {
      const result = await client.query(`SELECT o.id, o.title, p.display_name AS "customerName", o.status,
        c.id AS "caseId" FROM crm_opportunities o
        JOIN crm_parties p ON p.id = o.party_id AND p.workspace_id = o.workspace_id
        LEFT JOIN pre_project_cases c ON c.opportunity_id = o.id AND c.workspace_id = o.workspace_id
        WHERE o.workspace_id = $1 AND (o.status IN ('open', 'won') OR c.id IS NOT NULL)
        AND ($2 = '' OR strpos(lower(o.title || ' ' || p.display_name), lower($2)) > 0)
        ORDER BY o.updated_at DESC, o.id DESC LIMIT 51`, [workspaceId, query.search?.trim() ?? ""]);
      return { items: result.rows.slice(0, 50), hasMore: result.rows.length > 50 };
    });
  }

  startOptions(actor: RequestActor, workspaceId: string) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.create", "crm.opportunities.view", "crm.opportunities.manage", "crm.leads.manage"], async (client) => {
      const members = await client.query(`SELECT membership.id, account.display_name AS name FROM workspace_memberships membership JOIN users account ON account.id = membership.user_id WHERE membership.workspace_id = $1 AND membership.status = 'active' AND account.status = 'active' ORDER BY account.display_name, membership.id`, [workspaceId]);
      return { members: members.rows };
    });
  }

  startFromLead(actor: RequestActor, workspaceId: string, input: StartFromQualifiedLeadDto) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.create", "crm.opportunities.view", "crm.opportunities.manage", "crm.leads.manage"], async (client, user) => {
      const leadResult = await client.query(`SELECT lead.*, enquiry.title, enquiry.summary FROM crm_leads lead JOIN crm_enquiries enquiry ON enquiry.id = lead.enquiry_id AND enquiry.workspace_id = lead.workspace_id WHERE lead.workspace_id = $1 AND lead.id = $2 FOR UPDATE OF lead`, [workspaceId, input.leadId]);
      if (!leadResult.rowCount) throw new NotFoundException("Lead not found");
      const lead = leadResult.rows[0];
      const linked = await client.query(`SELECT id, status FROM crm_opportunities WHERE workspace_id = $1 AND lead_id = $2 ORDER BY created_at, id LIMIT 1 FOR UPDATE`, [workspaceId, input.leadId]);
      if (linked.rowCount) {
        const existing = await client.query(`SELECT id FROM pre_project_cases WHERE workspace_id = $1 AND opportunity_id = $2`, [workspaceId, linked.rows[0].id]);
        if (existing.rowCount) return this.read(client, workspaceId, existing.rows[0].id);
      }
      if (lead.status !== "qualified") throw new ConflictException("This lead is no longer Qualified. Refresh the Pre-execution table.");
      if (Number(lead.version) !== input.version) throw new ConflictException("Lead changed; refresh before starting its pre-execution.");
      let opportunityId: string;
      if (linked.rowCount) {
        if (!["open", "won"].includes(linked.rows[0].status)) throw new ConflictException("Reopen the linked opportunity before starting its pre-execution.");
        opportunityId = linked.rows[0].id;
      } else {
        if (!input.ownerMembershipId || !input.nextActionAt || Number.isNaN(Date.parse(input.nextActionAt))) throw new UnprocessableEntityException("Choose a lead manager and the next follow-up date.");
        if (!lead.qualification_evidence || !lead.qualification_evidence_hash) {
          throw new ConflictException("Qualification evidence is missing. Reopen and qualify the lead again before starting pre-execution.");
        }
        const pipeline = await client.query(`SELECT pipeline.id FROM crm_pipelines pipeline WHERE pipeline.workspace_id = $1 AND pipeline.status = 'active' AND EXISTS (SELECT 1 FROM crm_pipeline_stages stage WHERE stage.workspace_id = pipeline.workspace_id AND stage.pipeline_id = pipeline.id AND stage.status = 'active') ORDER BY pipeline.is_default DESC, pipeline.created_at, pipeline.id LIMIT 1 FOR SHARE`, [workspaceId]);
        if (!pipeline.rowCount) throw new UnprocessableEntityException("A workspace administrator needs to configure an active CRM pipeline before this pre-execution can start.");
        const opportunity = await this.opportunities.createQualifiedHandoff(client, workspaceId, {
          partyId: lead.party_id, leadId: lead.id, pipelineId: pipeline.rows[0].id,
          title: lead.title, description: lead.summary ?? undefined,
          ownerMembershipId: input.ownerMembershipId, nextActionAt: input.nextActionAt,
        }, user.userId, {
          origin: "pre_project_start",
          requestHash: canonicalHash({
            leadId: lead.id, leadVersion: input.version, pipelineId: pipeline.rows[0].id,
            ownerMembershipId: input.ownerMembershipId, nextActionAt: input.nextActionAt,
          }),
          qualificationEvidence: lead.qualification_evidence,
          qualificationEvidenceHash: String(lead.qualification_evidence_hash),
        });
        opportunityId = String(opportunity.id);
        await client.query(`UPDATE crm_leads SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, lead.id]);
      }
      const created = await client.query(`INSERT INTO pre_project_cases (workspace_id, opportunity_id, owner_membership_id, activated_at, created_by)
        SELECT opportunity.workspace_id, opportunity.id, COALESCE(CASE WHEN active_owner_account.id IS NOT NULL THEN active_owner.id END, actor_membership.id), now(), $3
        FROM crm_opportunities opportunity
        JOIN workspace_memberships actor_membership ON actor_membership.workspace_id = opportunity.workspace_id AND actor_membership.user_id = $3 AND actor_membership.status = 'active'
        LEFT JOIN workspace_memberships active_owner ON active_owner.workspace_id = opportunity.workspace_id AND active_owner.id = opportunity.owner_membership_id AND active_owner.status = 'active'
        LEFT JOIN users active_owner_account ON active_owner_account.id = active_owner.user_id AND active_owner_account.status = 'active'
        WHERE opportunity.workspace_id = $1 AND opportunity.id = $2
        RETURNING id`, [workspaceId, opportunityId, user.userId]);
      await ensureJobForSource(client, workspaceId, { type: "case", id: String(created.rows[0].id) }, user.userId);
      await assignDesignerToCase(client, workspaceId, String(created.rows[0].id));
      // PLM-100: the team tagged on the enquiry and the opportunity joins the case, role by role.
      const team = await carryTeamToCase(client, workspaceId, String(created.rows[0].id), user.userId);
      // Site check-in works for the job straight away when the property's position is known.
      await ensureSiteLocation(client, { workspaceId, opportunityId, actorUserId: user.userId });
      const result = await this.read(client, workspaceId, created.rows[0].id);
      await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: "pre_project.case_started.v1", entityType: "pre_project_case", entityId: result.id, after: { id: result.id, opportunityId, leadId: lead.id, team } });
      return result;
    });
  }

  get(actor: RequestActor, workspaceId: string, id: string) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client, user) => ({
      ...await this.read(client, workspaceId, id),
      // PLM-100: the case's team by role (a person or "not applicable"), as tagged on the enquiry and the opportunity.
      team: await readCaseTeam(client, workspaceId, id),
      canManageLifecycle: await this.access.hasPermission(client, workspaceId, user.userId, "pre_projects.manage_lifecycle"),
      canEditDetails: await this.canEditDetails(client, workspaceId, id, user.userId),
    }));
  }

  /** Whoever manages cases, and the case's own owner, may change its details (owner, target, priority, risk). */
  private async canEditDetails(client: PoolClient, workspaceId: string, caseId: string, userId: string) {
    if (await this.access.hasPermission(client, workspaceId, userId, "pre_projects.manage_lifecycle")) return true;
    const owner = await client.query(
      `SELECT 1 FROM pre_project_cases engagement
         JOIN workspace_memberships membership ON membership.workspace_id = engagement.workspace_id AND membership.id = engagement.owner_membership_id AND membership.status = 'active'
        WHERE engagement.workspace_id = $1 AND engagement.id = $2 AND membership.user_id = $3`, [workspaceId, caseId, userId]);
    return Boolean(owner.rowCount);
  }

  start(actor: RequestActor, workspaceId: string, opportunityId: string) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.create", "crm.opportunities.view"], async (client, user) => {
      // Lock the source: concurrent starts and CRM status changes cannot race this decision.
      const source = await client.query(`SELECT id, status FROM crm_opportunities WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, opportunityId]);
      if (!source.rowCount) throw new NotFoundException("Opportunity not found");
      const existing = await client.query(`SELECT id FROM pre_project_cases WHERE workspace_id = $1 AND opportunity_id = $2`, [workspaceId, opportunityId]);
      if (existing.rowCount) return this.read(client, workspaceId, existing.rows[0].id);
      if (!["open", "won"].includes(source.rows[0].status)) throw new ConflictException("Reopen the opportunity in CRM before starting a pre-execution.");
      const created = await client.query(`INSERT INTO pre_project_cases (workspace_id, opportunity_id, owner_membership_id, activated_at, created_by)
        SELECT opportunity.workspace_id, opportunity.id, COALESCE(CASE WHEN active_owner_account.id IS NOT NULL THEN active_owner.id END, actor_membership.id), now(), $3
        FROM crm_opportunities opportunity
        JOIN workspace_memberships actor_membership ON actor_membership.workspace_id = opportunity.workspace_id AND actor_membership.user_id = $3 AND actor_membership.status = 'active'
        LEFT JOIN workspace_memberships active_owner ON active_owner.workspace_id = opportunity.workspace_id AND active_owner.id = opportunity.owner_membership_id AND active_owner.status = 'active'
        LEFT JOIN users active_owner_account ON active_owner_account.id = active_owner.user_id AND active_owner_account.status = 'active'
        WHERE opportunity.workspace_id = $1 AND opportunity.id = $2
        RETURNING id`, [workspaceId, opportunityId, user.userId]);
      await ensureJobForSource(client, workspaceId, { type: "case", id: String(created.rows[0].id) }, user.userId);
      await assignDesignerToCase(client, workspaceId, String(created.rows[0].id));
      // PLM-100: the team tagged on the enquiry and the opportunity joins the case, role by role.
      const team = await carryTeamToCase(client, workspaceId, String(created.rows[0].id), user.userId);
      // Site check-in works for the job straight away when the property's position is known.
      await ensureSiteLocation(client, { workspaceId, opportunityId, actorUserId: user.userId });
      const result = await this.read(client, workspaceId, created.rows[0].id);
      await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: "pre_project.case_started.v1", entityType: "pre_project_case", entityId: result.id, after: { id: result.id, opportunityId, team } });
      return result;
    });
  }

  updateProfile(actor: RequestActor, workspaceId: string, id: string, input: UpdateEngagementProfileDto) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view"], async (client, user) => {
      if (!(await this.canEditDetails(client, workspaceId, id, user.userId)))
        throw new ForbiddenException("Only the case owner or someone who manages cases can change these details.");
      const hash = canonicalHash({ action: "update_profile", caseId: id, ...input });
      const replay = await this.replay(client, workspaceId, id, input.requestId, "update_profile", hash);
      if (replay) return replay;
      const before = await this.lifecycleRecord(client, workspaceId, id, true);
      const concurrentReplay = await this.reserve(client, workspaceId, id, input.requestId, "update_profile", hash, user.userId);
      if (concurrentReplay) return concurrentReplay;
      this.assertVersion(before.version, input.version);
      if (!["draft", "active", "on_hold"].includes(before.status)) {
        throw new ConflictException("Released or cancelled pre-execution details cannot be changed.");
      }
      const hasOwner = input.ownerMembershipId !== undefined;
      const hasTargetDate = input.targetDate !== undefined;
      const hasPriority = input.priority !== undefined;
      const hasRisk = input.riskLevel !== undefined;
      if (!hasOwner && !hasTargetDate && !hasPriority && !hasRisk) {
        throw new BadRequestException("Choose at least one pre-execution detail to update.");
      }
      if (input.ownerMembershipId) {
        const owner = await client.query(`SELECT 1 FROM workspace_memberships membership JOIN users account ON account.id = membership.user_id WHERE membership.workspace_id = $1 AND membership.id = $2 AND membership.status = 'active' AND account.status = 'active'`, [workspaceId, input.ownerMembershipId]);
        if (!owner.rowCount) throw new BadRequestException("Choose an active member from this organisation as the pre-execution owner.");
      }
      const updated = await client.query(`UPDATE pre_project_cases SET
          owner_membership_id = CASE WHEN $3 THEN $4::uuid ELSE owner_membership_id END,
          target_date = CASE WHEN $5 THEN $6::date ELSE target_date END,
          priority = CASE WHEN $7 THEN $8::varchar ELSE priority END,
          risk_level = CASE WHEN $9 THEN $10::varchar ELSE risk_level END,
          version = version + 1, updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND version = $11
        RETURNING id`, [workspaceId, id, hasOwner, input.ownerMembershipId ?? null, hasTargetDate, input.targetDate ?? null, hasPriority, input.priority ?? null, hasRisk, input.riskLevel ?? null, input.version]);
      if (!updated.rowCount) throw new ConflictException("This pre-execution changed. Reload it before saving.");
      const result = await this.read(client, workspaceId, id);
      await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: "pre_project.engagement_profile_updated.v1", entityType: "pre_project_case", entityId: id, correlationId: input.requestId, before, after: result });
      await this.complete(client, workspaceId, input.requestId, result);
      return result;
    });
  }

  transition(actor: RequestActor, workspaceId: string, id: string, input: TransitionEngagementDto) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.manage_lifecycle"], async (client, user) => {
      const hash = canonicalHash({ caseId: id, ...input });
      const replay = await this.replay(client, workspaceId, id, input.requestId, input.action, hash);
      if (replay) return replay;
      const before = await this.lifecycleRecord(client, workspaceId, id, true);
      const concurrentReplay = await this.reserve(client, workspaceId, id, input.requestId, input.action, hash, user.userId);
      if (concurrentReplay) return concurrentReplay;
      this.assertVersion(before.version, input.version);
      if (input.action === "reopen" && !["open", "won"].includes(before.opportunityStatus)) {
        throw new ConflictException("Reopen the linked CRM opportunity before reopening this pre-execution.");
      }
      const next = transitionEngagement(before, input.action, { phase: input.phase, reason: input.reason }, user.userId);
      const updated = await client.query(`UPDATE pre_project_cases SET
          status = $3, phase = $4, activated_at = $5, hold_reason = $6, held_at = $7, held_by = $8,
          cancellation_reason = $9, cancelled_at = $10, cancelled_by = $11,
          version = version + 1, updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND version = $12
        RETURNING id`, [workspaceId, id, next.status, next.phase, next.activatedAt, next.holdReason, next.heldAt, next.heldBy, next.cancellationReason, next.cancelledAt, next.cancelledBy, input.version]);
      if (!updated.rowCount) throw new ConflictException("This pre-execution changed. Reload it before continuing.");
      const result = await this.read(client, workspaceId, id);
      await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: `pre_project.${next.event}.v1`, entityType: "pre_project_case", entityId: id, correlationId: input.requestId, before, after: { ...result, transitionReason: next.reason } });
      await this.complete(client, workspaceId, input.requestId, result);
      return result;
    });
  }

  private async read(client: PoolClient, workspaceId: string, id: string) {
    const result = await client.query(`${caseSelect} WHERE c.workspace_id = $1 AND c.id = $2`, [workspaceId, id]);
    if (!result.rowCount) throw new NotFoundException("Pre-execution not found");
    return result.rows[0];
  }

  private async lifecycleRecord(client: PoolClient, workspaceId: string, id: string, lock = false): Promise<LifecycleRow> {
    const result = await client.query(`SELECT engagement.id, engagement.status::text AS status, engagement.phase,
      engagement.version, engagement.activated_at AS "activatedAt", engagement.hold_reason AS "holdReason",
      engagement.held_at AS "heldAt", engagement.held_by AS "heldBy",
      engagement.cancellation_reason AS "cancellationReason", engagement.cancelled_at AS "cancelledAt",
      engagement.cancelled_by AS "cancelledBy", opportunity.status::text AS "opportunityStatus"
      FROM pre_project_cases engagement
      JOIN crm_opportunities opportunity ON opportunity.workspace_id = engagement.workspace_id AND opportunity.id = engagement.opportunity_id
      WHERE engagement.workspace_id = $1 AND engagement.id = $2${lock ? " FOR UPDATE OF engagement" : ""}`, [workspaceId, id]);
    if (!result.rowCount) throw new NotFoundException("Pre-execution not found");
    return result.rows[0] as LifecycleRow;
  }

  private assertVersion(actual: number, expected: number) {
    if (Number(actual) !== expected) throw new ConflictException("This pre-execution changed. Reload it before continuing.");
  }

  private async replay(client: PoolClient, workspaceId: string, caseId: string, requestId: string, action: string, hash: string): Promise<Record<string, unknown> | undefined> {
    const result = await client.query(`SELECT case_id AS "caseId", action, request_hash AS "requestHash", response_body AS "responseBody" FROM pre_project_lifecycle_commands WHERE workspace_id = $1 AND request_id = $2`, [workspaceId, requestId]);
    if (!result.rowCount) return undefined;
    const prior = result.rows[0];
    if (prior.caseId !== caseId || prior.action !== action || prior.requestHash !== hash) {
      throw new ConflictException("This request ID was already used for a different pre-execution change.");
    }
    if (!prior.responseBody) throw new ConflictException("This pre-execution change is still being processed.");
    return prior.responseBody as Record<string, unknown>;
  }

  private async reserve(client: PoolClient, workspaceId: string, caseId: string, requestId: string, action: string, hash: string, actorUserId: string): Promise<Record<string, unknown> | undefined> {
    const inserted = await client.query(`INSERT INTO pre_project_lifecycle_commands (workspace_id, request_id, case_id, action, request_hash, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT(workspace_id, request_id) DO NOTHING RETURNING request_id`, [workspaceId, requestId, caseId, action, hash, actorUserId]);
    return inserted.rowCount ? undefined : this.replay(client, workspaceId, caseId, requestId, action, hash);
  }

  private complete(client: PoolClient, workspaceId: string, requestId: string, response: Record<string, unknown>) {
    return client.query(`UPDATE pre_project_lifecycle_commands SET response_body = $3 WHERE workspace_id = $1 AND request_id = $2 AND response_body IS NULL`, [workspaceId, requestId, response]);
  }
}
