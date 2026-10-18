import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { readDrawingItems, type DrawingItem } from "./project-drawing-needs";
import { MEASURE_UNITS, type MeasureUnit } from "./project-technical-measure";

type Db = Pick<PoolClient, "query">;

/**
 * Shop drawings and delivery proof per item. After the client signs the quotation each item (joinery, furniture, a
 * fit-out piece) goes material list → shop drawing → lead designer check → client sign → locked → production or
 * purchase → delivery (and installation).
 *
 * Drawings: an item that needs drawings (the drawing-need rule or the team's decision; supplier and catalogue items with
 * their drawing skip it) waits for a drawing, then each version goes to the lead designer, who approves it (it goes to
 * the client) or returns it with the reason; the client signs it in the portal with a one-time code, or asks for
 * changes. Signing locks the item's quantity and sizes to that version. A returned version or one the client asked to
 * change opens the next version.
 *
 * Delivery: an item is marked delivered, or delivered and installed, only with at least one photo of it on site taken
 * by a signed-in person.
 */
export const ITEM_DRAWING_STATES = ["not_needed", "waiting", "with_lead_designer", "with_client", "changes_asked", "signed"] as const;
export type ItemDrawingState = (typeof ITEM_DRAWING_STATES)[number];
/** What the item's own row holds (no row is "waiting"; "not needed" is read from the drawing-need rule). */
export type ItemDrawingRowStatus = Exclude<ItemDrawingState, "not_needed">;
export const VERSION_STATUSES = ["with_lead_designer", "returned", "with_client", "changes_asked", "signed"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];
export const DELIVERY_STATES = ["pending", "delivered", "installed"] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

/** The one message that blocks "delivered" without proof. */
export const MISSING_PROOF = "Add a photo of the item on site first.";
/** Photos one item takes, and items one signature takes. */
export const MAX_ITEM_PHOTOS = 20;
export const MAX_SIGN_ITEMS = 100;

/** Where an item's shop drawing stands: a signed item stays signed; an item that needs none says so; otherwise its row. */
export function itemDrawingState(input: { needed: boolean; status: ItemDrawingRowStatus | null }): ItemDrawingState {
  if (input.status === "signed") return "signed";
  if (!input.needed) return "not_needed";
  return input.status ?? "waiting";
}

/** A new version is added while the item waits for one or after changes were asked; never past the lead designer or the client, nor once signed. */
export function assertCanUpload(state: ItemDrawingState, number: number) {
  if (state === "not_needed") throw new ConflictException("This item doesn't need a shop drawing.");
  if (state === "signed") throw new ConflictException("This item is signed and locked. A change to it goes through a variation.");
  if (state === "with_lead_designer") throw new ConflictException(`Drawing V${number} is with the lead designer.`);
  if (state === "with_client") throw new ConflictException(`Drawing V${number} is with the client.`);
}

/** The lead designer's check: approved goes to the client; returned needs the reason. Only a version waiting for them. */
export function reviewOutcome(current: VersionStatus, decision: unknown, reason: string): "with_client" | "returned" {
  if (decision !== "approve" && decision !== "return") throw new BadRequestException("Approve the drawing, or return it with the reason.");
  if (current !== "with_lead_designer") throw new ConflictException("This drawing isn't waiting for the lead designer any more. Reload to see where it is.");
  if (decision === "return" && !reason) throw new BadRequestException("Say what needs to change.");
  return decision === "approve" ? "with_client" : "returned";
}

/** The versions a client signs: each one asked for once, each the item's current version and with the client. */
export function assertSignable(requested: string[], versions: Array<{ id: string; lineId: string; status: VersionStatus; current: boolean }>) {
  if (!requested.length) throw new BadRequestException("Choose the items to sign.");
  if (requested.length > MAX_SIGN_ITEMS) throw new BadRequestException(`Sign up to ${MAX_SIGN_ITEMS} items at once.`);
  if (new Set(requested).size !== requested.length) throw new BadRequestException("Choose each item once.");
  const found = requested.map((id) => versions.find((version) => version.id === id));
  if (found.some((version) => !version || !version.current || version.status !== "with_client"))
    throw new ConflictException("These drawings aren't waiting for your signature any more. Reload to see the latest.");
  if (new Set(found.map((version) => version!.lineId)).size !== found.length) throw new BadRequestException("Choose each item once.");
}

/** Delivered, or delivered and installed: always with a photo of the item on site, and only forward. */
export function deliveryNext(current: DeliveryState, target: unknown, photos: number): "delivered" | "installed" {
  if (target !== "delivered" && target !== "installed") throw new BadRequestException("Mark the item delivered, or delivered and installed.");
  if (photos < 1) throw new ConflictException(MISSING_PROOF);
  if (current === "installed") throw new ConflictException("This item is already delivered and installed.");
  if (current === target) throw new ConflictException("This item is already delivered.");
  return target;
}

