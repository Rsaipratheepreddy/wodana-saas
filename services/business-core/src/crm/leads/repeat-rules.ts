import type { PoolClient } from "pg";

export type Repeat =
  | { kind: "duplicate"; originalLeadId: string; originalReference: string | null; ownerMembershipId: string | null }
  | { kind: "returning"; source: string; channel: string; previousOwnerMembershipId: string | null };

export const RETURNING_SOURCE = "returning_customer";
export const RETURNING_CHANNEL = "old_leads";

/**
 * A contact who already has an open enquiry: the new one is a duplicate of the first (PLM-093).
 * A known contact with only closed enquiries or a past project is a returning customer (PLM-037),
 * when the workspace has a returning source configured.
 */
export async function classifyRepeat(client: PoolClient, workspaceId: string, partyId: string): Promise<Repeat | null> {
  const open = await client.query<{ id: string; reference: string | null; owner: string | null }>(
    `SELECT lead.id, enquiry.reference, lead.owner_membership_id AS owner FROM crm_leads lead
     JOIN crm_enquiries enquiry ON enquiry.id = lead.enquiry_id AND enquiry.workspace_id = lead.workspace_id
     WHERE lead.workspace_id = $1 AND lead.party_id = $2 AND lead.closed_at IS NULL
       AND lead.status NOT IN ('qualified', 'disqualified', 'duplicate')
     ORDER BY lead.created_at LIMIT 1`, [workspaceId, partyId]);
  if (open.rowCount) return { kind: "duplicate", originalLeadId: open.rows[0].id, originalReference: open.rows[0].reference, ownerMembershipId: open.rows[0].owner };
  const history = await client.query<{ owner: string | null }>(
    `SELECT lead.owner_membership_id AS owner FROM crm_leads lead WHERE lead.workspace_id = $1 AND lead.party_id = $2 AND lead.status <> 'duplicate'
     ORDER BY lead.created_at DESC LIMIT 1`, [workspaceId, partyId]);
  if (!history.rowCount) return null;
  const configured = await client.query(
    `SELECT 1 FROM crm_taxonomy_options source JOIN crm_taxonomies sources ON sources.id = source.taxonomy_id AND sources.code = 'lead_source'
     JOIN crm_taxonomies channels ON channels.workspace_id = source.workspace_id AND channels.code = 'lead_channel_' || source.code
     JOIN crm_taxonomy_options channel ON channel.taxonomy_id = channels.id AND channel.code = $3 AND channel.status = 'active'
     WHERE source.workspace_id = $1 AND source.code = $2 AND source.status = 'active' LIMIT 1`, [workspaceId, RETURNING_SOURCE, RETURNING_CHANNEL]);
  if (!configured.rowCount) return null;
  return { kind: "returning", source: RETURNING_SOURCE, channel: RETURNING_CHANNEL, previousOwnerMembershipId: history.rows[0].owner };
}
