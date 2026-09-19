export type BillingPlanCode = "starter" | "pro" | "enterprise";
export type BillingStatus = "trial" | "active" | "past_due" | "cancelled";

export type TenantLifecycleState = "draft" | "trial" | "active" | "grace" | "suspended" | "archived";
export type TenantLifecycleOverview = {
  workspaceId: string;
  state: TenantLifecycleState;
  version: number;
  source: "versioned" | "legacy_projection";
  workspaceStatus: "active" | "suspended" | "archived";
  graceEndsAt: string | null;
  graceExpired: boolean;
  nextStates: TenantLifecycleState[];
  readiness: { onboardingStatus: string | null; ownerInvitationStatus: string | null };
  noticeDeliveryState: "not_required" | "not_configured" | "pending" | "sent" | "failed";
  history: Array<{
    id: string;
    version: number;
    state: TenantLifecycleState;
    previousState: TenantLifecycleState;
    graceEndsAt: string | null;
    reason: string;
    noticeRequired: boolean;
    noticeDeliveryState: string;
    createdBy: string;
    createdAt: string;
  }>;
  observedAt: string;
};

export type WorkspaceSubscription = {
  amount: string;
  billingCycle: "monthly" | "yearly" | "custom";
  currency: string;
  note: string | null;
  planCode: BillingPlanCode;
  projectLimit: number;
  renewsAt: string | null;
  seatLimit: number;
  startedAt: string;
  status: BillingStatus;
  updatedAt: string;
  version: number;
};

export type ManagedTenant = {
  account?: {
    displayName: string;
    id: string;
    isDefaultOrganization: boolean;
    organizationCount: number;
    organizationLimit: number;
    contractStatus?: string | null;
    contractPlanCode?: string | null;
    contractPlanVersion?: number | null;
    status: string;
    version: number;
  } | null;
  externalTenantId: string;
  integrations: Array<{ count: number; provider: string; status: string }>;
  onboarding: { completedSteps: string[]; currentStep: string | null; status: string };
  owner: { email: string; name: string } | null;
  ownerInvitation: { acceptedAt: string | null; expiresAt: string; status: string } | null;
  subscription: WorkspaceSubscription;
  usage: { members: number; invitedMembers?: number; pendingInvitations: number; reservedSeats: number; projects: number };
  workspace: {
    createdAt: string;
    defaultCurrency: string;
    defaultLocale: string;
    defaultTimezone: string;
    id: string;
    name: string;
    slug: string;
    status: "active" | "suspended" | "archived";
    updatedAt: string;
    version: number;
  };
};

export type ManagedTenantStatus = {
  account: {
    id: string;
    displayName: string;
    status: string;
    organizationCount: number;
    organizationLimit: number;
    isDefaultOrganization: boolean;
    contractStatus?: string | null;
    contractPlanCode?: string | null;
    contractPlanVersion?: number | null;
  } | null;
  organization: {
    id: string;
    name: string;
    slug: string;
    status: string;
    version: number;
    updatedAt: string;
  };
  owner: { email: string; name: string } | null;
  onboarding: { completedSteps: string[]; currentStep: string | null; status: string };
  ownerInvitation: {
    status: string;
    expiresAt: string;
    acceptedAt: string | null;
    deliveryStatus: "untracked" | "not_requested" | "pending" | "sent" | "not_configured" | "failed";
    deliveryAttempts?: number;
    deliveryAttemptedAt?: string | null;
  } | null;
  seats: {
    limit: number | null;
    activeMembers: number;
    invitedMembers?: number;
    pendingInvitations: number;
    reserved: number;
    available: number | null;
  };
  plan: {
    code: string;
    status: string;
    billingCycle: string;
    currency: string;
    amount: string;
    renewsAt: string | null;
    projectLimit: number;
    version: number;
    updatedAt: string;
  } | null;
  domain: {
    platformSlug: string;
    hostname?: string;
    customDomainStatus: "not_configured" | "requested" | "verified" | "active" | "needs_attention";
    dnsStatus?: "pending" | "verified" | "expired" | "failed";
    certificateStatus?: "not_requested" | "manual_setup_required" | "pending" | "issued" | "expired" | "failed";
    routingStatus?: "not_requested" | "pending" | "active" | "failed";
    rollbackStatus?: "none" | "pending" | "completed" | "failed";
  };
  commercialEntitlements: {
    status: "not_configured" | "scheduled" | "active" | "suspended";
    planCode?: string;
    planVersion?: number;
    modules?: string[];
    version?: number;
    updatedAt?: string;
  };
  observedAt: string;
};

