import { Dec } from "../catalog-core/decimal";
import { TEAM_SLOTS, type TeamSlot } from "./design-team.domain";

/**
 * The finishes schedule (PLM-156), the material log and samples (PLM-157), the designer's specification for QS
 * (PLM-146) and the client's signed samples before procurement (PLM-148) are one record: the materials of the
 * materials and decisions ledger. This file holds the rules, with no database.
 */

/** Where a material comes from (PLM-144/157): the firm's own stock and brands first, a local supplier only when the client asks. */
export const MATERIAL_ORIGINS = ["own_stock", "brand", "local_supplier"] as const;
export type MaterialOrigin = (typeof MATERIAL_ORIGINS)[number];
/** What a library sample is: the firm's own stock, or a brand's. */
export const SAMPLE_ORIGINS = ["own_stock", "brand"] as const;

/**
 * A finish category of the firm (configuration): hard and soft finishes, whitegoods, sanitary ware, lighting,
 * sockets… `clientSignature`: the client signs the physical sample or the data sheet of each finish in it before
 * procurement orders (PLM-148).
 */
export type FinishCategory = { key: string; label: string; clientSignature: boolean };

/** A workspace that configured nothing: the usual categories, none needing the client's signature. */
export const DEFAULT_FINISH_CATEGORIES: readonly FinishCategory[] = [
  { key: "hard_finishes", label: "Hard finishes", clientSignature: false },
  { key: "soft_finishes", label: "Soft finishes", clientSignature: false },
  { key: "whitegoods", label: "Whitegoods", clientSignature: false },
  { key: "sanitary_ware", label: "Sanitary ware", clientSignature: false },
  { key: "lighting", label: "Lighting", clientSignature: false },
  { key: "sockets", label: "Sockets and switches", clientSignature: false },
];

const KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** Reads the stored categories, keeping only well-formed ones (an old or hand-edited row never breaks the schedule). */
export function readCategories(value: unknown): FinishCategory[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const key = typeof row.key === "string" ? row.key.trim() : "";
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!KEY.test(key) || !label || seen.has(key)) return [];
    seen.add(key);
    return [{ key, label: label.slice(0, 80), clientSignature: row.clientSignature === true }];
  });
}

/** What is wrong with a list of categories the firm saves, in words for the person editing it. */
export function categoriesProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return "Send the categories as a list";
  if (value.length > 40) return "Keep it to 40 categories";
  const keys = new Set<string>();
  const labels = new Set<string>();
  for (const raw of value) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const key = typeof row.key === "string" ? row.key.trim() : "";
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!KEY.test(key)) return "Give each category a key of lower-case letters, numbers and underscores";
    if (!label || label.length > 80) return "Name each category (up to 80 characters)";
    if (keys.has(key)) return `${key} is in the list twice`;
    if (labels.has(label.toLocaleLowerCase())) return `${label} is in the list twice`;
    if (row.clientSignature !== undefined && typeof row.clientSignature !== "boolean") return "Say yes or no for the client's signature";
    keys.add(key); labels.add(label.toLocaleLowerCase());
  }
  return null;
}

/** The design team parts that may edit the quotation's material column (PLM-146); unknown parts are refused. */
export function editorSlotsProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return "Send the design team parts as a list";
  if (value.some((slot) => !TEAM_SLOTS.includes(slot as TeamSlot))) return "Choose parts of the design team";
  return null;
}

/** Where a material comes from, read sensibly on an old version too (before origins existed, only "outsourced" was kept). */
export function originOf(version: { origin?: string | null; outsourced?: boolean | null } | null | undefined): MaterialOrigin | null {
  if (!version) return null;
  if (version.origin && (MATERIAL_ORIGINS as readonly string[]).includes(version.origin)) return version.origin as MaterialOrigin;
  return version.outsourced ? "local_supplier" : null;
}

/** The outsourced flag follows the origin: a local supplier's material needs the reviewer's sign-off. */
export function outsourcedFrom(input: { origin?: string | null; outsourced?: boolean | null }) {
  return input.origin ? input.origin === "local_supplier" : input.outsourced === true;
}

/** An origin and the outsourced flag that say different things are refused. */
export function originProblem(input: { origin?: string | null; outsourced?: boolean | null }) {
  if (input.origin === null || input.origin === undefined) return null;
  if (!(MATERIAL_ORIGINS as readonly string[]).includes(input.origin)) return "Say where the material comes from";
  if (input.outsourced !== undefined && input.outsourced !== null && input.outsourced !== (input.origin === "local_supplier"))
    return "A material from a local supplier is the outsourced one";
  return null;
}

/** The material log's three states (PLM-157): read from the client's decision and the outsourced sign-off, never typed. */
export type LogStatus = "approved" | "not_approved" | "in_process";

