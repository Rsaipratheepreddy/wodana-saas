export const PLATFORM_OPERATOR_ROLES = [
  "administrator",
  "platform_security_owner",
  "provisioning_operator",
  "account_billing_operator",
  "domain_operator",
  "support_observer",
] as const;

export type PlatformOperatorRole = typeof PLATFORM_OPERATOR_ROLES[number];

export const PLATFORM_OPERATOR_PERMISSIONS = [
  "tenants.read",
  "tenants.provision",
  "invitations.send",
  "billing.manage",
  "lifecycle.manage",
  "domains.manage",
  "entitlements.manage",
  "support.request",
  "support.approve",
  "data.manage",
  "operators.manage",
] as const;

export type PlatformOperatorPermission = typeof PLATFORM_OPERATOR_PERMISSIONS[number];

const allPermissions = [...PLATFORM_OPERATOR_PERMISSIONS];

export const PLATFORM_OPERATOR_POLICY: Record<PlatformOperatorRole, readonly PlatformOperatorPermission[]> = {
  administrator: allPermissions,
  platform_security_owner: allPermissions,
  provisioning_operator: ["tenants.read", "tenants.provision", "invitations.send"],
  account_billing_operator: ["tenants.read", "billing.manage", "entitlements.manage"],
  domain_operator: ["tenants.read", "domains.manage"],
  support_observer: ["tenants.read", "support.request"],
};

export function isPlatformOperatorRole(value: string): value is PlatformOperatorRole {
  return (PLATFORM_OPERATOR_ROLES as readonly string[]).includes(value);
}

export function platformOperatorPermissions(role: PlatformOperatorRole) {
  return [...PLATFORM_OPERATOR_POLICY[role]];
}

export function platformOperatorCan(
  role: PlatformOperatorRole,
  permission: PlatformOperatorPermission,
) {
  return PLATFORM_OPERATOR_POLICY[role].includes(permission);
}
