import type { CreditOverview, CreditState } from "@/lib/workspace/ai-credits";
import type { TenantBillingOverview, TenantModuleCode, TenantOperationsOverview } from "./types";

export type LifecycleState = "draft" | "trial" | "active" | "grace" | "suspended" | "archived";
export const LIFECYCLE_STATES: LifecycleState[] = ["draft", "trial", "active", "grace", "suspended", "archived"];

export type AttentionReason = "payment_past_due" | "grace" | "suspended" | "domain" | "support_open" | "owner_invitation" | "over_seats";

export type SeatPosition = {
  limit: number | null;
  members: number;
  reserved: number;
  available: number | null;
  overLimit: boolean;
  invitesBlocked: boolean;
};

export type AccountOrganization = {
  workspaceId: string;
  key: string;
  externalTenantId: string | null;
  name: string;
  slug: string;
  address: string;
  isDefault: boolean;
  state: LifecycleState;
  lifecycleVersion: number;
  graceEndsAt: string | null;
  onboardingStatus: string | null;
  plan: { code: string; version: number | null } | null;
  contract: { status: "trial_uncontracted" | "contracted" | "expired"; trialEndsAt: string | null } | null;
  seats: SeatPosition;
  owner: { email: string | null; invitationStatus: string | null; deliveryStatus: string | null };
  lastActivityAt: string | null;
  createdAt: string;
  attention: AttentionReason[];
};

export type AccountSummary = {
  id: string;
  name: string;
  status: string;
  externalCustomerId: string | null;
  contactEmail: string | null;
  organizationLimit: number;
  state: LifecycleState;
  plan: { code: string; version: number | null } | null;
  seats: { members: number; limit: number | null };
  lastActivityAt: string | null;
  attention: AttentionReason[];
  createdAt: string;
  organizations: AccountOrganization[];
};

export type AccountList = { accounts: AccountSummary[]; total: number; counts: Partial<Record<LifecycleState, number>> };

export type NoticeStatus = "pending" | "sent" | "failed" | "not_configured" | "skipped";
export type ControlNotice = {
  id: string;
  eventType: string;
  sourceType: string;
  sourceId: string;
  audience: "tenant_owner" | "operator";
  channel: "in_app" | "email";
  recipient: string;
  subject: string;
  status: NoticeStatus;
  attempts: number;
  lastAttemptedAt: string | null;
  createdAt: string;
};

export type NoticeDeliveryState = "not_required" | "pending" | "sent" | "partial" | "failed" | "not_configured";

export type LifecycleOverview = {
  workspaceId: string;
  externalTenantId: string;
  state: LifecycleState;
  version: number;
  workspaceStatus: string;
  graceEndsAt: string | null;
  nextStates: LifecycleState[];
  readiness: {
    onboardingStatus: string | null;
    ownerInvitationStatus: string | null;
    retentionPolicySet: boolean;
    legalHold: boolean;
    exportReady: boolean;
    exportExpiresAt: string | null;
    entitlementStatus: string;
  };
  history: Array<{
    id: string; version: number; state: LifecycleState; previousState: LifecycleState; graceEndsAt: string | null;
    reason: string; automated: boolean; createdByName: string | null; createdAt: string; noticeDeliveryState: NoticeDeliveryState;
  }>;
  notices: ControlNotice[];
};

export type SeatsView = {
  workspaceId: string;
  version: number;
  position: SeatPosition;
  activeMembers: number;
  invitedMembers: number;
  pendingInvitations: number;
  contractSeatLimit: number | null;
  history: Array<{ id: string; from: number | null; to: number | null; reason: string | null; createdAt: string; createdByName: string | null }>;
};

export type SupportState = "requested" | "approved" | "active" | "rejected" | "revoked" | "expired";
export type SupportSession = {
  id: string;
  status: SupportState;
  reason: string;
  durationMinutes: number;
  requestedBy: string;
  requestedByName: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  requestedAt: string;
  approvedAt: string | null;
  startsAt: string | null;
  expiresAt: string;
  endedAt: string | null;
  endReason: string | null;
  version: number;
  canApprove: boolean;
  canReject: boolean;
  canStart: boolean;
  canRevoke: boolean;
};

export type SupportMembers = {
  members: Array<{ id: string; displayName: string; email: string; status: string; joinedAt: string | null; roles: string[] }>;
  session: { id: string; expiresAt: string };
};

