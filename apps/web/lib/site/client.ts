import type { HandoverKind, HandoverState, SiteState, WarrantySettings, WarrantyState } from "./types";

export class SiteRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function send<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new SiteRequestError(typeof data?.message === "string" ? data.message : fallback, response.status);
  return data as T;
}

/** A project's site for one workspace: its state, one change at a time, and report photos. */
export function siteApi(workspaceId: string, projectId: string) {
  const at = (value = "") => `/api/site/projects/${projectId}${value ? `/${value}` : ""}?${new URLSearchParams({ workspaceId })}`;
  return {
    state: () => send<SiteState>(at(), {}, "The site didn't load."),
    command: (action: string, input: Record<string, unknown> = {}) =>
      send<SiteState>(at(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, action }) }, "Could not save."),
    /** A photo for a report its author is writing; replayed safely by its id. */
    uploadPhoto: (reportId: string, photoId: string, file: File) => {
      const form = new FormData(); form.set("file", file);
      return send<SiteState>(at(`reports/${reportId}/photos/${photoId}`), { method: "POST", body: form }, "The photo could not be uploaded.");
    },
    photoUrl: (photoId: string, preview = true) => `${at(`photos/${photoId}`)}${preview ? "&preview=1" : ""}`,
    handover: () => send<HandoverState>(at("handover"), {}, "The handover didn't load."),
    handoverCommand: (action: string, input: Record<string, unknown> = {}) =>
      send<HandoverState>(at("handover"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, action }) }, "Could not save."),
    /** A document for a draft pack; replayed safely by its id. */
    uploadDocument: (packId: string, documentId: string, kind: HandoverKind, title: string, file: File) => {
      const form = new FormData(); form.set("file", file);
      return send<HandoverState>(`${at(`handover/${packId}/documents/${documentId}`)}&${new URLSearchParams({ kind, title })}`, { method: "POST", body: form }, "The file could not be uploaded.");
    },
    documentUrl: (documentId: string) => at(`handover/documents/${documentId}`),
    /** D-29: the client confirmed site access by phone, or the delivery moves to a new day. */
    arrangeAccess: (requestId: string, input: { action: "confirm" | "reschedule"; version: number; date?: string; reason?: string; chargeable?: boolean }) =>
      send<{ ok: true; id: string }>(at(`access/${requestId}`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }, "Could not save."),
    warranty: () => send<WarrantyState>(at("warranty"), {}, "The warranty didn't load."),
    warrantyCommand: (action: string, input: Record<string, unknown> = {}) =>
      send<WarrantyState>(at("warranty"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, action }) }, "Could not save."),
  };
}
export type SiteApi = ReturnType<typeof siteApi>;

/** Settings → Projects → Warranty: months of warranty for each way of delivering a package. */
export function warrantySettingsApi(workspaceId: string) {
  const at = `/api/warranty-settings?${new URLSearchParams({ workspaceId })}`;
  return {
    get: () => send<WarrantySettings>(at, {}, "Could not load the settings."),
    save: (months: Record<string, number>) => send<WarrantySettings>(at, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ months }) }, "Could not save."),
  };
}
