export type AccountOrganization = {
  id: string;
  name: string;
  slug: string;
  status: string;
  isDefault: boolean;
  membershipId: string;
  membershipStatus: string;
  roles: string[];
};

export type OrganizationRequest = {
  id: string;
  name: string;
  slug: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decisionReason: string | null;
  approvedWorkspaceId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CustomerAccount = {
  id: string;
  displayName: string;
  status: string;
  organizationLimit: number;
  accountRole: "owner" | "administrator" | "member";
  organizationCount: number;
  availableOrganizationSlots: number;
  canRequestOrganization: boolean;
  organizations: AccountOrganization[];
};
