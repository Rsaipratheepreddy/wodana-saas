export type Health = "on_track" | "at_risk" | "off_track";

/** Why the project's health is what it is, each from a record (a date, a count of late work). */
export type HealthReason =
  | { key: "stated" }
  | { key: "past_handover"; days: number }
  | { key: "plan_after_handover"; days: number }
  | { key: "late_work"; count: number }
  | { key: "late_orders"; count: number }
  | { key: "critical_snags"; count: number };

const RANK: Record<Health, number> = { on_track: 0, at_risk: 1, off_track: 2 };
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * A running project's health: the worse of what its manager last said and what its records say. Missing
 * the handover date (passed, or the plan ends after it) is off track; late work, late orders or a critical
 * snag put it at risk. A project that isn't running keeps what was said; nothing here is stored.
 */
export function deliveryHealth(input: {
  stated: Health; status: string; today: string; promise: string | null; planEnd: string | null;
  lateWork: number; lateOrders: number; criticalSnags: number;
}): { health: Health; stated: Health; reasons: HealthReason[] } {
  const { stated, today, promise, planEnd } = input;
  if (input.status !== "active") return { health: stated, stated, reasons: stated === "on_track" ? [] : [{ key: "stated" }] };
  const off: HealthReason[] = [];
  const risk: HealthReason[] = [];
  if (promise && promise < today) off.push({ key: "past_handover", days: days(promise, today) });
  else if (promise && planEnd && planEnd > promise) off.push({ key: "plan_after_handover", days: days(promise, planEnd) });
  if (input.lateWork > 0) risk.push({ key: "late_work", count: input.lateWork });
  if (input.lateOrders > 0) risk.push({ key: "late_orders", count: input.lateOrders });
  if (input.criticalSnags > 0) risk.push({ key: "critical_snags", count: input.criticalSnags });
  const fromRecords: Health = off.length ? "off_track" : risk.length ? "at_risk" : "on_track";
  const health = RANK[stated] > RANK[fromRecords] ? stated : fromRecords;
  const reasons: HealthReason[] = [...(stated !== "on_track" && RANK[stated] >= RANK[fromRecords] ? [{ key: "stated" } as const] : []), ...off, ...risk];
  return { health, stated, reasons };
}
