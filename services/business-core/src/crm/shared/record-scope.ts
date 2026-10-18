import type { PoolClient } from "pg";
import type { WorkspaceAccessService } from "../../workspaces/workspace-access.service";

/**
 * §0.3 P0 (guide C, PLM-038): who sees which enquiries and opportunities. Whoever assigns enquiries (crm.leads.assign)
 * or may see every one (crm.leads.view_all) sees all of them; anyone else sees their own: what they own, what they are
 * tagged on, and the opportunity one of their enquiries became. Returns the membership to filter by, or null for all.
 */
export async function ownRecordsScope(client: PoolClient, access: Pick<WorkspaceAccessService, "hasPermission">, workspaceId: string, userId: string): Promise<string | null> {
  if (await access.hasPermission(client, workspaceId, userId, "crm.leads.view_all")) return null;
  if (await access.hasPermission(client, workspaceId, userId, "crm.leads.assign")) return null;
  const membership = (await client.query<{ id: string }>(
    `SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`, [workspaceId, userId])).rows[0];
  // Nobody's membership matches the empty id, so someone without one sees nothing.
  return membership?.id ?? "00000000-0000-0000-0000-000000000000";
}

/** The enquiry clause for a scoped member (`lead` and its first opportunity's owner `converted_owner` in scope). */
export const ownLeadSql = (lead: string, param: string) =>
  `(${lead}.owner_membership_id = ${param}
    OR EXISTS (SELECT 1 FROM crm_opportunities own_opportunity WHERE own_opportunity.workspace_id = ${lead}.workspace_id AND own_opportunity.lead_id = ${lead}.id AND own_opportunity.owner_membership_id = ${param})
    OR EXISTS (SELECT 1 FROM crm_lead_team own_team WHERE own_team.workspace_id = ${lead}.workspace_id AND own_team.lead_id = ${lead}.id AND own_team.membership_id = ${param}))`;

/** The opportunity clause for a scoped member. */
export const ownOpportunitySql = (opportunity: string, param: string) =>
  `(${opportunity}.owner_membership_id = ${param}
    OR EXISTS (SELECT 1 FROM crm_opportunity_team own_team WHERE own_team.workspace_id = ${opportunity}.workspace_id AND own_team.opportunity_id = ${opportunity}.id AND own_team.membership_id = ${param}))`;
