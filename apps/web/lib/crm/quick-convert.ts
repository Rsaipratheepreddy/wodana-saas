import { crmRequest, type RecordData } from "./client";
import { hasResolvedEnquiryType } from "./lead-options";
import type { CrmLeadListItem, LeadsPageData } from "./leads";
import { zonedToUtc } from "./zoned-time";

/** When the first follow-up after converting is, unless the enquiry already has one ahead: tomorrow at 10:00 in the workspace's time zone. */
export function defaultFollowUp(nextActionAt: string | null | undefined, timeZone: string, now = new Date()) {
  if (nextActionAt && Date.parse(nextActionAt) > now.getTime()) return new Date(nextActionAt).toISOString();
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now.getTime() + 86_400_000));
  return zonedToUtc(tomorrow, "10:00", timeZone) ?? new Date(now.getTime() + 86_400_000).toISOString();
}

/**
 * Everything one-click Convert (S-39) needs, from what the enquiry already says: its title, its owner (or the
 * person converting), the default Sales pipeline and a follow-up. Null means something is missing and the full
 * dialog opens instead (no owner, the enquiry type not chosen yet, no pipeline).
 */
export function quickConversion(lead: CrmLeadListItem, data: LeadsPageData, timeZone: string, now = new Date()) {
  const pipeline = data.pipelines.filter((candidate) => candidate.status === "active").sort((a, b) => Number(b.isDefault) - Number(a.isDefault))[0];
  const owner = lead.ownerMembershipId ?? data.currentMembershipId ?? null;
  if (!pipeline || !owner || !hasResolvedEnquiryType(lead.serviceType) || !lead.title?.trim()) return null;
  return {
    partyId: lead.partyId, leadVersion: lead.version, pipelineId: pipeline.id, ownerMembershipId: owner, title: lead.title.trim(),
    nextActionAt: defaultFollowUp(lead.nextActionAt, timeZone, now),
  };
}

export async function quickConvert(workspaceId: string, lead: CrmLeadListItem, body: NonNullable<ReturnType<typeof quickConversion>>) {
  return crmRequest<RecordData>(workspaceId, `leads/${lead.id}/qualify`, "POST", body);
}
