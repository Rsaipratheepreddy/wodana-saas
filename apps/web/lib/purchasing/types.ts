export type Approval = "pending" | "approved" | "not_approved" | "on_hold";
export type PaymentTerms = "upfront" | "on_delivery" | "split" | "credit" | "statement";
export type Deal = "none" | "discount" | "commission" | "on_request";

export type Supplier = {
  id: string; code: string; name: string; legalName: string | null; categories: string[];
  approval: Approval; preferredFor: string[]; approvalNote: string; approvalAt: string | null; approvalByName: string | null;
  paymentTerms: PaymentTerms; advancePercent: string | null; creditDays: number | null; termsNote: string;
  /** The share of each invoice held back until handover, copied to new orders. */
  retentionPercent: string;
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
  requireSitePhoto: boolean; stockAdjustApprovalValue: string | null; orderAheadDays: number; invoiceTolerancePercent: string; spendingGuard: "off" | "warn" | "strict";
  /** Invoices are paid only through an approved payment run; advances on orders are still recorded directly. */
  paymentRunsRequired: boolean; version: number;
};

/** Something a running project still needs to order. */
export type Need = {
  key: string; source: "material" | "line"; sourceId: string; projectId: string; projectReference: string; projectName: string;
  title: string; detail: string; unit: string; required: string | null; placed: string; drafted: string; received: string; remaining: string | null;
  catalogItemId: string | null; supplierHint: string; packageName: string | null; supply: string | null; clientChoice: boolean; blocked: "material_signoff" | null;
  /** When the work that uses it starts; ordered its lead time (in days) before that. */
  neededBy: string | null; leadDays: number; orderBy: string | null;
  /** Given from free stock (reserved for the project or issued to it); counted before orders. */
  fromStock: string; packageIds: string[]; scopeLines: string[];
  /** The project is running or on hold (ordering for it then needs the buyer's reason). */
  projectStatus?: "active" | "on_hold";
  /** The latest variation that reduced or removed what it's for ("VO-2"). */
  changedBy?: string | null;
};
export type NeedsState = { needs: Need[]; settings: PurchasingSettings; canBuy: boolean; canApprove: boolean };

export type ShipmentStatus = "booked" | "in_transit" | "delayed" | "arrived" | "cancelled";
export type OrderRow = {
  id: string; number: string; status: OrderStatus; vendorId: string; supplierName: string; legalEntityId: string; companyCode: string; currency: string;
  total: string; expectedDate: string | null; promisedDate: string | null; createdAt: string; createdByName: string; projects: Array<{ id: string; reference: string; status?: string }>; lines: number;
  revision: number; version: number;
  /** Who raised and submitted it (nobody approves their own order). */
  createdBy?: string; submittedBy?: string | null;
  /** Lines still to come, when the first is due, and deliveries waiting for inspection. */
  linesLeft?: number; due?: string | null; inspecting?: boolean;
  /** The latest shipment the buyer follows. */
  shipment?: { status: ShipmentStatus; eta: string | null; carrier: string } | null;
};
export type OrdersState = { orders: OrderRow[]; settings: PurchasingSettings; canBuy: boolean; canApprove: boolean; canReceive?: boolean; me?: string };

