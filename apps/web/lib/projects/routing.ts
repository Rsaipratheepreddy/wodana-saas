import type { WorkspaceNavigationSection } from "@/components/workspace/workspace-navigation";

export function realProjectRoute(pathname: string) {
  const match = pathname.match(
    /^\/workspace\/projects\/([0-9a-f-]{36})\/([^/]+)$/i,
  );
  return match
    ? { id: match[1], section: match[2], root: `/workspace/projects/${match[1]}` }
    : null;
}

export function projectNavigation(
  navigation: WorkspaceNavigationSection[],
  root: string,
): WorkspaceNavigationSection[] {
  return navigation.map((group) => ({
    ...group,
    items: group.items
      .filter((item) => item.id !== "portfolio" && item.id !== "active-projects")
      .map((item) => {
        const section = item.id === "projects-overview"
          ? "overview"
          : item.href.split("/").at(-1);
        return { ...item, href: `${root}/${section}` };
      }),
  }));
}
