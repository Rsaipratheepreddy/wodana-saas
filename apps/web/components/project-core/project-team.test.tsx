import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { CloseOut, ProjectDetail } from "@/lib/project-core/types";
import type { ProjectApi } from "@/lib/project-core/client";
import { CloseOutList } from "./project-stages";
import { ProjectTeam } from "./project-team";

const detail = (patch: Partial<ProjectDetail> = {}): ProjectDetail => ({
  roles: [{ key: "project_manager", label: "Project manager" }, { key: "designer", label: "Designer" }, { key: "quantity_surveyor", label: "Quantity surveyor" }],
  team: [
    { role: "project_manager", label: "Project manager", member: { membershipId: "m1", name: "Omar Haddad" } },
    { role: "designer", label: "Designer", member: { membershipId: "m2", name: "Dana Karim" } },
    { role: "quantity_surveyor", label: "Quantity surveyor", member: null, notApplicable: true },
  ],
  members: [{ membershipId: "m1", name: "Omar Haddad" }, { membershipId: "m2", name: "Dana Karim" }],
  teamNote: "", canManage: true, ...patch,
} as unknown as ProjectDetail);

describe("project team (PLM-100 / PLM-089)", () => {
  it("names a person per role or marks a role not applicable, and keeps a note on people outside the firm", async () => {
    const run = vi.fn().mockResolvedValue(true);
    render(<DesignSystemProvider><ProjectTeam detail={detail()} run={run} onClose={vi.fn()} /></DesignSystemProvider>);
    const sheet = await screen.findByRole("dialog", { name: "Team" });
    // The role carried as "not applicable" reads so.
    expect(within(sheet).getByRole("button", { name: /Quantity surveyor/ })).toHaveTextContent("Not applicable");
    await userEvent.click(within(sheet).getByRole("button", { name: /Designer/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Not applicable" }));
    await waitFor(() => expect(run).toHaveBeenCalledWith("set_member", { role: "designer", notApplicable: true }));
    // The project manager is never "not applicable" or nobody.
    await userEvent.click(within(sheet).getByRole("button", { name: /Project manager/ }));
    expect(screen.queryByRole("option", { name: "Not applicable" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await userEvent.type(within(sheet).getByRole("textbox", { name: "External people" }), "Installer: Ravi's crew");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(run).toHaveBeenCalledWith("set_team_note", { note: "Installer: Ravi's crew" }));
  });

  it("shows the team and the note read-only to someone who can't change it", async () => {
    render(<DesignSystemProvider><ProjectTeam detail={detail({ canManage: false, teamNote: "Installer: Ravi's crew" })} run={vi.fn()} onClose={vi.fn()} /></DesignSystemProvider>);
    const sheet = await screen.findByRole("dialog", { name: "Team" });
    expect(within(sheet).getByText("Not applicable")).toBeInTheDocument();
    expect(within(sheet).getByText("Installer: Ravi's crew")).toBeInTheDocument();
    expect(within(sheet).queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("closing a project (PLM-070)", () => {
  it("lists each open snag under the last stage, linked to the snags", async () => {
    const closeOut: CloseOut = { owedOrders: [], sharedDrafts: [], inspections: [], moves: [], siteStock: [], openWork: 0, drafts: [], heldStock: [], blockers: [],
      openSnags: [{ id: "s1", number: 12, title: "Chipped door", severity: "minor" }] };
    const api = { closeOut: vi.fn().mockResolvedValue(closeOut) } as unknown as ProjectApi;
    render(<DesignSystemProvider><CloseOutList api={api} projectId="p1" /></DesignSystemProvider>);
    expect(await screen.findByRole("link", { name: "Snag #12 · Chipped door" })).toHaveAttribute("href", "/workspace/projects/p1/plan?filter=snags");
    expect(screen.getByRole("heading", { name: "Before the project closes" })).toBeInTheDocument();
  });
});
