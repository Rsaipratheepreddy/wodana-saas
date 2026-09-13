import type { WorkspaceRole } from "./members";

export type WorkspacePermissionDefinition = {
  code: string;
  description: string;
};

export const ROLE_PERMISSION_ACTIONS = [
  { id: "read", label: "Read" },
  { id: "write", label: "Write" },
  { id: "edit", label: "Edit" },
  { id: "delete", label: "Delete" },
] as const;

export type WorkspacePermissionAction = typeof ROLE_PERMISSION_ACTIONS[number]["id"];
export type WorkspacePermissionModuleId = "organization" | "members" | "teams" | "roles" | "integrations";
export type WorkspacePermissionModule = {
  id: WorkspacePermissionModuleId;
  label: string;
  parentModule: "Workspace" | "Administration";
  description: string;
};

export const ROLE_PERMISSION_MODULES: WorkspacePermissionModule[] = [
  { id: "organization", label: "Organization profile", parentModule: "Workspace", description: "Identity, regional settings, and legal entities" },
  { id: "members", label: "Members", parentModule: "Workspace", description: "Invitations, access, and member status" },
  { id: "teams", label: "Teams & business units", parentModule: "Workspace", description: "Structure, teams, and team membership" },
  { id: "roles", label: "Roles & permissions", parentModule: "Workspace", description: "Custom roles and access rules" },
  { id: "integrations", label: "Integrations", parentModule: "Administration", description: "Connections, configuration, and sync access" },
];

export function modulePermissionCode(moduleId: WorkspacePermissionModuleId, action: WorkspacePermissionAction) {
  return `module.${moduleId}.${action}`;
}

export type RolesPermissionsPageData = {
  canManage: boolean;
  memberCount: number;
  permissions: WorkspacePermissionDefinition[];
  roles: WorkspaceRole[];
  workspaceId: string;
};

export const workspacePermissionFixture: WorkspacePermissionDefinition[] = ROLE_PERMISSION_MODULES.flatMap((module) =>
  ROLE_PERMISSION_ACTIONS.map((action) => ({
    code: modulePermissionCode(module.id, action.id),
    description: `${action.label} access across ${module.label.toLowerCase()}`,
  })),
);

export const rolesPermissionsFixture: RolesPermissionsPageData = {
  canManage: true,
  memberCount: 1,
  permissions: workspacePermissionFixture,
  roles: [
    {
      id: "00000000-0000-4000-8000-000000000004",
      code: "owner",
      name: "Owner",
      description: "Full workspace control, including ownership and billing.",
      isSystem: true,
      version: 1,
      memberCount: 1,
      permissions: workspacePermissionFixture.map((permission) => permission.code),
    },
    {
      id: "00000000-0000-4000-8000-000000000005",
      code: "administrator",
      name: "Administrator",
      description: "Manages workspace configuration, people, and access.",
      isSystem: true,
      version: 1,
      memberCount: 0,
      permissions: workspacePermissionFixture.map((permission) => permission.code),
    },
    {
      id: "00000000-0000-4000-8000-000000000006",
      code: "member",
      name: "Member",
      description: "Standard access to assigned workspace areas.",
      isSystem: true,
      version: 1,
      memberCount: 0,
      permissions: ROLE_PERMISSION_MODULES.map((module) => modulePermissionCode(module.id, "read")),
    },
    {
      id: "00000000-0000-4000-8000-000000000007",
      code: "viewer",
      name: "Viewer",
      description: "Read-only access to permitted workspace information.",
      isSystem: true,
      version: 1,
      memberCount: 0,
      permissions: ROLE_PERMISSION_MODULES.map((module) => modulePermissionCode(module.id, "read")),
    },
    {
      id: "00000000-0000-4000-8000-000000000008",
      code: "studio_lead",
      name: "Studio lead",
      description: "Coordinates studio members and organization settings.",
      isSystem: false,
      version: 1,
      memberCount: 0,
      permissions: [
        modulePermissionCode("organization", "read"),
        modulePermissionCode("organization", "edit"),
        modulePermissionCode("members", "read"),
        modulePermissionCode("members", "edit"),
        modulePermissionCode("teams", "read"),
      ],
    },
  ],
  workspaceId: "00000000-0000-4000-8000-000000000002",
};
