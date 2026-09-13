import type { WorkspaceNavigationSection } from "@/components/workspace/workspace-navigation";
import { caseHref, caseRoute } from "./types";

/** Catalogs appear beside the case list, never inside an individual case. */
export function preProjectNavigation(
  navigation: WorkspaceNavigationSection[],
  pathname: string,
  search = "",
): WorkspaceNavigationSection[] {
  const route = caseRoute(pathname);
  if (!route) return navigation.filter((group) => group.id === "pre-project-primary");
  return navigation.filter(group => ["pre-project-requirements", "pre-project-case-sections"].includes(group.id)).map(group => ({
    ...group,
    items: group.items.map(item => ({...item, href: caseHref(route.id, new URLSearchParams(search), item.href.split("/").at(-1)!)})),
  }));
}
