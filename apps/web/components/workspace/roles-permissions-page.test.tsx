import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rolesPermissionsFixture } from "@/lib/workspace/roles-permissions";
import { RolesPermissionsPage } from "./roles-permissions-page";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RolesPermissionsPage", () => {
  it("shows a role dropdown and saves module permissions for a custom role", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(rolesPermissionsFixture);
    const customRole = data.roles.find((role) => role.code === "studio_lead")!;
    const savedRole = {
      ...customRole,
      version: 2,
      permissions: [...customRole.permissions, "module.integrations.write"],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => savedRole });
    vi.stubGlobal("fetch", fetchMock);

    render(<RolesPermissionsPage initialData={data} />);

    expect(screen.getByLabelText("Role")).toHaveTextContent("Studio lead");
    const integrationSwitch = screen.getByRole("switch", { name: "Studio lead: Integrations Write" });
    expect(integrationSwitch).not.toBeChecked();
    await interaction.click(integrationSwitch);
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
        "module.members.edit",
        "module.teams.read",
        "module.integrations.write",
      ]),
    });
    expect(await screen.findByText("Studio lead permissions updated.")).toBeInTheDocument();
  });

  it("keeps system role permissions read-only", () => {
    const data = structuredClone(rolesPermissionsFixture);
    data.roles = data.roles.filter((role) => role.code !== "studio_lead");
    render(<RolesPermissionsPage initialData={data} />);

    expect(screen.getByRole("switch", { name: "Owner: Organization profile Read" })).toBeDisabled();
    expect(screen.getByText("System role permissions are managed by Wodana and cannot be changed.")).toBeInTheDocument();
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
});
