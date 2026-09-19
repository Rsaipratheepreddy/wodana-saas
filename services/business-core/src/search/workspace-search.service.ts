import { BadRequestException, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";

type SearchKind = "customer" | "job" | "room" | "quotation" | "project";
type SearchResult = {
  id: string;
  kind: SearchKind;
  title: string;
  subtitle: string;
  reference: string | null;
  route: string;
};

type SearchContext = {
  membershipId: string;
  permissions: Set<string>;
};

const kindOrder: Record<SearchKind, number> = {
  job: 0,
  customer: 1,
  room: 2,
  quotation: 3,
  project: 4,
};

function searchWindow(input?: string): number {
  if (input === undefined) return 20;
  const limit = Number(input);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new BadRequestException("Use a result limit between 1 and 50.");
  return limit;
}

function routeSegment(value: unknown): string {
  return encodeURIComponent(String(value));
}

@Injectable()
export class WorkspaceSearchService {
  constructor(private readonly access: WorkspaceAccessService) {}

  search(actor: RequestActor, workspaceId: string, queryInput?: string, limitInput?: string) {
    const query = queryInput?.trim() ?? "";
    const limit = searchWindow(limitInput);
    if (query.length > 120) throw new BadRequestException("Search terms must be 120 characters or fewer.");
    if (query.length < 2) return Promise.resolve({ query, items: [], searchedKinds: [], truncated: false });

    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const context = await this.context(client, workspaceId, user.userId);
      const searchedKinds: SearchKind[] = [];
      const perKind = Math.min(20, limit);
      const reads: Array<Promise<SearchResult[]>> = [];

      if (context.permissions.has("crm.parties.view")) {
        searchedKinds.push("customer");
        reads.push(this.customers(client, workspaceId, query, perKind));
      }

      const canReadLeads = context.permissions.has("crm.leads.view");
      const canReadOpportunities = context.permissions.has("crm.opportunities.view");
      const canReadPreProjects = context.permissions.has("pre_projects.view");
      const canManageProjects = context.permissions.has("projects.manage");
      const canReadProjects = canManageProjects || context.permissions.has("projects.view");
      if (canReadLeads || canReadOpportunities || canReadPreProjects || canReadProjects) {
        searchedKinds.push("job");
        reads.push(this.jobs(client, workspaceId, query, perKind, context.membershipId, {
          leads: canReadLeads,
          opportunities: canReadOpportunities,
          preProjects: canReadPreProjects,
          projects: canReadProjects,
          manageProjects: canManageProjects,
        }));
      }
      if (canReadPreProjects) {
        searchedKinds.push("room", "quotation");
        reads.push(this.rooms(client, workspaceId, query, perKind));
        reads.push(this.quotations(client, workspaceId, query, perKind));
      }
      if (canReadProjects) {
        searchedKinds.push("project");
        reads.push(this.projects(client, workspaceId, query, perKind, context.membershipId, canManageProjects));
      }

      const all = (await Promise.all(reads)).flat();
      const normalized = query.toLocaleLowerCase();
      all.sort((left, right) => {
        const leftExact = left.reference?.toLocaleLowerCase() === normalized || left.title.toLocaleLowerCase() === normalized ? 0 : 1;
        const rightExact = right.reference?.toLocaleLowerCase() === normalized || right.title.toLocaleLowerCase() === normalized ? 0 : 1;
        return leftExact - rightExact || kindOrder[left.kind] - kindOrder[right.kind] || left.title.localeCompare(right.title);
      });
      return { query, items: all.slice(0, limit), searchedKinds, truncated: all.length > limit };
    });
  }

  private async context(client: PoolClient, workspaceId: string, userId: string): Promise<SearchContext> {
    const result = await client.query<{ membershipId: string; code: string | null }>(
      `SELECT membership.id::text AS "membershipId",permission.code
         FROM workspace_memberships membership
         LEFT JOIN effective_member_roles assigned ON assigned.membership_id=membership.id
         LEFT JOIN role_permissions granted ON granted.role_id=assigned.role_id
         LEFT JOIN permissions permission ON permission.id=granted.permission_id
        WHERE membership.workspace_id=$1 AND membership.user_id=$2 AND membership.status='active'`,
      [workspaceId, userId],
    );
    const permissionCodes = result.rows.flatMap((row) => row.code ? [row.code] : []);
    const effectivePermissions = await this.access.effectivePermissions(client, workspaceId, permissionCodes);
    return {
      membershipId: result.rows[0]?.membershipId ?? "",
      permissions: new Set(effectivePermissions),
    };
  }

  private async customers(client: PoolClient, workspaceId: string, query: string, limit: number): Promise<SearchResult[]> {
    const rows = (await client.query<{ id: string; title: string; type: string; lifecycle: string }>(
      `SELECT party.id::text,party.display_name AS title,party.type::text,party.lifecycle
         FROM crm_parties party
        WHERE party.workspace_id=$1 AND party.status<>'archived'
          AND (party.display_name ILIKE $2 OR EXISTS(
            SELECT 1 FROM crm_contact_points contact
             WHERE contact.workspace_id=party.workspace_id AND contact.party_id=party.id
               AND contact.status='active' AND contact.normalized_value ILIKE $2))
        ORDER BY CASE WHEN lower(party.display_name)=lower($3) THEN 0 ELSE 1 END,party.display_name,party.id
        LIMIT $4`,
      [workspaceId, `%${query}%`, query, limit],
    )).rows;
    return rows.map((row) => ({
      id: row.id, kind: "customer", title: row.title,
      subtitle: `${row.type === "organization" ? "Company" : "Person"} · ${row.lifecycle.replaceAll("_", " ")}`,
      reference: null,
      route: `/workspace/crm/customers?record=${routeSegment(row.id)}`,
    }));
  }

  private async jobs(
    client: PoolClient,
    workspaceId: string,
    query: string,
    limit: number,
    membershipId: string,
    grants: { leads: boolean; opportunities: boolean; preProjects: boolean; projects: boolean; manageProjects: boolean },
  ): Promise<SearchResult[]> {
    const rows = (await client.query<{ id: string; reference: string; title: string; customer: string | null }>(
      `WITH facts AS (
         SELECT identity.id::text,identity.reference,link.record_type,
                CASE link.record_type
                  WHEN 'enquiry' THEN enquiry.title
                  WHEN 'lead' THEN lead_enquiry.title
                  WHEN 'opportunity' THEN opportunity.title
                  WHEN 'case' THEN case_opportunity.title
                  WHEN 'quote' THEN case_opportunity.title
                  WHEN 'project' THEN project.name
                END AS title,
                party.display_name AS customer,
                CASE link.record_type WHEN 'project' THEN 6 WHEN 'case' THEN 5 WHEN 'quote' THEN 4
                  WHEN 'opportunity' THEN 3 WHEN 'lead' THEN 2 ELSE 1 END AS priority
           FROM job_identities identity
           JOIN job_identity_links link ON link.workspace_id=identity.workspace_id AND link.job_id=identity.id AND link.status='active'
           LEFT JOIN crm_enquiries enquiry ON link.record_type='enquiry' AND enquiry.workspace_id=link.workspace_id AND enquiry.id::text=link.record_id
           LEFT JOIN crm_leads lead ON link.record_type='lead' AND lead.workspace_id=link.workspace_id AND lead.id::text=link.record_id
           LEFT JOIN crm_enquiries lead_enquiry ON lead_enquiry.workspace_id=lead.workspace_id AND lead_enquiry.id=lead.enquiry_id
           LEFT JOIN crm_opportunities opportunity ON link.record_type='opportunity' AND opportunity.workspace_id=link.workspace_id AND opportunity.id::text=link.record_id
           LEFT JOIN pre_project_cases case_record ON link.record_type IN ('case','quote') AND case_record.workspace_id=link.workspace_id
             AND ((link.record_type='case' AND case_record.id::text=link.record_id) OR (link.record_type='quote' AND case_record.id=link.case_id))
           LEFT JOIN crm_opportunities case_opportunity ON case_opportunity.workspace_id=case_record.workspace_id AND case_opportunity.id=case_record.opportunity_id
           LEFT JOIN delivery_projects project ON link.record_type='project' AND project.workspace_id=link.workspace_id AND project.id::text=link.record_id
           LEFT JOIN pre_project_cases project_case ON project_case.workspace_id=project.workspace_id AND project_case.id=project.case_id
           LEFT JOIN crm_opportunities project_opportunity ON project_opportunity.workspace_id=project_case.workspace_id AND project_opportunity.id=project_case.opportunity_id
           LEFT JOIN crm_parties party ON party.workspace_id=link.workspace_id AND party.id=COALESCE(
             enquiry.party_id,lead.party_id,opportunity.party_id,case_opportunity.party_id,project_opportunity.party_id)
          WHERE identity.workspace_id=$1 AND (
            ($3::boolean AND link.record_type IN ('enquiry','lead')) OR
            ($4::boolean AND link.record_type='opportunity') OR
            ($5::boolean AND link.record_type IN ('case','quote')) OR
            ($6::boolean AND link.record_type='project' AND ($7::boolean OR EXISTS(
              SELECT 1 FROM project_assignments assignment
               WHERE assignment.workspace_id=link.workspace_id AND assignment.project_id::text=link.record_id
                 AND assignment.membership_id=$8 AND assignment.active)))
          )
       ), grouped AS (
         SELECT id,reference,
                (array_agg(title ORDER BY priority DESC) FILTER (WHERE title IS NOT NULL))[1] AS title,
                (array_agg(customer ORDER BY priority DESC) FILTER (WHERE customer IS NOT NULL))[1] AS customer
           FROM facts GROUP BY id,reference
       )
       SELECT id,reference,COALESCE(title,reference) AS title,customer FROM grouped
        WHERE reference ILIKE $2 OR title ILIKE $2 OR customer ILIKE $2
        ORDER BY CASE WHEN lower(reference)=lower($9) THEN 0 ELSE 1 END,reference
        LIMIT $10`,
      [workspaceId, `%${query}%`, grants.leads, grants.opportunities, grants.preProjects,
        grants.projects, grants.manageProjects, membershipId, query, limit],
    )).rows;
    return rows.map((row) => ({
      id: row.id, kind: "job", title: row.title,
      subtitle: row.customer ? `Job · ${row.customer}` : "Job",
      reference: row.reference,
      route: `/workspace/crm/jobs/${routeSegment(row.id)}`,
    }));
  }

  private async rooms(client: PoolClient, workspaceId: string, query: string, limit: number): Promise<SearchResult[]> {
    const rows = (await client.query<{ id: string; name: string; caseId: string; caseTitle: string; customer: string }>(
      `SELECT room.id::text,room.name,case_record.id::text AS "caseId",opportunity.title AS "caseTitle",party.display_name AS customer
         FROM pre_project_rooms room
         JOIN pre_project_cases case_record ON case_record.workspace_id=room.workspace_id AND case_record.id=room.case_id
         JOIN crm_opportunities opportunity ON opportunity.workspace_id=case_record.workspace_id AND opportunity.id=case_record.opportunity_id
         JOIN crm_parties party ON party.workspace_id=opportunity.workspace_id AND party.id=opportunity.party_id
        WHERE room.workspace_id=$1 AND case_record.status<>'cancelled'
          AND concat_ws(' ',room.name,opportunity.title,party.display_name) ILIKE $2
        ORDER BY CASE WHEN lower(room.name)=lower($3) THEN 0 ELSE 1 END,room.name,room.id LIMIT $4`,
      [workspaceId, `%${query}%`, query, limit],
    )).rows;
    return rows.map((row) => ({
      id: row.id, kind: "room", title: row.name,
      subtitle: `${row.caseTitle} · ${row.customer}`,
      reference: null,
      route: `/workspace/pre-projects/cases/${routeSegment(row.caseId)}/requirements?room=${routeSegment(row.id)}`,
    }));
  }

  private async quotations(client: PoolClient, workspaceId: string, query: string, limit: number): Promise<SearchResult[]> {
    const rows = (await client.query<{ id: string; title: string; number: string; status: string; caseId: string; customer: string }>(
      `SELECT quote.data->>'id' AS id,COALESCE(NULLIF(quote.data->>'title',''),opportunity.title) AS title,
              COALESCE(quote.data->>'number','—') AS number,COALESCE(quote.data->>'status','draft') AS status,
              commercial.case_id::text AS "caseId",party.display_name AS customer
         FROM commercial_cases commercial
         JOIN pre_project_cases case_record ON case_record.workspace_id=commercial.workspace_id AND case_record.id=commercial.case_id
         JOIN crm_opportunities opportunity ON opportunity.workspace_id=case_record.workspace_id AND opportunity.id=case_record.opportunity_id
         JOIN crm_parties party ON party.workspace_id=opportunity.workspace_id AND party.id=opportunity.party_id
         CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(commercial.content->'quotes')='array'
           THEN commercial.content->'quotes' ELSE '[]'::jsonb END) quote(data)
        WHERE commercial.workspace_id=$1
          AND quote.data->>'kind'='quotation'
          AND NULLIF(quote.data->>'id','') IS NOT NULL
          AND concat_ws(' ',quote.data->>'title',quote.data->>'number',opportunity.title,party.display_name) ILIKE $2
        ORDER BY CASE WHEN lower(quote.data->>'number')=lower($3) THEN 0 ELSE 1 END,commercial.updated_at DESC
        LIMIT $4`,
      [workspaceId, `%${query}%`, query, limit],
    )).rows;
    return rows.map((row) => ({
      id: row.id, kind: "quotation", title: row.title,
      subtitle: `${row.status.replaceAll("_", " ")} · ${row.customer}`,
      reference: row.number === "—" ? null : row.number,
      route: `/workspace/pre-projects/cases/${routeSegment(row.caseId)}/quotations?quote=${routeSegment(row.id)}`,
    }));
  }

  private async projects(
    client: PoolClient,
    workspaceId: string,
    query: string,
    limit: number,
    membershipId: string,
    canManage: boolean,
  ): Promise<SearchResult[]> {
    const rows = (await client.query<{ id: string; name: string; reference: string | null; customer: string; status: string }>(
      `SELECT project.id::text,project.name,project.status,
              NULLIF(execution.content->'controls'->>'reference','') AS reference,
              party.display_name AS customer
         FROM delivery_projects project
         JOIN pre_project_cases case_record ON case_record.workspace_id=project.workspace_id AND case_record.id=project.case_id
         JOIN crm_opportunities opportunity ON opportunity.workspace_id=case_record.workspace_id AND opportunity.id=case_record.opportunity_id
         JOIN crm_parties party ON party.workspace_id=opportunity.workspace_id AND party.id=opportunity.party_id
         LEFT JOIN project_execution execution ON execution.workspace_id=project.workspace_id AND execution.project_id=project.id
        WHERE project.workspace_id=$1 AND project.status<>'archived'
          AND ($4::boolean OR EXISTS(SELECT 1 FROM project_assignments assignment
            WHERE assignment.workspace_id=project.workspace_id AND assignment.project_id=project.id
              AND assignment.membership_id=$3 AND assignment.active))
          AND concat_ws(' ',project.name,party.display_name,execution.content->'controls'->>'reference') ILIKE $2
        ORDER BY CASE WHEN lower(COALESCE(execution.content->'controls'->>'reference',''))=lower($5) THEN 0 ELSE 1 END,
                 project.created_at DESC LIMIT $6`,
      [workspaceId, `%${query}%`, membershipId, canManage, query, limit],
    )).rows;
    return rows.map((row) => ({
      id: row.id, kind: "project", title: row.name,
      subtitle: `Project · ${row.customer} · ${row.status}`,
      reference: row.reference,
      route: `/workspace/projects/${routeSegment(row.id)}/overview`,
    }));
  }
}