export type ManagedTenantAccess = {
  externalTenantId: string;
  organization: { id: string; name: string; slug: string };
  entitlement: {
    status: "not_configured" | "scheduled" | "active" | "suspended";
    modules: string[];
    planCode?: string;
    planVersion?: number;
    version?: number;
  };
  seats: {
    limit: number | null;
    used: number;
    activeMembers: number;
    invitedMembers: number;
    pendingInvitations: number;
    reserved: number;
    available: number | null;
    policy: string;
  };
  members: Array<{
    id: string;
    userId: string;
    email: string;
    displayName: string;
    status: string;
    joinedAt: string | null;
    access: {
      directRoles: Array<{ id: string; code: string; name: string }>;
      inheritedRoles: Array<{
        teamId: string;
        teamName: string;
        roleId: string;
        roleCode: string;
        roleName: string;
      }>;
      grantedPermissions: string[];
      effectivePermissions: string[];
      effectiveModules: string[];
      recordScope: { kind: "organization"; explanation: string };
      reasons: string[];
    };
  }>;
  invitations: Array<{
    id: string;
    email: string;
    status: string;
    expiresAt: string;
    createdAt: string;
    reservesSeat: boolean;
    directRoles: Array<{ id: string; code: string; name: string }>;
    teams: Array<{ id: string; name: string; roleCodes: string[] }>;
  }>;
  observedAt: string;
};

export type ManagedDomain = {
  id: string;
  hostname: string;
  version: number;
  isUsable?: boolean;
  issues?: string[];
  dns: {
    status: "pending" | "verified" | "expired" | "failed";
    record: { type: "TXT"; name: string; value: string };
    expiresAt: string;
    verifiedAt: string | null;
  };
  certificate: { status: "not_requested" | "manual_setup_required" | "pending" | "issued" | "expired" | "failed"; expiresAt: string | null };
  routing: { status: "not_requested" | "pending" | "active" | "failed"; activatedAt: string | null };
  rollback: { status: "none" | "pending" | "completed" | "failed" };
  removedAt: string | null;
  updatedAt: string;
};

export type WorkspaceBillingData = {
  account: { id: string; displayName: string } | null;
  contract: {
    version: number;
    status: "trial_uncontracted" | "contracted" | "expired";
    planCode: string;
    planVersion: number;
    currency: string;
    billingCycle: "monthly" | "yearly" | "custom";
    recurringAmount: string;
    seatLimit: number;
    projectLimit: number;
    trialEndsAt: string | null;
    termStartsAt: string;
    renewsAt: string | null;
    endsAt: string | null;
    taxValidationState: "unverified";
    effectiveFrom: string;
    effectiveUntil: string | null;
  } | { status: "not_configured"; taxValidationState: "unverified" };
  organizationAllocation: {
    version: number;
    status: "scheduled" | "active" | "suspended" | "ended";
    allocatedAmount: string;
    seatLimit: number;
    projectLimit: number;
    effectiveFrom: string;
    effectiveUntil: string | null;
  } | { status: "not_configured" };
  collection: {
    version: number;
    status: "current" | "grace" | "past_due" | "collections" | "suspended" | "closed";
    overdueAmount: string;
    currency: string;
    effectiveAt: string;
    nextReviewAt: string | null;
  } | { status: "not_configured" };
  accessPolicy: {
    state: "not_configured" | "trial" | "trial_expired" | "current" | "grace" | "past_due"
      | "collections" | "suspended" | "closed";
    effect: "unchanged";
    warning: boolean;
    actionDueAt: string | null;
    affectedModules: [];
    message: string;
  };
  usage: {
    members: number;
    invitedMembers: number;
    pendingInvitations: number;
    reservedSeats: number;
    projects: number;
  };
  accountUsageSnapshot: {
    periodStart: string;
    periodEnd: string;
    capturedAt: string;
    source: "computed" | "provider_import";
    totals: { members: number; pendingInvitations: number; projects: number; knownFileBytes: number; knownFileCount: number };
  } | null;
  documents: Array<{
    id: string;
    documentType: "invoice" | "credit_note" | "receipt";
    documentNumber: string | null;
    status: "draft" | "issued" | "past_due" | "paid" | "applied" | "verified" | "failed" | "void" | "refunded";
    currency: string;
    totalAmount: string;
    balanceAmount: string;
    issuedAt: string | null;
    dueAt: string | null;
    settledAt: string | null;
    taxValidationState: "unverified";
    createdAt: string;
    updatedAt: string;
  }>;
  workspace: { defaultCurrency: string; id: string; name: string; status: string };
  authority: "account_contract";
  taxCompliance: "unverified";
  observedAt: string;
};

