import { tKey, type MessageKey } from "@/lib/i18n/keys";

/** Change requests as the business core returns them to the team (services/business-core/src/change-requests). */
export type ChangeStatus = "draft" | "pricing" | "pending_approval" | "to_send" | "with_client" | "approved" | "applied" | "declined" | "withdrawn";
export type ChangeKind = "addition" | "deduction" | "replacement" | "move" | "schedule" | "price_correction";
export type LineSource = "quote_line" | "ledger" | "allowance" | "custom";
export type LineAction = "add" | "omit" | "replace" | "draw";

export type ChangeLine = {
  id: string; position: number; source: LineSource; action: LineAction; quoteId: string | null; quoteLineId: string | null; ledgerEntryId: string | null; ledgerVersionId: string | null;
  roomId: string | null; roomName: string | null; title: string; quantity: string | null; unit: string; unitPrice: string | null; amount: string;
};

export type ChangeApproval = { id: string; status: string; version: number; currentStep: number; waitingFor: string[];
  steps: Array<{ position: number; label: string; state: "done" | "current" | "upcoming" | "returned" | "rejected"; decidedBy: string | null; decidedAt: string | null }> };

export type ChangeRequest = {
  id: string; caseId: string; number: number; reference: string; kind: ChangeKind; title: string; description: string; designImpact: string; status: ChangeStatus;
  currency: string; priceImpact: string; allowanceDraw: string; timeImpactDays: number; handoverBefore: string | null; handoverAfter: string | null;
  raisedByClient: boolean; raisedByName: string | null; submittedAt: string | null; sentAt: string | null; decidedAt: string | null; decidedByName: string | null;
  decisionMethod: "portal" | "signed_link" | null; declineNote: string | null; lockNumber: number | null; withdrawnAt: string | null; withdrawReason: string | null; version: number;
  createdAt: string; updatedAt: string; lines: ChangeLine[];
  /** A change on a started project: it lives on the project's record (priced as a variation, applied there). */
  projectId?: string | null;
  approval: ChangeApproval | null;
  events: Array<{ event: string; at: string; note: string | null; actorName: string | null; byClient: boolean }>;
  purchaseOrders: Array<{ purchaseOrderId: string; number: string; status: string; matchedOn: string }>;
  signing: { id: string; status: string; state: string; signerName: string; expiresAt: string; signedAt: string | null; version: number } | null;
};

export type ChangeSources = {
  quoteLines: Array<{ quoteId: string; id: string; title: string; room: string | null; quantity: string; unit: string; rate: string; kind: string }>;
  ledgerChanges: Array<{ entryId: string; versionId: string; title: string; number: number; priceImpact: string; status: string }>;
};

export type ChangeRequestsView = { changes: ChangeRequest[]; sources: ChangeSources; canEdit?: boolean; link?: string | null; emailed?: string | null;
  /** The started project that takes this record's changes now (raised and priced on its record). */
  projectId?: string | null };

export const STATUS_LABEL: Record<ChangeStatus, MessageKey> = {
  draft: tKey("Being assessed"), pricing: tKey("Pricing"), pending_approval: tKey("Waiting for approval"), to_send: tKey("Approved"), with_client: tKey("With the client"),
  approved: tKey("Approved"), applied: tKey("Applied"), declined: tKey("Declined"), withdrawn: tKey("Withdrawn"),
};
export const STATUS_TONE: Record<ChangeStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  draft: "neutral", pricing: "info", pending_approval: "warning", to_send: "info", with_client: "info", approved: "success", applied: "success", declined: "danger", withdrawn: "neutral",
};
export const KIND_LABEL: Record<ChangeKind, MessageKey> = {
  addition: tKey("Addition"), deduction: tKey("Deduction"), replacement: tKey("Replacement"), move: tKey("Move"), schedule: tKey("Schedule"), price_correction: tKey("Price correction"),
};
export const ACTION_LABEL: Record<LineAction, MessageKey> = { add: tKey("Add"), omit: tKey("Remove"), replace: tKey("Replace"), draw: tKey("From allowance") };
export const EVENT_LABEL: Record<string, MessageKey> = {
  raised: tKey("Raised"), edited: tKey("Edited"), submitted: tKey("Sent for approval"), returned: tKey("Returned"), rejected: tKey("Rejected"), approved_internal: tKey("Approved inside the firm"),
  sent: tKey("Sent to sign"), approved: tKey("Approved by the client"), declined: tKey("Declined by the client"), withdrawn: tKey("Withdrawn"),
};
