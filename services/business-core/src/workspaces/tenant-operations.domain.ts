import { createHash } from "node:crypto";

export const TENANT_MODULES = ["workspace", "crm", "pre-project", "projects", "hrms"] as const;
export type TenantModule = typeof TENANT_MODULES[number];

export type CommercialEntitlementPlan = {
  soldModules: TenantModule[];
  allocationModules: TenantModule[];
  soldLimits: { seatLimit: number; projectLimit: number };
  allocationLimits: Partial<{ seatLimit: number; projectLimit: number }>;
  customOverride: boolean;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
};

export type TenantUsageSnapshot = {
  members: number;
  pendingInvitations: number;
  projects: number;
  knownFileBytes: number;
  knownFileCount: number;
};

export type AccountContractPlan = {
  status: "trial_uncontracted" | "contracted" | "expired";
  planCode: string;
  planVersion: number;
  currency: string;
  billingCycle: "monthly" | "yearly" | "custom";
  recurringAmount: number;
  seatLimit: number;
  projectLimit: number;
  contractReference: string | null;
  signedAt: Date | null;
  trialEndsAt: Date | null;
  termStartsAt: Date;
  renewsAt: Date | null;
  endsAt: Date | null;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  legalEntityReference: string | null;
  taxValidationState: "unverified";
  terms: Record<string, unknown>;
};

export type BillingAllocationPlan = {
  status: "scheduled" | "active" | "suspended" | "ended";
  allocatedAmount: number;
  seatLimit: number;
  projectLimit: number;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
};

export type BillingDocumentType = "invoice" | "credit_note" | "receipt";
export type BillingDocumentStatus =
  | "draft" | "issued" | "past_due" | "paid" | "applied"
  | "verified" | "failed" | "void" | "refunded";

export type BillingAccessPolicy = {
  state: "not_configured" | "trial" | "trial_expired" | "current" | "grace" | "past_due"
    | "collections" | "suspended" | "closed";
  effect: "unchanged";
  warning: boolean;
  actionDueAt: Date | null;
  affectedModules: [];
  message: string;
};

const DOCUMENT_STATUSES: Record<BillingDocumentType, readonly BillingDocumentStatus[]> = {
  invoice: ["draft", "issued", "past_due", "paid", "void", "refunded"],
  credit_note: ["draft", "issued", "applied", "void"],
  receipt: ["verified", "failed", "refunded"],
};

const DOCUMENT_TRANSITIONS: Partial<Record<BillingDocumentStatus, readonly BillingDocumentStatus[]>> = {
  draft: ["issued", "void"],
  issued: ["past_due", "paid", "applied", "void"],
  past_due: ["paid", "void"],
  paid: ["refunded"],
  verified: ["refunded"],
  failed: ["verified"],
};

export function canonicalHash(value: unknown) {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, normalize(child)]));
  };
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

export function normalizeEntitledModules(modules: readonly string[]): TenantModule[] {
  const selected = new Set(modules);
  selected.add("workspace");
  return TENANT_MODULES.filter((module) => selected.has(module));
}

export function effectiveEntitledModules(
  permissionModules: readonly TenantModule[],
  entitlements: { status: string; modules: readonly string[] } | null,
) {
  if (!entitlements) return [...permissionModules];
  if (entitlements.status !== "active") return permissionModules.filter((module) => module === "workspace");
  const sold = new Set(normalizeEntitledModules(entitlements.modules));
  return permissionModules.filter((module) => sold.has(module));
}

export function tenantModuleForPermission(permission: string): TenantModule {
  if (permission.startsWith("crm.")) return "crm";
  if (permission.startsWith("pre_projects.") || permission.startsWith("commercial.") || permission.startsWith("catalog.")) return "pre-project";
  if (permission.startsWith("projects.")) return "projects";
  if (permission.startsWith("hrms.")) return "hrms";
  return "workspace";
}

