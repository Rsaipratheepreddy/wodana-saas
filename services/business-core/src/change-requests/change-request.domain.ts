import { Dec } from "../catalog-core/decimal";

/**
 * Change requests after the contract (plan §6.20, §0.7 R1/R11, edge cases E5-1, M-5): the pure rules. A change is
 * raised by the client or the team, assessed (lines priced from the quote, the materials ledger, an allowance or new
 * work; the handover date it moves), approved inside the firm on E3 and then decided by the client in the portal or by
 * a signed link. Money is decimal text, never a float.
 */
export const CHANGE_KINDS = ["addition", "deduction", "replacement", "move", "schedule", "price_correction"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];
/**
 * draft → pending_approval → with_client → approved for a change on a planning record (no project yet). On a started
 * project the change is priced as a variation quotation and applied: draft → pricing → pending_approval → to_send →
 * with_client → approved → applied. Declined and withdrawn are final.
 */
export const CHANGE_STATUSES = ["draft", "pricing", "pending_approval", "to_send", "with_client", "approved", "applied", "declined", "withdrawn"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];
export const LINE_SOURCES = ["quote_line", "ledger", "allowance", "custom", "catalog", "boq_line"] as const;
export type LineSource = (typeof LINE_SOURCES)[number];
export const LINE_ACTIONS = ["add", "omit", "replace", "draw", "move"] as const;
export type LineAction = (typeof LINE_ACTIONS)[number];

export type LineInput = {
  id?: unknown; source?: unknown; action?: unknown; quoteId?: unknown; quoteLineId?: unknown; ledgerEntryId?: unknown; ledgerVersionId?: unknown; roomId?: unknown;
  title?: unknown; quantity?: unknown; unit?: unknown; unitPrice?: unknown; amount?: unknown;
};
export type CleanLine = {
  id: string; source: LineSource; action: LineAction; quoteId: string | null; quoteLineId: string | null; ledgerEntryId: string | null; ledgerVersionId: string | null;
  roomId: string | null; title: string; quantity: string | null; unit: string; unitPrice: string | null; amount: string;
  /** On a project: the catalogue item added, or the live-scope line removed, replaced or moved. */
  catalogItemId?: string | null; boqLineId?: string | null;
};

