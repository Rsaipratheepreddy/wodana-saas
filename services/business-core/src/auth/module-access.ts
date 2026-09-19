export type TenantModuleId = "workspace" | "crm" | "pre-project" | "projects" | "hrms";

/** Effective role grants, not a commercial entitlement. Contract-level module gates are CP04. */
export function allowedTenantModules(permissionCodes: readonly string[]): TenantModuleId[] {
  const allowed = new Set<TenantModuleId>(["workspace"]);
  for (const code of permissionCodes) {
    if (code.startsWith("crm.")) allowed.add("crm");
    if (code.startsWith("pre_projects.") || code.startsWith("commercial.")) allowed.add("pre-project");
    if (code.startsWith("projects.")) allowed.add("projects");
    if (code.startsWith("hrms.")) allowed.add("hrms");
  }
  return (["workspace", "crm", "pre-project", "projects", "hrms"] as const).filter((module) => allowed.has(module));
}
