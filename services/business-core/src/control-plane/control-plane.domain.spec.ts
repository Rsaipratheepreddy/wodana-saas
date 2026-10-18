import { describe, expect, it } from "vitest";
import {
  accountState,
  canAcceptIntoSeat,
  domainState,
  lifecycleAutomation,
  lifecycleNoticeEvent,
  noticeDeliveryState,
  planSupportCommand,
  projectSupportState,
  seatPosition,
  signInHost,
  supportAccessDecision,
  type DomainFacts,
} from "./control-plane.domain";

const now = new Date("2026-09-27T10:00:00Z");
const later = new Date("2026-09-27T18:00:00Z");
const earlier = new Date("2026-09-27T09:00:00Z");

describe("support sessions", () => {
  const base = { expiresAt: later, requestedBy: "requester", durationMinutes: 60, now };

  it("walks requested → approved → active with a second operator and the requester starting it", () => {
    expect(planSupportCommand({ ...base, command: "approve", status: "requested", actorUserId: "approver", actorCanApprove: true }))
      .toEqual({ status: "approved" });
    const started = planSupportCommand({ ...base, command: "start", status: "approved", actorUserId: "requester", actorCanApprove: false });
    expect(started.status).toBe("active");
    expect(started.expiresAt?.toISOString()).toBe("2026-09-27T11:00:00.000Z");
  });

  it("refuses self-approval, approval without the permission and starting someone else's session", () => {
    expect(() => planSupportCommand({ ...base, command: "approve", status: "requested", actorUserId: "requester", actorCanApprove: true }))
      .toThrow("second operator");
    expect(() => planSupportCommand({ ...base, command: "approve", status: "requested", actorUserId: "observer", actorCanApprove: false }))
      .toThrow("cannot approve");
    expect(() => planSupportCommand({ ...base, command: "start", status: "approved", actorUserId: "approver", actorCanApprove: true }))
      .toThrow("Only the operator who asked");
    expect(() => planSupportCommand({ ...base, command: "start", status: "requested", actorUserId: "requester", actorCanApprove: false }))
      .toThrow("Only an approved session");
  });

  it("treats an open session past its time as expired", () => {
    expect(projectSupportState({ status: "active", expiresAt: earlier }, now)).toBe("expired");
    expect(projectSupportState({ status: "revoked", expiresAt: earlier }, now)).toBe("revoked");
    expect(() => planSupportCommand({ ...base, expiresAt: earlier, command: "start", status: "approved", actorUserId: "requester", actorCanApprove: false }))
      .toThrow("expired");
  });

  it("keeps durations inside the time box", () => {
    expect(() => planSupportCommand({ ...base, durationMinutes: 600, command: "start", status: "approved", actorUserId: "requester", actorCanApprove: false }))
      .toThrow("between 15 and 480");
  });

  it("denies tenant reads without the operator's own active session and revokes when the role is gone", () => {
    const session = { status: "active", expiresAt: later, requestedBy: "requester" };
    expect(supportAccessDecision({ session: null, operatorUserId: "requester", operatorActive: true, operatorCanRequestSupport: true, now }))
      .toEqual({ allowed: false, reason: "no_session", revoke: false });
    expect(supportAccessDecision({ session, operatorUserId: "someone-else", operatorActive: true, operatorCanRequestSupport: true, now }))
      .toMatchObject({ allowed: false, reason: "no_session" });
    expect(supportAccessDecision({ session: { ...session, status: "approved" }, operatorUserId: "requester", operatorActive: true, operatorCanRequestSupport: true, now }))
      .toMatchObject({ allowed: false, reason: "not_started" });
    expect(supportAccessDecision({ session: { ...session, expiresAt: earlier }, operatorUserId: "requester", operatorActive: true, operatorCanRequestSupport: true, now }))
      .toMatchObject({ allowed: false, reason: "expired" });
    expect(supportAccessDecision({ session, operatorUserId: "requester", operatorActive: true, operatorCanRequestSupport: false, now }))
      .toEqual({ allowed: false, reason: "role_changed", revoke: true });
    expect(supportAccessDecision({ session, operatorUserId: "requester", operatorActive: false, operatorCanRequestSupport: true, now }))
      .toEqual({ allowed: false, reason: "operator_inactive", revoke: true });
    expect(supportAccessDecision({ session, operatorUserId: "requester", operatorActive: true, operatorCanRequestSupport: true, now }))
      .toEqual({ allowed: true });
  });
});

