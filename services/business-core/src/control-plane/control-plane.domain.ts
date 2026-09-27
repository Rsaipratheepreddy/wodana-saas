/**
 * Control-plane rules that do not need a database: support-session states, the single domain state,
 * seat position after a downgrade, lifecycle automation (grace → suspend) and which notices a change sends.
 */
import type { TenantLifecycleState } from "../workspaces/tenant-lifecycle.domain";

// ─── Support sessions: requested → approved → active → expired | revoked (or rejected) ───────────────

export const SUPPORT_SESSION_STATES = ["requested", "approved", "active", "rejected", "revoked", "expired"] as const;
export type SupportSessionState = typeof SUPPORT_SESSION_STATES[number];
export type SupportSessionCommand = "approve" | "reject" | "start" | "revoke";
export type SupportEndReason = "operator" | "rejected" | "expired" | "operator_role_changed" | "tenant_archived";

/** The longest time an approved session may stay open once started, and the window to approve and start it. */
export const SUPPORT_SESSION_MAX_MINUTES = 480;
export const SUPPORT_SESSION_MIN_MINUTES = 15;
export const SUPPORT_REQUEST_WINDOW_HOURS = 24;

const OPEN_SUPPORT_STATES: readonly SupportSessionState[] = ["requested", "approved", "active"];

export function isOpenSupportState(state: string): boolean {
  return (OPEN_SUPPORT_STATES as readonly string[]).includes(state);
}

/** Time is part of the state: an open session past its expiry reads as expired even before the sweep writes it. */
export function projectSupportState(input: { status: string; expiresAt: Date | string }, now = new Date()): SupportSessionState {
  const status = input.status as SupportSessionState;
  if (isOpenSupportState(status) && new Date(input.expiresAt).getTime() <= now.getTime()) return "expired";
  return status;
}

export class SupportSessionRuleError extends Error {}

export function planSupportCommand(input: {
  command: SupportSessionCommand;
  status: string;
  expiresAt: Date | string;
  requestedBy: string;
  actorUserId: string;
  actorCanApprove: boolean;
  durationMinutes: number;
  now?: Date;
}): { status: SupportSessionState; startsAt?: Date; expiresAt?: Date; endReason?: SupportEndReason } {
  const now = input.now ?? new Date();
  const state = projectSupportState(input, now);
  if (state === "expired") throw new SupportSessionRuleError("This support session has expired. Request a new one.");
  const requester = input.actorUserId === input.requestedBy;
  switch (input.command) {
    case "approve":
      if (state !== "requested") throw new SupportSessionRuleError("Only a requested session can be approved.");
      if (requester) throw new SupportSessionRuleError("A second operator must approve support access.");
      if (!input.actorCanApprove) throw new SupportSessionRuleError("Your role cannot approve support access.");
      return { status: "approved" };
    case "reject":
      if (state !== "requested" && state !== "approved") {
        throw new SupportSessionRuleError("Only a session that has not started can be rejected.");
      }
      if (requester) throw new SupportSessionRuleError("Revoke your own request instead of rejecting it.");
      if (!input.actorCanApprove) throw new SupportSessionRuleError("Your role cannot reject support access.");
      return { status: "rejected", endReason: "rejected" };
    case "start": {
      if (state !== "approved") throw new SupportSessionRuleError("Only an approved session can be started.");
      if (!requester) throw new SupportSessionRuleError("Only the operator who asked for access can start it.");
      const minutes = clampSupportMinutes(input.durationMinutes);
      return { status: "active", startsAt: now, expiresAt: new Date(now.getTime() + minutes * 60_000) };
    }
    case "revoke":
      if (!isOpenSupportState(state)) throw new SupportSessionRuleError("Only an open session can be revoked.");
      if (!requester && !input.actorCanApprove) throw new SupportSessionRuleError("Your role cannot revoke this session.");
      return { status: "revoked", endReason: "operator" };
  }
}

export function clampSupportMinutes(value: number) {
  if (!Number.isInteger(value) || value < SUPPORT_SESSION_MIN_MINUTES || value > SUPPORT_SESSION_MAX_MINUTES) {
    throw new SupportSessionRuleError(
      `Support access lasts between ${SUPPORT_SESSION_MIN_MINUTES} and ${SUPPORT_SESSION_MAX_MINUTES} minutes.`,
    );
  }
  return value;
}

