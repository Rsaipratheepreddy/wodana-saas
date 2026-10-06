import { tKey, type MessageKey } from "@/lib/i18n/keys";
import type { ApprovalStatus, ApproverKind } from "../../../../services/business-core/src/approvals/approval-policy";
import type { PolicyView } from "../../../../services/business-core/src/approvals/approval-policies.service";

export type { ApprovalStatus, ApproverKind, PolicyView };
export type PolicyStepDraft = { approverKind: ApproverKind; permissionCode?: string | null; roleCode?: string | null; userId?: string | null; label?: string | null };
export type PoliciesView = {
  kinds: string[];
  policies: PolicyView[];
  canManage: boolean;
  people: Array<{ userId: string; name: string }>;
  roles: Array<{ code: string; name: string }>;
};
export type Delegation = {
  id: string; userId: string; userName: string; delegateUserId: string; delegateName: string; startsAt: string; endsAt: string; note: string; version: number; active: boolean;
};
export type DelegationsView = { canManage: boolean; viewerId: string; delegations: Delegation[] };
export type PolicyInput = {
  name: string; currency: string | null; minAmount: string | null; ownerAboveAmount: string | null; escalateAfterHours: number | null;
  waiverAllowed: boolean; resetTolerancePercent: string; steps: PolicyStepDraft[];
};

/** What each kind approves, as its section title. */
export const KIND_TITLE: Record<string, MessageKey> = {
  deal_file: tKey("Deal File"),
  opportunity_value: tKey("Opportunity value"),
  quote_qs: tKey("QS price check"),
  quote_send: tKey("Quotation before sending"),
  discount: tKey("Discount"),
  refund: tKey("Refund"),
  payable: tKey("Supplier bill"),
  purchase_order: tKey("Purchase order"),
  change_request: tKey("Change request"),
  stock_correction: tKey("Stock correction"),
  ledger_change: tKey("Material change after sign-off"),
  payable_request: tKey("Payable request"),
};

/** The approvers a firm picks from by permission: the people who hold it today, never a role's name. */
export const PERMISSION_APPROVERS: Array<{ code: string; label: MessageKey }> = [
  { code: "commercial.finance.verify", label: tKey("Finance") },
  { code: "commercial.deal.approve", label: tKey("Deal File approver") },
  { code: "commercial.estimate", label: tKey("QS") },
  { code: "commercial.approve", label: tKey("Quotation approver") },
  { code: "payables.approve", label: tKey("Payables approver") },
  { code: "purchasing.approve", label: tKey("Purchasing approver") },
];

export const APPROVER_KINDS: Array<{ id: ApproverKind; label: MessageKey }> = [
  { id: "permission", label: tKey("By permission") },
  { id: "role", label: tKey("By role") },
  { id: "person", label: tKey("A person") },
];

/** "Finance verifies → Deal File approver → Owner": the steps in order, in the words of the policy. */
export function stepsLine(policy: Pick<PolicyView, "steps" | "ownerAboveAmount">, names: { permission: (code: string) => string; role: (code: string) => string; owner: string }) {
  const steps = policy.steps.map((step) => step.label || (step.approverKind === "permission" ? names.permission(step.permissionCode ?? "")
    : step.approverKind === "role" ? names.role(step.roleCode ?? "") : step.personName ?? ""));
  return [...steps, ...(policy.ownerAboveAmount !== null ? [names.owner] : [])];
}

const path = (workspaceId: string, resource: string) => `/api/workspace/approvals/${resource}?${new URLSearchParams({ workspaceId })}`;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : tKey("The approval settings could not be saved."));
  return payload as T;
}

export const policiesApi = (workspaceId: string) => ({
  list: () => request<PoliciesView>(path(workspaceId, "policies")),
  create: (kind: string, input: PolicyInput) => request<PoliciesView>(path(workspaceId, "policies"), { method: "POST", body: JSON.stringify({ kind, ...input }) }),
  update: (policyId: string, version: number, input: PolicyInput) => request<PoliciesView>(path(workspaceId, `policies/${policyId}`), { method: "PUT", body: JSON.stringify({ version, ...input }) }),
  setStatus: (policyId: string, version: number, status: "active" | "archived") =>
    request<PoliciesView>(path(workspaceId, `policies/${policyId}/status`), { method: "POST", body: JSON.stringify({ version, status }) }),
  delegations: () => request<DelegationsView>(path(workspaceId, "delegations")),
  delegate: (input: { userId?: string; delegateUserId: string; startsAt?: string; endsAt: string; note?: string }) =>
    request<DelegationsView>(path(workspaceId, "delegations"), { method: "POST", body: JSON.stringify(input) }),
  endDelegation: (id: string, version: number) => request<DelegationsView>(path(workspaceId, `delegations/${id}/end`), { method: "POST", body: JSON.stringify({ version }) }),
});

/** An exact decimal amount in its currency, in the reader's locale (never through a float sum). */
export function amountText(amount: string, currency: string | null, locale?: string) {
  if (!currency) return amount;
  try { return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount as unknown as number); } catch { return `${currency} ${amount}`; }
}
