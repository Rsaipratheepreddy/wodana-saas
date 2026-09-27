import { tKey } from "@/lib/i18n/keys";
import { crmRequest, CrmRequestError } from "./client";
import type { CrmLeadListItem } from "./leads";

export type AutoAssignmentProgress = {
  total: number; completed: number; assigned: number;
  remaining: { id: string; name: string; reason: string }[];
};
const active = new Set(["new", "attempting_contact", "connected", "nurturing", "paused"]);

/**
 * Snapshot all pages before mutating: assignment changes the list's sort order.
 * Errors and `reason` are i18n keys or server text: show them with `translateKnown`.
 */
export async function autoAssignLeads(
  workspaceId: string,
  selected: CrmLeadListItem[] | undefined,
  onProgress: (progress: AutoAssignmentProgress) => void,
  onAssigned: (lead: CrmLeadListItem) => void,
): Promise<AutoAssignmentProgress> {
  const leads = new Map<string, CrmLeadListItem>();
  if (selected) selected.forEach((lead) => leads.set(lead.id, lead));
  else {
    let cursor: string | null = null;
    const cursors = new Set<string>();
    do {
      const query = new URLSearchParams({ workspaceId, ...(cursor ? { cursor } : {}) });
      const response = await fetch(`/api/workspace/crm/leads?${query}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const page: { data?: CrmLeadListItem[]; nextCursor?: string | null; message?: string } = await response.json();
      if (!response.ok) throw new Error(page?.message ?? tKey("Could not load unassigned leads. No assignments were started."));
      if (!Array.isArray(page?.data)) throw new Error(tKey("The lead list could not be confirmed. No assignments were started."));
      page.data.forEach((lead: CrmLeadListItem) => leads.set(lead.id, lead));
      cursor = page.nextCursor ?? null;
      if (cursor && cursors.has(cursor)) throw new Error(tKey("Lead pagination could not finish. No assignments were started."));
      if (cursor) cursors.add(cursor);
    } while (cursor);
  }
  const candidates = [...leads.values()].filter((lead) => !lead.ownerMembershipId && !lead.isConverted && active.has(lead.status));
  const result: AutoAssignmentProgress = { total: candidates.length, completed: 0, assigned: 0, remaining: [] };
  const report = () => onProgress({ ...result, remaining: [...result.remaining] });
  report();
  for (let i = 0; i < candidates.length; i++) {
    const lead = candidates[i];
    try {
      const saved = await crmRequest<CrmLeadListItem>(workspaceId, `leads/${lead.id}/auto-assign?version=${lead.version}`, "POST", {}, AbortSignal.timeout(20_000));
      if (saved?.id !== lead.id || !Number.isInteger(saved.version)) throw new Error(tKey("Assignment could not be confirmed. Refresh before retrying."));
      onAssigned(saved);
      if (saved.ownerMembershipId) result.assigned++;
      else result.remaining.push({ id: lead.id, name: lead.partyName, reason: tKey("No available manager with remaining capacity.") });
    } catch (error) {
      result.remaining.push({ id: lead.id, name: lead.partyName, reason: error instanceof Error ? error.message : tKey("Assignment failed.") });
      // Authentication, permission, network and server failures cannot be fixed by repeating the request for every row.
      if (!(error instanceof CrmRequestError) || [401, 403, 429].includes(error.status) || error.status >= 500) {
        for (const pending of candidates.slice(i + 1)) result.remaining.push({ id: pending.id, name: pending.partyName, reason: tKey("Not attempted. Resolve the error above, then retry.") });
        result.completed++; report(); return result;
      }
    }
    result.completed++; report();
  }
  return result;
}
