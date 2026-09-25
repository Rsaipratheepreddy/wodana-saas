import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProjectRevampTabs } from "./project-revamp-tabs";

const navigation = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace/projects/new/demo",
  useSearchParams: () => new URLSearchParams(navigation.query),
}));

beforeEach(() => {
  navigation.query = "tab=planning&projectName=Villa";
  window.history.replaceState(null, "", `/workspace/projects/new/demo?${navigation.query}`);
});

it("shows the four requested Planning sections", () => {
  render(<ProjectRevampTabs projectName="Villa" />);
  const planning = within(screen.getByRole("region", { name: "Planning sections" }));
  expect(planning.getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Requirements", "Design", "Quotations", "Change Requests"]);
  expect(planning.getByRole("tab", { name: "Requirements" })).toHaveAttribute("aria-selected", "true");
});

it("keeps planning sub-tabs out of other main sections", () => {
  navigation.query = "tab=overview&projectName=Villa";
  render(<ProjectRevampTabs projectName="Villa" />);
  expect(screen.queryByRole("region", { name: "Planning sections" })).not.toBeInTheDocument();
});

it("restores a linked planning tab", () => {
  navigation.query += "&planningTab=quotations";
  render(<ProjectRevampTabs projectName="Villa" />);
  expect(screen.getByRole("tab", { name: "Quotations" })).toHaveAttribute("aria-selected", "true");
});

it("updates the planning selection URL without losing the project name", () => {
  render(<ProjectRevampTabs projectName="Villa" />);
  fireEvent.click(screen.getByRole("tab", { name: "Design" }));
  const query = new URLSearchParams(window.location.search);
  expect(query.get("tab")).toBe("planning");
  expect(query.get("planningTab")).toBe("design");
  expect(query.get("projectName")).toBe("Villa");
});
