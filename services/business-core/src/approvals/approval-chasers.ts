// Approvals that wait are chased by the reminder engine (reminders/sources/approvals.ts, kind approval.waiting): the
// person who may decide is reminded after the hours of the firm's rule (24 and 48 by default, copied from the old
// "Approval reminders" policy by 0290), then the owners hear it unless the E3 policy escalates by itself
// (escalateWaitingApprovals, still in the daily run). What is left here reads that old policy for its settings screen.

export const APPROVAL_REMINDER_EVENT = "approvals.reminder";
export const DEFAULT_CHASE = { remindAfterHours: 24, escalateAfterHours: 48 };

export type ChaseSettings = { enabled: boolean; remindAfterHours: number; escalateAfterHours: number; email: boolean };

/** Hours between 1 and a month; escalation never before the reminder. */
export function chaseSettings(policy: { status: string; conditions: unknown; channels: unknown } | undefined): ChaseSettings {
  const conditions = policy?.conditions && typeof policy.conditions === "object" ? policy.conditions as Record<string, unknown> : {};
  const hours = (value: unknown, fallback: number) => { const n = Number(value); return Number.isInteger(n) && n >= 1 && n <= 720 ? n : fallback; };
  const remindAfterHours = hours(conditions.remindAfterHours, DEFAULT_CHASE.remindAfterHours);
  const escalateAfterHours = Math.max(remindAfterHours, hours(conditions.escalateAfterHours, DEFAULT_CHASE.escalateAfterHours));
  return { enabled: policy ? policy.status === "active" : true, remindAfterHours, escalateAfterHours,
    email: Array.isArray(policy?.channels) && (policy!.channels as unknown[]).includes("email") };
}
