import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { readWithin } from "@/lib/workspace/read-within";
import { caseApi, caseRequest, type CaseAsset } from "./content";

/**
 * The finishes schedule (PLM-156), the material log and sample library (PLM-157), the specification for QS (PLM-146)
 * and the client's signed samples before procurement (PLM-148), as the API returns them. One record: the materials of
 * the materials and decisions list.
 */
export type FinishCategory = { key: string; label: string; clientSignature: boolean };
export type LogStatus = "approved" | "not_approved" | "in_process";
export type MaterialOrigin = "own_stock" | "brand" | "local_supplier";
export type FinishSnapshot = { id: string; assetId: string; assetName: string | null; markerX: number; markerY: number; label: string; createdByName: string | null; createdAt: string };
export type FinishEntry = {
  id: string; title: string; roomId: string | null; roomName: string | null; categoryKey: string | null; categoryLabel: string | null; location: string; installNote: string;
  position: number; version: number;
  current: {
    id: string; number: number; specification: string; supplier: string; quantity: string | null; unit: string; catalogItemId: string | null; origin: MaterialOrigin | null;
    outsourced: boolean; signOff: string | null; status: string; sampleId: string | null; sampleName: string | null; samplePhotoAssetId: string | null; samplePhotoName: string | null;
    note: string; confirmedAt: string | null; confirmedByName: string | null;
  } | null;
  locked: { id: string; number: number } | null;
  status: LogStatus;
  snapshots: FinishSnapshot[];
  signature: { required: boolean; signed: boolean; last: { signedOn: string; signer: string; assetId: string; assetName: string | null; recordedByName: string | null; outOfDate: boolean } | null };
  sentToQs: boolean; changedSinceSent: boolean; priced: { lines: number; stale: number };
};
export type DesignDrawing = { id: string; title: string; stage: string | null; roomName: string | null; revision: number | null; status: string | null; updatedAt: string };
export type ShopDrawing = { id: string; number: number; status: string; sentAt: string | null; decidedOn: string | null; files: Array<{ id: string; name: string }> };
export type ScheduleView = {
  caseId: string; categories: FinishCategory[]; entries: FinishEntry[]; removed: Array<{ id: string; title: string; roomName: string | null; archivedAt: string | null }>;
  currency: string | null;
  specification: { gate: boolean; samplesStep: boolean; samplesApproved: boolean; final: boolean; problem: string | null; changed: string[];
    handoff: { number: number; sentAt: string; sentByName: string | null; note: string; finishes: number } | null };
  share: { number: number; sharedAt: string; sharedByName: string | null; note: string } | null;
  project: { id: string; reference: string; name: string; started: boolean } | null;
  procurement: { payment: boolean; materials: boolean; signatures: { missing: string[]; exempt: boolean; required: number }; cleared: boolean } | null;
  drawings: { designs: DesignDrawing[]; shop: ShopDrawing[] };
  canEdit: boolean; canManageMaterials: boolean; canSendToQs: boolean; canRecordSignature: boolean; canShare: boolean;
};

/** Where the schedule is read from: the case (Planning), the job, or the Factory (once shared). */
export type ScheduleSource = { kind: "case"; workspaceId: string; caseId: string } | { kind: "project"; workspaceId: string; projectId: string }
  | { kind: "factory"; workspaceId: string; caseId: string };

async function read<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.message === "string" ? data.message : "The finishes didn't load.");
  return data as T;
}

/** The schedule's reads from where it is opened, and its commands on the case (the designers' and the Material Coordinator's). */
export function scheduleApi(source: ScheduleSource) {
  const query = `workspaceId=${encodeURIComponent(source.workspaceId)}`;
  const view = () => readWithin(source.kind === "case" ? caseRequest<ScheduleView>(source.workspaceId, source.caseId, "finishes")
    : source.kind === "project" ? read<ScheduleView>(`/api/project-core/projects/${source.projectId}/finishes?${query}`)
    : read<ScheduleView>(`/api/factory/finishes/${source.caseId}?${query}`));
  const post = (caseId: string, path: string, body: unknown) => caseRequest<ScheduleView>(source.workspaceId, caseId, `finishes/${path}`, "POST", body);
  return {
    view,
    /** A file of the schedule (a sample photo, a snapshot, a signed sample), from wherever this person reads it. */
    assetUrl: (caseId: string, assetId: string, preview = false) => source.kind === "case" ? `${caseApi(source.workspaceId, caseId, `assets/${assetId}`)}${preview ? "&preview=1" : ""}`
      : source.kind === "project" ? `/api/project-core/projects/${source.projectId}/finishes/assets/${assetId}?${query}${preview ? "&preview=1" : ""}`
      : `/api/factory/finishes/${caseId}/assets/${assetId}?${query}${preview ? "&preview=1" : ""}`,
    upload: (caseId: string, file: File, id: string) => { const body = new FormData(); body.set("file", file); return caseRequest<CaseAsset>(source.workspaceId, caseId, `finishes/assets/${id}`, "POST", body); },
    details: (caseId: string, entryId: string, input: { entryVersion: number; categoryKey?: string | null; roomId?: string | null; location?: string; installNote?: string }) =>
      post(caseId, `entries/${entryId}/details`, input),
    addSnapshot: (caseId: string, entryId: string, input: { id: string; assetId: string; markerX: number; markerY: number; label: string }) => post(caseId, `entries/${entryId}/snapshots`, input),
    removeSnapshot: (caseId: string, snapshotId: string) => post(caseId, `snapshots/${snapshotId}/archive`, {}),
    sendToQs: (caseId: string, note: string) => post(caseId, "send-to-qs", { note: note || null }),
    signature: (caseId: string, entryId: string, input: { id: string; versionId: string; signedOn: string; signer: string; assetId: string; note?: string | null }) =>
      post(caseId, `entries/${entryId}/signatures`, input),
    share: (caseId: string, note: string) => post(caseId, "share", { note: note || null }),
  };
}

