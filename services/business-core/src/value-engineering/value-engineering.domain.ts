import { Dec } from "../catalog-core/decimal";

/**
 * PLM-147 (updates PLM-045): value engineering on a job's estimate, led by the Lead Interior Designer with the QS.
 * When the QS's price is above the client's budget, the lead designer and the QS agree the savings (marble to
 * porcelain), the designer presents the options to the client (the value engineering meeting) and the client decides:
 * a new estimate version is sent, or they keep the price. The Account Manager is copied and may attend. No fixed
 * number of rounds; past the firm's free rounds a round is chargeable. Pure rules only; nothing here reads the database.
 */
export type VeOrigin = "automatic" | "manual";
export type VeOutcome = "new_version" | "kept_price" | "withdrawn";
/** Where an open round stands: agree the savings, present the options to the client, wait for the client's decision. */
export type VeStep = "agree_options" | "present_options" | "client_decision" | "closed";

export type Money = { amount: string; currency: string };

/** A budget amount as recorded on the brief: a positive decimal, else nothing. */
export function budgetOf(amount: unknown, currency: unknown): Money | null {
  if (typeof amount !== "string" || typeof currency !== "string" || !/^\d{1,12}(\.\d+)?$/.test(amount.trim()) || !/^[A-Z]{3}$/.test(currency)) return null;
  return Dec.of(amount.trim()).cmp(0) > 0 ? { amount: Dec.of(amount.trim()).toString(), currency } : null;
}

/**
 * How far the price is above the client's budget, or null when it isn't, or when there is no budget to compare with
 * (none recorded, or recorded in another currency than the estimate's).
 */
export function overBudgetBy(total: string, currency: string, budget: Money | null): string | null {
  if (!budget || budget.currency !== currency) return null;
  const over = Dec.of(total).sub(budget.amount);
  return over.cmp(0) > 0 ? over.toString() : null;
}

/** Whether round `round` (counted without withdrawn rounds) is past the firm's free rounds; null free rounds is no limit. */
export const roundChargeable = (round: number, freeRounds: number | null) => freeRounds !== null && round > freeRounds;

/**
 * Who leads value engineering: the job's lead designer; on a job with design work but nobody in that role, the Account
 * Manager (and the notices say so); on a job without design work and without a designer (furniture only), nobody: it
 * keeps the existing flow (Sales revises the quotation).
 */
export function veLead(input: { designer: string | null; accountManager: string | null; designWork: boolean }): { membershipId: string; fallback: boolean } | null {
  if (input.designer) return { membershipId: input.designer, fallback: false };
  if (input.designWork && input.accountManager) return { membershipId: input.accountManager, fallback: true };
  return null;
}

export type StartQuote = { kind: string; round: string | null; status: string; latest: boolean };

/** Why a round can't start on this estimate version (null: it can). */
export function startProblem(quote: StartQuote, lead: { membershipId: string } | null, designWork: boolean): string | null {
  if (quote.kind !== "quotation") return "Value engineering is for the estimate, not a variation.";
  if (quote.round === "design") return "Value engineering is for the estimate, not the Design Fee proposal.";
  if (["accepted", "superseded", "withdrawn"].includes(quote.status)) return quote.status === "accepted" ? "The client already accepted this estimate." : "Start it on the latest version of the estimate.";
  if (!quote.latest) return "Start it on the latest version of the estimate.";
  if (!lead) return designWork ? "Nobody leads value engineering on this job. Allocate the lead designer." : "This job has no designer. Revise the quotation with Sales.";
  return null;
}

/**
 * Where an open round stands. The savings come first; then the designer presents the options (the meeting, booked and
 * held); then the client decides. The client may decide at any point (a new version sent, or the price kept).
 */
export function veStep(round: { status: "open" | "closed"; optionsAgreedAt: string | Date | null; meetingStartsAt: string | Date | null }, now: Date): VeStep {
  if (round.status === "closed") return "closed";
  if (!round.optionsAgreedAt) return "agree_options";
  if (!round.meetingStartsAt || new Date(round.meetingStartsAt).getTime() > now.getTime()) return "present_options";
  return "client_decision";
}

/** The note a person types (the savings, a reason): trimmed and bounded, or "" when there is none. */
export const noteText = (value: unknown, max = 2000) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** The round's idle moment: its last move, or the end of its meeting when that is later. */
export function idleSince(lastMovedAt: Date, meetingEndsAt: Date | null) {
  return meetingEndsAt && meetingEndsAt.getTime() > lastMovedAt.getTime() ? meetingEndsAt : lastMovedAt;
}