export function planCommercialEntitlement(input: {
  requestedModules: readonly string[];
  requestedLimits: Record<string, unknown>;
  planConfiguration: Record<string, unknown>;
  contract: { seatLimit: number; projectLimit: number };
  status: "scheduled" | "active" | "suspended";
  effectiveFrom?: string;
  effectiveUntil?: string;
  now?: Date;
}): CommercialEntitlementPlan {
  const now = input.now ?? new Date();
  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : now;
  const effectiveUntil = input.effectiveUntil ? new Date(input.effectiveUntil) : null;
  if (Number.isNaN(effectiveFrom.getTime()) || (effectiveUntil && Number.isNaN(effectiveUntil.getTime()))) {
    throw new Error("Entitlement effective dates are invalid");
  }
  if (effectiveUntil && effectiveUntil <= effectiveFrom) {
    throw new Error("Entitlement end must be after its start");
  }
  if (input.status === "scheduled" && effectiveFrom <= now) {
    throw new Error("A scheduled allocation needs a future effective start");
  }

  const allocationModules = normalizeEntitledModules(input.requestedModules);
  const configuredModules = Array.isArray(input.planConfiguration.modules)
    ? normalizeEntitledModules(input.planConfiguration.modules.filter((value): value is string => typeof value === "string"))
    : null;
  const soldModules = configuredModules ?? allocationModules;
  const sold = new Set(soldModules);
  const outsidePlan = allocationModules.filter((module) => !sold.has(module));
  if (outsidePlan.length) throw new Error(`Modules are not sold by this plan: ${outsidePlan.join(", ")}`);

  const allowedLimitKeys = new Set(["seatLimit", "projectLimit"]);
  const unknownLimits = Object.keys(input.requestedLimits).filter((key) => !allowedLimitKeys.has(key));
  if (unknownLimits.length) throw new Error(`Unsupported entitlement limits: ${unknownLimits.join(", ")}`);
  const allocationLimits: Partial<{ seatLimit: number; projectLimit: number }> = {};
  for (const key of ["seatLimit", "projectLimit"] as const) {
    const value = input.requestedLimits[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${key} must be a positive integer`);
    if (Number(value) > input.contract[key]) throw new Error(`${key} cannot exceed the account contract`);
    allocationLimits[key] = Number(value);
  }
  return {
    soldModules,
    allocationModules,
    soldLimits: { seatLimit: input.contract.seatLimit, projectLimit: input.contract.projectLimit },
    allocationLimits,
    customOverride: configuredModules === null,
    effectiveFrom,
    effectiveUntil,
  };
}

function optionalDate(value: string | undefined | null, field: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} is invalid`);
  return parsed;
}

export function planAccountContract(input: {
  status: AccountContractPlan["status"];
  planCode: string;
  planVersion: number;
  currency: string;
  billingCycle: AccountContractPlan["billingCycle"];
  recurringAmount: number;
  seatLimit: number;
  projectLimit: number;
  contractReference?: string | null;
  signedAt?: string | null;
  trialEndsAt?: string | null;
  termStartsAt: string;
  renewsAt?: string | null;
  endsAt?: string | null;
  effectiveFrom?: string;
  effectiveUntil?: string | null;
  legalEntityReference?: string | null;
  terms?: Record<string, unknown>;
  now?: Date;
}): AccountContractPlan {
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be an ISO-style three-letter code");
  if (!Number.isFinite(input.recurringAmount) || input.recurringAmount < 0) {
    throw new Error("Recurring amount cannot be negative");
  }
  if (!Number.isInteger(input.seatLimit) || input.seatLimit < 1
    || !Number.isInteger(input.projectLimit) || input.projectLimit < 1) {
    throw new Error("Contract limits must be positive integers");
  }
  const now = input.now ?? new Date();
  const signedAt = optionalDate(input.signedAt, "Signed date");
  const trialEndsAt = optionalDate(input.trialEndsAt, "Trial end");
  const termStartsAt = optionalDate(input.termStartsAt, "Term start");
  const renewsAt = optionalDate(input.renewsAt, "Renewal date");
  const endsAt = optionalDate(input.endsAt, "Term end");
  const effectiveFrom = optionalDate(input.effectiveFrom, "Effective start") ?? now;
  const effectiveUntil = optionalDate(input.effectiveUntil, "Effective end");
  if (!termStartsAt) throw new Error("Term start is required");
  if (input.status === "contracted" && !signedAt) throw new Error("A contracted account requires a signed date");
  if (input.status !== "contracted" && signedAt) throw new Error("Only a contracted account can carry a signed date");
  if (endsAt && endsAt <= termStartsAt) throw new Error("Contract term end must be after its start");
  if (renewsAt && renewsAt < termStartsAt) throw new Error("Renewal date cannot be before the contract term");
  if (effectiveUntil && effectiveUntil <= effectiveFrom) throw new Error("Contract effective end must be after its start");
  return {
    status: input.status,
    planCode: input.planCode.trim(),
    planVersion: input.planVersion,
    currency,
    billingCycle: input.billingCycle,
    recurringAmount: input.recurringAmount,
    seatLimit: input.seatLimit,
    projectLimit: input.projectLimit,
    contractReference: input.contractReference?.trim() || null,
    signedAt,
    trialEndsAt,
    termStartsAt,
    renewsAt,
    endsAt,
    effectiveFrom,
    effectiveUntil,
    legalEntityReference: input.legalEntityReference?.trim() || null,
    taxValidationState: "unverified",
    terms: input.terms ?? {},
  };
}

export function planBillingAllocation(input: {
  status: BillingAllocationPlan["status"];
  allocatedAmount: number;
  seatLimit: number;
  projectLimit: number;
  effectiveFrom?: string;
  effectiveUntil?: string | null;
  contract: { recurringAmount: number; seatLimit: number; projectLimit: number };
  allocatedElsewhere: { recurringAmount: number; seatLimit: number; projectLimit: number };
  currentUsage: { seats: number; projects: number };
  now?: Date;
}): BillingAllocationPlan {
  const now = input.now ?? new Date();
  const effectiveFrom = optionalDate(input.effectiveFrom, "Allocation effective start") ?? now;
  const effectiveUntil = optionalDate(input.effectiveUntil, "Allocation effective end");
  if (!Number.isFinite(input.allocatedAmount) || input.allocatedAmount < 0) {
    throw new Error("Allocated amount cannot be negative");
  }
  if (!Number.isInteger(input.seatLimit) || input.seatLimit < 1
    || !Number.isInteger(input.projectLimit) || input.projectLimit < 1) {
    throw new Error("Allocation limits must be positive integers");
  }
  // A seat limit below the seats in use is allowed: members keep their access and new invites are refused
  // until the organization is back under its limit (§6.1 "downgrade below used seats").
  if (input.projectLimit < input.currentUsage.projects) throw new Error("Project allocation is below current usage");
  if (input.status === "scheduled" && effectiveFrom <= now) throw new Error("A scheduled allocation needs a future start");
  if (effectiveUntil && effectiveUntil <= effectiveFrom) throw new Error("Allocation end must be after its start");
  if (input.status !== "ended") {
    if (input.allocatedElsewhere.recurringAmount + input.allocatedAmount > input.contract.recurringAmount) {
      throw new Error("Organization amounts exceed the account contract");
    }
    if (input.allocatedElsewhere.seatLimit + input.seatLimit > input.contract.seatLimit) {
      throw new Error("Organization seats exceed the account contract");
    }
    if (input.allocatedElsewhere.projectLimit + input.projectLimit > input.contract.projectLimit) {
      throw new Error("Organization projects exceed the account contract");
    }
  }
  return { status: input.status, allocatedAmount: input.allocatedAmount, seatLimit: input.seatLimit,
    projectLimit: input.projectLimit, effectiveFrom, effectiveUntil };
}

export function validateBillingDocumentEvent(input: {
  documentType: BillingDocumentType;
  previousStatus?: BillingDocumentStatus | null;
  status: BillingDocumentStatus;
  eventType: "created" | "provider_notification" | "finance_verified" | "corrected";
  totalAmount: number;
  balanceAmount: number;
  currency: string;
}) {
  if (!DOCUMENT_STATUSES[input.documentType].includes(input.status)) {
    throw new Error(`${input.status} is not valid for a ${input.documentType}`);
  }
  if (!input.previousStatus && input.status === "refunded") {
    throw new Error("A refund requires an existing paid or verified billing document");
  }
  if (input.previousStatus && input.previousStatus !== input.status
    && !DOCUMENT_TRANSITIONS[input.previousStatus]?.includes(input.status)) {
    throw new Error(`Cannot move a billing document from ${input.previousStatus} to ${input.status}`);
  }
  if (input.documentType === "receipt" && input.status === "verified" && input.eventType !== "finance_verified") {
    throw new Error("A verified receipt requires an explicit finance verification event");
  }
  if (!Number.isFinite(input.totalAmount) || input.totalAmount < 0
    || !Number.isFinite(input.balanceAmount) || input.balanceAmount < 0
    || input.balanceAmount > input.totalAmount) {
    throw new Error("Billing document amounts are invalid");
  }
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be an ISO-style three-letter code");
  return { ...input, currency, taxValidationState: "unverified" as const };
}

export function validateCollectionState(input: {
  status: "current" | "grace" | "past_due" | "collections" | "suspended" | "closed";
  overdueAmount: number;
  currency: string;
  effectiveAt?: string;
  nextReviewAt?: string | null;
  now?: Date;
}) {
  if (!Number.isFinite(input.overdueAmount) || input.overdueAmount < 0) throw new Error("Overdue amount cannot be negative");
  if (input.status === "current" && input.overdueAmount !== 0) throw new Error("A current account cannot have an overdue amount");
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be an ISO-style three-letter code");
  const effectiveAt = optionalDate(input.effectiveAt, "Collection effective date") ?? input.now ?? new Date();
  const nextReviewAt = optionalDate(input.nextReviewAt, "Collection review date");
  if (nextReviewAt && nextReviewAt <= effectiveAt) throw new Error("Collection review must be after its effective date");
  return { status: input.status, overdueAmount: input.overdueAmount, currency, effectiveAt, nextReviewAt };
}

/**
 * Billing truth is visible to the tenant, but it is not an authorization shortcut.
 * A separate, audited organization lifecycle command is required to restrict access.
 */
export function deriveBillingAccessPolicy(input: {
  contractStatus?: AccountContractPlan["status"] | null;
  trialEndsAt?: Date | string | null;
  collectionStatus?: "current" | "grace" | "past_due" | "collections" | "suspended" | "closed" | null;
  nextReviewAt?: Date | string | null;
  now?: Date;
}): BillingAccessPolicy {
  const now = input.now ?? new Date();
  const trialEndsAt = input.trialEndsAt ? new Date(input.trialEndsAt) : null;
  const nextReviewAt = input.nextReviewAt ? new Date(input.nextReviewAt) : null;
  const collectionState = input.collectionStatus;

  if (collectionState && collectionState !== "current") {
    const messages: Record<Exclude<NonNullable<typeof collectionState>, "current">, string> = {
      grace: "The account is in a dated payment grace period. Workspace access and purchased modules remain unchanged.",
      past_due: "Payment is past due. Workspace access and purchased modules remain unchanged while finance follows up.",
      collections: "The account is in collections review. Workspace access remains unchanged until a separate lifecycle decision is approved.",
      suspended: "Billing is suspended, but billing state alone does not lock the workspace. A separate audited lifecycle action is required.",
      closed: "Billing is closed, but retained workspace data is not hidden or erased by this billing state.",
    };
    return {
      state: collectionState,
      effect: "unchanged",
      warning: true,
      actionDueAt: nextReviewAt,
      affectedModules: [],
      message: messages[collectionState],
    };
  }

  if (input.contractStatus === "trial_uncontracted") {
    const expired = Boolean(trialEndsAt && trialEndsAt.getTime() <= now.getTime());
    return {
      state: expired ? "trial_expired" : "trial",
      effect: "unchanged",
      warning: expired,
      actionDueAt: trialEndsAt,
      affectedModules: [],
      message: expired
        ? "The recorded trial has ended. Access remains unchanged until Wodana completes a separate lifecycle review."
        : "Trial access uses the organization’s purchased module allocation and remains available through the recorded trial date.",
    };
  }

  if (!input.contractStatus && !collectionState) {
    return {
      state: "not_configured",
      effect: "unchanged",
      warning: false,
      actionDueAt: null,
      affectedModules: [],
      message: "Billing is not configured. Existing workspace access is unchanged.",
    };
  }

  return {
    state: "current",
    effect: "unchanged",
    warning: false,
    actionDueAt: nextReviewAt,
    affectedModules: [],
    message: "Billing is current. Access continues to follow the organization’s entitlements and member permissions.",
  };
}

export function operationPlan(input: {
  type: "clone" | "export" | "erasure";
  source: TenantUsageSnapshot;
  target?: TenantUsageSnapshot;
  legalHold: boolean;
  exportBeforeErasure: boolean;
  hasCompletedExport: boolean;
}) {
  const blockers: string[] = [];
  if (input.type === "clone") {
    if (!input.target) blockers.push("Choose a target organization.");
    else if (input.target.projects > 0 || input.target.members > 1 || input.target.knownFileCount > 0) {
      blockers.push("The target must be an empty test organization before configuration can be cloned.");
    }
  }
  if (input.type === "erasure") {
    if (input.legalHold) blockers.push("A legal hold prevents erasure.");
    if (input.exportBeforeErasure && !input.hasCompletedExport) {
      blockers.push("Complete and verify a tenant export before requesting erasure.");
    }
  }
  return {
    scope: input.type === "clone"
      ? ["region_and_firm_kit", "terminology", "workflow_templates", "entitlements", "data_policy"]
      : input.type === "export"
        ? ["account_and_members", "crm", "pre_execution", "commercial", "projects", "hrms", "files", "audit"]
        : ["tenant_records", "stored_files", "search_indexes", "provider_references"],
    sourceUsage: input.source,
    targetUsage: input.target ?? null,
    blockers,
    executable: blockers.length === 0,
    note: input.type === "clone"
      ? "Dry-run only. Personal, financial and operational records are never copied by this configuration-clone plan."
      : input.type === "export"
        ? "Dry-run only. The export worker must produce a checksum and object manifest before completion."
        : "Dry-run only. Erasure requires separate approval, a verified export when required and no legal hold.",
  };
}
