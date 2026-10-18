import { Dec } from "../catalog-core/decimal";
import type { PaymentTerm } from "../commercial/commercial.types";
import { ChangeRuleError, type ChangeStatus } from "./change-request.domain";

/**
 * A change on a started project (plan §6.20): the pure rules of its flow. Anyone on the project raises it with what
 * changes (new work, a catalogue item, or a line of the live scope removed, replaced or moved), why, and the days it adds
 * to the stages it touches; the variation quotation prices it with the shared engine; the firm approves it on E3; the
 * client decides; applying it moves the project. Money is decimal text, never a float.
 */
export const CHANGE_REASONS = ["client_request", "site_condition", "design_change", "error"] as const;
export type ChangeReason = (typeof CHANGE_REASONS)[number];
export const PAYMENT_RULES = ["before_work", "next_milestone"] as const;
export type PaymentRule = (typeof PAYMENT_RULES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUANTITY = /^\d{1,10}(\.\d{1,4})?$/;
const MONEY = /^\d{1,14}(\.\d{1,2})?$/;
const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const id = (value: unknown) => (typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null);
const numberText = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value).trim() : "");

export type ScopeLineInput = {
  id?: unknown; source?: unknown; action?: unknown; title?: unknown; quantity?: unknown; unit?: unknown; unitPrice?: unknown; roomId?: unknown;
  catalogItemId?: unknown; boqLineId?: unknown;
};
export type ScopeLine = {
  id: string; source: "custom" | "catalog" | "boq_line"; action: "add" | "omit" | "replace" | "move"; title: string; quantity: string | null; unit: string;
  /** What the raiser thinks it costs (new work only); the variation quotation sets the price. */
  unitPrice: string | null;
  /** The room it is in; for a move, the room it moves to. */
  roomId: string | null;
  catalogItemId: string | null; boqLineId: string | null;
};

/**
 * One raised line, checked. New work names itself (a quantity, optionally what it may cost); a catalogue item is added
 * by quantity; a live-scope line is removed (some or all), replaced, or moved to another room.
 */
export function cleanScopeLine(input: ScopeLineInput, position: number): ScopeLine {
  const label = `Line ${position + 1}`;
  const lineId = id(input.id);
  if (!lineId) throw new ChangeRuleError(`${label} has no id`);
  const source = input.source === "custom" || input.source === "catalog" || input.source === "boq_line" ? input.source : null;
  if (!source) throw new ChangeRuleError(`${label}: new work, a catalogue item or an item already in the scope`);
  const action = source === "boq_line"
    ? (input.action === "omit" || input.action === "replace" || input.action === "move" ? input.action : null)
    : "add" as const;
  if (!action) throw new ChangeRuleError(`${label}: remove, replace or move it`);
  const title = text(input.title, 240);
  if (!title) throw new ChangeRuleError(`${label}: name it`);
  const quantity = numberText(input.quantity);
  if (action !== "move") {
    if (!quantity) throw new ChangeRuleError(`${label}: enter the quantity`);
    if (!QUANTITY.test(quantity) || Dec.of(quantity).cmp(0) <= 0) throw new ChangeRuleError(`${label}: quantity must be above zero`);
  }
  const unitPrice = source === "custom" ? numberText(input.unitPrice) : "";
  if (unitPrice && !MONEY.test(unitPrice)) throw new ChangeRuleError(`${label}: price is an amount with at most two decimals`);
  const catalogItemId = source === "catalog" ? id(input.catalogItemId) : null;
  if (source === "catalog" && !catalogItemId) throw new ChangeRuleError(`${label}: choose the catalogue item`);
  const boqLineId = source === "boq_line" ? id(input.boqLineId) : null;
  if (source === "boq_line" && !boqLineId) throw new ChangeRuleError(`${label}: choose the item in the scope`);
  const roomId = input.roomId === null || input.roomId === undefined || input.roomId === "" ? null : id(input.roomId);
  if (input.roomId && !roomId) throw new ChangeRuleError(`${label}: choose a room of this project`);
  if (action === "move" && !roomId) throw new ChangeRuleError(`${label}: choose the room it moves to`);
  return { id: lineId, source, action, title, quantity: action === "move" ? null : Dec.of(quantity).toString(), unit: text(input.unit, 40), unitPrice: unitPrice ? Dec.of(unitPrice).toFixed(2) : null,
    roomId, catalogItemId, boqLineId };
}

export type ProjectDraftInput = { title?: unknown; reason?: unknown; description?: unknown; lines?: unknown };

/** A project change's own words and lines, checked. */
export function cleanProjectDraft(input: ProjectDraftInput) {
  const title = text(input.title, 240);
  if (!title) throw new ChangeRuleError("Name the change");
  const reason = CHANGE_REASONS.includes(input.reason as ChangeReason) ? input.reason as ChangeReason : "client_request";
  const raw = Array.isArray(input.lines) ? input.lines as ScopeLineInput[] : [];
  if (raw.length > 100) throw new ChangeRuleError("Keep a change under 100 lines");
  const lines = raw.map((line, index) => cleanScopeLine(line, index));
  if (new Set(lines.map((line) => line.id)).size !== lines.length) throw new ChangeRuleError("Two lines share an id");
  const removed = lines.filter((line) => line.boqLineId).map((line) => line.boqLineId);
  if (new Set(removed).size !== removed.length) throw new ChangeRuleError("An item in the scope can change once per change request");
  return { title, reason, description: text(input.description, 4000), lines };
}

