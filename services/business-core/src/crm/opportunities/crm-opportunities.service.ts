import { loadEnquiryFacts, ProblemList, requirementContext, requirementProblems, throwProblems } from "../leads/enquiry-problems";
import { carryTeamToOpportunity, teamRolesForType } from "../leads/lead-team";
import { OpportunityDiscoveryService } from "./discovery.service";
import { opportunityFunnel } from "./opportunity-funnel";
import { flowSummary, loadFlowFacts, paymentProofs, pipelineStages } from "./flow-facts";
import { flowAsks, moveBlockers } from "../flows/flow-interpreter";
import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException, Optional } from "@nestjs/common";
import { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { ensureJobForSource } from "../../jobs/job-identity.store";
import { CrmEventsService } from "../shared/crm-events.service";
import { canonicalHash, decodeCursor, encodeCursor, normalizeName } from "../shared/crm-types";
import { CrmSlaLifecycleService } from "../leads/crm-sla-lifecycle.service";
import { evaluateQualification, QualificationEvidence } from "../leads/qualification-evidence";
import { hasResolvedEnquiryType, loadLeadOptions } from "../leads/lead-options";
import { thankForDeal } from "../conversations/inbox/client-followups";
import { markProposalWon, type ProposalKind } from "./opportunity-proposals";
import { tellDealOutcome } from "../leads/sales-attention";
import { ELIGIBLE_SALES_OWNERS_SQL, SALES_OWNER_PERMISSIONS } from "../leads/crm-leads.service";
import { loadDealClosing } from "./deal-closing";
import { takeForDeal } from "../../fulfilment/stock-reservations";
import { cancelOpenFollowUps } from "./follow-ups";
import { ownOpportunitySql, ownRecordsScope } from "../shared/record-scope";
import {
  AddStakeholderDto,
  CreateOpportunityDto,
  CreatePipelineDto,
  CreateProjectLinkDto,
  ListOpportunitiesQueryDto,
  OpportunityTeamMemberDto,
  PipelineStageDto,
  QualificationOutcomeDto,
  QualifyLeadDto,
  TransitionOpportunityDto,
  UpdateOpportunityDto,
  UpdatePipelineDto,
  UpdatePipelineStageDto,
} from "./dto/opportunities.dto";

type Row = Record<string, unknown>;
export type ConversionContext = {
  origin: "lead_qualification" | "pre_project_start";
  requestHash: string;
  qualificationEvidence: QualificationEvidence | Record<string, unknown>;
  qualificationEvidenceHash: string;
};

@Injectable()
export class CrmOpportunitiesService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
    private readonly slas: CrmSlaLifecycleService = new CrmSlaLifecycleService(),
    @Optional() private readonly discovery?: OpportunityDiscoveryService,
  ) {}

  listPipelines(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.view", async (client) => {
      const result = await client.query(
        `SELECT pipeline.id, pipeline.code, pipeline.name, pipeline.status,
                pipeline.is_default AS "isDefault", pipeline.version,
                COALESCE(jsonb_agg(jsonb_build_object(
                  'id', stage.id, 'code', stage.code, 'name', stage.name,
                  'position', stage.position, 'probability', stage.probability,
                  'forecastCategory', stage.forecast_category,
                  'entryRequirements', stage.entry_requirements, 'status', stage.status, 'version', stage.version
                ) ORDER BY stage.position) FILTER (WHERE stage.id IS NOT NULL), '[]'::jsonb) AS stages
         FROM crm_pipelines pipeline
         LEFT JOIN crm_pipeline_stages stage ON stage.pipeline_id = pipeline.id
          AND stage.workspace_id = pipeline.workspace_id
         WHERE pipeline.workspace_id = $1
         GROUP BY pipeline.id ORDER BY pipeline.is_default DESC, pipeline.name`,
        [workspaceId],
      );
      return result.rows;
    });
  }

  createPipeline(actor: RequestActor, workspaceId: string, input: CreatePipelineDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const positions = new Set(input.stages.map((stage) => stage.position));
      const codes = new Set(input.stages.map((stage) => stage.code));
      if (positions.size !== input.stages.length || codes.size !== input.stages.length) {
        throw new UnprocessableEntityException("Stage codes and positions must be unique");
      }
      for (const stage of input.stages) this.validateRequirements(stage.entryRequirements ?? {});
      if (input.isDefault) {
        await client.query(`UPDATE crm_pipelines SET is_default = false, version = version + 1 WHERE workspace_id = $1 AND is_default`, [workspaceId]);
      }
      const pipelineResult = await client.query(
        `INSERT INTO crm_pipelines (workspace_id, code, name, is_default)
         VALUES ($1, lower($2), $3, $4)
         RETURNING id, code, name, status, is_default AS "isDefault", version`,
        [workspaceId, input.code, input.name, input.isDefault ?? false],
      );
      const pipeline = pipelineResult.rows[0] as Row;
      const stages: Row[] = [];
      for (const stage of input.stages) {
        const result = await client.query(
          `INSERT INTO crm_pipeline_stages
            (workspace_id, pipeline_id, code, name, position, probability, forecast_category, entry_requirements)
           VALUES ($1, $2, lower($3), $4, $5, $6, $7, $8)
           RETURNING id, code, name, position, probability,
                     forecast_category AS "forecastCategory", entry_requirements AS "entryRequirements", status, version`,
          [workspaceId, pipeline.id, stage.code, stage.name, stage.position, stage.probability, stage.forecastCategory ?? "pipeline", stage.entryRequirements ?? {}],
        );
        stages.push(result.rows[0] as Row);
      }
      const response = { ...pipeline, stages };
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.pipeline.created.v1", entityType: "crm_pipeline", entityId: String(pipeline.id), after: response });
      return response;
    });
  }

  updatePipeline(actor: RequestActor, workspaceId: string, pipelineId: string, input: UpdatePipelineDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const existing = await client.query<Row>(`SELECT * FROM crm_pipelines WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, pipelineId]);
      if (!existing.rowCount) throw new NotFoundException("Pipeline not found");
      const before = existing.rows[0];
      if (Number(before.version) !== input.version) throw new ConflictException("Pipeline changed; reload and try again");
      if (input.status === "archived") {
        const open = await client.query(`SELECT 1 FROM crm_opportunities WHERE workspace_id = $1 AND pipeline_id = $2 AND status = 'open' LIMIT 1`, [workspaceId, pipelineId]);
        if (open.rowCount) throw new ConflictException("Move or close open opportunities before archiving this pipeline");
      }
      const removesDefault = (input.isDefault === false || input.status === "archived") && Boolean(before.is_default);
      if (removesDefault) {
        const alternative = await client.query(`SELECT 1 FROM crm_pipelines WHERE workspace_id = $1 AND id <> $2 AND status = 'active' AND is_default LIMIT 1`, [workspaceId, pipelineId]);
        if (!alternative.rowCount) throw new ConflictException("Select another default pipeline first");
      }
      if (input.isDefault) await client.query(`UPDATE crm_pipelines SET is_default = false, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id <> $2 AND is_default`, [workspaceId, pipelineId]);
      const result = await client.query(
        `UPDATE crm_pipelines SET name = COALESCE($1, name), is_default = COALESCE($2, is_default),
           status = COALESCE($3, status), version = version + 1, updated_at = now()
         WHERE workspace_id = $4 AND id = $5 AND version = $6
         RETURNING id, code, name, status, is_default AS "isDefault", version`,
        [input.name?.trim() ?? null, input.isDefault ?? null, input.status ?? null, workspaceId, pipelineId, input.version],
      );
      if (!result.rowCount) throw new ConflictException("Pipeline changed; reload and try again");
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.pipeline.updated.v1", entityType: "crm_pipeline", entityId: pipelineId, before, after: result.rows[0] as Row });
      return result.rows[0];
    });
  }

  createPipelineStage(actor: RequestActor, workspaceId: string, pipelineId: string, input: PipelineStageDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      this.validateRequirements(input.entryRequirements ?? {});
      const pipeline = await client.query(`SELECT 1 FROM crm_pipelines WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, pipelineId]);
      if (!pipeline.rowCount) throw new NotFoundException("Active pipeline not found");
      const result = await client.query(
        `INSERT INTO crm_pipeline_stages (workspace_id, pipeline_id, code, name, position, probability, forecast_category, entry_requirements)
         VALUES ($1,$2,lower($3),$4,$5,$6,$7,$8)
         RETURNING id, code, name, position, probability, forecast_category AS "forecastCategory", entry_requirements AS "entryRequirements", status, version`,
        [workspaceId, pipelineId, input.code, input.name, input.position, input.probability, input.forecastCategory ?? "pipeline", input.entryRequirements ?? {}],
      );
      const response = result.rows[0] as Row;
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.pipeline.stage_created.v1", entityType: "crm_pipeline_stage", entityId: String(response.id), after: response });
      return response;
    });
  }

  updatePipelineStage(actor: RequestActor, workspaceId: string, pipelineId: string, stageId: string, input: UpdatePipelineStageDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      if (input.entryRequirements) this.validateRequirements(input.entryRequirements);
      const existing = await client.query<Row>(`SELECT * FROM crm_pipeline_stages WHERE workspace_id = $1 AND pipeline_id = $2 AND id = $3 FOR UPDATE`, [workspaceId, pipelineId, stageId]);
      if (!existing.rowCount) throw new NotFoundException("Pipeline stage not found");
      const before = existing.rows[0];
      if (Number(before.version) !== input.version) throw new ConflictException("Pipeline stage changed; reload and try again");
      if (input.status === "archived") {
        const open = await client.query(`SELECT 1 FROM crm_opportunities WHERE workspace_id = $1 AND stage_id = $2 AND status = 'open' LIMIT 1`, [workspaceId, stageId]);
        if (open.rowCount) throw new ConflictException("Move open opportunities before archiving this stage");
        const remaining = await client.query(`SELECT count(*)::int AS count FROM crm_pipeline_stages WHERE workspace_id = $1 AND pipeline_id = $2 AND id <> $3 AND status = 'active'`, [workspaceId, pipelineId, stageId]);
        if (Number(remaining.rows[0]?.count) === 0) throw new ConflictException("A pipeline needs at least one active stage");
      }
      const result = await client.query(
        `UPDATE crm_pipeline_stages SET name = COALESCE($1, name), position = COALESCE($2, position),
           probability = COALESCE($3, probability), forecast_category = COALESCE($4, forecast_category),
           entry_requirements = COALESCE($5, entry_requirements), status = COALESCE($6, status),
           version = version + 1, updated_at = now()
         WHERE workspace_id = $7 AND pipeline_id = $8 AND id = $9 AND version = $10
         RETURNING id, code, name, position, probability, forecast_category AS "forecastCategory",
                   entry_requirements AS "entryRequirements", status, version`,
        [input.name?.trim() ?? null, input.position ?? null, input.probability ?? null, input.forecastCategory ?? null, input.entryRequirements ?? null, input.status ?? null, workspaceId, pipelineId, stageId, input.version],
      );
      if (!result.rowCount) throw new ConflictException("Pipeline stage changed; reload and try again");
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.pipeline.stage_updated.v1", entityType: "crm_pipeline_stage", entityId: stageId, before, after: result.rows[0] as Row });
      return result.rows[0];
    });
  }

  list(actor: RequestActor, workspaceId: string, query: ListOpportunitiesQueryDto) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.view", async (client, actorUser) => {
      const cursor = decodeCursor(query.cursor);
      if (query.cursor && !cursor) throw new BadRequestException("Invalid page cursor");
      const values: unknown[] = [workspaceId];
      const clauses = ["opportunity.workspace_id = $1"];
      for (const [column, value] of [["party_id", query.partyId], ["pipeline_id", query.pipelineId], ["stage_id", query.stageId], ["owner_membership_id", query.ownerMembershipId]] as const) {
        if (value) { values.push(value); clauses.push(`opportunity.${column} = $${values.length}`); }
      }
      if (query.status) { values.push(query.status); clauses.push(`opportunity.status = $${values.length}::crm_opportunity_status`); }
      if (query.proposal2 === "withdrawn") clauses.push(`EXISTS (SELECT 1 FROM crm_opportunity_proposals withdrawn WHERE withdrawn.workspace_id = opportunity.workspace_id
        AND withdrawn.opportunity_id = opportunity.id AND withdrawn.kind = 'main' AND withdrawn.withdrawal_status = 'confirmed')`);
      // §0.3 P0 (guide C): without the right to see every enquiry, only one's own opportunities.
      const own = await ownRecordsScope(client, this.access, workspaceId, actorUser.userId);
      if (own) { values.push(own); clauses.push(ownOpportunitySql("opportunity", `$${values.length}`)); }
      if (query.search) { values.push(normalizeName(query.search)); clauses.push(`(party.normalized_name % $${values.length} OR lower(opportunity.title) LIKE '%' || $${values.length} || '%')`); }
      if (cursor) { values.push(cursor.value, cursor.id); clauses.push(`(opportunity.created_at, opportunity.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`); }
      values.push(query.limit + 1);
      const result = await client.query(
        `${this.baseSelect()} WHERE ${clauses.join(" AND ")}
         ORDER BY opportunity.created_at DESC, opportunity.id DESC LIMIT $${values.length}`,
        values,
      );
      const hasMore = result.rows.length > query.limit;
      const rawData = hasMore ? result.rows.slice(0, query.limit) : result.rows;
      const canViewSensitiveValues = await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.opportunities.sensitive_values");
      const presented = rawData.map((row) => this.presentOpportunity(row as Row, canViewSensitiveValues));
      // PLM-102: a won card shows Deal Closed, computed from the records its enquiry type's closing event names.
      const data = [];
      for (const row of presented) {
        if ((row as { status?: string }).status !== "won") { data.push(row); continue; }
        const closing = await loadDealClosing(client, workspaceId, String((row as { id: string }).id));
        data.push({ ...row, dealClosed: closing?.closed ?? false, dealClosedAt: closing?.closedAt ?? null });
      }
      const last = data.at(-1) as { id: string; createdAt: Date } | undefined;
      return { data, nextCursor: hasMore && last ? encodeCursor({ value: new Date(last.createdAt).toISOString(), id: last.id }) : null };
    });
  }

  get(actor: RequestActor, workspaceId: string, opportunityId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.view", async (client, actorUser) => {
      const opportunity = await this.requireOpportunity(client, workspaceId, opportunityId, false);
      const own = await ownRecordsScope(client, this.access, workspaceId, actorUser.userId);
      if (own && !(await client.query(`SELECT 1 FROM crm_opportunities opportunity WHERE opportunity.workspace_id = $1 AND opportunity.id = $2 AND ${ownOpportunitySql("opportunity", "$3")}`, [workspaceId, opportunityId, own])).rowCount)
        throw new NotFoundException("Opportunity not found");
      const stakeholders = await client.query(`SELECT stakeholder.party_id AS "partyId", party.display_name AS "partyName", stakeholder.role, stakeholder.influence, stakeholder.is_primary AS "isPrimary" FROM crm_opportunity_stakeholders stakeholder JOIN crm_parties party ON party.id = stakeholder.party_id AND party.workspace_id = stakeholder.workspace_id WHERE stakeholder.workspace_id = $1 AND stakeholder.opportunity_id = $2 ORDER BY stakeholder.is_primary DESC, stakeholder.role`, [workspaceId, opportunityId]);
      const team = await client.query(`SELECT team.membership_id AS "membershipId", account.display_name AS name, team.role FROM crm_opportunity_team team JOIN workspace_memberships membership ON membership.id = team.membership_id JOIN users account ON account.id = membership.user_id WHERE team.workspace_id = $1 AND team.opportunity_id = $2 ORDER BY team.role, account.display_name`, [workspaceId, opportunityId]);
      const history = await client.query(`SELECT history.id, history.from_stage_id AS "fromStageId", from_stage.name AS "fromStageName", history.to_stage_id AS "toStageId", to_stage.name AS "toStageName", history.from_status AS "fromStatus", history.to_status AS "toStatus", history.reason, history.changed_at AS "changedAt" FROM crm_stage_history history LEFT JOIN crm_pipeline_stages from_stage ON from_stage.id = history.from_stage_id LEFT JOIN crm_pipeline_stages to_stage ON to_stage.id = history.to_stage_id WHERE history.workspace_id = $1 AND history.opportunity_id = $2 ORDER BY history.changed_at DESC`, [workspaceId, opportunityId]);
      const snapshots = await client.query(`SELECT id, owner_membership_id AS "ownerMembershipId", stage_id AS "stageId", status, amount, currency_code AS "currencyCode", reporting_amount AS "reportingAmount", reporting_currency_code AS "reportingCurrencyCode", probability, snapshot_reason AS "snapshotReason", captured_at AS "capturedAt" FROM crm_forecast_snapshots WHERE workspace_id = $1 AND opportunity_id = $2 ORDER BY captured_at DESC`, [workspaceId, opportunityId]);
      const project = await client.query(`SELECT id, project_id AS "projectId", mode, linked_at AS "linkedAt", promoted_at AS "promotedAt", version FROM crm_project_links WHERE workspace_id = $1 AND opportunity_id = $2`, [workspaceId, opportunityId]);
      const canViewSensitiveValues = await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.opportunities.sensitive_values");
      return {
        ...this.presentOpportunity(opportunity, canViewSensitiveValues),
        stakeholders: stakeholders.rows,
        team: team.rows,
        stageHistory: history.rows,
        forecastHistory: canViewSensitiveValues ? snapshots.rows : snapshots.rows.map((row) => this.presentOpportunity(row as Row, false)),
        projectLink: project.rows[0] ?? null,
        funnel: await opportunityFunnel(client, workspaceId, opportunityId, this.discovery ? (await this.discovery.missing(client, workspaceId, opportunityId)).length : null),
        flow: await this.flowView(client, workspaceId, opportunity, actorUser.userId),
      };
    });
  }

  create(actor: RequestActor, workspaceId: string, input: CreateOpportunityDto) {
    if (input.leadId) throw new UnprocessableEntityException("Use the lead qualification action to create a linked opportunity and preserve its lifecycle");
    const permissions = ["crm.opportunities.manage"];
    if (input.amount !== undefined || input.currencyCode !== undefined) permissions.push("crm.opportunities.sensitive_values");
    return this.access.withPermissions(actor, workspaceId, permissions, async (client, actorUser) => {
      const response = await this.createInTransaction(client, workspaceId, input, actorUser.userId, false);
      return this.presentOpportunity(response, permissions.length > 1);
    });
  }

  qualifyLead(actor: RequestActor, workspaceId: string, leadId: string, input: QualifyLeadDto) {
    const permissions = ["crm.opportunities.manage", "crm.leads.manage"];
    if (input.amount !== undefined || input.currencyCode !== undefined) permissions.push("crm.opportunities.sensitive_values");
    return this.access.withPermissions(actor, workspaceId, permissions, async (client, actorUser) => {
      const lead = await client.query<Row>(`SELECT * FROM crm_leads WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, leadId]);
      if (!lead.rowCount) throw new NotFoundException("Lead not found");
      const row = lead.rows[0];
      const requestHash = canonicalHash({ leadId, ...input });
      const existing = await client.query<{ id: string; conversion_request_hash: string | null }>(
        `SELECT id,conversion_request_hash FROM crm_opportunities WHERE workspace_id=$1 AND lead_id=$2`,
        [workspaceId, leadId],
      );
      if (existing.rowCount) {
        if (existing.rows[0].conversion_request_hash !== requestHash) {
          throw new ConflictException("This lead was already converted with different details");
        }
        const replay = await this.requireOpportunity(client, workspaceId, existing.rows[0].id, false);
        const canViewSensitiveValues = permissions.includes("crm.opportunities.sensitive_values")
          || await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.opportunities.sensitive_values");
        return { ...this.presentOpportunity(replay, canViewSensitiveValues), conversionReplay: true };
      }
      if (Number(row.version) !== input.leadVersion) throw new ConflictException("Lead changed; reload and try again");
      if (["disqualified", "paused"].includes(String(row.status))) throw new UnprocessableEntityException("Reopen the lead before qualification");
      if (input.leadId && input.leadId !== leadId) throw new UnprocessableEntityException("leadId does not match the route");
      if (String(row.party_id) !== input.partyId) throw new UnprocessableEntityException("Opportunity party must match the lead party");
      const qualification = row.status === "qualified" && row.qualification_evidence && row.qualification_evidence_hash
        && hasResolvedEnquiryType(String((row.qualification_evidence as Record<string, unknown>).serviceType ?? ""))
        ? {
          evidence: row.qualification_evidence as Record<string, unknown>,
          evidenceHash: String(row.qualification_evidence_hash),
        }
        : await evaluateQualification(client, workspaceId, leadId, {}, true);
      // PLM-096 / PLM-092: everything the enquiry type requires before converting, named at once.
      const facts = await loadEnquiryFacts(client, workspaceId, leadId);
      if (facts) {
        const context = await requirementContext(client, workspaceId, facts.serviceType, await teamRolesForType(client, workspaceId, facts.serviceType));
        throwProblems(requirementProblems(facts, context, "convert"), "Complete the enquiry before converting");
      }
      const conversion: ConversionContext = {
        origin: "lead_qualification",
        requestHash,
        qualificationEvidence: qualification.evidence,
        qualificationEvidenceHash: qualification.evidenceHash,
      };
      const opportunity = await this.createInTransaction(client, workspaceId, { ...input, leadId }, actorUser.userId, true, conversion);
      // PLM-100: the enquiry's team (and its designer) carries into the opportunity.
      await carryTeamToOpportunity(client, workspaceId, leadId, String(opportunity.id), actorUser.userId);
      // §0.3 P0: no floor plan yet, only an estimate: the owner gets a task to get the real plan before the site visit.
      if (facts?.floorPlan?.status === "not_available")
        await client.query(`INSERT INTO crm_activities (workspace_id, party_id, opportunity_id, type, title, description, owner_membership_id, is_next_action, created_by)
          VALUES ($1,$2,$3,'task','Get the floor plan before the site visit',$4,$5,false,$6)`,
          [workspaceId, opportunity.party_id, opportunity.id, facts.floorPlan.builtUpArea ? `Estimate given: ${facts.floorPlan.builtUpArea}` : null, opportunity.owner_membership_id ?? null, actorUser.userId]);
      const updated = await client.query(
        `UPDATE crm_leads SET status='qualified',next_action_at=NULL,
           qualified_at=COALESCE(qualified_at,now()),qualification_evidence=$4,
           qualification_evidence_hash=$5,qualified_by=COALESCE(qualified_by,$6),
           closed_at=now(),version=version+1
         WHERE workspace_id = $1 AND id = $2 AND version = $3 RETURNING *`,
        [workspaceId, leadId, input.leadVersion, qualification.evidence, qualification.evidenceHash, actorUser.userId],
      );
      if (!updated.rowCount) throw new ConflictException("Lead changed; reload and try again");
      await client.query(`UPDATE crm_enquiries SET status = 'qualified', closed_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, row.enquiry_id]);
      await this.slas.recordFirstResponse(client, workspaceId, leadId, {
        sourceType: "lead_status",
        sourceId: leadId,
        actorUserId: actorUser.userId,
        respondedAt: new Date(),
        details: { fromStatus: row.status, toStatus: "qualified", opportunityId: opportunity.id },
      });
      await client.query(`UPDATE crm_activities SET opportunity_id = $3, is_next_action = false, version = version + 1 WHERE workspace_id = $1 AND lead_id = $2 AND opportunity_id IS NULL`, [workspaceId, leadId, opportunity.id]);
      // SLA reconciliation may derive the lead's next action before its activities
      // are transferred. A converted lead is closed, so its follow-up belongs only
      // to the opportunity created above.
      await client.query(`UPDATE crm_leads SET next_action_at=NULL WHERE workspace_id=$1 AND id=$2`, [workspaceId, leadId]);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.lead.qualified.v1", entityType: "crm_lead", entityId: leadId, before: row, after: updated.rows[0] as Row });
      return this.presentOpportunity(opportunity, permissions.includes("crm.opportunities.sensitive_values"));
    });
  }

  update(actor: RequestActor, workspaceId: string, opportunityId: string, input: UpdateOpportunityDto) {
    const permissions = ["crm.opportunities.manage"];
    if (input.amount !== undefined || input.currencyCode !== undefined) permissions.push("crm.opportunities.sensitive_values");
    return this.access.withPermissions(actor, workspaceId, permissions, async (client, actorUser) => {
      const before = await this.requireOpportunity(client, workspaceId, opportunityId, true);
      if (Number(before.version) !== input.version) throw new ConflictException("Opportunity changed; reload and try again");
      // A new owner is someone who can own enquiries (the same rule as the owner pickers); an unchanged one stays.
      if (input.ownerMembershipId && input.ownerMembershipId !== before.owner_membership_id) await this.requireSalesOwner(client, workspaceId, input.ownerMembershipId);
      const hasAmount = input.amount !== undefined;
      const hasCurrency = input.currencyCode !== undefined;
      const amount = hasAmount ? input.amount ?? null : before.amount;
      const currency: string | null = hasCurrency
        ? input.currencyCode?.toUpperCase() ?? null
        : typeof before.currency_code === "string" ? before.currency_code : null;
      if ((amount == null) !== (currency == null)) throw new UnprocessableEntityException("Amount and currency must be supplied or cleared together");
      if (currency) await this.requireCurrency(client, currency);
      const expectedClose = input.expectedCloseAt !== undefined ? this.date(input.expectedCloseAt, "expectedCloseAt") : before.expected_close_at;
      const nextAction = input.nextActionAt !== undefined ? this.date(input.nextActionAt, "nextActionAt") : before.next_action_at;
      if (before.status !== "open" && input.nextActionAt) throw new UnprocessableEntityException("Reopen the opportunity before scheduling a next action");
      if (String(before.status) === "open" && !nextAction && !before.paused_reason && !input.pausedReason) throw new UnprocessableEntityException("An open opportunity requires a next action or paused reason");
      const result = await client.query(
        `UPDATE crm_opportunities SET title = COALESCE($1, title),
           description = CASE WHEN $2::boolean THEN $3 ELSE description END,
           owner_membership_id = CASE WHEN $4::boolean THEN $5::uuid ELSE owner_membership_id END,
           amount = $6::numeric, currency_code = $7::text, probability = CASE WHEN $8::boolean THEN $9::numeric ELSE probability END,
           reporting_currency_code = CASE WHEN $17::boolean THEN CASE WHEN $7 = (SELECT default_currency FROM workspaces WHERE id = $14) THEN $7 ELSE NULL END ELSE reporting_currency_code END,
           reporting_amount = CASE WHEN $17::boolean THEN CASE WHEN $7 = (SELECT default_currency FROM workspaces WHERE id = $14) THEN $6::numeric ELSE NULL END ELSE reporting_amount END,
           exchange_rate = CASE WHEN $17::boolean THEN CASE WHEN $7 = (SELECT default_currency FROM workspaces WHERE id = $14) THEN 1 ELSE NULL END ELSE exchange_rate END,
           exchange_rate_at = CASE WHEN $17::boolean THEN CASE WHEN $7 = (SELECT default_currency FROM workspaces WHERE id = $14) THEN now() ELSE NULL END ELSE exchange_rate_at END,
           expected_close_at = $10, next_action_at = $11,
           paused_reason = CASE WHEN $12::boolean THEN $13 ELSE paused_reason END,
           version = version + 1
         WHERE workspace_id = $14 AND id = $15 AND version = $16 RETURNING *`,
        [input.title ?? null, input.description !== undefined, input.description ?? null, input.ownerMembershipId !== undefined, input.ownerMembershipId ?? null, amount, currency, input.probability !== undefined, input.probability ?? null, expectedClose, nextAction, input.pausedReason !== undefined, input.pausedReason ?? null, workspaceId, opportunityId, input.version, hasAmount || hasCurrency],
      );
      if (!result.rowCount) throw new ConflictException("Opportunity changed; reload and try again");
      const response = result.rows[0] as Row;
      if (input.nextActionAt !== undefined || input.ownerMembershipId !== undefined) await this.syncCommitment(client, workspaceId, response, actorUser.userId);
      await this.snapshot(client, workspaceId, response, "record_updated");
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.opportunity.updated.v1", entityType: "crm_opportunity", entityId: opportunityId, before, after: response });
      const canViewSensitiveValues = permissions.length > 1 || await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.opportunities.sensitive_values");
      return this.presentOpportunity(response, canViewSensitiveValues);
    });
  }

  /**
   * §0.3 P0 (guide G): the intro's outcome. Going ahead names the scope (one of the firm's enquiry types) and needs the
   * client's target completion date (saved on the enquiry); needs time to think books the follow-up on a date, as the
   * opportunity's next action; lost closes it with the reason through the Lost transition. Version-checked and audited.
   */
  recordOutcome(actor: RequestActor, workspaceId: string, opportunityId: string, input: QualificationOutcomeDto) {
    const permissions = input.outcome === "lost" ? ["crm.opportunities.manage", "crm.opportunities.transition"] : ["crm.opportunities.manage"];
    return this.access.withPermissions(actor, workspaceId, permissions, async (client, actorUser) => {
      const before = await this.requireOpportunity(client, workspaceId, opportunityId, true);
      if (Number(before.version) !== input.version) throw new ConflictException("Opportunity changed; reload and try again");
      if (String(before.status) !== "open") throw new UnprocessableEntityException("Reopen the opportunity before recording the intro outcome");
      const canViewSensitiveValues = await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.opportunities.sensitive_values");
      if (input.outcome === "lost") {
        const reason = input.reason?.trim() ?? "";
        new ProblemList().when(!reason, "reason", "Say why the opportunity was lost").throwIfAny();
        const lost = (await client.query<{ id: string }>(`SELECT id FROM crm_pipeline_stages WHERE workspace_id = $1 AND pipeline_id = $2 AND code = 'lost' AND status = 'active' LIMIT 1`,
          [workspaceId, before.pipeline_id])).rows[0];
        const closed = await this.transitionWithin(client, actorUser.userId, workspaceId, opportunityId, { version: input.version, status: "lost", reason, ...(lost ? { stageId: lost.id } : {}) });
        return this.presentOpportunity(closed as Row, canViewSensitiveValues);
      }
      const day = /^\d{4}-\d{2}-\d{2}$/;
      const validDay = (value: string | undefined): value is string => Boolean(value && day.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
      // A day of slack: the firm's calendar can be ahead of UTC.
      const today = new Date().toISOString().slice(0, 10), yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const scope = input.scope?.trim() ?? "";
      const problems = new ProblemList();
      if (input.outcome === "proceed") {
        const types = (await loadLeadOptions(client, workspaceId)).enquiryTypes;
        problems.when(!hasResolvedEnquiryType(scope) || !types.some((type) => type.id === scope), "scope", "Choose what the client is going ahead with");
        problems.when(!validDay(input.targetCompletion) || input.targetCompletion < yesterday, "targetCompletion", "Enter the client's target completion date");
      } else {
        problems.when(!validDay(input.followUpOn) || input.followUpOn < today, "followUpOn", "Book the follow-up date");
      }
      problems.throwIfAny();
      if (input.outcome === "proceed")
        await client.query(`UPDATE crm_enquiries enquiry SET details = jsonb_set(COALESCE(enquiry.details, '{}'::jsonb), '{targetCompletion}', to_jsonb($3::text)), version = enquiry.version + 1, updated_at = now()
          FROM crm_leads lead WHERE lead.workspace_id = $1 AND lead.id = $2 AND enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
            AND enquiry.details->>'targetCompletion' IS DISTINCT FROM $3::text`,
          [workspaceId, before.lead_id, input.targetCompletion]);
      // Needs time: the follow-up is the opportunity's next action, at the start of the firm's working day.
      const followUpAt = input.outcome === "needs_time" ? (await client.query<{ at: Date }>(
        `SELECT ($2::date + time '09:00') AT TIME ZONE COALESCE(NULLIF(default_timezone, ''), 'UTC') AS at FROM workspaces WHERE id = $1`, [workspaceId, input.followUpOn])).rows[0]?.at ?? null : null;
      const updated = (await client.query<Row>(
        `UPDATE crm_opportunities SET qualification_outcome = $3, qualification_scope = $4, qualification_follow_up_on = $5::date,
           qualification_outcome_at = now(), qualification_outcome_by = $6,
           next_action_at = COALESCE($7::timestamptz, next_action_at), version = version + 1
         WHERE workspace_id = $1 AND id = $2 RETURNING id`,
        [workspaceId, opportunityId, input.outcome, input.outcome === "proceed" ? scope : null, input.outcome === "needs_time" ? input.followUpOn : null, actorUser.userId, followUpAt])).rows[0];
      if (followUpAt) {
        await client.query(`UPDATE crm_activities SET is_next_action = false, version = version + 1 WHERE workspace_id = $1 AND opportunity_id = $2 AND is_next_action`, [workspaceId, opportunityId]);
        await client.query(`INSERT INTO crm_activities (workspace_id, party_id, opportunity_id, type, title, owner_membership_id, due_at, is_next_action, created_by)
          VALUES ($1,$2,$3,'task','Follow up: the client is thinking it over',$4,$5,true,$6)`, [workspaceId, before.party_id, opportunityId, before.owner_membership_id ?? null, followUpAt, actorUser.userId]);
      }
      const after = await this.requireOpportunity(client, workspaceId, String(updated.id), false);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.opportunity.qualification_outcome.v1", entityType: "crm_opportunity", entityId: opportunityId,
        before: { qualificationOutcome: before.qualification_outcome ?? null, qualificationScope: before.qualification_scope ?? null },
        after: { qualificationOutcome: input.outcome, qualificationScope: input.outcome === "proceed" ? scope : null, targetCompletion: input.outcome === "proceed" ? input.targetCompletion : undefined, followUpOn: input.outcome === "needs_time" ? input.followUpOn : undefined } });
      return this.presentOpportunity(after, canViewSensitiveValues);
    });
  }

  transition(actor: RequestActor, workspaceId: string, opportunityId: string, input: TransitionOpportunityDto) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.transition", (client, actorUser) =>
      this.transitionWithin(client, actorUser.userId, workspaceId, opportunityId, input));
  }

  /** A stage move inside the caller's permission-checked tenant transaction (the board, the edit dialog, Woddy, a payment proof). */
  async transitionWithin(client: PoolClient, actorUserId: string, workspaceId: string, opportunityId: string, input: TransitionOpportunityDto, options: { wonRound?: ProposalKind | null } = {}) {
    const actorUser = { userId: actorUserId };
    const before = await this.requireOpportunity(client, workspaceId, opportunityId, true);
    if (Number(before.version) !== input.version) throw new ConflictException("Opportunity changed; reload and try again");
    const targetStatus = input.status ?? String(before.status);
    if (String(before.status) === "won" && targetStatus !== "open") throw new UnprocessableEntityException("A won opportunity may only be reopened");
    if (String(before.status) === "lost" && targetStatus !== "open") throw new UnprocessableEntityException("A lost opportunity may only be reopened");
    if (["won", "lost", "abandoned"].includes(targetStatus) && !input.reason?.trim()) throw new UnprocessableEntityException("A reason is required for this transition");
    if (targetStatus === "lost" && !input.reason) throw new UnprocessableEntityException("Loss reason is required");
    const targetStage = input.stageId ? await this.requireStage(client, workspaceId, input.stageId, String(before.pipeline_id)) : await this.requireStage(client, workspaceId, String(before.stage_id), String(before.pipeline_id));
    const terminalStageStatus = ["won", "lost"].includes(String(targetStage.code)) ? String(targetStage.code) : null;
    if (terminalStageStatus && targetStatus !== terminalStageStatus) {
      throw new UnprocessableEntityException(`The ${terminalStageStatus} stage requires a ${terminalStageStatus} outcome`);
    }
    if (targetStatus === "won" || targetStatus === "lost") {
      const configuredTerminalStage = await client.query<{ id: string }>(
        `SELECT id FROM crm_pipeline_stages WHERE workspace_id = $1 AND pipeline_id = $2 AND code = $3 AND status = 'active' LIMIT 1`,
        [workspaceId, before.pipeline_id, targetStatus],
      );
      if (configuredTerminalStage.rowCount && String(targetStage.id) !== configuredTerminalStage.rows[0].id) {
        throw new UnprocessableEntityException(`Choose the ${targetStatus} stage for this outcome`);
      }
    }
    const nextActionAt = input.nextActionAt ? this.date(input.nextActionAt, "nextActionAt") : before.next_action_at;
    if (targetStatus === "open" && !nextActionAt && !before.paused_reason) throw new UnprocessableEntityException("Schedule the next action when reopening an opportunity");
    if (targetStatus === "open" || targetStatus === "won") await this.assertEntryRequirements(client, workspaceId, { ...before, next_action_at: nextActionAt }, targetStage);
    // PLM-121/122: one step at a time, by what the enquiry type's flow needs at every column passed.
    await this.assertFlowGates(client, workspaceId, before, targetStage, targetStatus, actorUser.userId);
    const result = await client.query(
      `UPDATE crm_opportunities SET stage_id = $1, status = $2::crm_opportunity_status,
         probability = CASE WHEN $2 = 'won' THEN 100 WHEN $2 IN ('lost', 'abandoned') THEN 0 ELSE $3::numeric END,
         forecast_category = CASE WHEN $2 = 'won' THEN 'closed' WHEN $2 IN ('lost', 'abandoned') THEN 'omitted' ELSE $4 END,
         paused_reason = CASE WHEN $2 = 'abandoned' THEN $5 ELSE NULL END,
         outcome_reason = CASE WHEN $2 IN ('won', 'lost', 'abandoned') THEN $5 ELSE NULL END,
         competitor = CASE WHEN $2 = 'lost' THEN $6 ELSE competitor END,
         closed_at = CASE WHEN $2 IN ('won', 'lost', 'abandoned') THEN now() ELSE NULL END,
         next_action_at = CASE WHEN $2 = 'open' THEN $10::timestamptz ELSE NULL END,
         version = version + 1
       WHERE workspace_id = $7 AND id = $8 AND version = $9 RETURNING *`,
      [targetStage.id, targetStatus, targetStage.probability, targetStage.forecast_category, input.reason ?? null, input.competitor ?? null, workspaceId, opportunityId, input.version, nextActionAt],
    );
    if (!result.rowCount) throw new ConflictException("Opportunity changed; reload and try again");
    const response = result.rows[0] as Row;
    if (targetStatus === "open") await this.syncCommitment(client, workspaceId, response, actorUser.userId);
    if (targetStatus !== "open") await client.query(`UPDATE crm_activities SET is_next_action = false, version = version + 1 WHERE workspace_id = $1 AND opportunity_id = $2 AND is_next_action`, [workspaceId, opportunityId]);
    // A closed deal has nothing left to follow up: its open follow-ups are cancelled (audited, one history line).
    if (targetStatus === "won" || targetStatus === "lost") await cancelOpenFollowUps(client, { workspaceId, opportunityId, outcome: targetStatus, actorUserId: actorUser.userId });
    if (targetStatus === "won") await client.query(`UPDATE crm_parties SET lifecycle = 'customer', version = version + 1 WHERE workspace_id = $1 AND id = $2 AND lifecycle <> 'customer'`, [workspaceId, before.party_id]);
    await client.query(`INSERT INTO crm_stage_history (workspace_id, opportunity_id, from_stage_id, to_stage_id, from_status, to_status, reason, changed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [workspaceId, opportunityId, before.stage_id, targetStage.id, before.status, targetStatus, input.reason ?? null, actorUser.userId]);
    await this.snapshot(client, workspaceId, response, "stage_changed");
    const event = targetStatus === "won" ? "crm.opportunity.won.v1" : targetStatus === "lost" ? "crm.opportunity.lost.v1" : "crm.opportunity.stage_changed.v1";
    await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: event, entityType: "crm_opportunity", entityId: opportunityId, before, after: response });
    // PLM-009: Won is reported per proposal (design, main); this win marks the first proposal not yet Won.
    if (targetStatus === "won") await markProposalWon(client, { workspaceId, opportunityId, round: options.wonRound ?? null, actorUserId: actorUser.userId });
    // A won deal: the client is thanked on WhatsApp and told what happens next (once per opportunity).
    if (targetStatus === "won") await thankForDeal(client, workspaceId, opportunityId, { actorUserId: actorUser.userId });
    // PLM-125: Won takes the deal's goods out of stock where its path says so (Furniture A and B).
    if (targetStatus === "won") await takeForDeal(client, workspaceId, { opportunityId, event: "won", actorUserId: actorUser.userId });
    // The Sales admin and the Owners hear a deal closed, with why (S-23).
    if (targetStatus === "won" || targetStatus === "lost") await tellDealOutcome(client, workspaceId, { opportunityId, outcome: targetStatus, reason: input.reason ?? null, actorUserId: actorUser.userId });
    const canViewSensitiveValues = await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.opportunities.sensitive_values");
    return this.presentOpportunity(response, canViewSensitiveValues);
  }

  private async assertFlowGates(client: PoolClient, workspaceId: string, before: Row, targetStage: Row, targetStatus: string, actorUserId: string) {
    if (String(before.status) !== "open" && targetStatus === "open") return; // reopening goes back
    const stages = await pipelineStages(client, workspaceId, String(before.pipeline_id));
    const from = stages.find((stage) => stage.id === before.stage_id) ?? { code: "", position: -1 };
    const facts = await loadFlowFacts(client, workspaceId, String(before.id), this.discovery, { actorUserId });
    // The job's pinned flow decides what every column passed needs (plan §5a, engine rules 1–2).
    const missing = moveBlockers({
      definition: facts.flowDefinition.definition, facts, from, to: { code: String(targetStage.code), position: Number(targetStage.position) },
      firstPosition: stages[0]?.position ?? 0, stages, targetStatus,
    });
    if (missing.length) throw new UnprocessableEntityException({ message: "Stage requirements are not met", missing: missing.map(({ key, label }) => ({ key, label })) });
  }

  /** PLM-121/122: the opportunity's flow, its step line, what the next column needs, and the flow's own facts. */
  private async flowView(client: PoolClient, workspaceId: string, opportunity: Row, actorUserId: string) {
    const facts = await loadFlowFacts(client, workspaceId, String(opportunity.id), this.discovery, { actorUserId });
    const stages = await pipelineStages(client, workspaceId, String(opportunity.pipeline_id));
    return {
      ...flowSummary({ facts, stages, currentStageId: String(opportunity.stage_id), status: String(opportunity.status) }),
      enquiryType: facts.enquiryTypeLabel ?? facts.enquiryType,
      furniture: flowAsks(facts.flowDefinition.definition, "sub_path_chosen") ? {
        path: facts.furniturePath,
        feasibility: facts.feasibilityAt ? { at: facts.feasibilityAt, by: facts.feasibilityBy } : null,
        materialsChange: facts.materialsChange,
      } : null,
      clientApproval: opportunity.client_approved_at ? { at: opportunity.client_approved_at, by: facts.clientApprovedBy } : null,
      quotationExists: facts.quotationExists,
      paymentVerified: facts.verifiedPayment,
      proofs: await paymentProofs(client, workspaceId, String(opportunity.id)),
    };
  }

  private async syncCommitment(client: PoolClient, workspaceId: string, opportunity: Row, actorUserId: string) {
    if (opportunity.status !== "open") return;
    const current = await client.query(`SELECT * FROM crm_activities WHERE workspace_id = $1 AND opportunity_id = $2 AND is_next_action AND status = 'pending' FOR UPDATE`, [workspaceId, opportunity.id]);
    if (!opportunity.next_action_at) {
      await client.query(`UPDATE crm_activities SET is_next_action = false, version = version + 1 WHERE workspace_id = $1 AND opportunity_id = $2 AND is_next_action`, [workspaceId, opportunity.id]);
      return;
    }
    const activity = current.rows[0];
    if (activity) {
      await client.query(`UPDATE crm_appointments SET ends_at = ends_at + ($1::timestamptz - starts_at), starts_at = $1::timestamptz, version = version + 1 WHERE workspace_id = $2 AND activity_id = $3 AND starts_at <> $1::timestamptz`, [opportunity.next_action_at, workspaceId, activity.id]);
      await client.query(`UPDATE crm_activities SET due_at = $1, owner_membership_id = $2, version = version + 1 WHERE workspace_id = $3 AND id = $4 AND (due_at IS DISTINCT FROM $1::timestamptz OR owner_membership_id IS DISTINCT FROM $2::uuid)`, [opportunity.next_action_at, opportunity.owner_membership_id, workspaceId, activity.id]);
    } else {
      await client.query(`INSERT INTO crm_activities (workspace_id, party_id, opportunity_id, type, title, owner_membership_id, due_at, is_next_action, created_by) VALUES ($1,$2,$3,'task','Follow up on opportunity',$4,$5,true,$6)`, [workspaceId, opportunity.party_id, opportunity.id, opportunity.owner_membership_id, opportunity.next_action_at, actorUserId]);
    }
  }

  addStakeholder(actor: RequestActor, workspaceId: string, opportunityId: string, input: AddStakeholderDto) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.manage", async (client, actorUser) => {
      await this.requireOpportunity(client, workspaceId, opportunityId, true);
      const party = await client.query(`SELECT 1 FROM crm_parties WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, input.partyId]);
      if (!party.rowCount) throw new UnprocessableEntityException("Stakeholder party is not active");
      if (input.isPrimary) await client.query(`UPDATE crm_opportunity_stakeholders SET is_primary = false WHERE workspace_id = $1 AND opportunity_id = $2`, [workspaceId, opportunityId]);
      const result = await client.query(
        `INSERT INTO crm_opportunity_stakeholders (workspace_id, opportunity_id, party_id, role, influence, is_primary)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (opportunity_id, party_id, role)
         DO UPDATE SET influence = EXCLUDED.influence, is_primary = EXCLUDED.is_primary
         RETURNING party_id AS "partyId", role, influence, is_primary AS "isPrimary"`,
        [workspaceId, opportunityId, input.partyId, input.role, input.influence ?? null, input.isPrimary ?? false],
      );
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.opportunity.stakeholder_updated.v1", entityType: "crm_opportunity", entityId: opportunityId, after: result.rows[0] as Row });
      return result.rows[0];
    });
  }

  removeStakeholder(actor: RequestActor, workspaceId: string, opportunityId: string, partyId: string, role: string) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.manage", async (client, actorUser) => {
      await this.requireOpportunity(client, workspaceId, opportunityId, true);
      this.assertAssociationRole(role);
      const result = await client.query(
        `DELETE FROM crm_opportunity_stakeholders
         WHERE workspace_id = $1 AND opportunity_id = $2 AND party_id = $3 AND role = $4
         RETURNING party_id AS "partyId", role, influence, is_primary AS "isPrimary"`,
        [workspaceId, opportunityId, partyId, role.trim()],
      );
      if (!result.rowCount) throw new NotFoundException("Opportunity stakeholder not found");
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.opportunity.stakeholder_removed.v1", entityType: "crm_opportunity", entityId: opportunityId, before: result.rows[0] as Row });
      return { removed: true };
    });
  }

  upsertTeamMember(actor: RequestActor, workspaceId: string, opportunityId: string, membershipId: string, input: OpportunityTeamMemberDto) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.manage", async (client, actorUser) => {
      await this.requireOpportunity(client, workspaceId, opportunityId, true);
      await this.requireMembership(client, workspaceId, membershipId);
      this.assertAssociationRole(input.role);
      const result = await client.query(
        `INSERT INTO crm_opportunity_team (workspace_id, opportunity_id, membership_id, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (opportunity_id, membership_id, role) DO UPDATE SET role = EXCLUDED.role
         RETURNING membership_id AS "membershipId", role`,
        [workspaceId, opportunityId, membershipId, input.role.trim()],
      );
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.opportunity.team_member_updated.v1", entityType: "crm_opportunity", entityId: opportunityId, after: result.rows[0] as Row });
      return result.rows[0];
    });
  }

  removeTeamMember(actor: RequestActor, workspaceId: string, opportunityId: string, membershipId: string, role: string) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.manage", async (client, actorUser) => {
      await this.requireOpportunity(client, workspaceId, opportunityId, true);
      this.assertAssociationRole(role);
      const result = await client.query(
        `DELETE FROM crm_opportunity_team
         WHERE workspace_id = $1 AND opportunity_id = $2 AND membership_id = $3 AND role = $4
         RETURNING membership_id AS "membershipId", role`,
        [workspaceId, opportunityId, membershipId, role.trim()],
      );
      if (!result.rowCount) throw new NotFoundException("Opportunity team member not found");
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.opportunity.team_member_removed.v1", entityType: "crm_opportunity", entityId: opportunityId, before: result.rows[0] as Row });
      return { removed: true };
    });
  }

  linkProject(actor: RequestActor, workspaceId: string, opportunityId: string, input: CreateProjectLinkDto) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.manage", async (client, actorUser) => {
      const opportunity = await this.requireOpportunity(client, workspaceId, opportunityId, true);
      if (String(opportunity.status) !== "won") throw new UnprocessableEntityException("Only won opportunities may request a project handoff");
      const result = await client.query(
        `INSERT INTO crm_project_links (workspace_id, opportunity_id, project_id, mode, promoted_at)
         VALUES ($1,$2,$3,$4::varchar,CASE WHEN $4::text = 'delivery' THEN now() ELSE NULL END)
         ON CONFLICT (workspace_id, opportunity_id) DO UPDATE SET
           project_id = EXCLUDED.project_id, mode = EXCLUDED.mode,
           promoted_at = CASE WHEN EXCLUDED.mode = 'delivery' THEN COALESCE(crm_project_links.promoted_at, now()) ELSE crm_project_links.promoted_at END,
           version = crm_project_links.version + 1
         RETURNING id, project_id AS "projectId", mode, linked_at AS "linkedAt", promoted_at AS "promotedAt", version`,
        [workspaceId, opportunityId, input.projectId, input.mode ?? "pre_sales"],
      );
      const response = result.rows[0] as Row;
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.project_handoff_requested.v1", entityType: "crm_opportunity", entityId: opportunityId, after: { ...response, partyId: opportunity.party_id, title: opportunity.title } });
      return response;
    });
  }

  /** Called only inside the permission-checked, lead-locked Pre-execution handoff transaction. */
  async createQualifiedHandoff(
    client: PoolClient,
    workspaceId: string,
    input: CreateOpportunityDto,
    actorUserId: string,
    conversion: ConversionContext,
  ) {
    const opportunity = await this.createInTransaction(client, workspaceId, input, actorUserId, true, conversion);
    await client.query(`UPDATE crm_activities SET opportunity_id = $3, is_next_action = false, version = version + 1 WHERE workspace_id = $1 AND lead_id = $2 AND opportunity_id IS NULL`, [workspaceId, input.leadId, opportunity.id]);
    await client.query(`UPDATE crm_leads SET next_action_at=NULL WHERE workspace_id=$1 AND id=$2`, [workspaceId, input.leadId]);
    return opportunity;
  }

  private async createInTransaction(
    client: PoolClient,
    workspaceId: string,
    input: CreateOpportunityDto,
    actorUserId: string,
    skipLeadValidation: boolean,
    conversion?: ConversionContext,
  ) {
    if (input.leadId && !conversion) throw new UnprocessableEntityException("Lead conversion evidence is required");
    const pipeline = await client.query(`SELECT 1 FROM crm_pipelines WHERE workspace_id = $1 AND id = $2 AND status = 'active' FOR SHARE`, [workspaceId, input.pipelineId]);
    if (!pipeline.rowCount) throw new UnprocessableEntityException("Choose an active pipeline");
    const party = await client.query(`SELECT 1 FROM crm_parties WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, input.partyId]);
    if (!party.rowCount) throw new UnprocessableEntityException("Party is not active");
    if (input.leadId && !skipLeadValidation) {
      const lead = await client.query(`SELECT party_id FROM crm_leads WHERE workspace_id = $1 AND id = $2`, [workspaceId, input.leadId]);
      if (!lead.rowCount || String(lead.rows[0].party_id) !== input.partyId) throw new UnprocessableEntityException("Lead does not belong to this party");
    }
    if (input.ownerMembershipId) await this.requireMembership(client, workspaceId, input.ownerMembershipId);
    const stage = input.stageId ? await this.requireStage(client, workspaceId, input.stageId, input.pipelineId) : await this.firstStage(client, workspaceId, input.pipelineId);
    const currency = input.currencyCode?.toUpperCase();
    if ((input.amount == null) !== (currency == null)) throw new UnprocessableEntityException("Amount and currency must be supplied together");
    if (currency) await this.requireCurrency(client, currency);
    const expectedCloseAt = this.date(input.expectedCloseAt, "expectedCloseAt");
    const nextActionAt = this.date(input.nextActionAt, "nextActionAt");
    if (!nextActionAt) throw new UnprocessableEntityException("An open opportunity requires a next action");
    const workspace = await client.query<{ default_currency: string }>(`SELECT default_currency FROM workspaces WHERE id = $1`, [workspaceId]);
    const reportingCurrency = workspace.rows[0]?.default_currency ?? currency ?? null;
    const sameCurrency = Boolean(currency && reportingCurrency === currency);
    const result = await client.query(
      `INSERT INTO crm_opportunities
        (workspace_id, legal_entity_id, business_unit_id, party_id, lead_id, pipeline_id, stage_id,
         owner_membership_id, title, description, amount, currency_code, probability,
         forecast_category, expected_close_at, next_action_at, reporting_currency_code,
         reporting_amount, exchange_rate, exchange_rate_at,conversion_origin,
         conversion_request_hash,qualification_evidence,qualification_evidence_hash,
         converted_by,converted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
               $21,$22,$23,$24,$25,CASE WHEN $5::uuid IS NULL THEN NULL ELSE now() END)
       RETURNING *`,
      [
        workspaceId, input.legalEntityId ?? null, input.businessUnitId ?? null, input.partyId,
        input.leadId ?? null, input.pipelineId, stage.id, input.ownerMembershipId ?? null,
        input.title, input.description ?? null, input.amount ?? null, currency ?? null,
        input.probability ?? stage.probability, stage.forecast_category, expectedCloseAt, nextActionAt,
        sameCurrency ? reportingCurrency : null, sameCurrency ? input.amount ?? null : null,
        sameCurrency ? 1 : null, sameCurrency ? new Date() : null,
        conversion?.origin ?? null, conversion?.requestHash ?? null,
        conversion?.qualificationEvidence ?? null, conversion?.qualificationEvidenceHash ?? null,
        conversion ? actorUserId : null,
      ],
    );
    const response = result.rows[0] as Row;
    await ensureJobForSource(client, workspaceId, { type: "opportunity", id: String(response.id) }, actorUserId);
    await this.assertEntryRequirements(client, workspaceId, response, stage);
    await client.query(`INSERT INTO crm_activities (workspace_id, party_id, opportunity_id, type, title, owner_membership_id, due_at, is_next_action, created_by) VALUES ($1,$2,$3,'task','Follow up on opportunity',$4,$5,true,$6)`, [workspaceId, input.partyId, response.id, input.ownerMembershipId ?? null, nextActionAt, actorUserId]);
    await client.query(`INSERT INTO crm_stage_history (workspace_id, opportunity_id, to_stage_id, to_status, reason, changed_by) VALUES ($1,$2,$3,'open','created',$4)`, [workspaceId, response.id, stage.id, actorUserId]);
    await this.snapshot(client, workspaceId, response, "created");
    await this.events.record(client, {
      workspaceId, actorUserId, source: "user", action: "crm.opportunity.created.v1",
      entityType: "crm_opportunity", entityId: String(response.id),
      after: conversion ? { ...response, conversionEvidenceHash: conversion.qualificationEvidenceHash } : response,
    });
    return response;
  }

  private async assertEntryRequirements(client: PoolClient, workspaceId: string, opportunity: Row, stage: Row) {
    const requirements = (stage.entry_requirements ?? {}) as Record<string, unknown>;
    const missing: Array<{ key: string; label: string }> = [];
    if (requirements.amount === true && opportunity.amount == null) missing.push({ key: "amount", label: "Value" });
    if (requirements.expectedCloseAt === true && opportunity.expected_close_at == null) missing.push({ key: "expectedCloseAt", label: "Expected close date" });
    if (requirements.nextAction === true && opportunity.next_action_at == null) missing.push({ key: "nextAction", label: "Next follow-up" });
    if (requirements.owner === true && opportunity.owner_membership_id == null) missing.push({ key: "owner", label: "Sales owner" });
    if (requirements.stakeholders === true && opportunity.id) {
      const result = await client.query(`SELECT 1 FROM crm_opportunity_stakeholders WHERE workspace_id = $1 AND opportunity_id = $2 LIMIT 1`, [workspaceId, opportunity.id]);
      if (!result.rowCount) missing.push({ key: "stakeholders", label: "Stakeholders" });
    }
    // PLM-040: e.g. Design Quote needs the Account Manager's discovery form complete.
    if (requirements.discovery === true && opportunity.id && this.discovery) {
      for (const item of await this.discovery.missing(client, workspaceId, String(opportunity.id))) missing.push({ key: `discovery:${item.key}`, label: item.label });
    }
    if (missing.length) throw new UnprocessableEntityException({ message: "Stage requirements are not met", missing });
  }

  private validateRequirements(requirements: Record<string, unknown>) {
    const allowed = new Set(["amount", "expectedCloseAt", "nextAction", "owner", "stakeholders", "discovery"]);
    for (const [key, value] of Object.entries(requirements)) {
      if (!allowed.has(key) || typeof value !== "boolean") throw new UnprocessableEntityException(`Invalid stage requirement: ${key}`);
    }
  }

  private assertAssociationRole(role: string) {
    const normalized = role?.trim();
    if (!normalized || normalized.length > 80) throw new BadRequestException("A valid role is required");
  }

  /** The opportunity as this person sees it, inside a transaction another command already holds. */
  async presentFor(client: PoolClient, workspaceId: string, opportunityId: string, userId: string) {
    const row = await this.requireOpportunity(client, workspaceId, opportunityId, false);
    return this.presentOpportunity(row, await this.access.hasPermission(client, workspaceId, userId, "crm.opportunities.sensitive_values"));
  }

  private presentOpportunity(opportunity: Row, canViewSensitiveValues: boolean): Row {
    // Keep mutation and list/detail responses consistent for every linked CRM screen.
    const presented = { ...opportunity };
    for (const [source, target] of Object.entries({ party_id: "partyId", lead_id: "leadId", pipeline_id: "pipelineId", stage_id: "stageId", owner_membership_id: "ownerMembershipId", currency_code: "currencyCode", reporting_currency_code: "reportingCurrencyCode", reporting_amount: "reportingAmount", next_action_at: "nextActionAt", expected_close_at: "expectedCloseAt", qualification_outcome: "qualificationOutcome", qualification_scope: "qualificationScope", qualification_follow_up_on: "qualificationFollowUpOn", qualification_outcome_at: "qualificationOutcomeAt", paused_reason: "pausedReason", outcome_reason: "outcomeReason", conversion_origin: "conversionOrigin", qualification_evidence: "qualificationEvidence", qualification_evidence_hash: "qualificationEvidenceHash", converted_by: "convertedBy", converted_at: "convertedAt", created_at: "createdAt", updated_at: "updatedAt" })) {
      if (Object.hasOwn(opportunity, source)) presented[target] = opportunity[source];
    }
    // The fingerprint is an internal replay guard, not part of the public CRM model.
    delete presented.conversion_request_hash;
    if (canViewSensitiveValues) return presented;
    const redacted = { ...presented };
    for (const key of [
      "amount",
      "currency_code",
      "currencyCode",
      "reporting_amount",
      "reportingAmount",
      "reporting_currency_code",
      "reportingCurrencyCode",
      "exchange_rate",
      "exchangeRate",
      "exchange_rate_at",
      "exchangeRateAt",
    ]) {
      if (Object.hasOwn(redacted, key)) redacted[key] = null;
    }
    // Says the value exists but is not shown, so an edit never sends (and clears) a value this person can't see.
    redacted.valueHidden = true;
    return redacted;
  }

  private date(value: string | null | undefined, field: string): Date | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} is invalid`);
    return date;
  }

  private async requireCurrency(client: PoolClient, code: string) {
    const result = await client.query(`SELECT 1 FROM currencies WHERE code = $1 AND active`, [code]);
    if (!result.rowCount) throw new UnprocessableEntityException(`Unsupported currency: ${code}`);
  }

  /** Someone who can own an enquiry: active, with the sales-owner permissions (what the owner pickers list). */
  private async requireSalesOwner(client: PoolClient, workspaceId: string, membershipId: string) {
    const eligible = await client.query(ELIGIBLE_SALES_OWNERS_SQL, [workspaceId, membershipId, SALES_OWNER_PERMISSIONS, SALES_OWNER_PERMISSIONS.length, null]);
    if (!eligible.rowCount) throw new UnprocessableEntityException("Choose a sales owner: someone who works enquiries in this workspace.");
  }

  private async requireMembership(client: PoolClient, workspaceId: string, membershipId: string) {
    const result = await client.query(`SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, membershipId]);
    if (!result.rowCount) throw new UnprocessableEntityException("Lead manager is not an active workspace member");
  }

  private async firstStage(client: PoolClient, workspaceId: string, pipelineId: string): Promise<Row> {
    const result = await client.query<Row>(`SELECT * FROM crm_pipeline_stages WHERE workspace_id = $1 AND pipeline_id = $2 AND status = 'active' ORDER BY position LIMIT 1`, [workspaceId, pipelineId]);
    if (!result.rowCount) throw new UnprocessableEntityException("Pipeline has no active stage");
    return result.rows[0];
  }

  private async requireStage(client: PoolClient, workspaceId: string, stageId: string, pipelineId: string): Promise<Row> {
    const result = await client.query<Row>(`SELECT * FROM crm_pipeline_stages WHERE workspace_id = $1 AND pipeline_id = $2 AND id = $3 AND status = 'active'`, [workspaceId, pipelineId, stageId]);
    if (!result.rowCount) throw new UnprocessableEntityException("Stage does not belong to the active pipeline");
    return result.rows[0];
  }

  private async requireOpportunity(client: PoolClient, workspaceId: string, opportunityId: string, lock: boolean): Promise<Row> {
    const result = await client.query<Row>(`${this.baseSelect()} WHERE opportunity.workspace_id = $1 AND opportunity.id = $2${lock ? " FOR UPDATE OF opportunity" : ""}`, [workspaceId, opportunityId]);
    if (!result.rowCount) throw new NotFoundException("Opportunity not found");
    return result.rows[0];
  }

  private async snapshot(client: PoolClient, workspaceId: string, opportunity: Row, reason: string) {
    await client.query(
      `INSERT INTO crm_forecast_snapshots
        (workspace_id, opportunity_id, owner_membership_id, stage_id, status, amount,
         currency_code, reporting_amount, reporting_currency_code, probability, snapshot_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [workspaceId, opportunity.id, opportunity.owner_membership_id, opportunity.stage_id, opportunity.status, opportunity.amount, opportunity.currency_code, opportunity.reporting_amount, opportunity.reporting_currency_code, opportunity.probability, reason],
    );
  }

  private baseSelect() {
    return `SELECT opportunity.*, opportunity.currency_code AS "currencyCode",
                   opportunity.reporting_currency_code AS "reportingCurrencyCode",
                   opportunity.owner_membership_id AS "ownerMembershipId",
                   opportunity.expected_close_at AS "expectedCloseAt",
                   opportunity.next_action_at AS "nextActionAt",
                   opportunity.created_at AS "createdAt", opportunity.updated_at AS "updatedAt",
                   party.display_name AS "partyName", enquiry.reference AS "enquiryReference",
                   -- The phone and email typed on the enquiry: shown when the client record holds no contact points.
                   enquiry.details->'contact' AS "enquiryContact",
                   source_case.id AS "preProjectCaseId", commercial_case.content #>> '{dealFile,reference}' AS "dealFileReference",
                   case_project.id AS "projectId", case_project.reference AS "projectReference",
                   pipeline.name AS "pipelineName",
                   stage.name AS "stageName", account.display_name AS "ownerName"
            FROM crm_opportunities opportunity
            JOIN crm_parties party ON party.id = opportunity.party_id AND party.workspace_id = opportunity.workspace_id
            LEFT JOIN crm_leads source_lead ON source_lead.id = opportunity.lead_id AND source_lead.workspace_id = opportunity.workspace_id
            LEFT JOIN crm_enquiries enquiry ON enquiry.id = source_lead.enquiry_id AND enquiry.workspace_id = opportunity.workspace_id
            LEFT JOIN pre_project_cases source_case ON source_case.workspace_id = opportunity.workspace_id AND source_case.opportunity_id = opportunity.id
            LEFT JOIN commercial_cases_view commercial_case ON commercial_case.workspace_id = source_case.workspace_id AND commercial_case.case_id = source_case.id
            -- After Won, the job's live project (a cancelled one is history), so the record leads to it.
            LEFT JOIN LATERAL (SELECT project.id, project.reference FROM delivery_projects project
                                WHERE project.workspace_id = source_case.workspace_id AND project.case_id = source_case.id AND project.status <> 'cancelled'
                                ORDER BY project.created_at DESC LIMIT 1) case_project ON true
            JOIN crm_pipelines pipeline ON pipeline.id = opportunity.pipeline_id AND pipeline.workspace_id = opportunity.workspace_id
            JOIN crm_pipeline_stages stage ON stage.id = opportunity.stage_id AND stage.workspace_id = opportunity.workspace_id
            LEFT JOIN workspace_memberships membership ON membership.id = opportunity.owner_membership_id
            LEFT JOIN users account ON account.id = membership.user_id`;
  }
}
