import type { WorkspaceNavigationSection } from "@/components/workspace/workspace-navigation";

export function realProjectRoute(pathname: string) {
  const match = pathname.match(
    /^\/workspace\/projects\/([0-9a-f-]{36}|demo)\/([^/]+)$/i,
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
      .filter((item) => !["portfolio", "active-projects", "projects-calendar", "project-workflow-templates"].includes(item.id))
      .map((item) => {
        const section = item.id === "projects-overview"
          ? "overview"
          : item.href.split("/").at(-1);
        return { ...item, label: item.id === "projects-overview" ? "Overview" : item.label, href: `${root}/${section}` };
      }),
  }));
}

export function projectPortfolioNavigation(
  navigation: WorkspaceNavigationSection[],
): WorkspaceNavigationSection[] {
  const items = navigation.flatMap((group) => group.items);
  const pick = (id: string) => items.find((item) => item.id === id);
  return [
    {
      id: "projects-portfolio",
      label: "Projects",
      items: [pick("projects-overview"), pick("projects-calendar")].filter((item): item is NonNullable<typeof item> => Boolean(item)),
    },
    {
      id: "projects-setup",
      label: "Setup",
      items: [pick("project-workflow-templates")].filter((item): item is NonNullable<typeof item> => Boolean(item)),
    },
  ];
}
