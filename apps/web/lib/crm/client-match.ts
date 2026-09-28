import { crmRequest } from "./client";

/** An existing client a new enquiry may belong to, with enough to tell people apart (LF-1, S-3). */
export type ClientMatch = {
  partyId: string;
  name: string;
  mobile: string | null;
  email: string | null;
  leadId: string | null;
  reference: string | null;
  status: string | null;
  receivedAt: string | null;
  open: boolean;
  ownerName: string | null;
  /** Present when the match waits on an enquiry as "Confirm client". */
  candidateId?: string;
};

export type ContactMatchResult = { valid: boolean; message: string | null; matches: ClientMatch[] };

/** Who already has this mobile or email. */
export function findContactMatches(workspaceId: string, query: { mobile?: string; countryCode?: string; email?: string }, signal?: AbortSignal) {
  const search = new URLSearchParams(Object.entries(query).filter(([, value]) => value?.trim()) as Array<[string, string]>);
  return crmRequest<ContactMatchResult>(workspaceId, `leads/contact-match?${search}`, "GET", undefined, signal);
}
