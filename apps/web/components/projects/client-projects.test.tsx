import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { PortfolioRow } from "./project-portfolio";
import { ClientProjects } from "./client-projects";

const row: PortfolioRow = {
  id: "p1", caseId: "c1", name: "Villa interiors", customer: "Amira Hassan", phase: "active", manager: "Omar Rahman", reference: "PRJ-001", priority: "normal",
  risk: "on_track", onHold: false, handoverDate: "2026-10-02", nextAction: "", nextActionDate: "",
};

describe("client projects", () => {
  it("has one title and lists each client with their project on a muted line and the way to client updates", async () => {
    render(<DesignSystemProvider><ClientProjects rows={[row]} /></DesignSystemProvider>);
    expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual(["Clients"]);
    const grid = screen.getByRole("table", { name: "Client projects" });
    expect(within(grid).getByText("Villa interiors · PRJ-001")).toBeInTheDocument();
    expect(within(grid).getByRole("link", { name: "Client updates" })).toHaveAttribute("href", "/workspace/projects/p1/overview?view=client-updates");
    await userEvent.type(screen.getByRole("searchbox", { name: "Search clients and projects" }), "nobody");
    expect(await screen.findByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("says what to do when there are no client projects yet", () => {
    render(<DesignSystemProvider><ClientProjects rows={[]} /></DesignSystemProvider>);
    expect(screen.getByText("No client projects yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open projects" })).toHaveAttribute("href", "/workspace/projects");
  });
});
