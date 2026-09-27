import type { WorkspaceModuleDefinition, WorkspaceModuleId } from "@/components/workspace/workspace-navigation";

export type DeferredModule = "pre-project" | "projects";

export function isCrmFirstWorkspace(slug: string, configured = process.env.WODANA_CRM_ONLY_WORKSPACE_SLUGS): boolean {
  return Boolean(slug) && (configured ?? "").split(",").some((item) => item.trim().toLowerCase() === slug.toLowerCase());
}

export function deferredModuleForPath(pathname: string): DeferredModule | null {
  if (pathname === "/workspace/catalogs" || pathname === "/workspace/pre-projects" || pathname.startsWith("/workspace/pre-projects/")) return "pre-project";
  if (pathname === "/workspace/projects" || pathname.startsWith("/workspace/projects/")) return "projects";
  if (pathname === "/workspace/purchasing" || pathname.startsWith("/workspace/purchasing/")) return "projects";
  if (pathname === "/workspace/inventory" || pathname.startsWith("/workspace/inventory/")) return "projects";
  if (pathname === "/workspace/factory" || pathname.startsWith("/workspace/factory/")) return "projects";
  return null;
}

export function moduleForWorkspacePath(pathname: string): WorkspaceModuleId {
  if (pathname === "/workspace/catalogs" || pathname.startsWith("/workspace/catalogs/")) return "pre-project";
  if (pathname === "/workspace/pre-projects" || pathname.startsWith("/workspace/pre-projects/")) return "pre-project";
  if (pathname === "/workspace/projects" || pathname.startsWith("/workspace/projects/")) return "projects";
  if (pathname === "/workspace/purchasing" || pathname.startsWith("/workspace/purchasing/")) return "projects";
  if (pathname === "/workspace/inventory" || pathname.startsWith("/workspace/inventory/")) return "projects";
  if (pathname === "/workspace/factory" || pathname.startsWith("/workspace/factory/")) return "projects";
  if (pathname === "/workspace/crm" || pathname.startsWith("/workspace/crm/")) return "crm";
  if (pathname === "/workspace/hrms" || pathname.startsWith("/workspace/hrms/")) return "hrms";
  return "workspace";
}

export function visibleWorkspaceModules(modules: WorkspaceModuleDefinition[], slug: string, allowed: readonly WorkspaceModuleId[] = ["workspace"]): WorkspaceModuleDefinition[] {
  return modules.filter((module) => allowed.includes(module.id)
    && (!isCrmFirstWorkspace(slug) || (module.id !== "pre-project" && module.id !== "projects")));
}

export function scopePeopleNavigation(
  modules: WorkspaceModuleDefinition[],
  allowedPermissions: readonly string[] | undefined,
  roleCodes: readonly string[],
): WorkspaceModuleDefinition[] {
  const isAdministrator = roleCodes.some((role) => ["owner", "administrator"].includes(role.toLowerCase()));
  const canViewPeople = isAdministrator || (allowedPermissions ?? []).some((permission) => [
    "workspace.members.manage", "module.members.read", "module.members.write", "module.members.edit", "module.members.delete",
  ].includes(permission));
  if (canViewPeople) return modules;
  return modules.map((module) => module.id !== "workspace" ? module : {
    ...module,
    navigation: module.navigation.map((section) => ({
      ...section,
      items: section.items.filter((item) => item.id !== "members"),
    })).filter((section) => section.items.length > 0),
  });
}

/** Global supply entries follow the same project permissions as their data sources. */
export function scopeSupplyNavigation(
  modules: WorkspaceModuleDefinition[],
  allowedPermissions: readonly string[] | undefined,
  roleCodes: readonly string[],
): WorkspaceModuleDefinition[] {
  const isAdministrator = roleCodes.some(role => ["owner", "administrator"].includes(role.toLowerCase()));
  const canViewPurchasing = isAdministrator || (allowedPermissions ?? []).some(permission => ["purchasing.view", "purchasing.manage", "vendors.view", "vendors.manage"].includes(permission));
  const canViewInventory = isAdministrator || (allowedPermissions ?? []).some(permission => ["stock.view", "stock.manage", "stock.adjust", "stock.receive"].includes(permission));
  const canViewFactory = isAdministrator || (allowedPermissions ?? []).some(permission => ["factory.view", "factory.manage", "factory.report", "factory.approve"].includes(permission));
  const canViewFinance = isAdministrator || (allowedPermissions ?? []).some(permission => ["payables.view", "payables.manage", "payables.approve", "receivables.view", "receivables.manage"].includes(permission));
  return modules.map(module => module.id !== "projects" ? module : {
    ...module,
    navigation: module.navigation.map(section => ({
      ...section,
      items: section.items.filter(item => (item.id !== "global-purchasing" || canViewPurchasing) && (item.id !== "global-inventory" || canViewInventory)
        && (item.id !== "global-factory" || canViewFactory) && (item.id !== "global-finance" || canViewFinance)),
    })),
  });
}
