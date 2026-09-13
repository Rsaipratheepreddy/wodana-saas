export type WorkspaceRole = {
  id: string;
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  version: number;
  memberCount?: number;
  permissions: string[];
};

export type WorkspaceMember = {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  status: "active" | "suspended";
  joinedAt: string | null;
  version: number;
  roles: string[];
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
};

export type MembersPageData = {
  canManage: boolean;
  currentUserId: string;
  currentUserName: string;
  invitations: WorkspaceInvitation[];
  members: WorkspaceMember[];
  roles: WorkspaceRole[];
  workspaceId: string;
};

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
