import type { LocationKind, StockLocation } from "@/lib/purchasing/types";

export type { LocationKind, StockLocation };

/** One item at one place, for a project or free. */
export type StockRow = {
  itemId: string; itemName: string; itemCode: string; unit: string; catalogItemId: string | null;
  /** The item's category (a materials list's tab or category column); empty when it has none. */
  category?: string;
  locationId: string; locationName: string; locationKind: LocationKind;
  projectId: string | null; projectReference: string | null; projectName: string | null; onHand: string; updatedAt: string;
  /** Null for people who don't see stock costs (QA-006). */
  value: string | null; averageCost: string | null; currency: string;
};
export type PendingAdjustment = {
  id: string; itemName: string; unit: string; locationName: string; projectReference: string | null; counted: string; difference: string; value: string | null;
  reason: string; requestedBy: string; requestedByName: string; requestedAt: string;
};
export type ProjectOption = { id: string; reference: string; name: string };
/** Free stock of an item at one place (or every place) at or below its reorder point is low; short when nothing on order lifts it. */
export type ReorderPoint = {
  id: string; itemId: string; itemName: string; itemCode: string; unit: string; locationId: string | null; locationName: string | null;
  reorderAt: string; reorderQuantity: string | null; vendorId: string | null; vendorName: string | null;
  free: string; onOrder: string; low: boolean; short: boolean; lowSince: string | null; version: number;
};
/** A stock item kept, whether or not any is on hand. */
export type StockItemSummary = { itemId: string; itemName: string; itemCode: string; unit: string; catalogItemId: string | null; category: string };
export type StockState = {
  rows: StockRow[];
  /** Every active stock item (a materials list imported without quantities shows at nothing on hand). */
  items?: StockItemSummary[]; locations: StockLocation[]; projects: ProjectOption[]; inTransit: number; canManage: boolean; canAdjust: boolean; canReceive: boolean;
  pendingAdjustments: PendingAdjustment[]; me: string; currency: string; reorderPoints?: ReorderPoint[];
  /** §0.3 P0: the count sheet or shelf photo behind each correction waiting for approval (by its id). */
  adjustmentFiles?: Record<string, Array<{ id: string; name: string; mimeType: string; hasPreview: boolean; uploadedAt: string }>>;
  /** Whether stock values and costs are shown (QA-006); the server leaves them out otherwise. */
  canSeeCosts?: boolean;
};

export type MovementKind = "receive" | "issue" | "return" | "transfer_out" | "transfer_in" | "allocate" | "release" | "adjust" | "supplier_return" | "reverse" | "produce" | "sale" | "sale_return";
export type MovementRow = {
  id: string; batchId: string; kind: MovementKind; quantity: string; itemId: string; itemName: string; unit: string; locationName: string; projectReference: string | null;
  forProjectReference: string | null; reason: string; movedOn: string; byName: string; at: string; receiptNumber: number | null; orderNumber: string | null; transferNumber: number | null; returnNumber: number | null;
  unitCost: string | null; currency: string | null; workOrderNumber: number | null;
};

export type TransferStatus = "in_transit" | "received" | "cancelled";
export type TransferRow = {
  id: string; number: number; status: TransferStatus; fromLocationId: string; fromName: string; toLocationId: string; toName: string; note: string;
  sentOn: string; sentBy: string; sentByName: string; receivedOn: string | null; receivedByName: string | null; cancelReason: string | null; lines: number; short: boolean;
  /** Where it goes (a site names its project), the first things on it and the projects they're for. */
  fromKind?: string; toKind?: string; toProjectId?: string | null; items?: string; projects?: Array<{ id: string; reference: string }>;
  /** Refused where it arrived (and sent back on its return trip). */
  rejected?: boolean;
  /** A factory dispatch names its work order; a return trip the move it brings back. */
  workOrderId?: string | null; workOrderNumber?: number | null; returnedFromId?: string | null; returnedFromNumber?: number | null; returnId?: string | null; returnNumber?: number | null;
};
export type TransferLine = {
  id: string; itemId: string; itemName: string; unit: string; projectId: string | null; projectReference: string | null; quantity: string; received: string | null; lossReason: string;
  rejected?: string; rejectReason?: string;
};
export type TransfersState = { transfers: TransferRow[]; locations: StockLocation[]; canManage: boolean; canAdjust: boolean; canReceive: boolean };
export type TransferState = { transfer: TransferRow; lines: TransferLine[]; canManage: boolean; canAdjust: boolean; canReceive: boolean; canReceiveThis: boolean; canCancelThis: boolean };
