export type Approval = "pending" | "approved" | "not_approved" | "on_hold";
export type PaymentTerms = "upfront" | "on_delivery" | "split" | "credit" | "statement";
export type Deal = "none" | "discount" | "commission" | "on_request";

export type Supplier = {
  id: string; code: string; name: string; legalName: string | null; categories: string[];
  approval: Approval; preferredFor: string[]; approvalNote: string; approvalAt: string | null; approvalByName: string | null;
  paymentTerms: PaymentTerms; advancePercent: string | null; creditDays: number | null; termsNote: string;
  deal: Deal; dealPercent: string | null; dealNote: string;
  contactName: string | null; phone: string | null; email: string | null; locality: string | null;
  entityIds: string[]; taxRegistrationNumber: string | null; currency: string | null; notes: string;
  status: "draft" | "active" | "archived"; archivedReason: string | null; version: number;
};
/** One of the firm's companies (legal entities) that buys. */
export type BuyingCompany = { id: string; code: string; name: string };
export type SupplierState = {
  suppliers: Supplier[]; categories: string[]; entities: BuyingCompany[]; canManage: boolean; canApprove: boolean;
  supplierId?: string; imported?: { created: number; merged: number };
};

/** One row of a supplier list someone already keeps, as the import sends it. */
export type SupplierImportRow = {
  key: string; name: string; categories: string; approval: string; deal: string; terms: string;
  contactName: string; phone: string; email: string; locality: string; notes: string; entityId: string | null;
};
export type SupplierImportPlan = {
  plan: Array<{
    name: string; rows: string[]; existingId: string | null; action: "create" | "merge"; categories: string[]; approval: Approval; preferredFor: string[]; approvalSkipped: boolean;
    paymentTerms: PaymentTerms; advancePercent: string | null; creditDays: number | null; deal: Deal; dealPercent: string | null; entityIds: string[];
  }>;
  canApprove: boolean;
};

export type OrderStatus = "draft" | "pending_approval" | "approved" | "sent" | "confirmed" | "partly_received" | "received" | "closed" | "cancelled";
export type DeliverTo = "site" | "factory" | "warehouse" | "pickup" | "other";
export type PurchasingSettings = {
  approvalThreshold: string | null; requireMaterialSignoff: boolean; requireApprovedSupplier: boolean; requireInspection: boolean; receiveTolerancePercent: string;
  requireSitePhoto: boolean; version: number;
};

/** Something a running project still needs to order. */
export type Need = {
  key: string; source: "material" | "line"; sourceId: string; projectId: string; projectReference: string; projectName: string;
  title: string; detail: string; unit: string; required: string | null; placed: string; drafted: string; received: string; remaining: string | null;
  catalogItemId: string | null; supplierHint: string; packageName: string | null; supply: string | null; clientChoice: boolean; blocked: "material_signoff" | null;
};
export type NeedsState = { needs: Need[]; settings: PurchasingSettings; canBuy: boolean; canApprove: boolean };

export type OrderRow = {
  id: string; number: string; status: OrderStatus; vendorId: string; supplierName: string; legalEntityId: string; companyCode: string; currency: string;
  total: string; expectedDate: string | null; promisedDate: string | null; createdAt: string; createdByName: string; projects: Array<{ id: string; reference: string }>; lines: number;
  revision: number; version: number;
};
export type OrdersState = { orders: OrderRow[]; settings: PurchasingSettings; canBuy: boolean; canApprove: boolean };