export type SupportAccessDenial = "no_session" | "not_started" | "expired" | "operator_inactive" | "role_changed";

/**
 * Operators read tenant records only inside their own active, unexpired session, and only while they still
 * hold a role that may ask for support. A session whose operator lost that role is revoked, not kept.
 */
export function supportAccessDecision(input: {
  session: { status: string; expiresAt: Date | string; requestedBy: string } | null;
  operatorUserId: string;
  operatorActive: boolean;
  operatorCanRequestSupport: boolean;
  now?: Date;
}): { allowed: true } | { allowed: false; reason: SupportAccessDenial; revoke: boolean } {
  const now = input.now ?? new Date();
  if (!input.session || input.session.requestedBy !== input.operatorUserId) {
    return { allowed: false, reason: "no_session", revoke: false };
  }
  const state = projectSupportState(input.session, now);
  if (state === "expired") return { allowed: false, reason: "expired", revoke: false };
  if (state !== "active") {
    return { allowed: false, reason: state === "approved" || state === "requested" ? "not_started" : "no_session", revoke: false };
  }
  if (!input.operatorActive) return { allowed: false, reason: "operator_inactive", revoke: true };
  if (!input.operatorCanRequestSupport) return { allowed: false, reason: "role_changed", revoke: true };
  return { allowed: true };
}

// ─── Domains: requested → verifying → verified → certificate_issued → live | failed | removed ─────────

export const DOMAIN_STATES = ["requested", "verifying", "verified", "certificate_issued", "live", "failed", "removed"] as const;
export type DomainState = typeof DOMAIN_STATES[number];

export type DomainFacts = {
  dnsStatus: string;
  checkCount: number;
  certificateStatus: string;
  certificateExpiresAt: Date | null;
  routingStatus: string;
  rollbackStatus: string;
  removedAt: Date | null;
  challengeExpiresAt: Date;
};

export function domainState(facts: DomainFacts, now = new Date()): DomainState {
  if (facts.removedAt) return "removed";
  if (facts.dnsStatus === "failed" || facts.routingStatus === "failed" || facts.certificateStatus === "failed"
    || facts.rollbackStatus === "pending" || facts.rollbackStatus === "failed") return "failed";
  if (facts.certificateStatus === "issued" && facts.certificateExpiresAt && facts.certificateExpiresAt <= now) return "failed";
  if (facts.dnsStatus === "pending" && facts.challengeExpiresAt <= now) return "failed";
  if (facts.routingStatus === "active") return "live";
  if (facts.certificateStatus === "issued") return "certificate_issued";
  if (facts.dnsStatus === "verified") return "verified";
  return facts.checkCount > 0 ? "verifying" : "requested";
}

/** While the custom domain is not live, the tenant signs in at its Wodana address. */
export function signInHost(input: { slug: string; baseDomain: string; domains: Array<{ hostname: string; state: DomainState }> }) {
  const live = input.domains.find((domain) => domain.state === "live");
  return live ? { hostname: live.hostname, fallback: false } : { hostname: `${input.slug}.${input.baseDomain}`, fallback: true };
}

// ─── Seats: checked at invite and accept; a downgrade keeps members and blocks new invites ───────────

export function seatPosition(input: {
  limit: number | null;
  activeMembers: number;
  invitedMembers: number;
  pendingInvitations: number;
}) {
  const members = input.activeMembers + input.invitedMembers;
  const reserved = members + input.pendingInvitations;
  if (input.limit === null) {
    return { limit: null, members, reserved, available: null, overLimit: false, invitesBlocked: false };
  }
  return {
    limit: input.limit,
    members,
    reserved,
    available: Math.max(0, input.limit - reserved),
    overLimit: members > input.limit,
    invitesBlocked: reserved >= input.limit,
  };
}

/** Accepting takes the seat the invitation reserved, unless members alone already fill the limit. */
export function canAcceptIntoSeat(input: { limit: number; activeMembers: number; invitedMembers: number }) {
  return input.activeMembers + input.invitedMembers < input.limit;
}

