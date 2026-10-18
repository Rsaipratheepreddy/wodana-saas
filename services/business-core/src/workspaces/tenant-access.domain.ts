import { tenantModuleForPermission, type TenantModule } from "./tenant-operations.domain";

export type DirectRoleSource = { id: string; code: string; name: string };
export type TeamRoleSource = {
  teamId: string;
  teamName: string;
  roleId: string;
  roleCode: string;
  roleName: string;
};

export type AccessEntitlement = {
  status: string;
  modules: readonly string[];
} | null;

export function effectiveTenantPermissionCodes(input: {
  status: string;
  grantedPermissions: readonly string[];
  entitlements: AccessEntitlement;
}) {
  if (input.status !== "active") return [];
  const entitledModules = input.entitlements
    ? new Set(input.entitlements.status === "active" ? ["workspace", ...input.entitlements.modules] : ["workspace"])
    : null;
  return [...new Set(input.grantedPermissions)].sort().filter((permission) =>
    !entitledModules || entitledModules.has(tenantModuleForPermission(permission)));
}

export function explainTenantMemberAccess(input: {
  status: string;
  directRoles: DirectRoleSource[];
  inheritedRoles: TeamRoleSource[];
  grantedPermissions: string[];
  entitlements: AccessEntitlement;
}) {
  const effectivePermissions = effectiveTenantPermissionCodes(input);
  const effectiveModules = [...new Set(effectivePermissions.map(tenantModuleForPermission))]
    .sort() as TenantModule[];

  const reasons: string[] = [];
  if (input.status !== "active") reasons.push(`Membership is ${input.status}; no effective access is granted.`);
  if (input.directRoles.length) reasons.push("Direct role assignment grants workspace permissions.");
  if (input.inheritedRoles.length) reasons.push("Active team membership contributes inherited roles.");
  if (input.entitlements?.status === "active") {
    reasons.push("Permissions are limited to modules enabled by the active tenant entitlement.");
  } else if (input.entitlements) {
    reasons.push("Only workspace permissions remain while tenant module entitlements are not active.");
  } else {
    reasons.push("No module entitlement set is configured; legacy permission behavior applies.");
  }

  return {
    directRoles: input.directRoles,
    inheritedRoles: input.inheritedRoles,
    grantedPermissions: [...new Set(input.grantedPermissions)].sort(),
    effectivePermissions,
    effectiveModules,
    recordScope: {
      kind: "organization" as const,
      explanation: "No narrower record scope is configured; role permissions apply across this organization.",
    },
    reasons,
  };
}

export function tenantSeatSummary(input: {
  seatLimit: number | null;
  activeMembers: number;
  invitedMembers: number;
  pendingInvitations: number;
  reservedSeats: number;
  availableSeats: number | null;
}) {
  return {
    limit: input.seatLimit,
    used: input.activeMembers + input.invitedMembers,
    activeMembers: input.activeMembers,
    invitedMembers: input.invitedMembers,
    pendingInvitations: input.pendingInvitations,
    reserved: input.reservedSeats,
    available: input.availableSeats,
    policy: "Active and invited memberships plus non-expired pending invitations reserve one seat each.",
  };
}
