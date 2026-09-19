import type { AuthClient } from '../auth/client';

export type MobileBillingData = {
  contract: {
    version: number;
    status: 'trial_uncontracted' | 'contracted' | 'expired';
    planCode: string;
    planVersion: number;
    currency: string;
    billingCycle: 'monthly' | 'yearly' | 'custom';
    recurringAmount: string;
    seatLimit: number;
    projectLimit: number;
    renewsAt: string | null;
  } | { status: 'not_configured'; taxValidationState: 'unverified' };
  organizationAllocation: {
    version: number;
    status: 'scheduled' | 'active' | 'suspended' | 'ended';
    allocatedAmount: string;
    seatLimit: number;
    projectLimit: number;
  } | { status: 'not_configured' };
  collection: {
    version: number;
    status: 'current' | 'grace' | 'past_due' | 'collections' | 'suspended' | 'closed';
    overdueAmount: string;
    currency: string;
    nextReviewAt: string | null;
  } | { status: 'not_configured' };
  accessPolicy: {
    state: 'not_configured' | 'trial' | 'trial_expired' | 'current' | 'grace' | 'past_due' | 'collections' | 'suspended' | 'closed';
    effect: 'unchanged';
    warning: boolean;
    actionDueAt: string | null;
    affectedModules: [];
    message: string;
  };
  usage: { members: number; pendingInvitations: number; reservedSeats: number; projects: number };
  documents: Array<{ id: string; documentType: 'invoice' | 'credit_note' | 'receipt'; status: string }>;
};

export function loadMobileBilling(client: AuthClient, workspaceId: string) {
  return client.api<MobileBillingData>(`/workspaces/${workspaceId}/billing`);
}
