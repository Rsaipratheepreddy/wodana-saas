import { Dec } from "../catalog-core/decimal";

/**
 * E3 approval policies — the pure rules (no database): which policy covers a request, the steps it runs, who may
 * decide the current step (separation of duties, delegation, escalation, waiver) and when an amount change resets
 * the approvals. The engine (`approval-engine.ts`) loads the rows and applies these.
 */
export const APPROVAL_SUBJECT_KINDS = [
  "deal_file", "opportunity_value", "quote_qs", "quote_send", "discount", "refund", "payable", "purchase_order", "change_request", "stock_correction", "ledger_change",
  "payable_request", "manual_journal",
] as const;
export type ApprovalSubjectKind = (typeof APPROVAL_SUBJECT_KINDS)[number];

/** Kinds that already have their own row in "Waiting for you" (their module lists them); the engine's generic row skips them. */
export const KINDS_WITH_OWN_INBOX_ROW: ReadonlySet<ApprovalSubjectKind> = new Set<ApprovalSubjectKind>([
  "deal_file", "quote_qs", "quote_send", "discount", "purchase_order", "payable", "stock_correction",
]);

export type ApproverKind = "permission" | "role" | "person";
export type ApprovalDecision = "approve" | "return" | "reject";
export type ApprovalRequestStatus = "pending" | "approved" | "returned" | "rejected" | "cancelled" | "superseded";
export type DecisionVia = "direct" | "delegate" | "escalation" | "waiver" | "legacy" | "system";

export type PolicyStep = {
  position: number;
  approverKind: ApproverKind;
  permissionCode: string | null;
  roleCode: string | null;
  userId: string | null;
  label: string;
};
export type PolicyStepInput = { approverKind: ApproverKind; permissionCode?: string | null; roleCode?: string | null; userId?: string | null; label?: string | null };

export type PolicyVersion = {
  id: string;
  policyId: string;
  version: number;
  name: string;
  kind: string;
  currency: string | null;
  minAmount: string | null;
  ownerAboveAmount: string | null;
  escalateAfterHours: number | null;
  waiverAllowed: boolean;
  resetTolerancePercent: string;
  steps: PolicyStep[];
};

/** The role that decides above a policy's Owner amount and on escalation past the last step. */
export const OWNER_ROLE = "owner";
export const OWNER_STEP_LABEL = "Owner";

const step = (approverKind: ApproverKind, code: string, label: string): PolicyStepInput =>
  approverKind === "permission" ? { approverKind, permissionCode: code, label } : approverKind === "role" ? { approverKind, roleCode: code, label } : { approverKind, userId: code, label };
const FINANCE = step("permission", "commercial.finance.verify", "Finance verifies");
const DEAL_APPROVER = step("permission", "commercial.deal.approve", "Deal File approver");

/**
 * The product defaults, created for a workspace the first time a kind is requested. They reproduce the rules that
 * applied before the engine: the Deal File is checked by Finance and approved by anyone holding the Deal File
 * approval permission who neither submitted nor verified it; no escalation, no waiver, any change resets.
 */
export const DEFAULT_APPROVAL_POLICIES: Record<ApprovalSubjectKind, { name: string; steps: PolicyStepInput[] }> = {
  deal_file: { name: "Deal File", steps: [FINANCE, DEAL_APPROVER] },
  opportunity_value: { name: "Opportunity value", steps: [FINANCE, { ...DEAL_APPROVER, label: "Deal File approver locks" }] },
  quote_qs: { name: "QS price check", steps: [step("permission", "commercial.estimate", "QS confirms")] },
  quote_send: { name: "Quotation before sending", steps: [step("permission", "commercial.approve", "Quotation approver")] },
  discount: { name: "Discount", steps: [step("permission", "commercial.approve", "Quotation approver")] },
  refund: { name: "Refund", steps: [FINANCE, DEAL_APPROVER] },
  payable: { name: "Supplier bill", steps: [step("permission", "payables.approve", "Payables approver")] },
  purchase_order: { name: "Purchase order", steps: [step("permission", "purchasing.approve", "Purchasing approver")] },
  change_request: { name: "Change request", steps: [step("permission", "commercial.approve", "Change approver")] },
  stock_correction: { name: "Stock correction", steps: [step("permission", "stock.adjust", "Stock approver")] },
  ledger_change: { name: "Material change after sign-off", steps: [step("permission", "pre_projects.review_designs", "Design reviewer")] },
  // A supplier payment asked of Finance (PLM-110). A firm sets its amount thresholds on this policy: a minimum lets smaller payables through.
  payable_request: { name: "Payable request", steps: [step("permission", "payables.approve", "Payables approver")] },
  // A manual or opening Ledger journal (plan §6.21b P15): someone holding Ledger approval who didn't prepare it.
  manual_journal: { name: "Manual journal", steps: [step("permission", "books.approve", "Ledger approver")] },
};