/**
 * The record a signing code is bound to: the case and exactly the versions chosen, as a UUID-shaped SHA-256, so a code
 * asked for one set of items can't sign another.
 */
export function signingBatchId(caseId: string, versionIds: string[]) {
  const hex = createHash("sha256").update(`${caseId.toLowerCase()}:${versionIds.map((id) => id.toLowerCase()).sort().join(",")}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const DECIMAL = /^\d{1,14}(\.\d{1,4})?$/;

/** A positive decimal (a quantity or a size) as exact text, or null when empty and allowed. */
export function decimalInput(value: unknown, label: string, required: boolean): string | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!text) { if (required) throw new BadRequestException(`Enter the ${label}.`); return null; }
  if (!DECIMAL.test(text) || Number(text) <= 0) throw new BadRequestException(`Enter the ${label} as a number above zero.`);
  return text;
}

/** A stored decimal without trailing zeros ("4.0000" → "4"). */
export const decimalText = (value: string | null) => (value === null ? null : value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value);

export type DrawingInput = { quantity: string; width: string | null; height: string | null; depth: string | null; dimensionUnit: MeasureUnit; note: string };

/** What a shop drawing version shows: the quantity (the item's own by default), its sizes in the workspace's unit, a note. */
export function drawingInput(meta: Record<string, unknown>, item: { quantity: string }, defaultUnit: MeasureUnit): DrawingInput {
  const unit = meta.dimensionUnit === undefined || meta.dimensionUnit === null || meta.dimensionUnit === "" ? defaultUnit : meta.dimensionUnit;
  if (!MEASURE_UNITS.includes(unit as MeasureUnit)) throw new BadRequestException("Choose the unit of the sizes.");
  const note = typeof meta.note === "string" ? meta.note.trim() : "";
  if (note.length > 1000) throw new BadRequestException("Keep the note under 1000 characters.");
  return {
    quantity: decimalInput(meta.quantity ?? item.quantity, "quantity", true)!,
    width: decimalInput(meta.width, "width", false), height: decimalInput(meta.height, "height", false), depth: decimalInput(meta.depth, "depth", false),
    dimensionUnit: unit as MeasureUnit, note,
  };
}

/** How many applicable items pass, for the job's journey. "tracked" is whether the project keeps these per-item records at all. */
export function proofFacts(items: Array<{ needed: boolean; drawing: ItemDrawingRowStatus | null; delivery: "delivered" | "installed" | null }>) {
  const drawn = items.filter((item) => item.needed || item.drawing === "signed");
  return {
    drawings: { tracked: items.some((item) => item.drawing !== null), applicable: drawn.length, signed: drawn.filter((item) => item.drawing === "signed").length },
    delivery: { tracked: items.some((item) => item.delivery !== null), applicable: items.length, done: items.filter((item) => item.delivery !== null).length },
  };
}

export type ProjectItem = DrawingItem & { quantity: string; unit: string };

/** The project's items (the drawn kinds: furniture, joinery, fit-out pieces) with whether each needs drawings, its quantity and unit. */
export async function readProjectItems(db: Db, workspaceId: string, projectId: string): Promise<ProjectItem[]> {
  const items = await readDrawingItems(db, workspaceId, projectId);
  if (!items.length) return [];
  const lines = new Map((await db.query<{ id: string; quantity: string; unit: string }>(
    `SELECT id, quantity::text AS quantity, unit FROM project_boq_lines WHERE workspace_id = $1 AND project_id = $2 AND id = ANY($3::uuid[])`,
    [workspaceId, projectId, items.map((item) => item.lineId)])).rows.map((line) => [line.id, line]));
  return items.map((item) => ({ ...item, quantity: decimalText(lines.get(item.lineId)?.quantity ?? "0")!, unit: lines.get(item.lineId)?.unit ?? "" }));
}

/** The journey's facts for a project: shop drawings signed and items delivered, over the items that apply. */
export async function readItemProofFacts(db: Db, workspaceId: string, projectId: string) {
  const items = await readDrawingItems(db, workspaceId, projectId);
  const drawings = new Map((await db.query<{ lineId: string; status: ItemDrawingRowStatus }>(
    `SELECT line_id AS "lineId", status FROM project_item_drawings WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows.map((row) => [row.lineId, row.status]));
  const deliveries = new Map((await db.query<{ lineId: string; status: "delivered" | "installed" }>(
    `SELECT line_id AS "lineId", status FROM project_item_deliveries WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows.map((row) => [row.lineId, row.status]));
  return proofFacts(items.map((item) => ({ needed: item.needed, drawing: drawings.get(item.lineId) ?? null, delivery: deliveries.get(item.lineId) ?? null })));
}

export type ItemDrawingVersion = {
  id: string; number: number; status: VersionStatus; name: string; mimeType: string; byteSize: number; hasPreview: boolean; sha256: string; note: string;
  quantity: string; unit: string; width: string | null; height: string | null; depth: string | null; dimensionUnit: MeasureUnit;
  byName: string; at: string; reviewedByName: string | null; reviewedAt: string | null; reviewNote: string; clientNote: string; clientDecidedAt: string | null;
};
export type ItemDrawingRow = { id: string; lineId: string; status: ItemDrawingRowStatus; latestNumber: number; currentVersionId: string | null; version: number;
  lockedAt: string | null; lockedVersionId: string | null };
export type ItemSignature = { versionId: string; signerName: string; signedAt: string; device: string | null; fingerprint: string };

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

/** Every item drawing row, version (newest first) and signature of the project. */
export async function readItemDrawingRecords(db: Db, workspaceId: string, projectId: string) {
  const rows = (await db.query<ItemDrawingRow>(
    `SELECT id, line_id AS "lineId", status, latest_number AS "latestNumber", current_version_id AS "currentVersionId", version, locked_at AS "lockedAt", locked_version_id AS "lockedVersionId"
       FROM project_item_drawings WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows;
  const versions = (await db.query<ItemDrawingVersion & { lineId: string }>(
    `SELECT version.id, version.line_id AS "lineId", version.number, version.status, version.original_name AS name, version.mime_type AS "mimeType", version.byte_size AS "byteSize",
            version.preview_key IS NOT NULL AS "hasPreview", version.sha256, version.note, version.quantity::text AS quantity, version.unit, version.width::text AS width,
            version.height::text AS height, version.depth::text AS depth, version.dimension_unit AS "dimensionUnit", uploader.display_name AS "byName", version.created_at AS at,
            reviewer.display_name AS "reviewedByName", version.reviewed_at AS "reviewedAt", version.review_note AS "reviewNote", version.client_note AS "clientNote",
            version.client_decided_at AS "clientDecidedAt"
       FROM project_item_drawing_versions version
       JOIN users uploader ON uploader.id = version.created_by
       LEFT JOIN users reviewer ON reviewer.id = version.reviewed_by
      WHERE version.workspace_id = $1 AND version.project_id = $2 ORDER BY version.line_id, version.number DESC`, [workspaceId, projectId])).rows
    .map((version) => ({ ...version, quantity: decimalText(version.quantity)!, width: decimalText(version.width), height: decimalText(version.height), depth: decimalText(version.depth),
      at: iso(version.at)!, reviewedAt: iso(version.reviewedAt), clientDecidedAt: iso(version.clientDecidedAt) }));
  const signatures = (await db.query<ItemSignature>(
    `SELECT version_id AS "versionId", signer_name AS "signerName", signed_at AS "signedAt", coalesce(signer_device, signer_user_agent) AS device, file_sha256 AS fingerprint
       FROM project_item_drawing_signatures WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows
    .map((signature) => ({ ...signature, signedAt: iso(signature.signedAt)! }));
  return { rows, versions, signatures };
}

export type DeliveryPhoto = { id: string; name: string; hasPreview: boolean; byName: string; at: string };
export type DeliveryRow = { lineId: string; status: "delivered" | "installed"; version: number; note: string; deliveredAt: string; deliveredByName: string; installedAt: string | null;
  installedByName: string | null };

/** Every item delivery and photo of the project (photos oldest first). */
export async function readDeliveryRecords(db: Db, workspaceId: string, projectId: string) {
  const rows = (await db.query<DeliveryRow>(
    `SELECT delivery.line_id AS "lineId", delivery.status, delivery.version, delivery.note, delivery.delivered_at AS "deliveredAt", deliverer.display_name AS "deliveredByName",
            delivery.installed_at AS "installedAt", installer.display_name AS "installedByName"
       FROM project_item_deliveries delivery
       JOIN users deliverer ON deliverer.id = delivery.delivered_by
       LEFT JOIN users installer ON installer.id = delivery.installed_by
      WHERE delivery.workspace_id = $1 AND delivery.project_id = $2`, [workspaceId, projectId])).rows
    .map((row) => ({ ...row, deliveredAt: iso(row.deliveredAt)!, installedAt: iso(row.installedAt) }));
  const photos = (await db.query<DeliveryPhoto & { lineId: string }>(
    `SELECT photo.id, photo.line_id AS "lineId", photo.original_name AS name, photo.preview_key IS NOT NULL AS "hasPreview", taker.display_name AS "byName", photo.taken_at AS at
       FROM project_item_delivery_photos photo JOIN users taker ON taker.id = photo.taken_by
      WHERE photo.workspace_id = $1 AND photo.project_id = $2 ORDER BY photo.taken_at, photo.id`, [workspaceId, projectId])).rows
    .map((photo) => ({ ...photo, at: iso(photo.at)! }));
  return { rows, photos };
}
