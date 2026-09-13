import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  findWorkspaceModule,
  findWorkspaceScreen,
} from "@/components/workspace/workspace-navigation";
vi.mock("@/lib/auth/server", () => ({
  getAuthenticatedProfile: async () => ({
    memberships: [{ workspaceId: "workspace-selected" }],
  }),
}));
vi.mock("@/components/hrms/hrms-workspace", () => ({
  HrmsWorkspace: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="hrms-workspace">{workspaceId}</div>
  ),
}));
import HrmsPage from "./page";
describe("HRMS module", () => {
  it("resolves inside the workspace portal", () => {
    expect(findWorkspaceModule("/workspace/hrms").id).toBe("hrms");
    expect(findWorkspaceScreen("/workspace/hrms").id).toBe("hrms-overview");
  });
  it("uses the authenticated active workspace", async () => {
    render(await HrmsPage());
    expect(screen.getByTestId("hrms-workspace")).toHaveTextContent(
      "workspace-selected",
    );
  });
});