/** The finishes settings and the sample library (workspace level). */
export type PriceBand = { id: string; label: string; minAmount: string | null; maxAmount: string | null; position: number; archived: boolean };
export type FinishSettings = { categories: FinishCategory[]; configured: boolean; specificationGate: boolean; finishesToQsDays: number; materialEditorSlots: string[]; version: number };
export type SettingsView = { settings: FinishSettings; bands: PriceBand[]; currency: string | null; canManage: boolean };
export type Sample = {
  id: string; name: string; code: string; categoryKey: string | null; origin: MaterialOrigin; supplier: string; catalogItemId: string | null; catalogItemName: string | null;
  priceBandId: string | null; priceBandLabel: string | null; location: string; note: string; inStock: boolean; hasPhoto: boolean; photoName: string | null; archived: boolean; version: number;
  updatedAt: string;
};
export type LibraryView = { samples: Sample[]; bands: PriceBand[]; categories: FinishCategory[]; currency: string | null; canManage: boolean };
/** A library sample offered when choosing a material (in stock first, own stock before brands). */
export type SampleChoice = { id: string; name: string; code: string; origin: MaterialOrigin; supplier: string; categoryKey: string | null; catalogItemId: string | null;
  priceBandLabel: string | null; inStock: boolean; hasPhoto: boolean; location: string };

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: body instanceof FormData ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(Array.isArray(data?.message) ? data.message.join(". ") : typeof data?.message === "string" ? data.message : "Could not save.");
  return data as T;
}

export function libraryApi(workspaceId: string) {
  const url = (path: string, params: Record<string, string> = {}) => `/api/workspace/finishes/${path}?${new URLSearchParams({ workspaceId, ...params })}`;
  return {
    settings: () => readWithin(send<SettingsView>(url("settings"), "GET")),
    saveSettings: (input: { version: number; categories?: FinishCategory[]; specificationGate?: boolean; finishesToQsDays?: number; materialEditorSlots?: string[];
      bands?: Array<{ id?: string | null; label: string; minAmount: string | null; maxAmount: string | null }> }) => send<SettingsView>(url("settings"), "PUT", input),
    samples: (filters: { q?: string; band?: string; category?: string; archived?: boolean } = {}) => readWithin(send<LibraryView>(url("samples", Object.fromEntries(Object.entries({
      q: filters.q ?? "", band: filters.band ?? "", category: filters.category ?? "", archived: filters.archived ? "1" : "" }).filter(([, value]) => value))), "GET")),
    save: (input: Partial<Sample> & { id: string; name: string }) => send<Sample>(url("samples"), "POST", input),
    archive: (id: string, version: number) => send<Sample>(url(`samples/${id}/archive`), "POST", { version }),
    photo: (id: string, file: File) => { const body = new FormData(); body.set("file", file); return send<Sample>(url(`samples/${id}/photo`), "POST", body); },
    photoUrl: (id: string, preview = true) => url(`samples/${id}/photo`, preview ? { preview: "1" } : {}),
  };
}

export const LOG_STATUS_LABEL: Record<LogStatus, MessageKey> = { approved: tKey("Approved"), not_approved: tKey("Not approved"), in_process: tKey("In process") };
export const logStatusTone = (status: LogStatus): "success" | "danger" | "info" => status === "approved" ? "success" : status === "not_approved" ? "danger" : "info";
export const ORIGIN_LABEL: Record<MaterialOrigin, MessageKey> = { own_stock: tKey("Own stock"), brand: tKey("Brand"), local_supplier: tKey("Local supplier") };
export const MATERIAL_ORIGINS: MaterialOrigin[] = ["own_stock", "brand", "local_supplier"];
export const DRAWING_STATUS_LABEL: Record<string, MessageKey> = {
  draft: tKey("Draft"), internal_review: tKey("In review"), changes_requested: tKey("Changes requested"), client_review: tKey("With the client"), approved: tKey("Approved"),
  uploaded: tKey("Uploaded"), checked: tKey("Checked"), changes_needed: tKey("Changes needed"), sent: tKey("Sent to the client"),
};
/** The design team parts that may edit the quotation's material column (Settings › Design). */
export const EDITOR_SLOTS = ["lead_designer", "junior_designer", "sales_admin", "visualiser", "draftsman", "material_coordinator"] as const;
