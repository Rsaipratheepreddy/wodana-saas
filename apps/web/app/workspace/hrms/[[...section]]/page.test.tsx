import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { findWorkspaceModule, findWorkspaceScreen } from "@/components/workspace/workspace-navigation";

const next = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`); }),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
}));
vi.mock("next/navigation", () => next);
vi.mock("@/lib/auth/server", () => ({ getAuthenticatedProfile: async () => ({ memberships: [{ workspaceId: "workspace-selected" }] }) }));
vi.mock("@/components/hrms/hrms-page", () => ({
  HrmsPage: ({ workspaceId, section }: { workspaceId: string; section: string }) => <div data-testid="people">{`${workspaceId}:${section}`}</div>,
}));
import Page from "./page";

const open = async (section?: string[]) => Page({ params: Promise.resolve({ section }) });

describe("People routes", () => {
  it("resolves inside the workspace portal", () => {
    expect(findWorkspaceModule("/workspace/hrms").id).toBe("hrms");
    expect(findWorkspaceScreen("/workspace/hrms").id).toBe("hrms-overview");
    expect(findWorkspaceScreen("/workspace/hrms/team").id).toBe("hrms-team");
  });

  it("opens attendance by default and each tab by its address, for the active workspace", async () => {
    render(await open());
    expect(screen.getByTestId("people")).toHaveTextContent("workspace-selected:attendance");
    for (const section of ["leave", "team", "people"]) {
      const view = render(await open([section]));
      expect(view.getAllByTestId("people").at(-1)).toHaveTextContent(`workspace-selected:${section}`);
    }
  });

  it("sends old addresses to where they live now, and refuses unknown ones", async () => {
    await expect(open(["time-summary"])).rejects.toThrow("redirect:/workspace/hrms");
    await expect(open(["site-attendance"])).rejects.toThrow("redirect:/workspace/hrms");
    await expect(open(["settings"])).rejects.toThrow("redirect:/workspace/settings/attendance");
    await expect(open(["workplaces"])).rejects.toThrow("redirect:/workspace/settings/attendance?tab=workplaces");
    await expect(open(["leave-settings"])).rejects.toThrow("redirect:/workspace/settings/attendance?tab=leave-types");
    await expect(open(["payroll"])).rejects.toThrow("not-found");
    await expect(open(["leave", "extra"])).rejects.toThrow("not-found");
  });
});
