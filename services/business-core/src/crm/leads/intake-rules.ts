import { ForbiddenException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";

export type ReferralInput = { name?: string; contact?: string; membershipId?: string; option?: string };
export type ReferralColumns = { kind: "external" | "internal" | "broker" | "partner"; name: string | null; contact: string | null; membershipId: string | null; option: string | null };

export const REFERRAL_SOURCE = "referral";
const kindFor = (channel: string): ReferralColumns["kind"] => (channel === "internal" || channel === "broker" || channel === "partner" ? channel : "external");
const clean = (value: string | undefined, max: number) => value?.replace(/\s+/g, " ").trim().slice(0, max) || null;

/**
 * A referral enquiry names who referred it (PLM-035), shaped by the channel: an outside person
 * (name + contact), a team member, or an entry from the broker or partner list. Other sources carry none.
 */
export async function resolveReferral(client: PoolClient, workspaceId: string, source: string, channel: string, referral: ReferralInput | undefined): Promise<ReferralColumns | null> {
  if (source !== REFERRAL_SOURCE) return null;
  const kind = kindFor(channel);
  if (kind === "external") {
    const name = clean(referral?.name, 160);
    if (!name) throw new UnprocessableEntityException("Referred by is required: add the name of the person who referred this client");
    return { kind, name, contact: clean(referral?.contact, 160), membershipId: null, option: null };
  }
  if (kind === "internal") {
    if (!referral?.membershipId) throw new UnprocessableEntityException("Referred by is required: choose the team member");
    const member = await client.query(`SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, referral.membershipId]);
    if (!member.rowCount) throw new UnprocessableEntityException("Choose an active team member as the referrer");
    return { kind, name: null, contact: null, membershipId: referral.membershipId, option: null };
  }
  const listCode = kind === "broker" ? "referral_broker" : "referral_partner";
  if (!referral?.option) throw new UnprocessableEntityException(`Referred by is required: choose the ${kind}`);
  const option = await client.query(
    `SELECT 1 FROM crm_taxonomy_options choice JOIN crm_taxonomies list ON list.id = choice.taxonomy_id
     WHERE choice.workspace_id = $1 AND list.code = $2 AND choice.code = $3 AND choice.status = 'active' AND list.status = 'active'`,
    [workspaceId, listCode, referral.option]);
  if (!option.rowCount) throw new UnprocessableEntityException(`Choose a ${kind} from the ${kind} list`);
  return { kind, name: null, contact: null, membershipId: null, option: referral.option };
}

/** A source limited to roles (e.g. Self Generated, PLM-030) can only be chosen by people holding one of them. */
export async function assertSourceAllowed(client: PoolClient, workspaceId: string, userId: string, source: string) {
  const limit = await client.query<{ roles: string[] | null; label: string }>(
    `SELECT choice.allowed_role_codes AS roles, choice.label FROM crm_taxonomy_options choice JOIN crm_taxonomies list ON list.id = choice.taxonomy_id
     WHERE choice.workspace_id = $1 AND list.code = 'lead_source' AND choice.code = $2 AND choice.status = 'active'`, [workspaceId, source]);
  const roles = limit.rows[0]?.roles;
  if (!roles?.length) return;
  const held = await client.query(
    `SELECT 1 FROM workspace_memberships membership JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
     JOIN roles role ON role.id = assigned.role_id
     WHERE membership.workspace_id = $1 AND membership.user_id = $2 AND membership.status = 'active' AND (role.code = ANY($3::text[]) OR role.code IN ('owner', 'administrator'))
     LIMIT 1`, [workspaceId, userId, roles]);
  if (!held.rowCount) throw new ForbiddenException(`Only some roles can create ${limit.rows[0].label} enquiries. Choose another source.`);
}

/** Client Type is required once the workspace has set up client types (PLM-075). */
export async function assertCustomerType(client: PoolClient, workspaceId: string, customerType: string | undefined) {
  if (customerType?.trim()) return;
  const configured = await client.query(
    `SELECT 1 FROM crm_taxonomy_options choice JOIN crm_taxonomies list ON list.id = choice.taxonomy_id
     WHERE choice.workspace_id = $1 AND list.code = 'customer_type' AND choice.status = 'active' AND list.status = 'active' LIMIT 1`, [workspaceId]);
  if (configured.rowCount) throw new UnprocessableEntityException("Client type is required");
}
