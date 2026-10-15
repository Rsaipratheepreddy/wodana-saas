import type { PoolClient } from "pg";
import { commercialRepository } from "../commercial/commercial-repository";
import { closingEventFor, loadClosingRules, TEMPLATE_CLOSING } from "../crm/flows/flow-closing";
import type { FurniturePath } from "../crm/opportunities/flow-gates";

type Db = Pick<PoolClient, "query">;

/**
 * A design-only job (Full ID): the design is the whole job, so the client's design approval ends it as "Design
 * complete": there is no Proposal 2 estimate to hand off to and no work to keep the client updated on. Read from the
 * deal's chosen service path (design without a main quotation) when it has one, else from the enquiry type's closing
 * rule (the deal closes at the design handover). Read only: nothing is pinned or seeded here.
 */
export async function isDesignOnlyJob(db: Db, workspaceId: string, caseId: string): Promise<boolean> {
  const scope = (await commercialRepository.load(db, workspaceId, caseId))?.content?.servicePath?.scope;
  if (scope) return scope.design && !scope.mainQuotation;
  // The flow the job pinned, else its enquiry type's active flow.
  const row = (await db.query<{ flowId: string | null; code: string | null; furniturePath: FurniturePath | null }>(
    `SELECT flow.id AS "flowId", flow.code, opportunity.furniture_path AS "furniturePath"
       FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_flow_versions pinned ON pinned.workspace_id = opportunity.workspace_id AND pinned.id = opportunity.flow_version_id
       LEFT JOIN crm_leads lead ON lead.workspace_id = opportunity.workspace_id AND lead.id = opportunity.lead_id
       LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
       LEFT JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = opportunity.workspace_id AND taxonomy.code = 'enquiry_type'
       LEFT JOIN crm_taxonomy_options choice ON choice.workspace_id = taxonomy.workspace_id AND choice.taxonomy_id = taxonomy.id AND choice.code = enquiry.service_type
       LEFT JOIN crm_flows flow ON flow.workspace_id = opportunity.workspace_id
        AND flow.id = coalesce(pinned.flow_id, (SELECT typed.id FROM crm_flows typed WHERE typed.workspace_id = opportunity.workspace_id AND typed.code = choice.flow AND typed.status = 'active' LIMIT 1))
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0];
  if (!row?.flowId) return false;
  const rules = await loadClosingRules(db, workspaceId, row.flowId);
  // A flow whose closing rules were never read yet closes as its template or starter does.
  const template = row.code ? TEMPLATE_CLOSING[row.code] : undefined;
  const event = rules.length ? closingEventFor(rules, row.furniturePath)
    : (row.furniturePath ? template?.paths?.[row.furniturePath] : undefined) ?? template?.default ?? null;
  return event === "design_handover";
}
