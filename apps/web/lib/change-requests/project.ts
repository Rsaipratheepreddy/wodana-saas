import { tKey, type MessageKey } from "@/lib/i18n/keys";

/**
 * Changes on a started project as the business core returns them (services/business-core/src/change-requests,
 * project-changes.service.ts): raised, priced as a variation, approved, sent to the client, applied.
 */
export type ProjectChangeStatus = "draft" | "pricing" | "pending_approval" | "to_send" | "with_client" | "approved" | "applied" | "declined" | "withdrawn";
export type ChangeReason = "client_request" | "site_condition" | "design_change" | "error";
export type NextStep = "price" | "send_to_qs" | "submit" | "approve" | "send" | "apply";
export type ChangeAction = NextStep | "edit" | "return" | "send_link" | "withdraw" | "upload";
export type QsState = "not_needed" | "needed" | "with_qs" | "confirmed";

export type ProjectChangeRow = {
  id: string; reference: string; title: string; reason: ChangeReason; status: ProjectChangeStatus; currency: string; value: string | null; days: number;
  handoverBefore: string | null; handoverAfter: string | null; raisedByName: string | null; raisedByClient: boolean; updatedAt: string; next: NextStep | null; applyProblem: string | null;
};
export type ApprovedVariation = { sealId: string; label: string; quoteId: string; changeRequestId: string | null; reference: string | null; title: string; net: string; tax: string; total: string; currency: string; acceptedAt: string; appliedAt: string };
export type ChangeMoney = {
  currency: string | null; sealed: { label: string; net: string; tax: string; total: string } | null; variations: ApprovedVariation[]; variationsTotal: string; variationsNet: string; agreed: string;
};
export type ProjectChangesView = { changes: ProjectChangeRow[]; money: ChangeMoney; canRaise: boolean; projectOpen: boolean };

export type RaisedLine = {
  id: string; source: "custom" | "catalog" | "boq_line"; action: "add" | "omit" | "replace" | "move"; title: string; quantity: string | null; unit: string; unitPrice: string | null;
  roomId: string | null; roomName?: string | null; catalogItemId: string | null; boqLineId: string | null;
};
export type StageMove = { id: string; name: string; position: number; status: string; days: number; fromStart: string | null; fromEnd: string | null; toStart: string | null; toEnd: string | null; delay: number };
export type ItemMove = { id: string; number: number; title: string; stageId: string | null; fromStart: string | null; fromDue: string | null; startDate: string | null; dueDate: string | null };
export type SchedulePreview = { planned: boolean; stages: StageMove[]; items: ItemMove[]; finishDelay: number; handoverBefore: string | null; handoverAfter: string | null; totalDays: number };
export type PricedLine = { id: string; op: "add" | "omit" | "move"; title: string; area: string | null; fromArea: string | null; quantity: string; unit: string; rate: string; net: string; total: string; boqLineId: string | null };
export type ChangePrice = {
  quoteId: string; number: number; status: string; hash: string | null; validUntil: string | null; currency: string; decimals: number; pricesIncludeTax: boolean;
  lines: PricedLine[]; subtotal: string; discounts: string; net: string; tax: string; taxes: Array<{ rate: string; base: string; tax: string }>; total: string; credit: string;
  paymentTerms: Array<{ id: string; title: string; percent: number; requiredForRelease: boolean }>; value: string; paymentRule: "before_work" | "next_milestone"; holdsWork: boolean;
};
export type ApprovalStep = { position: number; label: string; state: "done" | "current" | "upcoming" | "returned" | "rejected"; decidedBy: string | null; decidedAt: string | null };
export type ChangeApproval = { id: string; status: string; version: number; amount: string | null; currency: string | null; waitingFor: string[]; steps: ApprovalStep[] };
export type ChangeRecord = {
  change: {
    id: string; reference: string; title: string; reason: ChangeReason; description: string; status: ProjectChangeStatus; kind: string; currency: string; version: number;
    raisedByName: string | null; raisedByClient: boolean; createdAt: string; updatedAt: string; decidedAt: string | null; decidedByName: string | null; decisionMethod: "portal" | "signed_link" | null;
    declineNote: string | null; withdrawReason: string | null; appliedAt: string | null; applyProblem: string | null; quoteId: string | null;
    timeImpactDays: number; handoverBefore: string | null; handoverAfter: string | null; lines: RaisedLine[];
  };
  /** caseId: the planning record its variation is priced in. */
  project: { id: string; reference: string; name: string; status: string; caseId?: string };
  price: ChangePrice | null;
  qs: QsState;
  /** QA-007: this person prices the change as its QS now (the variation is with the QS). */
  qsPricing?: boolean;
  /** False for a QS who opens only the changes waiting for them (no access to the project itself). */
  canOpenProject?: boolean;
  timeline: {
    impacts: Array<{ stageId: string; days: number }>; stages: Array<{ id: string; position: number; name: string; status: string }>; preview: SchedulePreview | null;
    sent: (Partial<SchedulePreview> & { quoteHash?: string; total?: string; sentAt?: string }) | null;
    applied: (Partial<SchedulePreview> & { seal?: string; orders?: string[]; materials?: string }) | null;
  };
  approval: ChangeApproval | null;
  signing: { id: string; state: string; signerName: string; expiresAt: string; signedAt: string | null } | null;
  files: Array<{ id: string; name: string; mimeType: string; hasPreview: boolean; createdAt: string; byName: string | null }>;
  events: Array<{ event: string; at: string; note: string | null; actorName: string | null; byClient: boolean }>;
  purchaseOrders: Array<{ purchaseOrderId: string; number: string; status: string; matchedOn: string }>;
  actions: ChangeAction[]; next: NextStep | null;
  link?: string | null; emailed?: string | null;
};
export type ChangeSources = {
  stages: Array<{ id: string; position: number; name: string; status: string }>;
  rooms: Array<{ id: string; name: string }>;
  scope: Array<{ id: string; title: string; unit: string; quantity: string; areaId: string | null; areaName: string | null; origin: string }>;
  catalog: Array<{ id: string; name: string; code: string; unit: string; rate: string | null }>;
};

