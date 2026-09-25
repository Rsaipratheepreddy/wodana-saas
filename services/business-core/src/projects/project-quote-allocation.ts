import type { Order } from "./execution.types";

/** Draft selections reserve only their own RFQ batch; they are not purchase commitments. */
export function quoteBatchRemaining(orders: Order[], order: Order): number {
  const requested = order.rfqSnapshot?.quantity ?? order.quantity;
  if (!order.quoteRequestId) return requested;
  const selected = orders.filter(other => other.id !== order.id &&
    other.quoteRequestId === order.quoteRequestId && other.sourceEnquiry &&
    other.status !== "cancelled" && other.status !== "enquiry")
    .reduce((sum, other) => sum + other.quantity, 0);
  return Math.max(0, requested - selected);
}
