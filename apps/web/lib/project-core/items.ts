import { projectPath, ProjectRequestError } from "./client";
import type { MeasureUnit } from "./types";

/** Where an item's shop drawing stands (project-item-proof.ts in the business core). */
export type ItemDrawingState = "not_needed" | "waiting" | "with_lead_designer" | "with_client" | "changes_asked" | "signed";
export type ItemVersionStatus = "with_lead_designer" | "returned" | "with_client" | "changes_asked" | "signed";
export type ItemDeliveryState = "pending" | "delivered" | "installed";

export type ItemDrawingVersion = {
  id: string; number: number; status: ItemVersionStatus; name: string; mimeType: string; byteSize: number; hasPreview: boolean; sha256: string; note: string;
  quantity: string; unit: string; width: string | null; height: string | null; depth: string | null; dimensionUnit: MeasureUnit;
  byName: string; at: string; reviewedByName: string | null; reviewedAt: string | null; reviewNote: string; clientNote: string; clientDecidedAt: string | null;
};

export type ItemDrawing = {
  lineId: string; title: string; area: string | null; quantity: string; unit: string; needed: boolean; state: ItemDrawingState;
  /** The item's own version (0 before its first drawing): every change is checked against it. */
  version: number; number: number; current: ItemDrawingVersion | null; versions: ItemDrawingVersion[];
  locked: { versionId: string; number: number; at: string; quantity: string; unit: string; width: string | null; height: string | null; depth: string | null; dimensionUnit: MeasureUnit } | null;
  signature: { versionId: string; signerName: string; signedAt: string; device: string | null; fingerprint: string } | null;
  /** Who drafts its drawing and by when, the factory's people and crew, and how it reaches site (guide steps 18, 22, 24). */
  plan: ItemPlan | null;
  /** Procurement's sign-off of its supplies (guide step 21), the last gate before its release. */
  supplies: ItemSupplies | null; canSignOffSupplies: boolean;
  canUpload: boolean; canReview: boolean;
};

export type ItemPlan = { drafterName: string; drafterDueOn: string | null; personsNeeded: number | null; crewNames: string[]; deliveryMode: "delivery" | "delivery_install"; version: number };
export type ItemSupplies = { method: "ordered" | "from_stock"; note: string; signedByName: string | null; signedAt: string };
export type ItemPlanInput = { drafterName: string; drafterDueOn: string | null; personsNeeded: number | null; crewNames: string[]; deliveryMode: ItemPlan["deliveryMode"] };

export type ItemDrawingsState = { dimensionUnit: MeasureUnit; units: MeasureUnit[]; canUpload: boolean; canReview: boolean; canPlan: boolean; items: ItemDrawing[] };

export type ItemDeliveryPhoto = { id: string; name: string; hasPreview: boolean; byName: string; at: string };
export type ItemDelivery = {
  lineId: string; title: string; area: string | null; quantity: string; unit: string; state: ItemDeliveryState; version: number;
  deliveredAt: string | null; deliveredByName: string | null; installedAt: string | null; installedByName: string | null; note: string; photos: ItemDeliveryPhoto[]; canRecord: boolean;
  plan?: ItemPlan | null;
};
/** Guide step 23: one checklist before installation (all ready, the lead designer's design check, permit, crew and vehicle, a login on each visit). */
export type InstallationCheck = { key: "ready" | "design_check" | "permit" | "crew" | "login"; label: string; done: boolean };
export type ItemDeliveriesState = { canRecord: boolean; items: ItemDelivery[]; checklist?: InstallationCheck[]; canDesignCheck?: boolean };

export type DrawingDetails = { version: number; quantity: string; width: string; height: string; depth: string; dimensionUnit: MeasureUnit; note: string };

async function send<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ProjectRequestError(typeof data?.message === "string" ? data.message : fallback, response.status);
  return data as T;
}

/** Shop drawings and delivery proof per item, for one project. Commands carry their own id, so a retry is a replay. */
export function itemProofApi(workspaceId: string, projectId: string) {
  const path = (value: string) => projectPath(workspaceId, `projects/${projectId}/${value}`);
  const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return {
    drawings: () => send<ItemDrawingsState>(path("item-drawings"), {}, "The shop drawings didn't load."),
    deliveries: () => send<ItemDeliveriesState>(path("item-deliveries"), {}, "The deliveries didn't load."),
    review: (versionId: string, version: number, decision: "approve" | "return", reason: string) =>
      send<ItemDrawingsState>(path("items"), json({ commandId: crypto.randomUUID(), action: "review_drawing", versionId, version, decision, reason }), "Could not save."),
    plan: (lineId: string, version: number, input: ItemPlanInput) =>
      send<ItemDrawingsState>(path("items"), json({ commandId: crypto.randomUUID(), action: "plan_item", view: "drawings", lineId, version, ...input }), "Could not save."),
    designCheck: () => send<ItemDeliveriesState>(path("items"), json({ commandId: crypto.randomUUID(), action: "design_check" }), "Could not save."),
    signOffSupplies: (lineId: string, method: ItemSupplies["method"], note: string) =>
      send<ItemDrawingsState>(path("items"), json({ commandId: crypto.randomUUID(), action: "sign_off_supplies", lineId, method, note }), "Could not save."),
    mark: (lineId: string, version: number, target: "delivered" | "installed", note: string) =>
      send<ItemDeliveriesState>(path("items"), json({ commandId: crypto.randomUUID(), action: target === "installed" ? "mark_installed" : "mark_delivered", lineId, version, note }), "Could not save."),
    uploadDrawing: (lineId: string, versionId: string, file: File, details: DrawingDetails) => {
      const form = new FormData();
      form.set("file", file);
      form.set("meta", JSON.stringify({ ...details, width: details.width || null, height: details.height || null, depth: details.depth || null }));
      return send<ItemDrawingsState>(path(`items/${lineId}/drawing-versions/${versionId}`), { method: "POST", body: form }, "The file could not be uploaded.");
    },
    uploadPhoto: (lineId: string, photoId: string, file: File) => {
      const form = new FormData();
      form.set("file", file);
      return send<ItemDeliveriesState>(path(`items/${lineId}/delivery-photos/${photoId}`), { method: "POST", body: form }, "The photo could not be uploaded.");
    },
    drawingUrl: (versionId: string, preview = false) => `${path(`item-drawings/files/${versionId}`)}${preview ? "&preview=1" : ""}`,
    photoUrl: (photoId: string, preview = false) => `${path(`item-photos/${photoId}`)}${preview ? "&preview=1" : ""}`,
  };
}
export type ItemProofApi = ReturnType<typeof itemProofApi>;