export const CHANGE_STATUS_LABEL: Record<ProjectChangeStatus, MessageKey> = {
  draft: tKey("Raised"), pricing: tKey("Pricing"), pending_approval: tKey("In approval"), to_send: tKey("Approved"), with_client: tKey("With client"),
  approved: tKey("Client approved"), applied: tKey("Applied"), declined: tKey("Declined"), withdrawn: tKey("Withdrawn"),
};
export const CHANGE_STATUS_TONE: Record<ProjectChangeStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  draft: "neutral", pricing: "info", pending_approval: "warning", to_send: "info", with_client: "warning", approved: "warning", applied: "success", declined: "danger", withdrawn: "neutral",
};
export const REASON_LABEL: Record<ChangeReason, MessageKey> = {
  client_request: tKey("Client request"), site_condition: tKey("Site condition"), design_change: tKey("Design change"), error: tKey("Error"),
};
/** The one next step, as its button reads (verb first, two words). */
export const NEXT_STEP_LABEL: Record<NextStep, MessageKey> = {
  price: tKey("Price it"), send_to_qs: tKey("Send to QS"), submit: tKey("Send for approval"), approve: tKey("Approve"), send: tKey("Send to client"), apply: tKey("Apply"),
};
export const LINE_OP_LABEL: Record<"add" | "omit" | "replace" | "move", MessageKey> = { add: tKey("Add"), omit: tKey("Remove"), replace: tKey("Replace"), move: tKey("Move") };
export const EVENT_LABEL: Record<string, MessageKey> = {
  raised: tKey("Raised"), edited: tKey("Edited"), priced: tKey("Priced"), submitted: tKey("Sent for approval"), returned: tKey("Returned"), rejected: tKey("Rejected"),
  approved_internal: tKey("Approved inside the firm"), sent: tKey("Sent to the client"), approved: tKey("Approved by the client"), declined: tKey("Declined by the client"),
  withdrawn: tKey("Withdrawn"), applied: tKey("Applied to the project"), apply_blocked: tKey("Not applied"), reminded: tKey("Client reminded"), file_added: tKey("File added"),
};

export class ChangeRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const path = (workspaceId: string, value: string) => `/api/project-changes/${value}?${new URLSearchParams({ workspaceId })}`;

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ChangeRequestError(typeof data?.message === "string" ? data.message : "Could not update the change.", response.status);
  return data as T;
}

/** The project changes API for one workspace and project. */
export function projectChangesApi(workspaceId: string, projectId: string) {
  const at = (value = "") => path(workspaceId, `${projectId}${value ? `/${value}` : ""}`);
  return {
    list: () => request<ProjectChangesView>(at()),
    sources: (search = "") => request<ChangeSources>(`${at("sources")}${search ? `&${new URLSearchParams({ search })}` : ""}`),
    get: (id: string) => request<ChangeRecord>(at(id)),
    raise: (body: Record<string, unknown>) => request<ChangeRecord>(at(), "POST", body),
    save: (id: string, body: Record<string, unknown>) => request<ChangeRecord>(at(id), "PUT", body),
    step: (id: string, step: "price" | "submit" | "decide" | "send" | "send-link" | "apply" | "withdraw", body: Record<string, unknown> = {}) => request<ChangeRecord>(at(`${id}/${step}`), "POST", body),
    preview: (stageImpacts: Array<{ stageId: string; days: number }>) => request<SchedulePreview>(at("preview"), "POST", { stageImpacts }),
    fileUrl: (fileId: string, preview = false) => `${at(`files/${fileId}`)}${preview ? "&preview=1" : ""}`,
    upload: async (id: string, fileId: string, file: File) => {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch(at(`${id}/files/${fileId}`), { method: "POST", body: form, cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new ChangeRequestError(typeof data?.message === "string" ? data.message : "The file could not be uploaded.", response.status);
      return data as ChangeRecord;
    },
  };
}
export type ProjectChangesApi = ReturnType<typeof projectChangesApi>;

/** A signed money difference for people: "+AED 1,250.00", "−AED 300.00". */
export function signedMoney(value: string, format: (value: string, currency: string) => string, currency: string) {
  return value.startsWith("-") ? format(value, currency) : `+${format(value, currency)}`;
}
