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

export type OrderStatus = "draft" | "pending_approval" | "approved" | "sent" | "confirmed" | "closed" | "cancelled";
export type DeliverTo = "site" | "factory" | "warehouse" | "pickup" | "other";
export type PurchasingSettings = { approvalThreshold: string | null; requireMaterialSignoff: boolean; requireApprovedSupplier: boolean; version: number };

/** Something a running project still needs to order. */
export type Need = {
  key: string; source: "material" | "line"; sourceId: string; projectId: string; projectReference: string; projectName: string;
  title: string; detail: string; unit: string; required: string | null; placed: string; drafted: string; remaining: string | null;
  catalogItemId: string | null; supplierHint: string; packageName: string | null; supply: string | null; blocked: "material_signoff" | null;
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
};
export type OrderDetail = OrderRow & {
  paymentTerms: PaymentTerms; advancePercent: string | null; creditDays: number | null; termsNote: string; deliverTo: DeliverTo; deliveryAddress: string; supplierReference: string; notes: string;
  subtotal: string; discountTotal: string; taxTotal: string; createdBy: string; submittedBy: string | null; approvedByName: string | null; approvedAt: string | null;
  sentAt: string | null; sentTo: string | null; confirmedAt: string | null; cancelledAt: string | null; cancelReason: string | null; companyName: string;
};
export type OrderState = {
  order: OrderDetail; lines: OrderLine[];
  events: Array<{ id: string; kind: string; detail: Record<string, unknown>; byName: string | null; at: string }>;
  revisions: Array<{ revision: number; reason: string; at: string; byName: string }>;
  supplier: { id: string; name: string; email: string | null; phone: string | null; contactName: string | null; approval: Approval; deal: Deal; dealPercent: string | null } | null;
  canBuy: boolean; canApprove: boolean; canApproveThis: boolean;
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
