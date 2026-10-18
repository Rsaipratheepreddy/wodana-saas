import type { WorkspaceModuleDefinition, WorkspaceModuleId } from "@/components/workspace/workspace-navigation";
import { canOpen } from "./access";

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
  if (pathname === "/workspace/finance" || pathname.startsWith("/workspace/finance/")) return "projects";
  return null;
}

const CHANGE_RECORD = /^\/workspace\/projects\/[^/]+\/changes\/[^/]+(\/price)?$/;

/**
 * QA-007: a QS who works in Planning (pre-project module, commercial.estimate) opens a project change whose pricing is
 * with them, without the Projects module. The page shows only what the API gives them: the changes waiting for them.
 */
export function opensAsQs(pathname: string, allowedModules: readonly string[], permissions: readonly string[] | undefined) {
  return CHANGE_RECORD.test(pathname) && allowedModules.includes("pre-project") && Boolean(permissions?.includes("commercial.estimate"));
}

export function moduleForWorkspacePath(pathname: string): WorkspaceModuleId {
  if (pathname === "/workspace/catalogs" || pathname.startsWith("/workspace/catalogs/")) return "pre-project";
  if (pathname === "/workspace/pre-projects" || pathname.startsWith("/workspace/pre-projects/")) return "pre-project";
  if (pathname === "/workspace/projects" || pathname.startsWith("/workspace/projects/")) return "projects";
  if (pathname === "/workspace/purchasing" || pathname.startsWith("/workspace/purchasing/")) return "projects";
  if (pathname === "/workspace/inventory" || pathname.startsWith("/workspace/inventory/")) return "projects";
  if (pathname === "/workspace/factory" || pathname.startsWith("/workspace/factory/")) return "projects";
  // Finance pays suppliers and invoices clients for projects: it is part of the Projects module.
  if (pathname === "/workspace/finance" || pathname.startsWith("/workspace/finance/")) return "projects";
  if (pathname === "/workspace/crm" || pathname.startsWith("/workspace/crm/")) return "crm";
  if (pathname === "/workspace/hrms" || pathname.startsWith("/workspace/hrms/")) return "hrms";
  return "workspace";
}

export function visibleWorkspaceModules(modules: WorkspaceModuleDefinition[], slug: string, allowed: readonly WorkspaceModuleId[] = ["workspace"]): WorkspaceModuleDefinition[] {
  return modules.filter((module) => allowed.includes(module.id)
    && (!isCrmFirstWorkspace(slug) || (module.id !== "pre-project" && module.id !== "projects")));
}

/**
 * Keeps the navigation entries whose pages the signed-in member can open, using the same permission
 * codes the pages load with (see `NAVIGATION_ACCESS`). Sidebar, Settings menu and module tabs all
 * come from this list, so nothing leads to a page that only says "no access".
 */
export function scopeWorkspaceNavigation(
  modules: WorkspaceModuleDefinition[],
  allowedPermissions: readonly string[] | undefined,
  roleCodes: readonly string[],
): WorkspaceModuleDefinition[] {
  const context = { permissions: allowedPermissions ?? [], roles: roleCodes };
  // Attendance & leave settings exist only in a workspace that has People.
  const hasPeople = modules.some((module) => module.id === "hrms");
  return modules.map((module) => ({
    ...module,
    navigation: module.navigation.map((section) => ({
      ...section,
      items: section.items.filter((item) => canOpen(item.id, context) && (item.id !== "attendance-settings" || hasPeople)),
    })).filter((section) => section.items.length > 0),
  }));
}

/** @deprecated Use `scopeWorkspaceNavigation`, which scopes every module. */
export const scopePeopleNavigation = scopeWorkspaceNavigation;
/** @deprecated Use `scopeWorkspaceNavigation`, which scopes every module. */
export const scopeSupplyNavigation = scopeWorkspaceNavigation;