export type SupportActivity = {
  events: Array<{ id: string; action: string; entityType: string; source: string; actorName: string | null; occurredAt: string }>;
  session: { id: string; expiresAt: string };
};

export type DomainState = "requested" | "verifying" | "verified" | "certificate_issued" | "live" | "failed" | "removed";
export type ConsoleDomain = {
  id: string;
  hostname: string;
  version: number;
  state: DomainState;
  isUsable: boolean;
  issues: string[];
  dns: { status: string; record: { type: "TXT"; name: string; value: string }; expiresAt: string; verifiedAt: string | null };
  certificate: { status: string; expiresAt: string | null };
  routing: { status: string; activatedAt: string | null };
  rollback: { status: string };
  lastCheckedAt: string | null;
  checkCount: number;
  ownershipLostAt: string | null;
};
export type DomainList = { platformHostname: string; signIn: { hostname: string; fallback: boolean }; domains: ConsoleDomain[] };

export type ActivityEvent = {
  id: string;
  action: string;
  actorName: string | null;
  actorEmail: string | null;
  workspaceId: string;
  organizationName: string | null;
  createdAt: string;
  reason: string | null;
};

export type SlugAvailability = { slug: string; available: boolean; suggestion: string | null; address: string };

export type { TenantBillingOverview, TenantModuleCode, TenantOperationsOverview };

/** AI credits across organizations (credits are decimal strings; 1 credit = US$0.001 of model use). */
export type AiCreditsOrganization = {
  workspaceId: string;
  accountId: string | null;
  key: string;
  name: string;
  slug: string;
  aiEnabled: boolean;
  hasAccount: boolean;
  balance: string;
  state: CreditState;
  usedThisMonth: string;
  usedToday: string;
  lastTopUp: { credits: string | null; at: string } | null;
};
export type AiCreditsList = {
  organizations: AiCreditsOrganization[];
  platform: { usedToday: string; dailyLimit: string; reached: boolean; workspaceDailyLimit: string; welcomeCredits: string; provider: string | null; model: string | null };
};
export type AiModelRate = {
  model: string;
  provider: string;
  label: string;
  listInput: string;
  listOutput: string;
  margin: string;
  inputPerMillion: string;
  outputPerMillion: string;
  priceConfirmed: boolean;
  active: boolean;
  version: number;
  updatedAt: string;
};
export type AiModelRates = { rates: AiModelRate[]; inUse: { provider: string; model: string } | null };
export type { CreditOverview };

export class ConsoleRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, init?: RequestInit & { idempotencyKey?: string }): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("content-type", "application/json");
  if (init?.idempotencyKey) headers.set("idempotency-key", init.idempotencyKey);
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const data = await response.json().catch(() => null) as (T & { message?: string }) | null;
  if (!response.ok) throw new ConsoleRequestError(typeof data?.message === "string" ? data.message : "", response.status);
  return data as T;
}

const post = <T>(path: string, body: unknown, idempotencyKey?: string) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body), idempotencyKey });
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) });

const organization = (key: string) => `/api/internal/organizations/${encodeURIComponent(key)}`;
const tenant = (key: string) => `/api/internal/tenants/${encodeURIComponent(key)}`;

