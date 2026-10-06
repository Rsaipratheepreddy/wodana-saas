import type { FurniturePath } from "../crm/opportunities/flow-gates";
import { workdays, type WorkCalendar } from "../project-core/work-calendar";
import type { RuleSettings } from "./fulfilment-rules";

/**
 * PLM-126: how a won Furniture Only order reaches the client, per path, read from its records (never typed):
 *   A take home now     paid → collected
 *   B in stock          (transfer from the factory when asked) → delivery booked → delivered
 *   C supplier order    ordered with the supplier → received → collected or delivered
 *   D core collection   drawing approved → factory slot → production → ready → delivery booked → delivered
 *   E bespoke           drawing approved → factory slot → production → ready → delivery booked → delivered
 * The expected date is the path's lead time in working days (the region's working week and the firm's holidays)
 * from Won, or from the drawing approval, at least the catalogue's own time; late once it passes and the client
 * doesn't have it yet.
 */
export const FULFILMENT_STEPS = ["paid", "transfer", "ordered", "received", "drawing_approved", "slot_booked", "in_production", "ready", "delivery_booked", "collected", "delivered", "handed_over"] as const;
export type FulfilmentStep = (typeof FULFILMENT_STEPS)[number];
export type StepState = "done" | "current" | "pending";

export type FulfilmentFacts = {
  wonAt: string | null; collectedAt: string | null; deliveredAt: string | null;
  /** Path B: the transfer asked of the factory, and when it arrived. */
  transfer: { requestedAt: string | null; at: string | null };
  deliveryOn: string | null; deliveryBookedAt: string | null;
  supplierOrders: { placed: number; firstPlacedAt: string | null; received: number; lastReceivedAt: string | null };
  production: { projectId: string | null; drawingApprovedAt: string | null; slotOn: string | null; slotAt: string | null; total: number; started: number; ready: number;
    firstStartedAt: string | null; lastReadyAt: string | null };
  /** The catalogue's own time for the order's items in days (the longest production or supplier time), when known. */
  catalogueDays: number | null;
  cancelledAt: string | null;
};

export type FulfilmentPlan = {
  steps: Array<{ key: FulfilmentStep; state: StepState; at: string | null }>;
  /** When the client should have it: the first and last working day of the lead time. */
  expected: { from: string; by: string } | null;
  handedOver: boolean; late: boolean; cancelled: boolean;
};

const day = (value: string | null) => (value ? value.slice(0, 10) : null);

/** The working-day window from the anchor: the rule's lead time, stretched to the catalogue's own time when asked. */
export function expectedWindow(rule: Pick<RuleSettings, "leadMinDays" | "leadMaxDays" | "leadFromCatalogue">, anchor: string | null, catalogueDays: number | null, calendar: WorkCalendar) {
  if (!anchor) return null;
  const extra = rule.leadFromCatalogue && catalogueDays !== null ? catalogueDays : null;
  const min = rule.leadMinDays === null ? extra : extra === null ? rule.leadMinDays : Math.max(rule.leadMinDays, extra);
  const max = rule.leadMaxDays === null ? extra : extra === null ? rule.leadMaxDays : Math.max(rule.leadMaxDays, extra);
  if (min === null || max === null) return null;
  const math = workdays(calendar);
  const start = day(anchor)!;
  return { from: min === 0 ? start : math.shift(start, min), by: max === 0 ? start : math.shift(start, max) };
}

export function fulfilmentPlan(path: FurniturePath | null, rule: RuleSettings, facts: FulfilmentFacts, calendar: WorkCalendar, today: string): FulfilmentPlan {
  const handedAt = path === "take_home_now" ? facts.collectedAt : path === "supplier_order" ? ([facts.collectedAt, facts.deliveredAt].filter(Boolean).sort()[0] ?? null)
    : facts.deliveredAt ?? facts.collectedAt;
  const made = facts.production;
  const list: Array<[FulfilmentStep, string | null]> =
    path === "take_home_now" ? [["paid", facts.wonAt], ["collected", facts.collectedAt]]
    : path === "in_stock_delivery" ? [
      ...(facts.transfer.requestedAt ? [["transfer", facts.transfer.at] as [FulfilmentStep, string | null]] : []),
      ["delivery_booked", facts.deliveryBookedAt], ["delivered", facts.deliveredAt]]
    : path === "supplier_order" ? [["ordered", facts.supplierOrders.placed ? facts.supplierOrders.firstPlacedAt : null],
      ["received", facts.supplierOrders.placed && facts.supplierOrders.received >= facts.supplierOrders.placed ? facts.supplierOrders.lastReceivedAt : null], ["handed_over", handedAt]]
    : path === "core_collection_factory" || path === "bespoke" ? [["drawing_approved", made.drawingApprovedAt], ["slot_booked", made.slotOn ? made.slotAt : null],
      ["in_production", made.started ? made.firstStartedAt : null], ["ready", made.total && made.ready >= made.total ? made.lastReadyAt : null],
      ["delivery_booked", facts.deliveryBookedAt], ["delivered", facts.deliveredAt]]
    : [["delivery_booked", facts.deliveryBookedAt], ["handed_over", handedAt]];
  // A later step done means the earlier ones are behind it, whatever their own record says.
  const lastDone = list.reduce((last, [, at], index) => (at ? index : last), -1);
  const handedOver = Boolean(handedAt);
  let current = false;
  const steps = list.map(([key, at], index) => {
    const done = Boolean(at) || index < lastDone || handedOver;
    const state: StepState = done ? "done" : !current && !facts.cancelledAt ? (current = true, "current") : "pending";
    return { key, state, at: at ?? null };
  });
  const anchor = rule.leadFrom === "drawing_approved" ? made.drawingApprovedAt : facts.wonAt;
  const expected = expectedWindow(rule, anchor, facts.catalogueDays, calendar);
  return { steps, expected, handedOver, cancelled: Boolean(facts.cancelledAt), late: Boolean(expected && !handedOver && !facts.cancelledAt && today > expected.by) };
}
