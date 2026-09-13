export type BillingPlanCode = "starter" | "pro" | "enterprise";
export type BillingStatus = "trial" | "active" | "past_due" | "cancelled";

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
  externalTenantId: string;
  integrations: Array<{ count: number; provider: string; status: string }>;
  onboarding: { completedSteps: string[]; currentStep: string | null; status: string };
  owner: { email: string; name: string } | null;
  ownerInvitation: { acceptedAt: string | null; expiresAt: string; status: string } | null;
  subscription: WorkspaceSubscription;
  usage: { members: number; projects: number };
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

export type WorkspaceBillingData = {
  subscription: Omit<WorkspaceSubscription, "note"> | null;
  usage: { members: number; projects: number };
  workspace: { defaultCurrency: string; id: string; name: string; status: string };
};