describe("domain state", () => {
  const facts: DomainFacts = {
    dnsStatus: "pending", checkCount: 0, certificateStatus: "not_requested", certificateExpiresAt: null,
    routingStatus: "not_requested", rollbackStatus: "none", removedAt: null, challengeExpiresAt: later,
  };

  it("maps the stored facts onto one state", () => {
    expect(domainState(facts, now)).toBe("requested");
    expect(domainState({ ...facts, checkCount: 2 }, now)).toBe("verifying");
    expect(domainState({ ...facts, dnsStatus: "verified", certificateStatus: "manual_setup_required" }, now)).toBe("verified");
    expect(domainState({ ...facts, dnsStatus: "verified", certificateStatus: "issued", certificateExpiresAt: later }, now)).toBe("certificate_issued");
    expect(domainState({ ...facts, dnsStatus: "verified", certificateStatus: "issued", certificateExpiresAt: later, routingStatus: "active" }, now)).toBe("live");
    expect(domainState({ ...facts, dnsStatus: "failed", rollbackStatus: "pending" }, now)).toBe("failed");
    expect(domainState({ ...facts, challengeExpiresAt: earlier }, now)).toBe("failed");
    expect(domainState({ ...facts, removedAt: earlier }, now)).toBe("removed");
  });

  it("falls back to the Wodana address until a domain is live", () => {
    expect(signInHost({ slug: "acme", baseDomain: "wodana.ai", domains: [{ hostname: "portal.acme.test", state: "failed" }] }))
      .toEqual({ hostname: "acme.wodana.ai", fallback: true });
    expect(signInHost({ slug: "acme", baseDomain: "wodana.ai", domains: [{ hostname: "portal.acme.test", state: "live" }] }))
      .toEqual({ hostname: "portal.acme.test", fallback: false });
  });
});

describe("seats", () => {
  it("keeps members after a downgrade and blocks new invites", () => {
    expect(seatPosition({ limit: 3, activeMembers: 5, invitedMembers: 0, pendingInvitations: 1 }))
      .toEqual({ limit: 3, members: 5, reserved: 6, available: 0, overLimit: true, invitesBlocked: true });
    expect(seatPosition({ limit: 10, activeMembers: 5, invitedMembers: 1, pendingInvitations: 1 }))
      .toMatchObject({ available: 3, overLimit: false, invitesBlocked: false });
  });

  it("lets a pending invitation take its reserved seat only while members fit", () => {
    expect(canAcceptIntoSeat({ limit: 5, activeMembers: 4, invitedMembers: 0 })).toBe(true);
    expect(canAcceptIntoSeat({ limit: 3, activeMembers: 3, invitedMembers: 0 })).toBe(false);
  });
});

describe("lifecycle automation", () => {
  it("starts grace when payment is past due and suspends when grace ends", () => {
    const grace = lifecycleAutomation({ state: "active", graceEndsAt: null, paymentPastDue: true, graceDays: 7, now });
    expect(grace).toEqual({ to: "grace", graceEndsAt: new Date("2026-10-04T10:00:00Z"), reasonCode: "payment_past_due" });
    expect(lifecycleAutomation({ state: "grace", graceEndsAt: earlier, paymentPastDue: true, graceDays: 7, now }))
      .toEqual({ to: "suspended", reasonCode: "grace_ended" });
    expect(lifecycleAutomation({ state: "grace", graceEndsAt: later, paymentPastDue: true, graceDays: 7, now })).toBeNull();
    expect(lifecycleAutomation({ state: "suspended", graceEndsAt: null, paymentPastDue: true, graceDays: 7, now })).toBeNull();
    expect(lifecycleAutomation({ state: "active", graceEndsAt: null, paymentPastDue: false, graceDays: 7, now })).toBeNull();
  });
});

describe("notices", () => {
  it("names the event for each change", () => {
    expect(lifecycleNoticeEvent("active", "suspended")).toBe("lifecycle.suspended");
    expect(lifecycleNoticeEvent("suspended", "active")).toBe("lifecycle.reactivated");
    expect(lifecycleNoticeEvent("trial", "active")).toBe("lifecycle.activated");
    expect(lifecycleNoticeEvent("active", "grace")).toBe("lifecycle.grace_started");
  });

  it("reports delivery only from provider receipts", () => {
    expect(noticeDeliveryState([])).toBe("not_required");
    expect(noticeDeliveryState(["sent", "sent"])).toBe("sent");
    expect(noticeDeliveryState(["sent", "pending"])).toBe("pending");
    expect(noticeDeliveryState(["sent", "failed"])).toBe("partial");
    expect(noticeDeliveryState(["not_configured"])).toBe("not_configured");
    expect(noticeDeliveryState(["failed", "not_configured"])).toBe("failed");
  });
});

describe("accounts list", () => {
  it("shows the state that most needs attention", () => {
    expect(accountState(["active", "suspended"])).toBe("suspended");
    expect(accountState(["archived", "active"])).toBe("active");
    expect(accountState([])).toBe("draft");
  });
});
