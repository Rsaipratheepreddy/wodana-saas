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
