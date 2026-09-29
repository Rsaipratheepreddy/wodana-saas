import type { ViewAsSettings } from "./view-as";

export type WorkspaceRole = {
  id: string;
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  version: number;
  memberCount?: number;
  teamCount?: number;
  pendingInvitationCount?: number;
  permissions: string[];
};

export type WorkspaceMember = {
  id: string;
  userId: string;
  avatarPreset?: string | null;
  photoUrl?: string | null;
  email: string;
  displayName: string;
  status: "active" | "suspended";
  joinedAt: string | null;
  version: number;
  roles: string[];
  inheritedRoles?: string[];
  teams?: Array<{ id: string; name: string }>;
};

export type WorkspaceInvitation = {
  id: string;
  email: string;
  displayName: string;
  status: "pending" | "accepted" | "cancelled" | "expired";
  expiresAt: string;
  acceptedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  invitedByName: string;
  roles: string[];
  teams?: Array<{ id: string; name: string }>;
};

/** The workspace's seats (SP-3): the limit, members using one, invitations reserving one, and what's free. */
export type SeatUsage = { limit: number | null; used: number; reserved: number; available: number | null };

export type MembersPageData = {
  seats?: SeatUsage | null;
  canView?: boolean;
  canManage: boolean;
  canInvite?: boolean;
  canEdit?: boolean;
  canCancelInvitations?: boolean;
  assignableRoleCodes?: string[];
  currentUserId: string;
  currentUserName: string;
  invitations: WorkspaceInvitation[];
  members: WorkspaceMember[];
  roles: WorkspaceRole[];
  teams: Array<{ id: string; name: string; roleIds?: string[] }>;
  workspaceId: string;
  /** "View as" a person (owners and administrators): whether it is offered, and its notice setting. */
  viewAs?: { canViewAs: boolean; mfaEnabled: boolean; settings: ViewAsSettings | null; viewerIsOwner: boolean };
};

export function memberAccessCapabilities(
  allowedPermissions: readonly string[] | undefined,
  roleCodes: readonly string[],
  roles: readonly WorkspaceRole[],
) {
  const isAdministrator = roleCodes.some((role) => ["owner", "administrator"].includes(role.toLowerCase()));
  const permissions = new Set(allowedPermissions ?? []);
  const canManage = isAdministrator;
  const canView = isAdministrator || permissions.has("workspace.members.manage") || [
    "module.members.read", "module.members.write", "module.members.edit", "module.members.delete",
  ].some((permission) => permissions.has(permission));
  const canInvite = isAdministrator || permissions.has("workspace.members.manage") || permissions.has("module.members.write");
  const canEdit = isAdministrator || permissions.has("workspace.members.manage") || permissions.has("module.members.edit");
  const canCancelInvitations = isAdministrator || permissions.has("workspace.members.manage") || permissions.has("module.members.delete");
  const canReadInvitations = isAdministrator || permissions.has("workspace.members.manage") || [
    "module.members.read", "module.members.write", "module.members.delete",
  ].some((permission) => permissions.has(permission));
  const canReadTeams = isAdministrator || permissions.has("module.teams.read") || permissions.has("legal_entities.view");
  const assignableRoleCodes = roles
    .filter((role) => isAdministrator || (
      !["owner", "administrator"].includes(role.code.toLowerCase())
      && role.permissions.every((permission) => permissions.has(permission))
    ))
    .map((role) => role.code);
  return { canView, canManage, canInvite, canEdit, canCancelInvitations, canReadInvitations, canReadTeams, assignableRoleCodes };
}

export const membersPageFixture: MembersPageData = {
  canManage: true,
  currentUserId: "00000000-0000-4000-8000-000000000001",
  currentUserName: "Iglo Administrator",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  members: [
    {
      id: "00000000-0000-4000-8000-000000000003",
      userId: "00000000-0000-4000-8000-000000000001",
      email: "admin@igloarchitects.com",
      displayName: "Iglo Administrator",
      status: "active",
      joinedAt: "2026-09-05T12:00:00.000Z",
      version: 1,
      roles: ["owner"],
    },
  ],
  invitations: [],
  teams: [],
  roles: [
    {
      id: "00000000-0000-4000-8000-000000000004",
      code: "owner",
      name: "Owner",
      description: "Full workspace control, including ownership and billing.",
      isSystem: true,
      version: 1,
      memberCount: 1,
      permissions: ["workspace.members.manage", "workspace.roles.manage"],
    },
    {
      id: "00000000-0000-4000-8000-000000000005",
      code: "administrator",
      name: "Administrator",
      description: "Manages workspace configuration, people, and access.",
      isSystem: true,
      version: 1,
      memberCount: 0,
      permissions: ["workspace.members.manage", "workspace.roles.manage"],
    },
    {
      id: "00000000-0000-4000-8000-000000000006",
      code: "member",
      name: "Member",
      description: "Standard access to assigned workspace areas.",
      isSystem: true,
      version: 1,
      memberCount: 0,
      permissions: [],
    },
    {
      id: "00000000-0000-4000-8000-000000000007",
      code: "viewer",
      name: "Viewer",
      description: "Read-only access to permitted workspace information.",
      isSystem: true,
      version: 1,
      memberCount: 0,
      permissions: [],
    },
  ],
};

export function readableRole(code: string, roles: WorkspaceRole[]): string {
  return roles.find((role) => role.code === code)?.name
    ?? code.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
