import type { PoolClient } from "pg";
import type { JobLineageRows } from "./job-lineage";

/** Read one tenant's source lineage under the caller's tenant transaction. */
export async function loadJobLineageRows(client: PoolClient, workspaceId: string): Promise<JobLineageRows> {
  const enquiries = await client.query<JobLineageRows["enquiries"][number]>(
    `SELECT id::text, workspace_id::text AS "workspaceId", party_id::text AS "partyId"
     FROM crm_enquiries WHERE workspace_id=$1 ORDER BY created_at,id`, [workspaceId],
  );
  const leads = await client.query<JobLineageRows["leads"][number]>(
    `SELECT id::text, workspace_id::text AS "workspaceId", enquiry_id::text AS "enquiryId", party_id::text AS "partyId"
     FROM crm_leads WHERE workspace_id=$1 ORDER BY created_at,id`, [workspaceId],
  );
  const opportunities = await client.query<JobLineageRows["opportunities"][number]>(
    `SELECT id::text, workspace_id::text AS "workspaceId", party_id::text AS "partyId", lead_id::text AS "leadId"
     FROM crm_opportunities WHERE workspace_id=$1 ORDER BY created_at,id`, [workspaceId],
  );
  const cases = await client.query<JobLineageRows["cases"][number]>(
    `SELECT id::text, workspace_id::text AS "workspaceId", opportunity_id::text AS "opportunityId"
     FROM pre_project_cases WHERE workspace_id=$1 ORDER BY created_at,id`, [workspaceId],
  );
  const quotes = await client.query<JobLineageRows["quotes"][number]>(
    `SELECT quote.value->>'id' AS id, commercial.workspace_id::text AS "workspaceId", commercial.case_id::text AS "caseId"
     FROM commercial_cases commercial
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE WHEN jsonb_typeof(commercial.content->'quotes')='array'
            THEN commercial.content->'quotes' ELSE '[]'::jsonb END
     ) AS quote(value)
     WHERE commercial.workspace_id=$1 AND quote.value ? 'id'
     ORDER BY commercial.case_id,id`, [workspaceId],
  );
  const projects = await client.query<JobLineageRows["projects"][number]>(
    `SELECT id::text, workspace_id::text AS "workspaceId", case_id::text AS "caseId"
     FROM delivery_projects WHERE workspace_id=$1 ORDER BY created_at,id`, [workspaceId],
  );
  const projectLinks = await client.query<JobLineageRows["projectLinks"][number]>(
    `SELECT id::text, workspace_id::text AS "workspaceId", opportunity_id::text AS "opportunityId",
            project_id::text AS "projectId", mode
     FROM crm_project_links WHERE workspace_id=$1 ORDER BY linked_at,id`, [workspaceId],
  );
  return {
    enquiries: enquiries.rows,
    leads: leads.rows,
    opportunities: opportunities.rows,
    cases: cases.rows,
    quotes: quotes.rows,
    projects: projects.rows,
    projectLinks: projectLinks.rows,
  };
}
