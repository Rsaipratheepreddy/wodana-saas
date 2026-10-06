import type { PortalContact, PortalFile, PortalSettings, PortalSite, PortalView, ProjectPortal, StaffIssue, StaffMoodboard, StaffPaymentReport, StaffThreads } from "./types";
import type { Translate } from "@/lib/i18n/keys";

const untranslated: Translate = (key) => key;

/** A failed portal request: the message is written for the person, the status says what kind of failure. */
export class PortalError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter?: number) { super(message); }
}

async function call<T>(t: Translate, url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method, cache: "no-store", headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!response) throw new PortalError(t("You seem to be offline. Check your connection and try again."), 0);
  const data = await response.json().catch(() => null) as (T & { message?: unknown; retryAfter?: unknown }) | null;
  if (!response.ok) throw new PortalError(typeof data?.message === "string" ? data.message : t("Something went wrong. Please try again."), response.status,
    typeof data?.retryAfter === "number" ? data.retryAfter : undefined);
  return data as T;
}

export type Challenge = { challengeId: string; channel: "whatsapp" | "email"; expiresIn: number; resendAfter: number; sentTo?: string };

/** The client's side of one tenant's portal; `t` writes the messages this client creates itself. */
export function portalApi(slug: string, t: Translate = untranslated) {
  const at = (path: string) => `/api/client-portal/${encodeURIComponent(slug)}/${path}`;
  return {
    view: () => call<PortalView>(t, at("view")),
    challenge: (input: { phone?: string; channel: "whatsapp" | "email"; purpose?: string }) => call<Challenge>(t, at("challenge"), "POST", input),
    login: (input: { challengeId: string; code: string }) => call<{ ok: true; needsName: boolean }>(t, at("login"), "POST", input),
    /** One command; the id makes a retry of the same action safe. */
    command: <T = { ok: true }>(commandId: string, input: Record<string, unknown>) => call<T>(t, at("command"), "POST", { ...input, commandId }),
    logout: () => call<{ ok: true }>(t, at("logout"), "POST", {}),
    file: (kind: "design" | "photo" | "handover" | "agreement" | "asset" | "change" | "drawing", id: string, preview = false) => `${at(`files/${kind}/${id}`)}${preview ? "?preview=1" : ""}`,
    /** Adds a photo or PDF to the project before it's sent with something; the id makes a retried upload return the same file. */
    upload: (caseId: string, id: string, file: File) => upload(t, at(`cases/${caseId}/uploads/${id}`), file),
    /** A tax invoice or receipt of the client's, to print. */
    document: <T>(caseId: string, kind: "invoice" | "receipt", id: string) => call<T>(t, at(`cases/${caseId}/documents/${kind}/${id}`)),
  };
}

async function upload(t: Translate, url: string, file: File): Promise<PortalFile> {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch(url, { method: "POST", body, cache: "no-store" }).catch(() => null);
  if (!response) throw new PortalError(t("You seem to be offline. Check your connection and try again."), 0);
  const data = await response.json().catch(() => null) as (PortalFile & { message?: unknown }) | null;
  if (!response.ok || !data) throw new PortalError(typeof data?.message === "string" ? data.message : t("That file couldn't be added. Try a photo or PDF up to 20 MB."), response.status);
  return data;
}
export type PortalApi = ReturnType<typeof portalApi>;

