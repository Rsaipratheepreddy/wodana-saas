import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { findWorkspaceModule, findWorkspaceScreen, workspaceModules, workspaceScreens } from "@/components/workspace/workspace-navigation";
import { PreProjectSectionPage } from "./pre-project-section-page";

const preProjectModule = workspaceModules.find((item) => item.id === "pre-project")!;
const sections = preProjectModule.navigation.flatMap((group) => group.items);

describe("Pre-execution navigation", () => {
  it("groups every agreed destination without execution operations or duplicate approval centers", () => {
    expect(preProjectModule.navigation.map((group) => [group.label ?? "Main", group.items.map((item) => item.label)])).toEqual([
      ["Main", ["Pre-execution cases", "Master Data", "Supplier Offers", "Quotation Templates"]],
      ["Requirement gathering", ["Case overview", "Requirements"]],
      ["Main", ["Client inspirations", "Design", "Scope confirmation", "Quotations", "Agreement & payments", "Change requests", "Approvals & release", "Client portal"]],
    ]);
    expect(new Set(workspaceScreens.map((item) => item.id)).size).toBe(workspaceScreens.length);
    expect(new Set(workspaceScreens.map((item) => item.href)).size).toBe(workspaceScreens.length);
  });

  it.each(sections)("resolves $label within Pre-execution and explains its planned scope", (section) => {
    expect(findWorkspaceModule(section.href).id).toBe("pre-project");
    expect(findWorkspaceScreen(section.href).id).toBe(section.id);
    expect(section.description).toBeTruthy();
    render(<PreProjectSectionPage section={section} />);
    expect(screen.getByRole("heading", { level: 1, name: section.label })).toBeVisible();
    expect(screen.getByText(section.description!)).toBeVisible();
    expect(screen.getByText("Planned")).toBeVisible();
    expect(screen.getByText(/not available yet/)).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
