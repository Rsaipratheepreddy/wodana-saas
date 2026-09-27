import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rolesPermissionsFixture } from "@/lib/workspace/roles-permissions";
import { RolesPermissionsPage } from "./roles-permissions-page";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RolesPermissionsPage", () => {
  it("shows every product area and saves an enforced capability for a custom role", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(rolesPermissionsFixture);
    const customRole = data.roles.find((role) => role.code === "studio_lead")!;
    const savedRole = {
      ...customRole,
      version: 2,
      permissions: [...customRole.permissions, "commercial.costs.manage"],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => savedRole });
    vi.stubGlobal("fetch", fetchMock);

    render(<RolesPermissionsPage initialData={data} />);

    expect(screen.getByLabelText("Role")).toHaveTextContent("Studio lead");
    expect(screen.getByRole("button", { name: "Company 29" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sales 26" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Planning & design 9" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quotations & finance 8" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Projects & work 7" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Supply & catalog 7" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Client portal 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "People 4" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI & platform 1" })).toBeInTheDocument();

    const costSwitch = screen.getByRole("switch", { name: "Studio lead: Manage internal quotation costs" });
    expect(costSwitch).not.toBeChecked();
    await interaction.click(costSwitch);
    await interaction.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/workspace/roles/${customRole.id}`);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      workspaceId: data.workspaceId,
      version: 1,
      permissionCodes: expect.arrayContaining([
        "module.organization.read",
        "module.organization.edit",
        "module.members.read",
        "module.teams.read",
        "crm.leads.view",
        "pre_projects.view",
        "projects.manage",
        "hrms.self",
        "commercial.costs.manage",
      ]),
    });
    expect(await screen.findByText("Studio lead permissions updated.")).toBeInTheDocument();
  });

  it("keeps system role permissions read-only", () => {
    const data = structuredClone(rolesPermissionsFixture);
    data.roles = data.roles.filter((role) => role.code !== "studio_lead");
    render(<RolesPermissionsPage initialData={data} />);

    expect(screen.getByRole("switch", { name: "Owner: View organization profile" })).toBeDisabled();
    expect(screen.getByText("System role permissions are managed by Wodana and cannot be changed.")).toBeInTheDocument();
  });

  it("shows a restricted custom role without mutation controls", () => {
    const data = structuredClone(rolesPermissionsFixture);
    data.canCreate = false;
    data.canEdit = false;
    data.canDelete = false;
    data.memberCount = null;
    render(<RolesPermissionsPage initialData={data} />);

    expect(screen.getByRole("switch", { name: "Studio lead: Manage internal quotation costs" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Custom role" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actions for Studio lead" })).not.toBeInTheDocument();
    expect(screen.getByText("You can review this role. Permission changes require role editing access.")).toBeInTheDocument();
    expect(screen.queryByText("1 member")).not.toBeInTheDocument();
  });

  it("does not offer editing of a role with grants beyond the editor's access", () => {
    const data = structuredClone(rolesPermissionsFixture);
    data.canCreate = false;
    data.canDelete = false;
    data.delegablePermissions = ["module.roles.edit", "commercial.costs.manage"];
    render(<RolesPermissionsPage initialData={data} />);

    expect(screen.getByRole("switch", { name: "Studio lead: Manage internal quotation costs" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.getByText("This role contains permissions outside your access and is read-only for you.")).toBeInTheDocument();
  });

  it("lets a scoped editor change only capabilities they hold", () => {
    const data = structuredClone(rolesPermissionsFixture);
    const customRole = data.roles.find((role) => role.code === "studio_lead")!;
    customRole.permissions = ["module.roles.edit"];
    data.canCreate = false;
    data.canDelete = false;
    data.delegablePermissions = ["module.roles.edit", "commercial.costs.manage"];
    render(<RolesPermissionsPage initialData={data} />);

    expect(screen.getByRole("switch", { name: "Studio lead: Manage internal quotation costs" })).toBeEnabled();
    expect(screen.getByRole("switch", { name: "Studio lead: Approve deal file" })).toBeDisabled();
    expect(screen.getByText("Save changes to apply access. You can grant only permissions you hold.")).toBeInTheDocument();
  });

  it("creates a custom role with an automatically generated code and selected permissions", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(rolesPermissionsFixture);
    const createdRole = {
      id: "00000000-0000-4000-8000-000000000009",
      code: "project_coordinator",
      name: "Project coordinator",
      description: "Coordinates project access.",
      isSystem: false,
      version: 1,
      memberCount: 0,
      permissions: ["workspace.members.manage"],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => createdRole });
    vi.stubGlobal("fetch", fetchMock);

    render(<RolesPermissionsPage initialData={data} />);
    await interaction.click(screen.getByRole("button", { name: "Custom role" }));
    const dialog = await screen.findByRole("dialog", { name: "Create custom role" });
    await interaction.type(within(dialog).getByRole("textbox", { name: /Role name/ }), "Project coordinator");
    expect(within(dialog).getByRole("textbox", { name: /Role code/ })).toHaveValue("project_coordinator");
    await interaction.type(within(dialog).getByRole("textbox", { name: "Description" }), "Coordinates project access.");
    await interaction.click(within(dialog).getByRole("button", { name: "Save role" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspace/roles");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      workspaceId: data.workspaceId,
      code: "project_coordinator",
      name: "Project coordinator",
      description: "Coordinates project access.",
      permissionCodes: [],
    });
    expect(await screen.findByText("Project coordinator was saved.")).toBeInTheDocument();
  });

  it("keeps unsaved permission switches when role details are edited", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(rolesPermissionsFixture);
    const role = data.roles.find((item) => item.code === "studio_lead")!;
    const renamed = { ...role, name: "Studio director", version: 2 };
    const saved = { ...renamed, version: 3, permissions: [...role.permissions, "commercial.costs.manage"] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => renamed })
      .mockResolvedValueOnce({ ok: true, json: async () => saved });
    vi.stubGlobal("fetch", fetchMock);

    render(<RolesPermissionsPage initialData={data} />);
    await interaction.click(screen.getByRole("switch", { name: "Studio lead: Manage internal quotation costs" }));
    await interaction.click(screen.getByRole("button", { name: "Actions for Studio lead" }));
    await interaction.click(await screen.findByRole("menuitem", { name: "Edit role" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit custom role" });
    await interaction.clear(within(dialog).getByRole("textbox", { name: /Role name/ }));
    await interaction.type(within(dialog).getByRole("textbox", { name: /Role name/ }), "Studio director");
    await interaction.click(within(dialog).getByRole("button", { name: "Save role" }));

    expect(await screen.findByText(/Studio director details saved.*unsaved permission changes remain/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Studio director: Manage internal quotation costs" })).toBeChecked();
    await interaction.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      workspaceId: data.workspaceId, version: 2,
      permissionCodes: expect.arrayContaining(["commercial.costs.manage"]),
    });
  });

  it("shows team and invite assignments instead of offering deletion", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(rolesPermissionsFixture);
    const role = data.roles.find((item) => item.code === "studio_lead")!;
    role.teamCount = 1;
    role.pendingInvitationCount = 2;
    render(<RolesPermissionsPage initialData={data} />);

    expect(screen.getByText("1 team")).toBeInTheDocument();
    expect(screen.getByText("2 pending invites")).toBeInTheDocument();
    expect(screen.getByText(/Reassign members, teams and pending invites before deleting this role/)).toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Actions for Studio lead" }));
    expect(await screen.findByRole("menuitem", { name: "Edit role" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete role" })).not.toBeInTheDocument();
  });
});
