import type { WorkspaceNavigationSection } from "@/components/workspace/workspace-navigation";
import { projectSectionIds, type ProjectSection } from "./flows";

export const DEMO_PROJECT = {
  title: "Jumeirah villa interiors",
  customer: "Example client · Dubai",
  root: "/workspace/projects/demo",
  description: "Interior fit-out for a family villa: living spaces, bedrooms, kitchen joinery and lighting coordination.",
};

const sections = new Set<string>(projectSectionIds);
export function demoProjectSection(pathname: string): ProjectSection | null {
  if (!pathname.startsWith(`${DEMO_PROJECT.root}/`)) return null;
  const section = pathname.slice(DEMO_PROJECT.root.length + 1);
  if (section === "installation") return "site-work";
  return sections.has(section) ? section as ProjectSection : null;
}
export function demoProjectNavigation(navigation: WorkspaceNavigationSection[]): WorkspaceNavigationSection[] {
  return navigation.map((group) => ({ ...group, items: group.items
    .filter((item) => item.id !== "portfolio" && item.id !== "active-projects")
    .map((item) => ({ ...item, href: `${DEMO_PROJECT.root}/${item.id === "projects-overview" ? "overview" : item.href.split("/").at(-1)}` })),
  }));
}

export function realProjectRoute(pathname:string){const match=pathname.match(/^\/workspace\/projects\/([0-9a-f-]{36})\/([^/]+)$/i);return match?{id:match[1],section:match[2],root:`/workspace/projects/${match[1]}`}:null;}
export function projectNavigation(navigation:WorkspaceNavigationSection[],root:string){return demoProjectNavigation(navigation).map(g=>({...g,items:g.items.map(i=>({...i,href:i.href.replace(DEMO_PROJECT.root,root)}))}));}
