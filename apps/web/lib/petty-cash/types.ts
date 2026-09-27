export type PettyCashCategory = "transport" | "food" | "materials" | "tools" | "fees" | "other";
export type ClaimStatus = "draft" | "submitted" | "approved" | "rejected" | "reimbursed";

/** What someone on a project's team spent for it, from its draft to its reimbursement. Amounts are exact decimal strings. */
export type PettyCashClaim = {
  id: string; number: number; reference: string; projectId: string; projectReference: string; projectName: string; packageId: string | null; packageName: string | null;
  spentOn: string; amount: string; currency: string; description: string; category: PettyCashCategory; receiptName: string | null; noReceiptReason: string; status: ClaimStatus;
  claimedBy: string; claimedByName: string; submittedAt: string | null; decidedByName: string | null; decidedAt: string | null; decisionNote: string;
  reimbursedByName: string | null; reimbursedAt: string | null; reimbursementReference: string; version: number;
};

/** A project's petty cash: the person's own claims, or every claim for whoever decides them. */
export type ProjectPettyCash = {
  claims: PettyCashClaim[]; packages: Array<{ id: string; name: string }>; currency: string; today: string; me: string; canClaim: boolean; canApprove: boolean;
};

/** For the people who pay: approved claims to reimburse, and those reimbursed. */
export type PettyCashPayables = { claims: PettyCashClaim[]; canReimburse: boolean };
