import type { BusinessUnitRecord, LegalEntityRecord } from "./company-profile";
import type { WorkspaceMember } from "./members";
import type { WorkspaceRole } from "./members";

export type TeamMemberRecord = {
  membershipId: string;
  userId: string;
  displayName: string;
  email: string;
  isLead: boolean;
};

export type WorkspaceTeamRecord = {
  id: string;
  businessUnitId: string;
  code: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  version: number;
  members: TeamMemberRecord[];
  roleIds?: string[];
  queueIds?: string[];
};

export type TeamQueueOption = { id: string; name: string; code: string };

export type OrganizationStructurePageData = {
  canManage: boolean;
  workspaceId: string;
  legalEntities: LegalEntityRecord[];
  businessUnits: BusinessUnitRecord[];
  teams: WorkspaceTeamRecord[];
  members: WorkspaceMember[];
  roles: WorkspaceRole[];
  queues: TeamQueueOption[];
};

export const organizationStructureFixture: OrganizationStructurePageData = {
  canManage: true,
  workspaceId: "00000000-0000-4000-8000-000000000002",
  legalEntities: [{
    id: "00000000-0000-4000-8000-000000000003",
    workspaceId: "00000000-0000-4000-8000-000000000002",
    code: "IGLO",
    displayName: "Iglo Architects",
    registeredName: "Iglo Architects LLC",
    countryCode: "AE",
    baseCurrency: "AED",
    locale: "en-AE",
    timezone: "Asia/Dubai",
    taxRegistrationNumber: null,
    registrationNumber: null,
    address: {},
    status: "active",
    version: 1,
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
  }],
  businessUnits: [{
    id: "20000000-0000-4000-8000-000000000001",
    legalEntityId: "00000000-0000-4000-8000-000000000003",
    parentBusinessUnitId: null,
    code: "DESIGN",
    name: "Design Studio",
    type: "studio",
    timezone: "Asia/Dubai",
    status: "active",
    version: 1,
  }],
  teams: [],
  members: [],
  roles: [],
  queues: [],
};
