import { addExact, multiplyExact, subtractExact } from "@/lib/purchasing/amounts";
import type { ReorderPoint } from "./types";

/** What to order to restock an item: its reorder point's own quantity, else back to twice the point (never less than the point). */
export function restockQuantity(point: Pick<ReorderPoint, "reorderQuantity" | "reorderAt" | "free" | "onOrder">) {
  if (point.reorderQuantity) return point.reorderQuantity;
  const gap = subtractExact(multiplyExact(point.reorderAt, "2"), addExact(point.free, point.onOrder));
  const floor = Number(point.reorderAt) > 0 ? point.reorderAt : "1";
  return Number(gap) > Number(floor) ? gap : floor;
}