export function logStatus(version: { status: string; outsourced?: boolean | null; signOff?: string | null } | null | undefined): LogStatus {
  if (!version) return "in_process";
  if (version.status === "declined") return "not_approved";
  if (version.outsourced && (version.signOff === "rejected" || version.signOff === "returned")) return "not_approved";
  if (version.status === "confirmed" && (!version.outsourced || version.signOff === "approved")) return "approved";
  return "in_process";
}

/** A marker on a render snapshot: inside the picture (0–100 % of its width and height) with a label. */
export function markerProblem(input: { markerX?: unknown; markerY?: unknown; label?: unknown }) {
  const inside = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
  if (!inside(input.markerX) || !inside(input.markerY)) return "Place the marker on the picture";
  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (!label) return "Say what the marker shows (e.g. the marble type)";
  if (label.length > 200) return "Keep the label under 200 characters";
  return null;
}

/** A marker's position kept to two decimals (the database's precision). */
export const markerValue = (value: number) => Dec.of(value).round(2).toFixed(2);

/**
 * PLM-146: the specification is final once the samples are approved and the finishes went to QS with nothing changed
 * since. A job without design (no journey, or a furniture/joinery order) has no samples step: the hand-off is enough.
 */
export function specificationProblem(input: { samplesStep: boolean; samplesApproved: boolean; sentNumber: number | null; changedSince: string[]; finishes: number }) {
  if (input.samplesStep && !input.samplesApproved) return "The samples aren't approved yet. The final quotation follows the final specification.";
  if (!input.finishes) return "There are no finishes on the schedule yet. The designer marks them and sends them to QS.";
  if (input.sentNumber === null) return "The designer hasn't sent the finishes to QS yet. The final quotation follows the final specification.";
  if (input.changedSince.length) return `${names(input.changedSince)} changed after the finishes went to QS. The designer sends them to QS again.`;
  return null;
}

/** What changed since a hand-off: finishes added or changed (a different version), and finishes removed. */
export function changedSinceHandoff(live: Array<{ id: string; title: string; versionId: string | null }>, sent: Array<{ entryId: string; versionId: string; title: string }>) {
  const sentBy = new Map(sent.map((line) => [line.entryId, line]));
  const changed = live.filter((entry) => sentBy.get(entry.id)?.versionId !== entry.versionId).map((entry) => entry.title);
  const liveIds = new Set(live.map((entry) => entry.id));
  const removed = sent.filter((line) => !liveIds.has(line.entryId)).map((line) => line.title);
  return [...changed, ...removed];
}

/**
 * PLM-148: the finishes the client still has to sign before procurement orders: those in a category marked for the
 * client's signature whose version procurement uses (the signed-off one when the list is locked, else the current one)
 * has no signed sample or sheet recorded.
 */
export function signaturesMissing(entries: Array<{ title: string; categoryKey: string | null; requiredVersionId: string | null; signedVersionIds: string[] }>, categories: readonly FinishCategory[]) {
  const signing = new Set(categories.filter((category) => category.clientSignature).map((category) => category.key));
  return entries.filter((entry) => entry.categoryKey && signing.has(entry.categoryKey) && entry.requiredVersionId && !entry.signedVersionIds.includes(entry.requiredVersionId))
    .map((entry) => entry.title);
}

/** A signed sample or sheet: on a day that has happened, by someone named, with the photo of it. */
export function signatureProblem(input: { signedOn?: string | null; signer?: string | null; assetId?: string | null }, today: string) {
  if (!input.signedOn || !/^\d{4}-\d{2}-\d{2}$/.test(input.signedOn) || Number.isNaN(Date.parse(`${input.signedOn}T00:00:00Z`))) return "Say the day the client signed";
  if (input.signedOn > today) return "The signing day can't be in the future";
  if (!input.signer?.trim()) return "Say who signed";
  if (input.signer.trim().length > 200) return "Keep the name under 200 characters";
  if (!input.assetId) return "Attach a photo of the signed sample or data sheet";
  return null;
}

/** A sample price band: a label, and amounts that make a range (either end may stay open). */
export function bandProblem(input: { label?: unknown; minAmount?: unknown; maxAmount?: unknown }) {
  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (!label || label.length > 80) return "Name the price band (up to 80 characters)";
  const amount = (value: unknown) => value === null || value === undefined || value === "" ? null : typeof value === "string" && /^\d{1,12}(\.\d{1,2})?$/.test(value) ? value : undefined;
  const min = amount(input.minAmount), max = amount(input.maxAmount);
  if (min === undefined || max === undefined) return "Enter the amounts with at most two decimals";
  if (min !== null && max !== null && Dec.of(max).cmp(min) < 0) return "The upper amount is at least the lower one";
  return null;
}

/** Up to three names, then how many more. */
export function names(list: string[]) {
  const shown = list.slice(0, 3).join(", ");
  return list.length > 3 ? `${shown} and ${list.length - 3} more` : shown;
}
