import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { PoolClient } from "pg";
import { RequestActor } from "../auth/actor";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { CrmOpportunitiesService } from "../crm/opportunities/crm-opportunities.service";
import { canonicalHash } from "../crm/shared/crm-types";
import { ListPreProjectsDto, StartFromQualifiedLeadDto } from "./pre-projects.dto";

const caseSelect = `SELECT c.id, c.status::text AS status, c.created_at AS "createdAt", c.updated_at AS "updatedAt",
  o.id AS "opportunityId", o.title, o.description, o.status::text AS "opportunityStatus",
  o.party_id AS "customerId", p.display_name AS "customerName", o.lead_id AS "leadId",
  o.amount, o.currency_code AS "currencyCode", u.display_name AS "leadManagerName",
  false AS "qualifiedLead", NULL::int AS "leadVersion", o.owner_membership_id AS "ownerMembershipId"
  FROM pre_project_cases c
  JOIN crm_opportunities o ON o.id = c.opportunity_id AND o.workspace_id = c.workspace_id
  JOIN crm_parties p ON p.id = o.party_id AND p.workspace_id = c.workspace_id
  LEFT JOIN workspace_memberships m ON m.id = o.owner_membership_id AND m.workspace_id = c.workspace_id
  LEFT JOIN users u ON u.id = m.user_id`;

@Injectable()
export class PreProjectsService {
  constructor(private readonly access: WorkspaceAccessService, private readonly events: CrmEventsService, private readonly opportunities: CrmOpportunitiesService) {}

  list(actor: RequestActor, workspaceId: string, query: ListPreProjectsDto) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client, user) => {
      const values = [workspaceId, query.search?.trim() ?? "", query.status ?? "all"];
      // Qualified leads are visible immediately, including records qualified before this release.
      // A linked case replaces its incoming lead row; archived cases never reappear as new leads.
      const records = `WITH records AS (
        ${caseSelect} WHERE c.workspace_id = $1
        UNION ALL
        SELECT lead.id, 'qualified', COALESCE(lead.qualified_at, lead.created_at), lead.updated_at,
          opportunity.id, COALESCE(opportunity.title, enquiry.title), COALESCE(opportunity.description, enquiry.summary), opportunity.status::text,
          party.id, party.display_name, lead.id, opportunity.amount, opportunity.currency_code,
          manager.display_name, true, lead.version, COALESCE(opportunity.owner_membership_id, lead.owner_membership_id)
        FROM crm_leads lead
        JOIN crm_enquiries enquiry ON enquiry.id = lead.enquiry_id AND enquiry.workspace_id = lead.workspace_id
        JOIN crm_parties party ON party.id = lead.party_id AND party.workspace_id = lead.workspace_id
        LEFT JOIN LATERAL (SELECT o.* FROM crm_opportunities o WHERE o.workspace_id = lead.workspace_id AND o.lead_id = lead.id ORDER BY o.created_at, o.id LIMIT 1) opportunity ON true
        LEFT JOIN workspace_memberships membership ON membership.id = COALESCE(opportunity.owner_membership_id, lead.owner_membership_id) AND membership.workspace_id = lead.workspace_id
        LEFT JOIN users manager ON manager.id = membership.user_id
        WHERE lead.workspace_id = $1 AND lead.status = 'qualified'
          AND NOT EXISTS (SELECT 1 FROM pre_project_cases existing JOIN crm_opportunities linked ON linked.id = existing.opportunity_id AND linked.workspace_id = existing.workspace_id WHERE existing.workspace_id = lead.workspace_id AND linked.lead_id = lead.id)
      )`;
      const where = ` WHERE ($2 = '' OR strpos(lower(title || ' ' || "customerName"), lower($2)) > 0) AND ($3 = 'all' OR status = $3)`;
      const total = await client.query(`${records} SELECT count(*)::int AS total FROM records${where}`, values);
      const items = await client.query(`${records} SELECT * FROM records${where} ORDER BY "updatedAt" DESC, id DESC LIMIT 24 OFFSET $4`, [...values, ((query.page ?? 1) - 1) * 24]);
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
      const created = await client.query(`INSERT INTO pre_project_cases (workspace_id, opportunity_id, created_by) VALUES ($1, $2, $3) RETURNING id`, [workspaceId, opportunityId, user.userId]);
      const result = await this.read(client, workspaceId, created.rows[0].id);
      await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: "pre_project.case_started.v1", entityType: "pre_project_case", entityId: result.id, after: { id: result.id, opportunityId, leadId: lead.id } });
      return result;
    });
  }

  get(actor: RequestActor, workspaceId: string, id: string) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", (client) => this.read(client, workspaceId, id));
  }

  start(actor: RequestActor, workspaceId: string, opportunityId: string) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.create", "crm.opportunities.view"], async (client, user) => {
      // Lock the source: concurrent starts and CRM status changes cannot race this decision.
      const source = await client.query(`SELECT id, status FROM crm_opportunities WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, opportunityId]);
      if (!source.rowCount) throw new NotFoundException("Opportunity not found");
      const existing = await client.query(`SELECT id FROM pre_project_cases WHERE workspace_id = $1 AND opportunity_id = $2`, [workspaceId, opportunityId]);
      if (existing.rowCount) return this.read(client, workspaceId, existing.rows[0].id);
      if (!["open", "won"].includes(source.rows[0].status)) throw new ConflictException("Reopen the opportunity in CRM before starting a pre-execution.");
      const created = await client.query(`INSERT INTO pre_project_cases (workspace_id, opportunity_id, created_by)
        VALUES ($1, $2, $3) RETURNING id`, [workspaceId, opportunityId, user.userId]);
      const result = await this.read(client, workspaceId, created.rows[0].id);
      await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: "pre_project.case_started.v1", entityType: "pre_project_case", entityId: result.id, after: { id: result.id, opportunityId } });
      return result;
    });
  }

  private async read(client: PoolClient, workspaceId: string, id: string) {
    const result = await client.query(`${caseSelect} WHERE c.workspace_id = $1 AND c.id = $2`, [workspaceId, id]);
    if (!result.rowCount) throw new NotFoundException("Pre-execution not found");
    return result.rows[0];
  }
}
