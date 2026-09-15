import { describe, expect, it } from "vitest";
import { transitionEngagement, type EngagementLifecycleState } from "./engagement-lifecycle";

const now = new Date("2026-09-15T10:00:00.000Z");
const active = (overrides: Partial<EngagementLifecycleState> = {}): EngagementLifecycleState => ({
  status: "active",
  phase: "discover",
  activatedAt: "2026-09-14T10:00:00.000Z",
  holdReason: null,
  heldAt: null,
  heldBy: null,
  cancellationReason: null,
  cancelledAt: null,
  cancelledBy: null,
  ...overrides,
});

describe("engagement lifecycle", () => {
  it("places an active engagement on hold without losing its phase", () => {
    const result = transitionEngagement(active({ phase: "design" }), "hold", { reason: "Client travelling" }, "user-1", now);
    expect(result).toMatchObject({ status: "on_hold", phase: "design", holdReason: "Client travelling", heldBy: "user-1", heldAt: now.toISOString(), event: "engagement_held" });
  });

  it("resumes the same phase and clears the current hold overlay", () => {
    const result = transitionEngagement(active({ status: "on_hold", phase: "price", holdReason: "Awaiting direction", heldAt: "2026-09-14T12:00:00.000Z", heldBy: "user-2" }), "resume", { reason: "Direction received" }, "user-1", now);
    expect(result).toMatchObject({ status: "active", phase: "price", holdReason: null, heldAt: null, heldBy: null, event: "engagement_resumed" });
  });

  it("requires evidence for hold, cancellation and reopening", () => {
    expect(() => transitionEngagement(active(), "hold", {}, "user-1", now)).toThrow("Explain why");
    expect(() => transitionEngagement(active(), "cancel", {}, "user-1", now)).toThrow("Explain why");
    expect(() => transitionEngagement(active({ status: "cancelled", cancellationReason: "No budget", cancelledAt: now, cancelledBy: "user-2" }), "reopen", {}, "user-1", now)).toThrow("Explain why");
  });

  it("cancels an on-hold engagement and closes the hold overlay", () => {
    const result = transitionEngagement(active({ status: "on_hold", holdReason: "Paused", heldAt: now, heldBy: "user-2" }), "cancel", { reason: "Client withdrew" }, "user-1", now);
    expect(result).toMatchObject({ status: "cancelled", holdReason: null, heldAt: null, heldBy: null, cancellationReason: "Client withdrew", cancelledBy: "user-1", event: "engagement_cancelled" });
  });

  it("reopens a cancelled engagement without erasing its original activation date", () => {
    const result = transitionEngagement(active({ status: "cancelled", phase: "define", cancellationReason: "Paused indefinitely", cancelledAt: "2026-09-14T12:00:00.000Z", cancelledBy: "user-2" }), "reopen", { reason: "Client restarted" }, "user-1", now);
    expect(result).toMatchObject({ status: "active", phase: "define", activatedAt: "2026-09-14T10:00:00.000Z", cancellationReason: null, cancelledAt: null, cancelledBy: null, reason: "Client restarted", event: "engagement_reopened" });
  });

  it("activates only a draft engagement", () => {
    const draft = active({ status: "draft", activatedAt: null });
    expect(transitionEngagement(draft, "activate", {}, "user-1", now)).toMatchObject({ status: "active", activatedAt: now.toISOString() });
    expect(() => transitionEngagement(active(), "activate", {}, "user-1", now)).toThrow("Only a draft");
  });

  it("allows the normal next phase without a reason", () => {
    expect(transitionEngagement(active(), "set_phase", { phase: "define" }, "user-1", now)).toMatchObject({ phase: "define", reason: null });
  });

  it("requires a reason to skip forward or move backward", () => {
    expect(() => transitionEngagement(active(), "set_phase", { phase: "design" }, "user-1", now)).toThrow("Explain a backwards or skipped phase change");
    expect(() => transitionEngagement(active({ phase: "design" }), "set_phase", { phase: "define" }, "user-1", now)).toThrow("Explain a backwards or skipped phase change");
    expect(transitionEngagement(active({ phase: "design" }), "set_phase", { phase: "define", reason: "Brief changed" }, "user-1", now)).toMatchObject({ phase: "define", reason: "Brief changed" });
  });

  it("does not change phase while held or after cancellation", () => {
    expect(() => transitionEngagement(active({ status: "on_hold", holdReason: "Paused", heldAt: now, heldBy: "user-2" }), "set_phase", { phase: "define" }, "user-1", now)).toThrow("Resume or activate");
    expect(() => transitionEngagement(active({ status: "cancelled", cancellationReason: "Stopped", cancelledAt: now, cancelledBy: "user-2" }), "set_phase", { phase: "define" }, "user-1", now)).toThrow("Resume or activate");
  });

  it("keeps released engagements terminal", () => {
    const released = active({ status: "released", phase: "release" });
    for (const action of ["hold", "cancel", "reopen", "set_phase"] as const) {
      expect(() => transitionEngagement(released, action, { phase: "agree", reason: "Attempt" }, "user-1", now)).toThrow("final");
    }
  });

  it("rejects ambiguous transition payloads", () => {
    expect(() => transitionEngagement(active(), "hold", { phase: "define", reason: "Waiting" }, "user-1", now)).toThrow("phase can only be supplied");
  });
});
