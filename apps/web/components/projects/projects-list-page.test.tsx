import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProjectsListPage } from "./projects-list-page";

describe("Projects table selector", () => {
  it("shows the demo as a compact table row with real navigation", () => {
    render(<ProjectsListPage />);
    const table = screen.getByRole("table", { name: "Projects" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Client", "Project", "Project manager", "Status", "Action"]);
    expect(within(table).getByText("Demo project")).toBeInTheDocument();
    expect(within(table).getByText("EC")).toHaveAttribute("aria-hidden", "true");
    expect(within(table).getByRole("link", { name: "Open Jumeirah villa interiors" })).toHaveAttribute("href", "/workspace/projects/demo/overview");
    expect(screen.getByRole("link", { name: "Back to Pre-execution" })).toHaveAttribute("href", "/workspace/pre-projects");
    expect(screen.queryByRole("link", { name: "Back to CRM" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Go to Pre-execution" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start project" })).toHaveAttribute("href", "/workspace/pre-projects");
    expect(screen.queryByRole("button", { name: "Cards" })).not.toBeInTheDocument();
  });
  it("searches by customer or project and resets empty results", () => {
    render(<ProjectsListPage />);
    const input = screen.getByRole("textbox", { name: "Search projects" });
    fireEvent.change(input, { target: { value: "no such project" } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No matching projects" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(input).toHaveValue("");
    expect(screen.getByRole("table")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "  DUBAI " } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
  it("filters the demo as planning, never as active or completed", () => {
    render(<ProjectsListPage />);
    const filters = within(screen.getByRole("group", { name: "Project status" }));
    fireEvent.click(filters.getByRole("button", { name: "Completed" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(filters.getByRole("button", { name: "In progress" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(filters.getByRole("button", { name: "Planning" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(filters.getByRole("button", { name: "Planning" })).toHaveAttribute("aria-pressed", "true");
  });
});