/** Shape rules some kinds need because their module maps steps onto its own screens (Finance first, then approvers). */
export const KIND_RULES: Partial<Record<ApprovalSubjectKind, { firstPermission: string; minSteps: number }>> = {
  deal_file: { firstPermission: "commercial.finance.verify", minSteps: 2 },
  opportunity_value: { firstPermission: "commercial.finance.verify", minSteps: 2 },
};

export function isSubjectKind(value: unknown): value is ApprovalSubjectKind {
  return APPROVAL_SUBJECT_KINDS.includes(value as ApprovalSubjectKind);
}

const AMOUNT = /^\d{1,16}(\.\d{1,4})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const CODE = /^[a-z][a-z0-9_.]{1,99}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ApprovalRuleError extends Error {
  constructor(message: string, readonly code: "invalid" | "forbidden" | "conflict" = "invalid") { super(message); }
}

/** A money amount as text with up to four places (numeric(20,4)), never a float; null stays null. */
export function amountText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "number" ? (Number.isFinite(value) ? Dec.of(value).toFixed(4) : "") : typeof value === "string" ? value.trim() : "";
  if (!AMOUNT.test(text)) throw new ApprovalRuleError("Enter the amount as a number, for example 125000 or 125000.50");
  return text;
}

export function currencyText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!CURRENCY.test(text)) throw new ApprovalRuleError("Choose the currency");
  return text;
}

const atLeast = (amount: string | null, threshold: string | null) => threshold === null || (amount !== null && Dec.of(amount).cmp(threshold) >= 0);

/**
 * The policy that covers a request: active policies of the kind whose currency matches (or that name none) and whose
 * minimum the amount reaches. The most specific wins: a currency over none, then the highest minimum.
 */
export function selectPolicy(versions: PolicyVersion[], amount: string | null, currency: string | null): PolicyVersion | null {
  const candidates = versions.filter((version) =>
    (version.currency === null || version.currency === currency) && (version.minAmount === null || (version.currency === currency && atLeast(amount, version.minAmount))));
  candidates.sort((left, right) =>
    Number(right.currency !== null) - Number(left.currency !== null)
    || Dec.of(right.minAmount ?? "0").cmp(left.minAmount ?? "0")
    || left.policyId.localeCompare(right.policyId));
  return candidates[0] ?? null;
}

/** Whether the Owner joins as the last step: the amount reaches the policy's Owner amount, in its currency. */
export function needsOwner(version: Pick<PolicyVersion, "currency" | "ownerAboveAmount">, amount: string | null, currency: string | null) {
  return version.ownerAboveAmount !== null && version.currency === currency && atLeast(amount, version.ownerAboveAmount);
}

/** The steps a request runs: the policy's, plus the Owner when the amount calls for it. */
export function effectiveSteps(version: Pick<PolicyVersion, "steps">, ownerStep: boolean): PolicyStep[] {
  const steps = [...version.steps].sort((left, right) => left.position - right.position);
  return ownerStep
    ? [...steps, { position: steps.length + 1, approverKind: "role", permissionCode: null, roleCode: OWNER_ROLE, userId: null, label: OWNER_STEP_LABEL }]
    : steps;
}

export type Person = { userId: string; permissions: ReadonlySet<string>; roles: ReadonlySet<string> };

export function satisfies(step: Pick<PolicyStep, "approverKind" | "permissionCode" | "roleCode" | "userId">, person: Person) {
  if (step.approverKind === "permission") return Boolean(step.permissionCode && person.permissions.has(step.permissionCode));
  if (step.approverKind === "role") return Boolean(step.roleCode && person.roles.has(step.roleCode));
  return step.userId === person.userId;
}

export type RequestFacts = {
  status: ApprovalRequestStatus;
  requesterUserId: string;
  currentStep: number;
  stepSince: Date | string;
  expiresAt: Date | string | null;
  steps: PolicyStep[];
  escalateAfterHours: number | null;
  waiverAllowed: boolean;
  /** Approvals of earlier steps on this request: who decided, and for whom. */
  earlier: Array<{ decidedBy: string | null; onBehalfOf: string | null }>;
};

export type Eligibility = {
  canDecide: boolean;
  via: Exclude<DecisionVia, "legacy" | "system"> | null;
  /** The person the decision is for (a delegator), or null. */
  onBehalfOf: string | null;
  reason: "decided" | "expired" | "own" | "earlier_step" | "not_yours" | null;
};