export type AccountContractVersion = {
  id: string;
  version: number;
  status: "trial_uncontracted" | "contracted" | "expired";
  planCode: string;
  planVersion: number;
  currency: string;
  billingCycle: "monthly" | "yearly" | "custom";
  recurringAmount: string;
  seatLimit: number;
  projectLimit: number;
  contractReference?: string | null;
  signedAt?: string | null;
  trialEndsAt?: string | null;
  termStartsAt?: string;
  renewsAt?: string | null;
  endsAt?: string | null;
  terms?: Record<string, unknown>;
  legalEntityReference?: string | null;
  taxValidationState?: "unverified";
  effectiveFrom: string;
  effectiveUntil: string | null;
  reason: string;
  createdAt: string;
};

export type OrganizationBillingAllocation = {
  id: string;
  accountContractVersionId: string;
  version: number;
  status: "scheduled" | "active" | "suspended" | "ended";
  allocatedAmount: string;
  seatLimit: number;
  projectLimit: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  reason: string;
  createdAt: string;
};

export type AccountCollectionVersion = {
  id: string;
  version: number;
  status: "current" | "grace" | "past_due" | "collections" | "suspended" | "closed";
  overdueAmount: string;
  currency: string;
  effectiveAt: string;
  nextReviewAt: string | null;
  reason: string;
  createdAt: string;
};

