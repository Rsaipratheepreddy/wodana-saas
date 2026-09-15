import { BadRequestException, ConflictException } from "@nestjs/common";

export const engagementPhases = ["discover", "define", "design", "price", "agree", "release"] as const;
export const engagementStatuses = ["draft", "active", "on_hold", "released", "cancelled"] as const;
export const engagementTransitionActions = ["activate", "hold", "resume", "cancel", "reopen", "set_phase"] as const;

export type EngagementPhase = typeof engagementPhases[number];
export type EngagementStatus = typeof engagementStatuses[number];
export type EngagementTransitionAction = typeof engagementTransitionActions[number];

export type EngagementLifecycleState = {
  status: EngagementStatus;
  phase: EngagementPhase;
  activatedAt: string | Date | null;
  holdReason: string | null;
  heldAt: string | Date | null;
  heldBy: string | null;
  cancellationReason: string | null;
  cancelledAt: string | Date | null;
  cancelledBy: string | null;
};

export type EngagementLifecyclePatch = EngagementLifecycleState & {
  event: string;
  reason: string | null;
};

const requiredReason = (reason: string | undefined, message: string) => {
  const value = reason?.trim() ?? "";
  if (!value) throw new BadRequestException(message);
  return value;
};

export function transitionEngagement(
  current: EngagementLifecycleState,
  action: EngagementTransitionAction,
  options: { phase?: EngagementPhase; reason?: string },
  actorUserId: string,
  now = new Date(),
): EngagementLifecyclePatch {
  if (current.status === "released") {
    throw new ConflictException("A released pre-execution is final and cannot change lifecycle.");
  }
  if (action !== "set_phase" && options.phase !== undefined) {
    throw new BadRequestException("A phase can only be supplied for a phase-change command.");
  }

  const at = now.toISOString();
  const next: EngagementLifecyclePatch = {
    ...current,
    event: "",
    reason: options.reason?.trim() || null,
  };

  if (action === "activate") {
    if (current.status !== "draft") throw new ConflictException("Only a draft pre-execution can be activated.");
    next.status = "active";
    next.activatedAt = current.activatedAt ?? at;
    next.event = "engagement_activated";
  } else if (action === "hold") {
    if (current.status !== "active") throw new ConflictException("Only an active pre-execution can be placed on hold.");
    next.status = "on_hold";
    next.holdReason = requiredReason(options.reason, "Explain why this pre-execution is being placed on hold.");
    next.heldAt = at;
    next.heldBy = actorUserId;
    next.event = "engagement_held";
  } else if (action === "resume") {
    if (current.status !== "on_hold") throw new ConflictException("Only an on-hold pre-execution can be resumed.");
    next.status = "active";
    next.holdReason = null;
    next.heldAt = null;
    next.heldBy = null;
    next.event = "engagement_resumed";
  } else if (action === "cancel") {
    if (!["draft", "active", "on_hold"].includes(current.status)) {
      throw new ConflictException("This pre-execution cannot be cancelled from its current state.");
    }
    next.status = "cancelled";
    next.holdReason = null;
    next.heldAt = null;
    next.heldBy = null;
    next.cancellationReason = requiredReason(options.reason, "Explain why this pre-execution is being cancelled.");
    next.cancelledAt = at;
    next.cancelledBy = actorUserId;
    next.event = "engagement_cancelled";
  } else if (action === "reopen") {
    if (current.status !== "cancelled") throw new ConflictException("Only a cancelled pre-execution can be reopened.");
    next.status = "active";
    next.activatedAt = current.activatedAt ?? at;
    next.cancellationReason = null;
    next.cancelledAt = null;
    next.cancelledBy = null;
    next.reason = requiredReason(options.reason, "Explain why this pre-execution is being reopened.");
    next.event = "engagement_reopened";
  } else {
    if (current.status !== "active") throw new ConflictException("Resume or activate this pre-execution before changing its phase.");
    if (!options.phase) throw new BadRequestException("Choose the phase to move this pre-execution into.");
    if (options.phase === current.phase) throw new ConflictException("This pre-execution is already in that phase.");
    const from = engagementPhases.indexOf(current.phase);
    const to = engagementPhases.indexOf(options.phase);
    if (to < from || to > from + 1) {
      next.reason = requiredReason(options.reason, "Explain a backwards or skipped phase change.");
    }
    next.phase = options.phase;
    next.event = "engagement_phase_changed";
  }

  return next;
}