const HOUR = 3_600_000;
const time = (value: Date | string) => (value instanceof Date ? value.getTime() : Date.parse(value));

/** The step that decides when the current one escalates: the next step, or the Owner past the last. */
export function escalationStep(facts: Pick<RequestFacts, "steps" | "currentStep">): PolicyStep {
  return facts.steps[facts.currentStep] ?? { position: facts.currentStep + 1, approverKind: "role", permissionCode: null, roleCode: OWNER_ROLE, userId: null, label: OWNER_STEP_LABEL };
}

/**
 * Whether the current step has passed to the next approver: after the escalation hours, or at once when the step names
 * only the requester (separation of duties skips them, E3-2).
 */
export function isEscalated(facts: RequestFacts, now: Date) {
  const current = facts.steps[facts.currentStep - 1];
  if (current?.approverKind === "person" && current.userId === facts.requesterUserId) return true;
  return facts.escalateAfterHours !== null && now.getTime() - time(facts.stepSince) >= facts.escalateAfterHours * HOUR;
}

export function isExpired(facts: Pick<RequestFacts, "expiresAt">, now: Date) {
  return facts.expiresAt !== null && time(facts.expiresAt) <= now.getTime();
}

/**
 * Who may decide the current step (E3-1, E3-2): a direct approver who is neither the requester nor someone who
 * decided an earlier step; a delegate acting for such an approver; after escalation, the next step's approvers;
 * the requester only through a recorded waiver, and only when the policy allows it.
 */
export function eligibility(facts: RequestFacts, actor: Person, delegators: Person[], now: Date): Eligibility {
  const no = (reason: Eligibility["reason"]): Eligibility => ({ canDecide: false, via: null, onBehalfOf: null, reason });
  if (facts.status !== "pending") return no("decided");
  const step = facts.steps[facts.currentStep - 1];
  if (!step) return no("decided");
  const earlier = new Set(facts.earlier.flatMap((decision) => [decision.decidedBy, decision.onBehalfOf]).filter((id): id is string => Boolean(id)));
  const blocked = (userId: string) => userId === facts.requesterUserId || earlier.has(userId);
  const actorOwn = actor.userId === facts.requesterUserId;
  const actorEarlier = earlier.has(actor.userId);
  if (!actorOwn && !actorEarlier && satisfies(step, actor)) return { canDecide: true, via: "direct", onBehalfOf: null, reason: null };
  if (!actorOwn && !actorEarlier) {
    const delegator = delegators.find((person) => !blocked(person.userId) && satisfies(step, person));
    if (delegator) return { canDecide: true, via: "delegate", onBehalfOf: delegator.userId, reason: null };
    if (isEscalated(facts, now) && satisfies(escalationStep(facts), actor)) return { canDecide: true, via: "escalation", onBehalfOf: null, reason: null };
  }
  if (actorOwn && !actorEarlier && facts.waiverAllowed && satisfies(step, actor)) return { canDecide: true, via: "waiver", onBehalfOf: null, reason: null };
  return no(actorOwn ? "own" : actorEarlier ? "earlier_step" : "not_yours");
}

/** What a decision does to the request: the next step, or its final state. */
export function nextState(facts: Pick<RequestFacts, "currentStep" | "steps">, decision: ApprovalDecision): { status: ApprovalRequestStatus; currentStep: number; final: boolean } {
  if (decision === "return") return { status: "returned", currentStep: facts.currentStep, final: true };
  if (decision === "reject") return { status: "rejected", currentStep: facts.currentStep, final: true };
  if (facts.currentStep >= facts.steps.length) return { status: "approved", currentStep: facts.currentStep, final: true };
  return { status: "pending", currentStep: facts.currentStep + 1, final: false };
}

/**
 * E3-3: whether an amount change resets the approvals. It does when the change moves the request under another
 * policy or adds or removes the Owner (it crosses a threshold), or when it exceeds the policy's tolerance.
 */
export function amountChangeResets(input: {
  before: { amount: string | null; currency: string | null; policyId: string; ownerStep: boolean };
  after: { amount: string | null; currency: string | null; policyId: string | null; ownerStep: boolean };
  tolerancePercent: string;
}) {
  const { before, after } = input;
  if (before.currency !== after.currency || after.policyId !== before.policyId || after.ownerStep !== before.ownerStep) return true;
  if (before.amount === after.amount) return false;
  if (before.amount === null || after.amount === null) return true;
  const old = Dec.of(before.amount);
  const change = Dec.of(after.amount).sub(old).abs();
  if (old.isZero()) return !change.isZero();
  return change.mul(100).cmp(old.mul(input.tolerancePercent)) > 0;
}

