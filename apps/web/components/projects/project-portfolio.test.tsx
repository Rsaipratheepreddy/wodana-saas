import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest } from "@/lib/commercial/client";
import { ProjectPortfolio, type PortfolioRow } from "./project-portfolio";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/commercial/client", async (original) => ({ ...await original<object>(), jsonRequest: vi.fn() }));

const project: PortfolioRow = {
  id: "project-id", caseId: "case-id", name: "Jumeirah villa interiors", customer: "Amira Hassan",
  phase: "planning", manager: "Omar Rahman", reference: "PRJ-001", priority: "normal",
  risk: "on_track", onHold: false, handoverDate: "2026-10-02", nextAction: "Confirm joinery slot",
  nextActionDate: "2026-09-18",
};

describe("project portfolio", () => {
  beforeEach(() => { push.mockReset(); vi.mocked(jsonRequest).mockReset(); });

  it("shows projects in the shared grid and opens a selected project", async () => {
    const user = userEvent.setup();
    render(<ProjectPortfolio rows={[project]} today="2026-09-17" workspaceId="workspace" />);
    await user.click(screen.getByRole("radio", { name: "Table" }));
    expect(screen.getByRole("table", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByText("Amira Hassan · PRJ-001")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Jumeirah villa interiors/ }));
    expect(push).toHaveBeenCalledWith("/workspace/projects/project-id/overview");
  });

  it("has one title, one primary action, status tabs under the title and project cards", async () => {
    const user = userEvent.setup();
    render(<ProjectPortfolio rows={[project, { ...project, id: "done", name: "Marina office", phase: "completed" }]} today="2026-09-17" workspaceId="workspace" />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Start project" })).toHaveLength(1);
    const card = screen.getByRole("heading", { level: 2, name: "Jumeirah villa interiors" }).closest("article")!;
    expect(within(card).getByRole("link", { name: "Jumeirah villa interiors" })).toHaveAttribute("href", "/workspace/projects/project-id/overview");
    await user.click(within(screen.getByRole("group", { name: "Project status" })).getByRole("button", { name: "Completed" }));
    expect(screen.queryByText("Jumeirah villa interiors")).not.toBeInTheDocument();
    expect(screen.getByText("Marina office")).toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "Project status" })).getByRole("button", { name: "Handover" }));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Jumeirah villa interiors")).toBeInTheDocument();
  });

  it("loads eligible planning cases before creating a project", async () => {
    const user = userEvent.setup();
    vi.mocked(jsonRequest)
      .mockResolvedValueOnce([{ id: "case-id", title: "Villa case", customer: "Amira Hassan" }])
      .mockResolvedValueOnce({ id: "new-project" });
    render(<ProjectPortfolio rows={[]} today="2026-09-17" workspaceId="workspace" />);
    await user.click(screen.getAllByRole("button", { name: "Start project" })[0]);
    await waitFor(() => expect(jsonRequest).toHaveBeenCalledWith("/api/projects/candidates?workspaceId=workspace"));
    await user.click(screen.getByRole("button", { name: /Planning case/ }));
    await user.click(screen.getByRole("option", { name: "Villa case · Amira Hassan" }));
    await user.click(screen.getByRole("button", { name: "Create planning workspace" }));
    await waitFor(() => expect(jsonRequest).toHaveBeenCalledWith("/api/projects/planning?workspaceId=workspace", "POST", { caseId: "case-id" }));
    expect(push).toHaveBeenCalledWith("/workspace/projects/new-project/plan-teams");
  });
});