// ─── Lifecycle automation: payment past due → grace → suspended ───────────────────────────────────────

export const DEFAULT_GRACE_DAYS = 14;

export type LifecycleAutomation =
  | { to: "grace"; graceEndsAt: Date; reasonCode: "payment_past_due" }
  | { to: "suspended"; reasonCode: "grace_ended" };

export function lifecycleAutomation(input: {
  state: TenantLifecycleState;
  graceEndsAt: Date | null;
  paymentPastDue: boolean;
  graceDays: number;
  now?: Date;
}): LifecycleAutomation | null {
  const now = input.now ?? new Date();
  if (input.state === "grace") {
    if (input.graceEndsAt && input.graceEndsAt.getTime() <= now.getTime()) return { to: "suspended", reasonCode: "grace_ended" };
    return null;
  }
  if ((input.state === "active" || input.state === "trial") && input.paymentPastDue) {
    const days = Number.isInteger(input.graceDays) && input.graceDays > 0 ? input.graceDays : DEFAULT_GRACE_DAYS;
    return { to: "grace", graceEndsAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000), reasonCode: "payment_past_due" };
  }
  return null;
}

// ─── Notices: who is told what, per event ─────────────────────────────────────────────────────────────

export const CONTROL_NOTICE_EVENTS = [
  "lifecycle.trial_started",
  "lifecycle.activated",
  "lifecycle.grace_started",
  "lifecycle.suspended",
  "lifecycle.reactivated",
  "lifecycle.archived",
  "billing.past_due",
  "domain.ownership_lost",
  "domain.live",
] as const;
export type ControlNoticeEvent = typeof CONTROL_NOTICE_EVENTS[number];
export type NoticeAudience = "tenant_owner" | "operator";

export const NOTICE_AUDIENCES: Record<ControlNoticeEvent, readonly NoticeAudience[]> = {
  "lifecycle.trial_started": ["tenant_owner"],
  "lifecycle.activated": ["tenant_owner"],
  "lifecycle.grace_started": ["tenant_owner", "operator"],
  "lifecycle.suspended": ["tenant_owner", "operator"],
  "lifecycle.reactivated": ["tenant_owner", "operator"],
  "lifecycle.archived": ["tenant_owner", "operator"],
  "billing.past_due": ["tenant_owner", "operator"],
  "domain.ownership_lost": ["tenant_owner", "operator"],
  "domain.live": ["tenant_owner"],
};

export function lifecycleNoticeEvent(from: TenantLifecycleState, to: TenantLifecycleState): ControlNoticeEvent | null {
  if (to === "trial") return "lifecycle.trial_started";
  if (to === "grace") return "lifecycle.grace_started";
  if (to === "suspended") return "lifecycle.suspended";
  if (to === "archived") return "lifecycle.archived";
  if (to === "active") return from === "suspended" || from === "grace" ? "lifecycle.reactivated" : "lifecycle.activated";
  return null;
}

export type NoticeDeliveryState = "not_required" | "pending" | "sent" | "partial" | "failed" | "not_configured";

/** One state for a change from the delivery of each of its notices; "sent" only with a provider receipt. */
export function noticeDeliveryState(statuses: readonly string[]): NoticeDeliveryState {
  if (!statuses.length) return "not_required";
  if (statuses.every((status) => status === "sent")) return "sent";
  if (statuses.some((status) => status === "pending")) return "pending";
  if (statuses.some((status) => status === "sent")) return "partial";
  if (statuses.every((status) => status === "not_configured")) return "not_configured";
  return "failed";
}

// ─── Accounts list ────────────────────────────────────────────────────────────────────────────────────

const STATE_WEIGHT: Record<TenantLifecycleState, number> = {
  suspended: 6, grace: 5, draft: 4, trial: 3, active: 2, archived: 1,
};

/** An account shows the state that most needs an operator across its organizations. */
export function accountState(states: readonly TenantLifecycleState[]): TenantLifecycleState {
  if (!states.length) return "draft";
  return [...states].sort((left, right) => STATE_WEIGHT[right] - STATE_WEIGHT[left])[0];
}
