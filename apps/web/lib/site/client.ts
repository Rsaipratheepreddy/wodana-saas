import type { ClientView, DayFeed, HandoverKind, HandoverState, ProgressReport, SiteAttention, SitesToday, SiteState, WarrantySettings, WarrantyState } from "./types";

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
    /** The workspace these calls act in (for the shared History beside them). */
    workspaceId,
    state: () => send<SiteState>(at(), {}, "The site didn't load."),
    command: (action: string, input: Record<string, unknown> = {}) =>
      send<SiteState>(at(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, action }) }, "Could not save."),
    /** A photo for a report its author is writing, with its room, before/after and pair; replayed safely by its id. */
    uploadPhoto: (reportId: string, photoId: string, file: File, tags: { areaId?: string | null; phase?: string | null; pairId?: string | null } = {}) => {
      const form = new FormData(); form.set("file", file);
      const query = new URLSearchParams(Object.entries({ area: tags.areaId, phase: tags.phase, pair: tags.pairId }).filter((entry): entry is [string, string] => Boolean(entry[1])));
      return send<SiteState>(`${at(`reports/${reportId}/photos/${photoId}`)}${query.size ? `&${query}` : ""}`, { method: "POST", body: form }, "The photo could not be uploaded.");
    },
    /** The client's card for a day: as it would go now, or as it went. */
    clientView: (reportId: string) => send<{ view: ClientView; sent: boolean }>(at(`reports/${reportId}/client-view`), {}, "The client's view didn't load."),
    /** The day cards for a range of days, or the latest days with a report. */
    days: (query: { from?: string; to?: string; latest?: number }) => send<DayFeed>(`${at("days")}&${new URLSearchParams(Object.entries(query)
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== "").map(([key, value]) => [key, String(value)]))}`, {}, "The site didn't load."),
    /** The "Progress report" for a period (client-ready, for the PDF). */
    progressReport: (from: string, to: string) => send<ProgressReport>(`${at("progress-report")}&${new URLSearchParams({ from, to })}`, {}, "The progress report didn't load."),
    /** The progress report's printout for a period, to print or save as PDF. */
    progressPrintUrl: (from: string, to: string) => `/print/progress?${new URLSearchParams({ workspaceId, projectId, from, to })}`,
    photoUrl: (photoId: string, preview = true) => `${at(`photos/${photoId}`)}${preview ? "&preview=1" : ""}`,
    /** The day's printout (the client's card on A4), to print or save as PDF. */
    printUrl: (reportId: string) => `/print/daily/${encodeURIComponent(reportId)}?${new URLSearchParams({ workspaceId, projectId })}`,
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

/** Home: daily reports waiting for my review, and sites without today's report after the end of the day. */
export function siteAttention(workspaceId: string) {
  return send<SiteAttention>(`/api/site/attention?${new URLSearchParams({ workspaceId })}`, {}, "Couldn't load the sites.");
}

/** My sites today (Home → My day for the site team): each running site I'm on, with today's day card. */
export function sitesToday(workspaceId: string) {
  return send<SitesToday>(`/api/site/today?${new URLSearchParams({ workspaceId })}`, {}, "Couldn't load the sites.");
}

/** Settings → Projects → Warranty: months of warranty for each way of delivering a package. */
export function warrantySettingsApi(workspaceId: string) {
  const at = `/api/warranty-settings?${new URLSearchParams({ workspaceId })}`;
  return {
    get: () => send<WarrantySettings>(at, {}, "Could not load the settings."),
    save: (months: Record<string, number>) => send<WarrantySettings>(at, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ months }) }, "Could not save."),
  };
}
