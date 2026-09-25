import { describe, expect, it } from "vitest";
import { projectNavigation, projectPortfolioNavigation, realProjectRoute } from "./routing";

describe("project workspace routing", () => {
  it("keeps the local demo project scoped when moving between sections", () => {
    const route = realProjectRoute("/workspace/projects/demo/overview");
    expect(route).toEqual({ id: "demo", section: "overview", root: "/workspace/projects/demo" });
    expect(projectNavigation([{ id: "delivery", items: [{ id: "boq", href: "/workspace/projects/boq", icon: "boq", label: "BOQ" }] }], route!.root)[0].items[0].href)
      .toBe("/workspace/projects/demo/boq");
  });

  it("does not treat the portfolio or unrelated paths as a project workspace", () => {
    expect(realProjectRoute("/workspace/projects")).toBeNull();
    expect(realProjectRoute("/workspace/projects/not-a-project/overview")).toBeNull();
  });

  it("keeps only working portfolio destinations before a project is selected", () => {
    const navigation = projectPortfolioNavigation([{ id: "all", items: [
      { id: "projects-overview", href: "/workspace/projects", icon: "home", label: "Portfolio overview" },
      { id: "projects-calendar", href: "/workspace/projects/calendar", icon: "calendar", label: "Portfolio calendar" },
      { id: "project-commercial", href: "/workspace/projects/commercial", icon: "commercial", label: "Budget" },
      { id: "project-workflow-templates", href: "/workspace/projects/workflow-templates", icon: "settings", label: "Workflow setup" },
    ] }]);
    expect(navigation.flatMap((group) => group.items).map((item) => item.href)).toEqual([
      "/workspace/projects", "/workspace/projects/workflow-templates",
    ]);
  });

  it("keeps planning, factory, onsite, quality and closeout destinations inside the selected project", () => {
    const root = "/workspace/projects/11111111-1111-4111-8111-111111111111";
    const navigation = projectNavigation([{ id: "delivery", items: [
      { id: "material-planning", href: "/workspace/projects/material-planning", icon: "materialPlan", label: "Material planning" },
      { id: "production", href: "/workspace/projects/production", icon: "production", label: "Production" },
      { id: "site-work", href: "/workspace/projects/site-work", icon: "installation", label: "Onsite execution" },
      { id: "daily-progress", href: "/workspace/projects/daily-progress", icon: "reports", label: "Daily progress" },
      { id: "snagging", href: "/workspace/projects/snagging", icon: "snagging", label: "Snagging & warranty" },
      { id: "handover", href: "/workspace/projects/handover", icon: "handover", label: "Handover" },
    ] }], root);
    expect(navigation[0].items.map((item) => item.href)).toEqual([
      `${root}/material-planning`,
      `${root}/production`,
      `${root}/site-work`,
      `${root}/daily-progress`,
      `${root}/snagging`,
      `${root}/handover`,
    ]);
  });
});
