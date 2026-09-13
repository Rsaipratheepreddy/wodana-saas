import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProjectDemoCard } from "./project-demo-card";

describe("project demo card", () => {
  it("links the entire demo card to its project workspace", () => {
    render(<ProjectDemoCard />);
    const card = screen.getByRole("link", { name: "Open Jumeirah villa interiors" });
    expect(card).toHaveAttribute("href", "/workspace/projects/demo/overview");
    expect(screen.getByText("Demo project")).toBeInTheDocument();
    expect(screen.getByText("Open project")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
