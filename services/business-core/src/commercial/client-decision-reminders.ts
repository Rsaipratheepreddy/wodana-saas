// Decisions waiting on the client (an issued quote, a design shared for review, drawings sent) are chased by the
// reminder engine (reminders/sources/quotes.ts and designs.ts: client.quote_decision, client.design_decision), at
// most one client reminder a day, with a staff copy to the case owner after two. The helpers below read the firm's
// old decision days for the quotation settings screen (0290 copied them into the reminder rules).

/** Days after a quote or design reaches the client when they are reminded (the client decision rules' default). */
export const DEFAULT_DECISION_REMINDER_DAYS = [2, 5];

/** The firm's reminder days (Settings → Quotations), sorted, each 1–60, at most five. */
export function reminderDays(value: unknown): number[] {
  const days = Array.isArray(value) ? value.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 60) : DEFAULT_DECISION_REMINDER_DAYS;
  return [...new Set(days)].sort((a, b) => a - b).slice(0, 5);
}

/** Which reminder is due after `waited` days: 1 for the first threshold passed, 2 for the second…, 0 for none yet. */
export function reminderRound(waited: number, days: number[]) {
  return days.filter((day) => waited >= day).length;
}