/** The quotation builder's line commands that put the raised lines on the variation quotation (each keeps its id). */
export function variationOps(lines: ScopeLine[]) {
  return lines.map((line) => {
    if (line.source === "catalog") return { op: "catalog", itemId: line.catalogItemId, line: { id: line.id, quantity: line.quantity, areaId: line.roomId } };
    if (line.source === "custom") return { op: "upsert", line: { id: line.id, title: line.title, quantity: line.quantity, unit: line.unit, rate: line.unitPrice ?? "0", areaId: line.roomId } };
    if (line.action === "move") return { op: "change", change: "move", id: line.id, boqLineId: line.boqLineId, areaId: line.roomId };
    if (line.action === "replace") return { op: "change", change: "replace", id: line.id, boqLineId: line.boqLineId, quantity: line.quantity, replacementId: replacementId(line.id) };
    return { op: "change", change: "omit", id: line.id, boqLineId: line.boqLineId, quantity: line.quantity };
  });
}

/** The replacement line's id for a replaced scope line: derived, so pricing the same change twice adds it once. */
export function replacementId(lineId: string) {
  const hex = lineId.replace(/-/g, "");
  const flipped = [...hex].map((char, index) => (index === 12 ? "4" : index === 16 ? "8" : ((parseInt(char, 16) ^ 0xf).toString(16)))).join("");
  return `${flipped.slice(0, 8)}-${flipped.slice(8, 12)}-${flipped.slice(12, 16)}-${flipped.slice(16, 20)}-${flipped.slice(20)}`;
}

/**
 * How the client pays for a variation, from the firm's rule (Settings › Projects): all of it before the work on it starts
 * (required before work), or with the project's next milestone (billed with it, not holding the work). A variation that
 * credits the client has no payment terms; the credit is recorded when it is accepted.
 */
export function variationPaymentTerms(rule: PaymentRule, total: string, nextMilestone: { title: string } | null): PaymentTerm[] {
  if (Dec.of(total).cmp(0) <= 0) return [];
  if (rule === "next_milestone" && nextMilestone)
    return [{ id: "variation-with-next", title: `With ${nextMilestone.title}`.slice(0, 160), percent: 100, trigger: `Billed with ${nextMilestone.title}`.slice(0, 300),
      requiredForRelease: false, requiredForProduction: false }];
  return [{ id: "variation-before-work", title: "Before the work starts", percent: 100, trigger: "Before the work on this change starts", requiredForRelease: true, requiredForProduction: false }];
}

// ---------------------------------------------------------------- who may do what, and the next step

export type ChangeRights = {
  /** Sees the project (team member, or sees every project). */
  view: boolean;
  /** Prices and sends changes (edits planning records and quotations). */
  commercial: boolean;
  /** Leads this project (its project manager, or manages every project). */
  manager: boolean;
  /** Raised this change. */
  raiser: boolean;
  /** Can decide the change's approval at its current step (the approval engine says so). */
  approver: boolean;
};
export type ChangeAction = "edit" | "price" | "send_to_qs" | "submit" | "approve" | "return" | "send" | "send_link" | "apply" | "withdraw" | "upload";

/** The actions this person may take on a project change now. */
export function allowedActions(change: { status: ChangeStatus; hasQuote: boolean; qs: QsState }, rights: ChangeRights): ChangeAction[] {
  if (!rights.view) return [];
  const actions: ChangeAction[] = [];
  const steer = rights.commercial || rights.manager;
  const { status } = change;
  if (status === "draft" && (steer || rights.raiser)) actions.push("edit", "upload");
  if (status === "pricing" && steer) actions.push("edit", "upload");
  // Pricing is quotation work (the builder): Sales or the QS.
  if (status === "draft" && rights.commercial) actions.push("price");
  if (status === "pricing" && rights.commercial && change.qs === "needed") actions.push("send_to_qs");
  if (status === "pricing" && steer && change.qs !== "needed" && change.qs !== "with_qs") actions.push("submit");
  if (status === "pending_approval" && rights.approver) actions.push("approve", "return");
  if (status === "to_send" && steer) actions.push("send");
  if (status === "with_client" && steer) actions.push("send_link");
  if (status === "approved" && rights.manager) actions.push("apply");
  if (["draft", "pricing", "pending_approval", "to_send", "with_client"].includes(status) && (steer || (rights.raiser && status === "draft"))) actions.push("withdraw");
  return actions;
}

/** Whether the variation needs the QS and where that stands. */
export type QsState = "not_needed" | "needed" | "with_qs" | "confirmed";

/** The one next step on the change for this person: the primary action of its page (null when nothing is theirs to do). */
export function nextStep(actions: ChangeAction[]): Exclude<ChangeAction, "edit" | "upload" | "withdraw" | "return" | "send_link"> | null {
  for (const action of ["price", "send_to_qs", "submit", "approve", "send", "apply"] as const) if (actions.includes(action)) return action;
  return null;
}

/** The signed difference a change makes, as people read it: "+1250.00", "-300.00", "0.00". */
export function signedAmount(value: string) {
  const amount = Dec.of(value);
  return `${amount.cmp(0) > 0 ? "+" : ""}${amount.toFixed(2)}`;
}