export type PolicyInput = {
  name: string;
  currency: string | null;
  minAmount: string | null;
  ownerAboveAmount: string | null;
  escalateAfterHours: number | null;
  waiverAllowed: boolean;
  resetTolerancePercent: string;
  steps: PolicyStepInput[];
};

/** Validates a policy as an administrator sends it; every rule is checked and the first problem is named. */
export function validatePolicyInput(kind: ApprovalSubjectKind, input: Record<string, unknown>): PolicyInput {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 120) throw new ApprovalRuleError("Give the policy a name (up to 120 characters)");
  const currency = currencyText(input.currency);
  const minAmount = amountText(input.minAmount);
  const ownerAboveAmount = amountText(input.ownerAboveAmount);
  if ((minAmount !== null || ownerAboveAmount !== null) && currency === null) throw new ApprovalRuleError("Choose the currency the amounts are in");
  if (minAmount !== null && ownerAboveAmount !== null && Dec.of(ownerAboveAmount).cmp(minAmount) < 0)
    throw new ApprovalRuleError("The Owner amount can't be below the policy's starting amount");
  const hours = input.escalateAfterHours === null || input.escalateAfterHours === undefined || input.escalateAfterHours === "" ? null : Number(input.escalateAfterHours);
  if (hours !== null && (!Number.isInteger(hours) || hours < 1 || hours > 720)) throw new ApprovalRuleError("Escalate after 1 to 720 hours, or never");
  const tolerance = input.resetTolerancePercent === undefined || input.resetTolerancePercent === null || input.resetTolerancePercent === "" ? "0" : String(input.resetTolerancePercent).trim();
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(tolerance) || Dec.of(tolerance).cmp(100) > 0) throw new ApprovalRuleError("The tolerance is a percentage from 0 to 100");
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  if (!rawSteps.length || rawSteps.length > 6) throw new ApprovalRuleError("A policy has 1 to 6 approvers in order");
  const steps = rawSteps.map((raw, index): PolicyStepInput => {
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const label = typeof value.label === "string" ? value.label.trim().slice(0, 120) : "";
    const where = `Approver ${index + 1}`;
    if (value.approverKind === "permission") {
      if (typeof value.permissionCode !== "string" || !CODE.test(value.permissionCode)) throw new ApprovalRuleError(`${where}: choose who approves`);
      return { approverKind: "permission", permissionCode: value.permissionCode, label };
    }
    if (value.approverKind === "role") {
      if (typeof value.roleCode !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(value.roleCode)) throw new ApprovalRuleError(`${where}: choose the role`);
      return { approverKind: "role", roleCode: value.roleCode, label };
    }
    if (value.approverKind === "person") {
      if (typeof value.userId !== "string" || !UUID.test(value.userId)) throw new ApprovalRuleError(`${where}: choose the person`);
      return { approverKind: "person", userId: value.userId, label };
    }
    throw new ApprovalRuleError(`${where}: approve by permission, role or person`);
  });
  const seen = new Set(steps.map((item) => `${item.approverKind}:${item.permissionCode ?? item.roleCode ?? item.userId}`));
  if (seen.size !== steps.length) throw new ApprovalRuleError("Each approver appears once");
  const rule = KIND_RULES[kind];
  if (rule && (steps.length < rule.minSteps || steps[0].approverKind !== "permission" || steps[0].permissionCode !== rule.firstPermission))
    throw new ApprovalRuleError("Finance verifies first, then at least one approver");
  return { name, currency, minAmount, ownerAboveAmount, escalateAfterHours: hours, waiverAllowed: input.waiverAllowed === true, resetTolerancePercent: tolerance, steps };
}

/** One step of a request as a screen shows it. */
export type ApprovalStepView = {
  position: number;
  label: string;
  approverKind: ApproverKind;
  state: "done" | "current" | "upcoming" | "returned" | "rejected";
  decidedBy: string | null;
  onBehalfOf: string | null;
  via: DecisionVia | null;
  decidedAt: string | null;
  note: string | null;
};

/** The state of one subject's latest request, for the module that owns the subject and for screens. */
export type ApprovalStatus = {
  id: string;
  kind: string;
  subjectId: string;
  title: string;
  href: string | null;
  status: ApprovalRequestStatus;
  amount: string | null;
  currency: string | null;
  /** The amount before a change that reopened approvals (E3-3): old → new. */
  previousAmount: string | null;
  policy: { id: string; versionId: string; version: number; name: string };
  requestedBy: { userId: string; name: string };
  requestedAt: string;
  currentStep: number;
  stepSince: string;
  escalated: boolean;
  expiresAt: string | null;
  steps: ApprovalStepView[];
  /** Names of people who may decide the current step (a few), when pending. */
  waitingFor: string[];
  version: number;
};