export type OrderLine = {
  id: string; position: number; projectId: string | null; projectReference: string | null; source: "material" | "line" | "free"; materialItemId: string | null; boqLineId: string | null;
  description: string; specification: string; quantity: string; unit: string; unitPrice: string; discountPercent: string; taxRate: string; net: string; tax: string; total: string;
  accepted: string; rejected: string; pending: string; credited: string; returned: string;
  promisedDate: string | null; confirmedQuantity: string | null; due: string | null;
  cancelled: string; cancelReason: string | null; replacesLineId: string | null; replacesOrderNumber: string | null;
};
export type OrderDetail = OrderRow & {
  paymentTerms: PaymentTerms; advancePercent: string | null; creditDays: number | null; termsNote: string; deliverTo: DeliverTo; deliveryAddress: string; supplierReference: string; notes: string;
  subtotal: string; discountTotal: string; taxTotal: string; createdBy: string; submittedBy: string | null; approvedByName: string | null; approvedAt: string | null;
  sentAt: string | null; sentTo: string | null; confirmedAt: string | null; cancelledAt: string | null; cancelReason: string | null; closedAt: string | null; closeReason: string | null; overReason: string | null; companyName: string;
};
export type OrderState = {
  order: OrderDetail; lines: OrderLine[]; receipts: Receipt[]; returns: SupplierReturnRow[]; canReceive: boolean;
  events: Array<{ id: string; kind: string; detail: Record<string, unknown>; byName: string | null; at: string }>;
  revisions: Array<{ revision: number; reason: string; at: string; byName: string }>;
  supplier: { id: string; name: string; email: string | null; phone: string | null; contactName: string | null; approval: Approval; deal: Deal; dealPercent: string | null } | null;
  canBuy: boolean; canApprove: boolean; canApproveThis: boolean;
  /** Lines taking a project past what it needs, by how much (while the order is a draft or waiting for approval). */
  overOrdered: Array<{ lineId: string; description: string; unit: string; over: string }>;
  /** The supplier's pack size and minimum where a line doesn't fit them, and the quantity that does. */
  packs: Array<{ lineId: string; packSize: string | null; minimum: string | null; suggested: string }>;
  /** After cancelling the rest of a line and ordering it elsewhere: the new draft order. */
  reordered?: string | null;
  /** After sending: how the supplier's email went. */
  delivery?: "sent" | "not_configured" | "failed" | null;
};

export type PriceRequestStatus = "open" | "awarded" | "cancelled";
export type PriceRequestRow = {
  id: string; number: number; status: PriceRequestStatus; neededBy: string | null; createdAt: string; createdByName: string; lines: number; suppliers: number; replied: number; projects: string[];
};
export type PriceRequestsState = { requests: PriceRequestRow[]; canBuy: boolean };
export type PriceRequestLine = {
  id: string; position: number; projectId: string | null; projectReference: string | null; source: "material" | "line" | "free"; materialItemId: string | null; boqLineId: string | null;
  description: string; specification: string; quantity: string; unit: string; awardedVendorId: string | null; awardReason: string; orderId: string | null;
};
export type PriceRequestState = {
  request: { id: string; number: number; status: PriceRequestStatus; neededBy: string | null; notes: string; currency: string; legalEntityId: string; companyName: string;
    createdByName: string; createdAt: string; awardedAt: string | null; cancelReason: string | null; version: number };
  suppliers: Array<{ vendorId: string; name: string; approval: Approval; email: string | null; status: "asked" | "replied" | "declined"; askedTo: string | null; leadTimeDays: number | null;
    validUntil: string | null; note: string; repliedAt: string | null }>;
  lines: PriceRequestLine[];
  quotes: Array<{ vendorId: string; lineId: string; unitPrice: string; discountPercent: string; net: string }>;
  cheapest: Record<string, string | null>;
  totals: Record<string, { net: string; priced: number }>;
  orders: Array<{ id: string; number: string; vendorId: string }>;
  canBuy: boolean;
};

export type LocationKind = "warehouse" | "factory" | "site" | "other";
export type StockLocation = { id: string; kind: LocationKind; name: string; projectId: string | null; projectReference: string | null; address: string; isDefault: boolean; active: boolean };
/** Where goods can be received: a location, or one made on first use (`site:<project>`, `warehouse`, `factory`). */
export type Place = { key: string; kind: LocationKind; name: string | null; projectReference: string | null };