export type AccountBillingDocument = {
  id: string;
  documentType: "invoice" | "credit_note" | "receipt";
  provider: string;
  externalReference: string;
  documentNumber: string | null;
  status: "draft" | "issued" | "past_due" | "paid" | "applied" | "verified" | "failed" | "void" | "refunded";
  currency: string;
  totalAmount: string;
  balanceAmount: string;
  issuedAt: string | null;
  dueAt: string | null;
  settledAt: string | null;
  legalEntityReference: string | null;
  taxValidationState: "unverified";
  metadata: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type AccountUsageSnapshot = {
  id: string;
  periodStart: string;
  periodEnd: string;
  capturedAt: string;
  source: "computed" | "provider_import";
  totals: { members: number; pendingInvitations: number; projects: number; knownFileBytes: number; knownFileCount: number };
  organizationUsage: Array<Record<string, unknown>>;
};

export type TenantBillingOverview = {
  account: { id: string; displayName: string; status: string; isDefaultOrganization: boolean };
  contract: AccountContractVersion | { status: "not_configured"; taxValidationState: "unverified" };
  contractHistory: AccountContractVersion[];
  organizationAllocation: OrganizationBillingAllocation | { status: "not_configured" };
  organizationAllocationHistory: OrganizationBillingAllocation[];
  organizations: Array<{
    workspaceId: string; name: string; slug: string; version: number | null;
    status: string | null; allocatedAmount: string | null; seatLimit: number | null;
    projectLimit: number | null; effectiveFrom: string | null; effectiveUntil: string | null;
  }>;
  collection: AccountCollectionVersion | { status: "not_configured" };
  collectionHistory: AccountCollectionVersion[];
  documents: AccountBillingDocument[];
  documentEvents: Array<{
    id: string; documentId: string; eventType: string; previousStatus: string | null;
    status: string; payload: Record<string, unknown>; occurredAt: string; recordedAt: string;
  }>;
  usageSnapshots: AccountUsageSnapshot[];
  authority: "account_contract";
  taxCompliance: "unverified";
  observedAt: string;
};

export type TenantModuleCode = "workspace" | "crm" | "pre-project" | "projects" | "hrms";

export type EntitlementCatalog = {
  plans: Array<{
    code: string;
    version: number;
    configuration: {
      label?: string;
      modules?: TenantModuleCode[];
      seatLimit?: number;
      projectLimit?: number;
      billingCycle?: string;
      [key: string]: unknown;
    };
    publishedAt: string;
  }>;
  capabilityFlags: Array<{
    code: string;
    module: TenantModuleCode;
    releaseState: "unavailable" | "internal_preview" | "available";
    reason: string;
    version: number;
    updatedAt: string;
  }>;
  observedAt: string;
};

export type TenantOperationsOverview = {
  workspaceId: string;
  externalTenantId: string;
  organization: { id: string; name: string; slug: string; status: string; version: number };
  entitlements: {
    status: "not_configured" | "scheduled" | "active" | "suspended" | "expired";
    planCode?: string;
    planVersion?: number;
    modules?: TenantModuleCode[];
    limits?: Record<string, unknown>;
    soldModules?: TenantModuleCode[];
    soldLimits?: Record<string, unknown>;
    customOverride?: boolean;
    effectiveAt?: string;
    effectiveUntil?: string | null;
    source?: "allocation" | "legacy";
    reason?: string;
    version?: number;
    updatedAt?: string;
  };
  entitlementHistory: Array<{
    version: number;
    status: "active" | "suspended" | "expired";
    modules: TenantModuleCode[];
    limits: Record<string, unknown>;
    effectiveFrom: string;
    effectiveUntil: string | null;
    reason: string;
    createdAt: string;
    planCode: string;
    planVersion: number;
    soldModules: TenantModuleCode[];
    soldLimits: Record<string, unknown>;
    customOverride: boolean;
  }>;
  dataPolicy: {
    status?: "not_configured";
    storageQuotaBytes?: string;
    retentionDays?: number;
    legalHold?: boolean;
    scanRequirement?: "required" | "optional";
    scannerStatus: "not_configured" | "baseline" | "healthy" | "degraded";
    exportBeforeErasure?: boolean;
    version?: number;
    updatedAt?: string;
  };
  usage: {
    members: number;
    pendingInvitations: number;
    projects: number;
    knownFileBytes: number;
    knownFileCount: number;
    storageQuotaBytes: string | null;
    storagePercent: number | null;
    coverage: "managed_objects_and_known_legacy";
  };
  adoption: { windowDays: number; eventCount: number; activeActors: number; lastActivityAt: string | null };
  supportSessions: Array<{
    id: string;
    accessLevel: "read_only" | "limited_write";
    status: "requested" | "active" | "rejected" | "revoked" | "expired";
    reason: string;
    requestedBy: string;
    approvedBy: string | null;
    expiresAt: string;
    version: number;
    canApprove: boolean;
    canRevoke: boolean;
  }>;
  operations: Array<{
    id: string;
    operationType: "clone" | "export" | "erasure";
    phase: "dry_run" | "apply" | "rollback";
    status: "planned" | "blocked" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
    reason: string;
    plan: { blockers?: string[]; executable?: boolean; note?: string };
    result?: {
      exportId?: string;
      sha256?: string;
      byteSize?: number;
      recordCount?: number;
      fileCount?: number;
      expiresInDays?: number;
      [key: string]: unknown;
    } | null;
    targetWorkspaceId?: string | null;
    targetExternalTenantId?: string | null;
    rollbackOf?: string | null;
    version: number;
    canApprove: boolean;
    createdAt: string;
  }>;
  observedAt: string;
};
