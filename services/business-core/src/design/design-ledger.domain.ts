import { Dec } from "../catalog-core/decimal";
import { originProblem } from "./finishes.domain";

/**
 * The materials and decisions ledger (plan §6.7a, PLM-054, E5-1/E5-2): every material or design choice is a row
 * with versions. A version records where the choice came from, when, its evidence, its price and time impact and
 * the client's confirmation. The list is locked at design sign-off; a later change is a new version that
 * procurement ignores (it keeps the locked one) until the change is approved and the list is locked again.
 */
export const LEDGER_KINDS = ["material", "design"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
export const LEDGER_SOURCES = ["portal", "meeting", "whatsapp", "email", "phone", "site", "showroom"] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];
export const CONFIRMATION_METHODS = ["portal", "signed_document", "email", "in_person", "phone", "message"] as const;
export type ConfirmationMethod = (typeof CONFIRMATION_METHODS)[number];
export type VersionStatus = "proposed" | "confirmed" | "declined" | "superseded";

export type LedgerVersionInput = {
  title?: string | null; specification?: string | null; supplier?: string | null; quantity?: string | null; unit?: string | null;
  unitPrice?: string | null; timeImpactDays?: number | null; source?: string | null; saidAt?: string | null; evidenceNote?: string | null; note?: string | null;
  /** PLM-144: from a local supplier instead of the firm's own stock or brands; it needs the reviewer's sign-off. */
  outsourced?: boolean | null;
  /** PLM-157: where it comes from (own stock, a brand, a local supplier: the outsourced one), the library sample it was chosen from and the sample's photo. */
  origin?: string | null; sampleId?: string | null; samplePhotoAssetId?: string | null;
};

const QUANTITY = /^\d{1,10}(\.\d{1,4})?$/;
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

/** What is wrong with a version before it is written, in words for the person entering it. */
export function versionProblem(input: LedgerVersionInput, now = new Date()) {
  if (!input.title?.trim()) return "Name the material or choice";
  if (input.title.trim().length > 240) return "Keep the name under 240 characters";
  if ((input.specification ?? "").length > 2000) return "Keep the finish or specification under 2000 characters";
  if (input.quantity && (!QUANTITY.test(input.quantity) || Dec.of(input.quantity).cmp(0) <= 0)) return "Quantity must be a number above zero";
  if (input.unitPrice && !MONEY.test(input.unitPrice)) return "Price must be an amount with at most two decimals";
  if (input.timeImpactDays !== null && input.timeImpactDays !== undefined && (!Number.isInteger(input.timeImpactDays) || Math.abs(input.timeImpactDays) > 365)) return "Time impact is a whole number of days within a year";
  if (!LEDGER_SOURCES.includes(input.source as LedgerSource)) return "Say where the choice came from";
  // Guide step 2: during design every decision comes through the portal, a meeting, an email or a call, never WhatsApp.
  if (input.source === "whatsapp") return "During design, choices come through the portal, not WhatsApp";
  if (!input.saidAt || Number.isNaN(Date.parse(input.saidAt))) return "Say when the choice was made";
  if (Date.parse(input.saidAt) > now.getTime() + 5 * 60_000) return "The choice can't be dated in the future";
  return originProblem(input);
}

/** Quantity × unit price, exact; nothing when either is missing. */
export function lineTotal(quantity: string | null | undefined, unitPrice: string | null | undefined): Dec | null {
  if (!quantity || !unitPrice) return null;
  return Dec.of(quantity).mul(unitPrice).round(2);
}

/** What a new version adds to the price against the version it replaces (two decimals, can be negative). */
export function priceImpact(previous: { quantity: string | null; unitPrice: string | null } | null, next: { quantity: string | null; unitPrice: string | null }) {
  const before = previous ? lineTotal(previous.quantity, previous.unitPrice) ?? Dec.ZERO : Dec.ZERO;
  const after = lineTotal(next.quantity, next.unitPrice) ?? Dec.ZERO;
  return after.sub(before).toFixed(2);
}

export type EntryState = {
  id: string; title: string; archived: boolean; archivedAfterLock: boolean;
  current: { id: string; number: number; status: VersionStatus } | null;
  /** The version the latest lock holds for this entry, if it was in the list then. */
  locked: { id: string; number: number } | null;
  /** PLM-144: the current version is outsourced and its sign-off isn't approved (yet). */
  signOffWaiting?: boolean;
};

/** An outsourced version counts once its sign-off is approved; anything else (none asked yet, pending, sent back, rejected) waits. */
export const outsourcedWaiting = (version: { outsourced: boolean; signOff: string | null } | null | undefined) => Boolean(version?.outsourced && version.signOff !== "approved");

export type LedgerState = "empty" | "open" | "locked" | "changes_pending";

/** One word for where the list stands: nothing yet, being built, locked, or changed since the lock. */
export function ledgerState(entries: EntryState[], hasLock: boolean): LedgerState {
  const live = entries.filter((entry) => !entry.archived);
  if (!hasLock) return live.length ? "open" : "empty";
  const changed = entries.some((entry) => entry.archived ? Boolean(entry.locked) && entry.archivedAfterLock : !entry.locked || entry.locked.id !== entry.current?.id);
  return changed ? "changes_pending" : "locked";
}

/** E5-2: the list locks only when every current choice is confirmed by the client (who, when, how). */
export function lockProblem(entries: EntryState[]) {
  const live = entries.filter((entry) => !entry.archived);
  if (!live.length) return "Add the materials and choices first";
  const waiting = live.filter((entry) => entry.current?.status !== "confirmed");
  const names = (list: EntryState[]) => `${list.slice(0, 3).map((entry) => entry.title).join(", ")}${list.length > 3 ? ` and ${list.length - 3} more` : ""}`;
  if (waiting.length) return `Waiting for the client's confirmation: ${names(waiting)}`;
  const unsigned = live.filter((entry) => entry.signOffWaiting);
  if (unsigned.length) return `Waiting for the sign-off of the outsourced ${unsigned.length === 1 ? "material" : "materials"}: ${names(unsigned)}`;
  return null;
}

/**
 * The client decides on the version they were shown. An older version is refused and the latest shown instead
 * (§6.7 edge case: the client approves an old revision).
 */
export function confirmProblem(version: { number: number; status: VersionStatus }, currentNumber: number) {
  if (version.number !== currentNumber) return "This isn't the latest version any more. Reload to see the latest.";
  if (version.status !== "proposed") return version.status === "confirmed" ? "This choice is already confirmed." : "This choice was already decided.";
  return null;
}

/** PLM-054: procurement can't order a case's materials until its list has been locked at least once. */
export function procurementProblem(hasLedger: boolean, hasLock: boolean, reference: string) {
  if (!hasLedger || hasLock) return null;
  return `The client hasn't signed off ${reference}'s material list yet. Ordering starts after the design sign-off.`;
}

/** "+1250.00 AED · +3 days": a change's impact for notices (exact amount, the case currency, no float). */
export function impactText(price: string, days: number, currency: string | null) {
  const parts: string[] = [];
  const amount = Dec.of(price);
  if (!amount.isZero()) parts.push(`${amount.isNegative() ? "" : "+"}${amount.toFixed(2)}${currency ? ` ${currency}` : ""}`);
  if (days) parts.push(`${days > 0 ? "+" : ""}${days} ${Math.abs(days) === 1 ? "day" : "days"}`);
  return parts.length ? parts.join(" · ") : "No price or time impact";
}