export type OrderLine = {
  id: string; position: number; projectId: string | null; projectReference: string | null; source: "material" | "line" | "free"; materialItemId: string | null; boqLineId: string | null;
  description: string; specification: string; quantity: string; unit: string; unitPrice: string; discountPercent: string; taxRate: string; net: string; tax: string; total: string;
  accepted: string; rejected: string; pending: string; credited: string; returned: string;
  promisedDate: string | null; confirmedQuantity: string | null; due: string | null;
  cancelled: string; cancelReason: string | null; replacesLineId: string | null; replacesOrderNumber: string | null;
  alternateStatus: "offered" | "accepted" | "rejected" | null; alternateDescription: string | null; alternateSpecification: string; alternateUnitPrice: string | null;
  alternateNote: string; alternateOfferedBy: string | null; originalDescription: string | null; originalSpecification: string | null;
  /** The stock item a restock line refills. */
  stockItemId?: string | null;
};
export type OrderDetail = OrderRow & {
  paymentTerms: PaymentTerms; advancePercent: string | null; creditDays: number | null; termsNote: string;
  /** The share of each invoice held back until the project's handover. */
  retentionPercent: string; deliverTo: DeliverTo; deliveryAddress: string; supplierReference: string; notes: string;
  subtotal: string; discountTotal: string; taxTotal: string; createdBy: string; submittedBy: string | null; approvedByName: string | null; approvedAt: string | null;
  sentAt: string | null; sentTo: string | null; confirmedAt: string | null; cancelledAt: string | null; cancelReason: string | null; closedAt: string | null; closeReason: string | null; overReason: string | null; companyName: string;
  continuedAt: string | null; continuedNote: string | null; continuedByName: string | null;
  /** Who let the order go ahead beyond its project's money in hand, and why. */
  fundsOverrideAt: string | null; fundsOverrideReason: string | null; fundsOverrideByName: string | null;
  /** Who said it goes ahead while its project is on hold, and why. */
  holdOverrideAt?: string | null; holdOverrideReason?: string | null; holdOverrideByName?: string | null;
};
export type Shipment = {
  id: string; carrier: string; trackingRef: string; trackingUrl: string; status: ShipmentStatus; shippedOn: string | null; eta: string | null; note: string;
  updatedAt: string; updatedByName: string; version: number;
};
/** An invoice the supplier sent for the order, and how it matched (for people who see supplier bills). */
export type OrderBill = { id: string; number: string; invoiceDate: string; status: "draft" | "held" | "approved" | "cancelled"; holdReasons: string; total: string; balance: string; currency: string };
/** Work on a project held up by a line of the order. */
export type LineBlocker = {
  workItemId: string; number: number; title: string; status: string; projectId: string; projectReference: string; orderId: string; orderNumber: string; orderLineId: string; description: string; blocks: number;
};
export type OrderState = {
  order: OrderDetail; lines: OrderLine[]; receipts: Receipt[]; returns: SupplierReturnRow[]; canReceive: boolean;
  events: Array<{ id: string; kind: string; detail: Record<string, unknown>; byName: string | null; at: string }>;
  revisions: Array<{ revision: number; reason: string; at: string; byName: string }>;
  supplier: { id: string; name: string; email: string | null; phone: string | null; contactName: string | null; approval: Approval; deal: Deal; dealPercent: string | null } | null;
  canBuy: boolean; canApprove: boolean; canApproveThis: boolean;
  /** The supplier is on hold while this order is open: it waits for someone who approves orders. */
  supplierHold: { approval: Approval; note: string } | null;
  /** Who's looking (to tell whether they recorded something someone else decides). */
  me: string;
  /** Lines taking a project past what it needs, by how much (while the order is a draft or waiting for approval). */
  overOrdered: Array<{ lineId: string; description: string; unit: string; over: string }>;
  /** The supplier's pack size and minimum where a line doesn't fit them, and the quantity that does. */
  packs: Array<{ lineId: string; packSize: string | null; minimum: string | null; suggested: string }>;
  /** Lines under a valid rate contract: its reference and price, and whether the line costs more. */
  contracts: Array<{ lineId: string; reference: string; unitPrice: string; above: boolean }>;
  /** When each line's goods are needed on its project, by line id. */
  neededBy: Record<string, string>;
  /** Orders beyond a project's money in hand: off, warn or strict (stopped until someone who may override approves). */
  spendingGuard: "off" | "warn" | "strict";
  /** While not placed: the projects this order takes beyond their money in hand, in the workspace's currency. */
  fundsShort: Array<{ projectId: string; reference: string; currency: string; needed: string; available: string }>;
  canOverrideFunds: boolean;
  /** After cancelling the rest of a line and ordering it elsewhere: the new draft order. */
  reordered?: string | null;
  /** After sending: how the supplier's email went. */
  delivery?: "sent" | "not_configured" | "failed" | null;
  shipments?: Shipment[];
  /** Its projects on hold now, while it isn't placed or going ahead anyway. */
  holdProjects?: Array<{ id: string; reference: string }>;
  bills?: OrderBill[] | null;
  blockers?: LineBlocker[];
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
/** What's on its way to one project's site: supplier orders delivering there and moves to it. */
export type ArrivalsState = {
  orders: Array<OrderRow & { items: Array<{ description: string; left: string; unit: string; due: string | null }> }>;
  moves: Array<{ id: string; number: number; status: "in_transit" | "received" | "cancelled"; fromName: string; toName: string; sentOn: string; items: string; workOrderId: string | null;
    workOrderNumber: number | null; note: string }>;
  canReceive: boolean; canReceiveMoves: boolean;
};
export type DeliveriesState = {
  expected: ExpectedOrder[]; inspection: Receipt[]; received: Receipt[]; locations: StockLocation[]; canReceive: boolean; canInspect: boolean; userId: string;
  unmatched: UnmatchedDelivery[]; requireSitePhoto: boolean;
};
/** What the receive form needs for one order. */
export type ReceivingForm = {
  order: OrderDetail; lines: Array<OrderLine & { outstanding: string; receivable: string }>; places: Place[]; defaultPlace: string | null;
  requireInspection: boolean; receiveTolerancePercent: string; requireSitePhoto: boolean;
};

export type DocumentKind = "trade_licence" | "tax_certificate" | "insurance" | "bank_letter" | "other";
export type VendorDocument = {
  id: string; kind: DocumentKind; label: string; number: string; expiresOn: string | null; required: boolean; hasFile: boolean; fileName: string | null;
  createdByName: string; createdAt: string; replacedAt: string | null;
};
export type BankSource = "supplier_letter" | "email" | "in_person" | "phone";
export type BankAccount = {
  id: string; accountName: string; bankName: string; accountNumber: string; swift: string; currency: string | null; source: BankSource;
  status: "pending" | "approved" | "rejected" | "retired"; requestedBy: string; requestedByName: string; requestedAt: string; callbackByName: string | null; callbackAt: string | null;
  callbackNote: string; decidedByName: string | null; decidedAt: string | null; rejectReason: string | null;
};
export type Scorecard = {
  orders: Array<{ currency: string; orders: number; value: string }>; deliveredLines: number; onTimePercent: string | null; received: string; rejected: string;
  rejectPercent: string | null; returns: number; priceRequests: number; replyPercent: string | null; replyDays: string | null;
};
export type RateContract = {
  id: string; reference: string; currency: string; validFrom: string; validTo: string; note: string; status: "active" | "cancelled"; cancelReason: string | null;
  state: "upcoming" | "valid" | "expired" | "cancelled"; createdByName: string;
  lines: Array<{ id: string; catalogItemId: string; itemName: string; unit: string; unitPrice: string; minimum: string | null; packSize: string | null; leadDays: number | null }>;
};
export type SupplierControlsState = {
  supplier: Supplier; documents: VendorDocument[]; bankAccounts: BankAccount[]; scorecard: Scorecard; contracts: RateContract[];
  catalogItems: Array<{ id: string; name: string; unit: string }>;
  openOrders: Array<{ id: string; number: string; status: OrderStatus; total: string; currency: string }>; canManage: boolean; canApprove: boolean; me: string;
};
