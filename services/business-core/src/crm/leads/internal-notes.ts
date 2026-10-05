import type { PoolClient } from "pg";
import { loadSalesSettings } from "./sales-attention";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-024: who reads an enquiry's internal notes. `team` (the default): the enquiry's owner, the people tagged on its
 * team, and whoever assigns enquiries (they see the whole team's work, PLM-076). `sales`: everyone with Sales access.
 * Never the client or the portal (portal reads never select the notes). Every read path that returns an enquiry's
 * details passes them through `redactNotes`.
 */
export const NOTES_VISIBILITY = ["team", "sales"] as const;
export type NotesVisibility = (typeof NOTES_VISIBILITY)[number];

export type NotesReader = { all: boolean; membershipId: string | null; teamLeadIds: ReadonlySet<string> };

/** The caller as a notes reader, for these enquiries. `canAssign` is the caller's crm.leads.assign permission. */
export async function notesReader(db: Db, workspaceId: string, userId: string, canAssign: boolean, leadIds: string[]): Promise<NotesReader> {
  const settings = await loadSalesSettings(db, workspaceId);
  if (settings.internalNotesVisibility === "sales" || canAssign) return { all: true, membershipId: null, teamLeadIds: new Set() };
  const membershipId = (await db.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`, [workspaceId, userId])).rows[0]?.id ?? null;
  if (!membershipId || !leadIds.length) return { all: false, membershipId, teamLeadIds: new Set() };
  const team = await db.query<{ leadId: string }>(`SELECT lead_id AS "leadId" FROM crm_lead_team WHERE workspace_id = $1 AND membership_id = $2 AND lead_id = ANY($3::uuid[])`, [workspaceId, membershipId, leadIds]);
  return { all: false, membershipId, teamLeadIds: new Set(team.rows.map((row) => row.leadId)) };
}

export function canReadNotes(reader: NotesReader, lead: { id: string | null | undefined; ownerMembershipId?: string | null }) {
  if (reader.all) return true;
  if (!lead.id) return false;
  return Boolean(reader.membershipId && lead.ownerMembershipId === reader.membershipId) || reader.teamLeadIds.has(lead.id);
}

/** The details without the internal notes, unless this reader may read them. */
export function redactNotes<T>(details: T, visible: boolean): T {
  if (visible || !details || typeof details !== "object" || Array.isArray(details) || !("internalNotes" in details)) return details;
  const { internalNotes: _hidden, ...rest } = details as Record<string, unknown>;
  return rest as T;
}

/** A change-history line about the internal notes (`details.internalNotes`). */
export const isNotesField = (field: string) => /(^|\.)internalNotes$/.test(field);