/** The operator console's calls, all through the same-origin internal routes (which add the operator session). */
export const consoleApi = {
  accounts: () => request<AccountList>("/api/internal/accounts"),
  account: (accountId: string) => request<AccountSummary>(`/api/internal/accounts/${accountId}`),
  activity: (accountId: string) => request<{ events: ActivityEvent[] }>(`/api/internal/accounts/${accountId}/activity`),
  slug: (slug: string) => request<SlugAvailability>(`/api/internal/provisioning/slug?slug=${encodeURIComponent(slug)}`),

  lifecycle: (key: string) => request<LifecycleOverview>(`${organization(key)}/lifecycle`),
  transition: (key: string, body: { expectedVersion: number; to: LifecycleState; reason: string; graceEndsAt?: string }, idempotencyKey: string) =>
    post<{ state: LifecycleState }>(`${organization(key)}/lifecycle/transitions`, body, idempotencyKey),

  seats: (key: string) => request<SeatsView>(`${organization(key)}/seats`),
  changeSeats: (key: string, body: { expectedVersion: number; seatLimit: number; reason: string }) =>
    patch<SeatsView>(`${organization(key)}/seats`, body),

  supportSessions: (key: string) => request<{ sessions: SupportSession[] }>(`${organization(key)}/support-sessions`),
  requestSupport: (key: string, body: { reason: string; durationMinutes: number }, idempotencyKey: string) =>
    post<SupportSession>(`${organization(key)}/support-sessions`, body, idempotencyKey),
  supportCommand: (key: string, sessionId: string, command: "approve" | "reject" | "start" | "revoke", body: { expectedVersion: number; note?: string }) =>
    post<SupportSession>(`${organization(key)}/support-sessions/${sessionId}/${command}`, body),
  supportMembers: (key: string) => request<SupportMembers>(`${organization(key)}/support/members`),
  supportActivity: (key: string) => request<SupportActivity>(`${organization(key)}/support/activity`),

  domains: (key: string) => request<DomainList>(`${tenant(key)}/domains`),
  requestDomain: (key: string, hostname: string, idempotencyKey: string) =>
    post<ConsoleDomain>(`${tenant(key)}/domains`, { hostname }, idempotencyKey),
  domainAction: (key: string, domainId: string, action: "verify" | "recheck" | "rotate-challenge" | "remove", expectedVersion: number) =>
    post<ConsoleDomain>(`${tenant(key)}/domains/${domainId}/${action}`, { expectedVersion }),
  domainStep: (key: string, domainId: string, step: "certificate" | "activate" | "rollback-complete", body: { expectedVersion: number; expiresAt?: string }) =>
    post<ConsoleDomain>(`${organization(key)}/domains/${domainId}/${step}`, body),

  operations: (key: string) => request<TenantOperationsOverview>(`${tenant(key)}/operations`),
  entitlementCatalog: () => request<{ plans: Array<{ code: string; version: number; configuration: { label?: string; modules?: TenantModuleCode[] } }> }>("/api/internal/entitlements/catalog"),
  updateEntitlements: (key: string, body: { expectedVersion: number; planCode: string; planVersion: number; status: "active";
    modules: TenantModuleCode[]; limits: Record<string, number>; reason: string }) => patch<unknown>(`${tenant(key)}/operations/entitlements`, body),
  planExport: (key: string, reason: string, idempotencyKey: string) =>
    post<unknown>(`${tenant(key)}/operations/plans`, { operationType: "export", reason }, idempotencyKey),
  decideOperation: (key: string, operationId: string, body: { expectedVersion: number; decision: "approve" | "cancel"; reason: string }) =>
    post<unknown>(`${tenant(key)}/operations/${operationId}/decision`, body),
  exportUrl: (key: string, exportId: string) => `${tenant(key)}/operations/exports/${exportId}`,

  billing: (key: string) => request<TenantBillingOverview>(`${tenant(key)}/operations/billing`),

  aiCredits: () => request<AiCreditsList>("/api/internal/ai-credits"),
  aiRates: () => request<AiModelRates>("/api/internal/ai-credits/rates"),
  setAiRate: (model: string, body: { expectedVersion: number; listInput: string; listOutput: string; margin: string; priceConfirmed: boolean; active: boolean }) =>
    patch<AiModelRate>(`/api/internal/ai-credits/rates/${encodeURIComponent(model)}`, body),
  organizationAiCredits: (key: string) => request<CreditOverview>(`${organization(key)}/ai-credits`),
  topUpAiCredits: (key: string, body: { credits: string; reference: string; note?: string }, idempotencyKey: string) =>
    post<CreditOverview>(`${organization(key)}/ai-credits/top-ups`, body, idempotencyKey),
  adjustAiCredits: (key: string, body: { kind: "adjustment" | "refund"; credits: string; reference: string; note?: string }, idempotencyKey: string) =>
    post<CreditOverview>(`${organization(key)}/ai-credits/adjustments`, body, idempotencyKey),
  setAiCreditThreshold: (key: string, body: { expectedVersion: number; threshold: string | null }) =>
    patch<CreditOverview>(`${organization(key)}/ai-credits/threshold`, body),
  sendOwnerInvitation: (key: string, idempotencyKey: string) =>
    request<{ deliveryStatus: string; invitationToken: string | null; status: string; expiresAt: string }>(
      `${tenant(key)}/owner-invitation/send`, { method: "POST", idempotencyKey }),
};