export type Receipt = {
  id: string; number: number; orderId: string; orderNumber: string; supplierName: string; locationId: string; locationName: string; locationKind: LocationKind;
  receivedOn: string; receivedBy: string; receivedByName: string; deliveryNote: string; notes: string; inspectedByName: string | null; inspectedAt: string | null;
  received: string; accepted: string; rejected: string; pending: string; createdAt: string;
  missing: string; reversedAt: string | null; reversedByName: string | null; reverseReason: string | null;
  handedOverBy: string; photos: number;
};
export type ReceiptPhoto = { id: string; name: string; byName: string; at: string };
export type RejectKind = "damaged" | "defective" | "wrong_item" | "wrong_spec" | "other";
export type ReceiptLine = {
  id: string; orderLineId: string; description: string; specification: string; unit: string; projectReference: string | null; boqLineId: string | null; projectId: string | null;
  received: string; accepted: string; rejected: string; pending: string; rejectReason: string; rejectKind: RejectKind | null; noted: string | null; inspectedByName: string | null;
  returnedRejected: string; returnedAccepted: string;
};
export type ReceiptState = {
  receipt: Receipt; lines: ReceiptLine[]; canBuy: boolean; canReceive: boolean; canInspect: boolean; canInspectThis: boolean; canReturnThis: boolean; canReverseThis: boolean;
  photos: ReceiptPhoto[]; needsPhoto: boolean;
};

/** Goods that came without an order, held until they're matched to one or sent back. */
export type UnmatchedDelivery = {
  id: string; number: number; vendorId: string | null; supplierName: string; locationId: string; locationName: string; locationKind: LocationKind; receivedOn: string;
  receivedBy: string; receivedByName: string; handedOverBy: string; deliveryNote: string; notes: string; status: "open" | "matched" | "returned"; receiptId: string | null;
  receiptNumber: number | null; resolvedByName: string | null; resolvedAt: string | null; resolutionNote: string; createdAt: string; lines: number; photos: number;
};
export type UnmatchedState = {
  delivery: UnmatchedDelivery; lines: Array<{ id: string; description: string; quantity: string; unit: string }>; photos: ReceiptPhoto[];
  candidates: Array<{ id: string; number: string; supplierName: string; lines: Array<{ id: string; description: string; unit: string; projectReference: string | null; outstanding: string }> }>;
  canBuy: boolean; canReceive: boolean; canInspect: boolean;
};

export type SupplierReturnRow = {
  id: string; number: number; orderId: string; orderNumber: string; supplierName: string; locationName: string; outcome: "replace" | "credit"; status: "open" | "sent" | "cancelled";
  note: string; createdByName: string; createdAt: string; sentOn: string | null; sentByName: string | null; cancelReason: string | null; version: number; lines: number; credit: string | null; currency: string;
};
export type SupplierReturnLine = {
  id: string; receiptLineId: string; receiptNumber: number; description: string; unit: string; source: "rejected" | "accepted"; quantity: string; reasonKind: RejectKind; reason: string;
  creditAmount: string | null; creditTax: string | null; projectReference: string | null;
};
export type SupplierReturnState = {
  return: SupplierReturnRow; lines: SupplierReturnLine[]; canBuy: boolean; canReceive: boolean; canSendThis: boolean; canCancelThis: boolean;
  delivery?: "sent" | "not_configured" | "failed" | null;
};
export type SupplierReturnsState = { returns: SupplierReturnRow[]; canBuy: boolean; canReceive: boolean };

export type ExpectedOrder = OrderRow & { deliverTo: DeliverTo; linesLeft: number; due: string | null };
export type DeliveriesState = {
  expected: ExpectedOrder[]; inspection: Receipt[]; received: Receipt[]; locations: StockLocation[]; canReceive: boolean; canInspect: boolean; userId: string;
  unmatched: UnmatchedDelivery[]; requireSitePhoto: boolean;
};
/** What the receive form needs for one order. */
export type ReceivingForm = {
  order: OrderDetail; lines: Array<OrderLine & { outstanding: string; receivable: string }>; places: Place[]; defaultPlace: string | null;
  requireInspection: boolean; receiveTolerancePercent: string; requireSitePhoto: boolean;
};
