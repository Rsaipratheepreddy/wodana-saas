export const TENANT_LIFECYCLE_STATES = ["draft", "trial", "active", "grace", "suspended", "archived"] as const;
export type TenantLifecycleState = typeof TENANT_LIFECYCLE_STATES[number];

const transitions: Record<TenantLifecycleState, readonly TenantLifecycleState[]> = {
  draft: ["trial", "active", "archived"],
  trial: ["active", "grace", "suspended", "archived"],
  active: ["grace", "suspended", "archived"],
  grace: ["active", "suspended", "archived"],
  suspended: ["trial", "active", "grace", "archived"],
  archived: [],
};

export function tenantLifecycleBaseline(input: {
  workspaceStatus: string;
  onboardingStatus?: string | null;
  subscriptionStatus?: string | null;
}): TenantLifecycleState {
  if (input.workspaceStatus === "archived") return "archived";
  if (input.workspaceStatus === "suspended") return "suspended";
  if (input.subscriptionStatus === "trial") return "trial";
  if (input.onboardingStatus && input.onboardingStatus !== "completed") return "draft";
  return "active";
}

export function tenantLifecycleOptions(state: TenantLifecycleState) {
  return [...transitions[state]];
}

export function planTenantLifecycleTransition(input: {
  from: TenantLifecycleState;
  to: TenantLifecycleState;
  now: Date;
  graceEndsAt?: Date | null;
}) {
  if (!transitions[input.from].includes(input.to)) {
    throw new Error(`Cannot move organization from ${input.from} to ${input.to}.`);
  }
  if (input.to === "grace" && (!input.graceEndsAt || !Number.isFinite(input.graceEndsAt.getTime())
    || input.graceEndsAt.getTime() <= input.now.getTime())) {
    throw new Error("A grace period needs a future end date.");
  }
  if (input.to !== "grace" && input.graceEndsAt) {
    throw new Error("Grace end date is only valid for a grace transition.");
  }
  return {
    workspaceStatus: input.to === "suspended" ? "suspended" as const
      : input.to === "archived" ? "archived" as const : "active" as const,
    noticeRequired: input.to !== "draft",
    noticeDeliveryState: input.to === "draft" ? "not_required" as const : "not_configured" as const,
  };
}
