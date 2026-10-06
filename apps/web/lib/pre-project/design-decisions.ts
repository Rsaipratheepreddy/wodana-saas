import { tKey, type MessageKey } from "@/lib/i18n/keys";

/** Plan §6.7a: concept presentations (rounds) and the materials and decisions ledger, as the API returns them. */
export type PresentationOption = {
  id: string; position: number; title: string; note: string; linkUrl: string | null; designId: string | null; designTitle: string | null;
  versionId: string | null; versionNumber: number | null; mimeType: string | null; hasPreview: boolean;
};
export type Presentation = {
  id: string; stage: "concepts" | "space_planning" | "material_selection" | "renders"; round: number;
  status: "draft" | "presented" | "chosen" | "changes_requested" | "withdrawn"; chargeable: boolean;
  presentedAt: string | null; presentedByName: string | null; chosenOptionId: string | null; decidedAt: string | null; decidedByName: string | null;
  decisionSource: string | null; decisionNote: string | null; fromPortal: boolean; version: number; options: PresentationOption[];
};
export type Revisions = { used: number; included: number; chargeable: boolean };
export type PresentationsView = { presentations: Presentation[]; revisions: Record<string, Revisions> | null };

export type LedgerVersion = {
  id: string; entryId: string; number: number; title: string; specification: string; catalogItemId: string | null; supplier: string;
  quantity: string | null; unit: string; unitPrice: string | null; currency: string | null; priceImpact: string; timeImpactDays: number;
  source: string; saidAt: string; evidenceAssetId: string | null; evidenceName: string | null; evidenceNote: string; note: string; afterLock: boolean;
  status: "proposed" | "confirmed" | "declined" | "superseded"; confirmedAt: string | null; confirmationMethod: string | null; confirmedByName: string | null;
  fromPortal: boolean; recordedByName: string | null; recordedAt: string;
};
export type LedgerEntry = {
  id: string; kind: "material" | "design"; roomId: string | null; roomName: string | null; position: number; currentNumber: number;
  archivedAt: string | null; archivedAfterLock: boolean; version: number; title: string;
  current: LedgerVersion | null; locked: { id: string; number: number } | null; versions: LedgerVersion[];
};
export type LedgerState = "empty" | "open" | "locked" | "changes_pending";
export type LedgerView = {
  state: LedgerState; lockProblem: string | null; currency: string | null;
  lock: { number: number; reason: string; lockedAt: string; lockedByName: string | null; note: string | null } | null;
  entries: LedgerEntry[]; canEdit?: boolean; canRecordClient?: boolean; canApprove?: boolean;
  /** E5-1 on E3: the approval of changes after sign-off (who it waits for). */
  approval?: { id: string; status: string; version: number; waitingFor: string[]; requestedBy: { userId: string; name: string } } | null;
};

export const LEDGER_SOURCES = ["showroom", "meeting", "site", "whatsapp", "email", "phone", "portal"] as const;
export const SOURCE_LABEL: Record<string, MessageKey> = {
  showroom: tKey("Showroom"), meeting: tKey("Meeting"), site: tKey("Site"), whatsapp: tKey("WhatsApp"), email: tKey("Email"), phone: tKey("Phone"), portal: tKey("Client portal"),
};
export const CONFIRMATION_METHODS = ["signed_document", "email", "in_person", "phone", "message"] as const;
export const METHOD_LABEL: Record<string, MessageKey> = {
  portal: tKey("Client portal"), signed_document: tKey("Signed document"), email: tKey("Email"), in_person: tKey("In person"), phone: tKey("Phone"), message: tKey("Message"),
};
export const DECISION_SOURCES = ["meeting", "whatsapp", "email", "phone"] as const;

export const LEDGER_STATE_LABEL: Record<LedgerState, MessageKey> = {
  empty: tKey("No choices yet"), open: tKey("Not signed off"), locked: tKey("Signed off"), changes_pending: tKey("Changes waiting"),
};
export const ledgerStateTone = (state: LedgerState): "neutral" | "info" | "success" | "warning" =>
  state === "locked" ? "success" : state === "changes_pending" ? "warning" : state === "open" ? "info" : "neutral";

/** The client's side of a version, in one word. */
export function clientStatus(version: Pick<LedgerVersion, "status"> | null): { key: MessageKey; tone: "neutral" | "info" | "success" | "danger" | "warning" } {
  if (!version) return { key: tKey("No version"), tone: "neutral" };
  if (version.status === "confirmed") return { key: tKey("Confirmed"), tone: "success" };
  if (version.status === "declined") return { key: tKey("Declined"), tone: "danger" };
  if (version.status === "superseded") return { key: tKey("Replaced"), tone: "neutral" };
  return { key: tKey("Waiting for the client"), tone: "info" };
}

/** Exact decimal text arithmetic for display: quantity × price, two places (no floats). */
export function lineTotal(quantity: string | null, unitPrice: string | null): string | null {
  if (!quantity || !unitPrice) return null;
  const scale = (value: string) => { const [whole, fraction = ""] = value.split("."); return { digits: BigInt(whole + fraction), places: fraction.length }; };
  const a = scale(quantity), b = scale(unitPrice);
  const raw = a.digits * b.digits;
  const places = a.places + b.places;
  // Round half away from zero to two places.
  const factor = 10n ** BigInt(Math.max(places - 2, 0));
  const cents = places > 2 ? (raw + factor / 2n) / factor : raw * 10n ** BigInt(2 - places);
  const text = cents.toString().padStart(3, "0");
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
}

/** A signed amount for an impact: "+193.75", "-200.00"; nothing when zero. */
export function signedAmount(value: string): string | null {
  const trimmed = value.trim();
  if (/^-?0+(\.0+)?$/.test(trimmed)) return null;
  return trimmed.startsWith("-") ? trimmed : `+${trimmed}`;
}

/** The revision counter wording: "Revision 1 of 2", or "Revision 3 · chargeable" beyond the package's included revisions (PLM-049/051). */
export function revisionDetail(revisions: Revisions | null | undefined): { key: MessageKey; values?: Record<string, number> } | null {
  if (!revisions || !revisions.used) return null;
  if (revisions.chargeable) return { key: tKey("Revision {used} · chargeable"), values: { used: revisions.used } };
  return { key: tKey("Revision {used} of {included}"), values: { used: revisions.used, included: revisions.included } };
}

export const PRESENTATION_STATUS_LABEL: Record<Presentation["status"], MessageKey> = {
  draft: tKey("Draft"), presented: tKey("With client"), chosen: tKey("Chosen"), changes_requested: tKey("Changes requested"), withdrawn: tKey("Discarded"),
};