export class ChangeRuleError extends Error {
  constructor(message: string, readonly code: "invalid" | "conflict" = "invalid") { super(message); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUANTITY = /^\d{1,10}(\.\d{1,4})?$/;
const MONEY = /^-?\d{1,14}(\.\d{1,2})?$/;

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const id = (value: unknown) => (typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null);
const ref = (value: unknown) => (typeof value === "string" && value.trim() && value.trim().length <= 80 ? value.trim() : null);

/**
 * One line of a change, checked and priced. Quantity × unit price makes the amount (an omission takes it off); a
 * replacement states its net amount; a ledger line's amount is the price impact of its version (set by the store).
 */
export function cleanLine(input: LineInput, position: number): CleanLine {
  const source = (["quote_line", "ledger", "allowance", "custom"] as const).includes(input.source as never) ? input.source as LineSource : null;
  if (!source) throw new ChangeRuleError(`Line ${position + 1}: say what it changes`);
  const action = LINE_ACTIONS.includes(input.action as LineAction) ? input.action as LineAction : null;
  if (!action || action === "move") throw new ChangeRuleError(`Line ${position + 1}: add, omit, replace or draw`);
  if ((source === "allowance") !== (action === "draw")) throw new ChangeRuleError(`Line ${position + 1}: only an allowance is drawn down`);
  const lineId = id(input.id);
  if (!lineId) throw new ChangeRuleError(`Line ${position + 1} has no id`);
  const title = text(input.title, 240);
  if (!title) throw new ChangeRuleError(`Line ${position + 1}: name it`);
  const quantity = typeof input.quantity === "string" || typeof input.quantity === "number" ? String(input.quantity).trim() : "";
  if (quantity && (!QUANTITY.test(quantity) || Dec.of(quantity).cmp(0) <= 0)) throw new ChangeRuleError(`Line ${position + 1}: quantity must be above zero`);
  const unitPrice = typeof input.unitPrice === "string" || typeof input.unitPrice === "number" ? String(input.unitPrice).trim() : "";
  if (unitPrice && (!MONEY.test(unitPrice) || Dec.of(unitPrice).isNegative())) throw new ChangeRuleError(`Line ${position + 1}: price is an amount with at most two decimals`);
  const quoteId = ref(input.quoteId), quoteLineId = ref(input.quoteLineId);
  if ((source === "quote_line" || source === "allowance") && (!quoteId || !quoteLineId)) throw new ChangeRuleError(`Line ${position + 1}: choose the quote line`);
  const ledgerEntryId = id(input.ledgerEntryId), ledgerVersionId = id(input.ledgerVersionId);
  if (source === "ledger" && (!ledgerEntryId || !ledgerVersionId)) throw new ChangeRuleError(`Line ${position + 1}: choose the changed material`);
  let amount: Dec;
  if (source === "ledger") amount = Dec.ZERO; // the store sets it from the version's price impact
  else if (action === "replace") {
    const stated = typeof input.amount === "string" || typeof input.amount === "number" ? String(input.amount).trim() : "";
    if (!MONEY.test(stated)) throw new ChangeRuleError(`Line ${position + 1}: state what the replacement adds or saves`);
    amount = Dec.of(stated);
  } else {
    if (!quantity || !unitPrice) throw new ChangeRuleError(`Line ${position + 1}: enter the quantity and the price`);
    amount = Dec.of(quantity).mul(unitPrice).round(2);
    if (action === "omit") amount = amount.neg();
  }
  return {
    id: lineId, source, action, quoteId: source === "quote_line" || source === "allowance" ? quoteId : null, quoteLineId: source === "quote_line" || source === "allowance" ? quoteLineId : null,
    ledgerEntryId: source === "ledger" ? ledgerEntryId : null, ledgerVersionId: source === "ledger" ? ledgerVersionId : null, roomId: id(input.roomId),
    title, quantity: quantity || null, unit: text(input.unit, 40), unitPrice: unitPrice || null, amount: amount.toFixed(2),
  };
}

/** The change's price impact: the sum of its lines (two decimals, can be negative). */
export function priceImpact(lines: Array<{ amount: string }>) {
  return lines.reduce((sum, line) => sum.add(line.amount), Dec.ZERO).toFixed(2);
}

/** What part of the impact draws on allowances already in the price (not new money for the client). */
export function allowanceDraw(lines: Array<{ source: string; amount: string }>) {
  return lines.filter((line) => line.source === "allowance").reduce((sum, line) => sum.add(line.amount), Dec.ZERO).toFixed(2);
}

export type DraftInput = { title?: unknown; description?: unknown; kind?: unknown; designImpact?: unknown; timeImpactDays?: unknown; lines?: unknown };

/** A draft's own fields, checked; lines are checked one by one. */
export function cleanDraft(input: DraftInput) {
  const title = text(input.title, 240);
  if (!title) throw new ChangeRuleError("Name the change");
  const kind = CHANGE_KINDS.includes(input.kind as ChangeKind) ? input.kind as ChangeKind : "addition";
  const days = input.timeImpactDays === undefined || input.timeImpactDays === null || input.timeImpactDays === "" ? 0 : Number(input.timeImpactDays);
  if (!Number.isInteger(days) || Math.abs(days) > 365) throw new ChangeRuleError("Time impact is a whole number of days within a year");
  const raw = Array.isArray(input.lines) ? input.lines as LineInput[] : [];
  if (raw.length > 100) throw new ChangeRuleError("Keep a change under 100 lines");
  const lines = raw.map((line, index) => cleanLine(line, index));
  if (new Set(lines.map((line) => line.id)).size !== lines.length) throw new ChangeRuleError("Two lines share an id");
  return { title, kind, description: text(input.description, 4000), designImpact: text(input.designImpact, 2000), timeImpactDays: days, lines };
}

/** What makes a draft ready to go for approval: something to decide on. */
export function submitProblem(draft: { title: string; timeImpactDays: number; designImpact: string; lines: unknown[] }) {
  if (!draft.lines.length && !draft.timeImpactDays && !draft.designImpact.trim()) return "Add what changes: lines, a design note or a time impact";
  return null;
}

type Event = "edit" | "price" | "submit" | "internal_approved" | "returned" | "rejected" | "send" | "client_approved" | "client_declined" | "apply" | "withdraw";
/** `to: null`: the event keeps the status (an edit, a resend). */
type Move = { from: ChangeStatus[]; to: ChangeStatus | null };
/** A change on a planning record (no project yet): assessed with its own lines, decided by the client. */
const CASE_MOVES: Partial<Record<Event, Move>> = {
  edit: { from: ["draft"], to: "draft" },
  submit: { from: ["draft"], to: "pending_approval" },
  internal_approved: { from: ["pending_approval"], to: "with_client" },
  returned: { from: ["pending_approval"], to: "draft" },
  rejected: { from: ["pending_approval"], to: "withdrawn" },
  send: { from: ["with_client"], to: "with_client" },
  client_approved: { from: ["with_client"], to: "approved" },
  client_declined: { from: ["with_client"], to: "declined" },
  withdraw: { from: ["draft", "pending_approval", "with_client"], to: "withdrawn" },
};
/** A change on a started project: priced as a variation quotation, sent when approved, applied once the client agrees. */
const PROJECT_MOVES: Partial<Record<Event, Move>> = {
  edit: { from: ["draft", "pricing"], to: null },
  price: { from: ["draft"], to: "pricing" },
  submit: { from: ["pricing"], to: "pending_approval" },
  internal_approved: { from: ["pending_approval"], to: "to_send" },
  returned: { from: ["pending_approval"], to: "pricing" },
  rejected: { from: ["pending_approval"], to: "withdrawn" },
  send: { from: ["to_send"], to: "with_client" },
  client_approved: { from: ["with_client"], to: "approved" },
  client_declined: { from: ["with_client"], to: "declined" },
  apply: { from: ["approved"], to: "applied" },
  withdraw: { from: ["draft", "pricing", "pending_approval", "to_send", "with_client"], to: "withdrawn" },
};

const WHY: Record<ChangeStatus, string> = {
  draft: "This change is still being assessed.",
  pricing: "This change is being priced.",
  pending_approval: "This change is waiting for approval inside the firm.",
  to_send: "This change is approved and waiting to be sent to the client.",
  with_client: "This change is with the client.",
  approved: "This change was already approved.",
  applied: "This change was already approved and applied to the project.",
  declined: "This change was declined. Raise a new one with a fresh assessment.",
  withdrawn: "This change was withdrawn.",
};

/** The status after an event, or why it can't happen now. */
export function nextStatus(status: ChangeStatus, event: Event, mode: "case" | "project" = "case"): ChangeStatus {
  const move = (mode === "project" ? PROJECT_MOVES : CASE_MOVES)[event];
  if (!move || !move.from.includes(status)) throw new ChangeRuleError(WHY[status], "conflict");
  return move.to ?? status;
}
export type ChangeEvent = Event;

/** "CR-007": how a change is named to people. */
export const changeReference = (number: number) => `CR-${String(number).padStart(3, "0")}`;

/** "+1250.00 AED · +3 days" for notices and the PDF (exact amount, the case currency). */
export function impactLine(price: string, days: number, currency: string) {
  const parts: string[] = [];
  const amount = Dec.of(price);
  if (!amount.isZero()) parts.push(`${amount.isNegative() ? "" : "+"}${amount.toFixed(2)} ${currency}`);
  if (days) parts.push(`${days > 0 ? "+" : ""}${days} ${Math.abs(days) === 1 ? "day" : "days"}`);
  return parts.length ? parts.join(" · ") : "No price or time impact";
}

// ---------------------------------------------------------------- R1: the client's budget

export type BudgetSource = {
  currency: string;
  /** Accepted quotations: what the client agreed (the accepted total, else the total). */
  agreed: Array<{ id: string; title: string; amount: string; decidedAt: string | null }>;
  /** Accepted variation quotes (additions positive, deductions negative). */
  variations: Array<{ id: string; title: string; amount: string; decidedAt: string | null }>;
  /** Approved change requests: their net change (allowance draws counted separately) and how the client approved. */
  changes: Array<{ id: string; reference: string; title: string; amount: string; draw: string; decidedAt: string; method: string }>;
  /** Changes still waiting (inside the firm or with the client): shown, not in the forecast. */
  pending: Array<{ id: string; reference: string; title: string; amount: string; status: ChangeStatus }>;
  /** Allowance lines of the accepted quotation and what approved changes drew on them. */
  allowances: Array<{ lineId: string; title: string; included: string; spent: string }>;
};

/**
 * R1: agreed value + approved changes + allowance spend beyond what was included = the forecast final price. An
 * allowance spent below its amount isn't credited until the account is closed, so the forecast never promises a
 * refund. Every change carries the approval it came from. Client prices only: no cost or margin enters here.
 */
export function budgetTracker(source: BudgetSource) {
  const sum = (items: Array<{ amount: string }>) => items.reduce((total, item) => total.add(item.amount), Dec.ZERO);
  const agreed = sum(source.agreed);
  const changes = [
    ...source.variations.map((item) => ({ kind: "variation" as const, id: item.id, reference: null as string | null, title: item.title, amount: Dec.of(item.amount).toFixed(2),
      decidedAt: item.decidedAt, method: "quote" })),
    ...source.changes.map((item) => ({ kind: "change_request" as const, id: item.id, reference: item.reference, title: item.title,
      amount: Dec.of(item.amount).sub(item.draw).toFixed(2), decidedAt: item.decidedAt as string | null, method: item.method })),
  ].sort((a, b) => (a.decidedAt ?? "").localeCompare(b.decidedAt ?? ""));
  const changed = changes.reduce((total, item) => total.add(item.amount), Dec.ZERO);
  const allowances = source.allowances.map((line) => {
    const over = Dec.of(line.spent).sub(line.included);
    return { lineId: line.lineId, title: line.title, included: Dec.of(line.included).toFixed(2), spent: Dec.of(line.spent).toFixed(2),
      over: over.isNegative() ? "0.00" : over.toFixed(2), left: over.isNegative() ? over.neg().toFixed(2) : "0.00" };
  });
  const overrun = allowances.reduce((total, line) => total.add(line.over), Dec.ZERO);
  const pending = source.pending.map((item) => ({ ...item, amount: Dec.of(item.amount).toFixed(2) }));
  return {
    currency: source.currency,
    agreed: agreed.toFixed(2),
    changes,
    changesTotal: changed.toFixed(2),
    allowances,
    allowanceIncluded: allowances.reduce((total, line) => total.add(line.included), Dec.ZERO).toFixed(2),
    allowanceSpent: allowances.reduce((total, line) => total.add(line.spent), Dec.ZERO).toFixed(2),
    allowanceOverrun: overrun.toFixed(2),
    pending,
    pendingTotal: sum(pending).toFixed(2),
    forecast: agreed.add(changed).add(overrun).toFixed(2),
  };
}

export type BudgetTracker = ReturnType<typeof budgetTracker>;