/** The firm's side: settings, a project's portal and client contacts. */
export function staffPortalApi(workspaceId: string, t: Translate = untranslated) {
  const at = (path: string) => `/api/client-portal-admin/${path}?${new URLSearchParams({ workspaceId })}`;
  type Settings = { settings: PortalSettings; site: PortalSite; canManage: boolean; demo: boolean };
  type Contacts = { contacts: PortalContact[]; canManage: boolean; demo: boolean };
  return {
    settings: () => call<Settings>(t, at("settings")),
    saveSettings: (input: Record<string, unknown>) => call<Settings>(t, at("settings"), "PUT", input),
    project: (projectId: string) => call<ProjectPortal>(t, at(`projects/${projectId}`)),
    saveProject: (projectId: string, input: Record<string, unknown>) => call<ProjectPortal>(t, at(`projects/${projectId}`), "PUT", input),
    /** Invites (or re-invites) the project's client; the command id makes a retry safe. */
    inviteClient: (projectId: string, input: { commandId: string; version: number }) => call<ProjectPortal>(t, at(`projects/${projectId}/invite`), "POST", input),
    revokeClient: (projectId: string, input: { commandId: string; version: number }) => call<ProjectPortal>(t, at(`projects/${projectId}/revoke`), "POST", input),
    contacts: (caseId: string) => call<Contacts>(t, at(`cases/${caseId}/contacts`)),
    /** The portal exactly as this case's client sees it (read-only). */
    preview: (caseId: string) => call<{ site: PortalSite; view: PortalView; preview: true }>(t, at(`cases/${caseId}/preview`)),
    saveContact: (caseId: string, input: Record<string, unknown>) => call<Contacts>(t, at(`cases/${caseId}/contacts`), "PUT", input),
    signOut: (caseId: string, contactId: string) => call<Contacts>(t, at(`cases/${caseId}/contacts/${contactId}/sign-out`), "POST", {}),
    /** Sets (six digits) or clears (null) one contact's demonstration sign-in code; the command id makes a retry safe. */
    demoCode: (caseId: string, contactId: string, input: { commandId: string; version: number; code: string | null }) =>
      call<Contacts>(t, at(`cases/${caseId}/contacts/${contactId}/demo-code`), "POST", input),
    // What the client did, for the team.
    moodboard: (caseId: string) => call<StaffMoodboard>(t, at(`cases/${caseId}/moodboard`)),
    /** Shows (or hides) moodboard pins in the client's portal. */
    shareMoodboard: (caseId: string, input: { entryIds: string[]; shared: boolean }) => call<StaffMoodboard>(t, at(`cases/${caseId}/moodboard/share`), "POST", input),
    /** Answers the client on a board or pin; the id makes a retry safe. */
    replyMoodboard: (caseId: string, input: { id: string; targetKind: "pin" | "design"; targetId: string; text: string }) =>
      call<StaffMoodboard>(t, at(`cases/${caseId}/moodboard/reply`), "POST", input),
    paymentReports: (caseId: string) => call<{ reports: StaffPaymentReport[]; canDecide: boolean }>(t, at(`cases/${caseId}/payment-reports`)),
    decidePaymentReport: (reportId: string, input: { decision: "recorded" | "not_received"; note: string; version: number }) =>
      call<{ reports: StaffPaymentReport[]; canDecide: boolean }>(t, at(`payment-reports/${reportId}`), "POST", input),
    issues: (projectId: string) => call<{ issues: StaffIssue[]; caseId: string; canTriage: boolean }>(t, at(`projects/${projectId}/issues`)),
    triageIssue: (projectId: string, issueId: string, input: { decision: "accept" | "decline"; severity?: "minor" | "major" | "critical"; note: string; version: number }) =>
      call<{ issues: StaffIssue[]; caseId: string; canTriage: boolean }>(t, at(`projects/${projectId}/issues/${issueId}`), "POST", input),
    threads: (caseId: string) => call<StaffThreads>(t, at(`cases/${caseId}/threads`)),
    /** The team opened a conversation (the client sees it was seen). */
    readThread: (caseId: string, threadId: string) => call<{ ok: true }>(t, at(`cases/${caseId}/threads/${threadId}/read`), "POST", {}),
    /** A file the client added, for the team to open. */
    clientFile: (caseId: string, assetId: string, preview = false) => `/api/client-portal-admin/cases/${caseId}/files/${assetId}?${new URLSearchParams({ workspaceId, ...(preview ? { preview: "1" } : {}) })}`,
  };
}
export type StaffPortalApi = ReturnType<typeof staffPortalApi>;

/** A new id for one person's action (kept across retries of that action). */
export function commandId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
