import type { WorkspaceModuleDefinition, WorkspaceModuleId } from "@/components/workspace/workspace-navigation";

export type DeferredModule = "pre-project" | "projects";

export function isCrmFirstWorkspace(slug: string, configured = process.env.WODANA_CRM_ONLY_WORKSPACE_SLUGS): boolean {
  return Boolean(slug) && (configured ?? "").split(",").some((item) => item.trim().toLowerCase() === slug.toLowerCase());
}

export function deferredModuleForPath(pathname: string): DeferredModule | null {
  if (pathname === "/workspace/catalogs" || pathname === "/workspace/pre-projects" || pathname.startsWith("/workspace/pre-projects/")) return "pre-project";
  if (pathname === "/workspace/projects" || pathname.startsWith("/workspace/projects/")) return "projects";
  return null;
}

export function moduleForWorkspacePath(pathname: string): WorkspaceModuleId {
  if (pathname === "/workspace/catalogs" || pathname.startsWith("/workspace/catalogs/")) return "pre-project";
  if (pathname === "/workspace/pre-projects" || pathname.startsWith("/workspace/pre-projects/")) return "pre-project";
  if (pathname === "/workspace/projects" || pathname.startsWith("/workspace/projects/")) return "projects";
  if (pathname === "/workspace/crm" || pathname.startsWith("/workspace/crm/")) return "crm";
  if (pathname === "/workspace/hrms" || pathname.startsWith("/workspace/hrms/")) return "hrms";
  return "workspace";
}

export function visibleWorkspaceModules(modules: WorkspaceModuleDefinition[], slug: string, allowed: readonly WorkspaceModuleId[] = ["workspace"]): WorkspaceModuleDefinition[] {
  return modules.filter((module) => allowed.includes(module.id)
    && (!isCrmFirstWorkspace(slug) || (module.id !== "pre-project" && module.id !== "projects")));
}
