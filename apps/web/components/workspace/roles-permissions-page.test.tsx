import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rolesPermissionsFixture } from "@/lib/workspace/roles-permissions";
import { RolesPermissionsPage } from "./roles-permissions-page";

afterEach(() => {
  vi.unstubAllGlobals();
});

const rolesNav = () => within(screen.getByRole("navigation", { name: "Roles" }));
const area = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name} \\d+ of \\d+ on$`) });

describe("RolesPermissionsPage", () => {
  it("lists roles beside the selected role and groups capabilities by area with counts", () => {
    render(<RolesPermissionsPage initialData={structuredClone(rolesPermissionsFixture)} />);

    const nav = rolesNav();
    expect(nav.getByRole("button", { name: /Owner Built-in/ })).toBeInTheDocument();
    expect(nav.getByRole("button", { name: /Studio lead Custom 0 members/ })).toHaveAttribute("aria-current", "true");
    expect(nav.getByRole("button", { name: /Owner Built-in 1 member/ }).querySelectorAll(".wd-avatar")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "Studio lead" })).toBeInTheDocument();
    expect(screen.getByText("Coordinates design, pricing, delivery and the studio team.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "0 members" })).toHaveAttribute("href", "/workspace/members?role=studio_lead");

    expect(screen.getByRole("button", { name: "Company 5 of 29 on" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Sales 5 of 26 on" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Planning & design 5 of 9 on" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quotations & finance 2 of 8 on" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Projects & work 4 of 7 on" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Supply & catalog 2 of 7 on" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Client portal 0 of 2 on" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "People 2 of 4 on" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI & platform 1 of 1 on" })).toBeInTheDocument();
    // Only the first area starts open; its rows carry no product-area column or icon.
    expect(screen.getByRole("switch", { name: "Studio lead: View organization profile" })).toBeChecked();
    expect(screen.queryByRole("switch", { name: "Studio lead: Manage internal quotation costs" })).not.toBeInTheDocument();
    expect(screen.queryByText("Product area")).not.toBeInTheDocument();
    expect(within(screen.getByRole("switch", { name: "Studio lead: Delete organization profile" }).closest("li")!).getByText("Sensitive")).toBeInTheDocument();
  });

  it("saves a changed capability from the sticky change bar", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(rolesPermissionsFixture);
    const customRole = data.roles.find((role) => role.code === "studio_lead")!;
    const savedRole = { ...customRole, version: 2, permissions: [...customRole.permissions, "commercial.costs.manage"] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => savedRole });
    vi.stubGlobal("fetch", fetchMock);

    render(<RolesPermissionsPage initialData={data} />);
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument();
    await interaction.click(area("Quotations & finance"));
    const costSwitch = screen.getByRole("switch", { name: "Studio lead: Manage internal quotation costs" });
    expect(costSwitch).not.toBeChecked();
    await interaction.click(costSwitch);

    const bar = within(screen.getByRole("region", { name: "Unsaved changes" }));
    expect(bar.getByText("1 change")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quotations & finance 3 of 8 on" })).toBeInTheDocument();
    await interaction.click(bar.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/workspace/roles/${customRole.id}`);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      workspaceId: data.workspaceId,
      version: 1,
      permissionCodes: expect.arrayContaining(["module.organization.read", "projects.manage", "hrms.self", "commercial.costs.manage"]),
    });
    expect(await screen.findByText("Studio lead permissions updated.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument();
  });

  it("discards draft changes from the change bar", async () => {
    const interaction = userEvent.setup();
    render(<RolesPermissionsPage initialData={structuredClone(rolesPermissionsFixture)} />);

    await interaction.click(screen.getByRole("switch", { name: "Studio lead: View organization profile" }));
    expect(screen.getByRole("button", { name: "Company 4 of 29 on" })).toBeInTheDocument();
    await interaction.click(within(screen.getByRole("region", { name: "Unsaved changes" })).getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("button", { name: "Company 5 of 29 on" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument();
  });

  it("shows a mixed area toggle that grants or removes the whole area", async () => {
    const interaction = userEvent.setup();
    render(<RolesPermissionsPage initialData={structuredClone(rolesPermissionsFixture)} />);

    const toggle = screen.getByRole("checkbox", { name: "All Company capabilities for Studio lead" });
    expect(toggle).toHaveAttribute("aria-checked", "mixed");
    await interaction.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Company 29 of 29 on" })).toBeInTheDocument();
    expect(screen.getByText("24 changes")).toBeInTheDocument();
    await interaction.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "Company 0 of 29 on" })).toBeInTheDocument();
    expect(screen.getByText("5 changes")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "All Client portal capabilities for Studio lead" })).toHaveAttribute("aria-checked", "false");
  });

  it("filters by search and expands only the areas with matches", async () => {
    const interaction = userEvent.setup();
    render(<RolesPermissionsPage initialData={structuredClone(rolesPermissionsFixture)} />);

    await interaction.type(screen.getByRole("searchbox", { name: "Search capabilities" }), "quotation costs");
    expect(screen.getByRole("button", { name: "Quotations & finance 2 of 8 on" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("button", { name: /^Company / })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Studio lead: Manage internal quotation costs" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Studio lead: View internal quotation costs" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Studio lead: Approve deal file" })).not.toBeInTheDocument();

    await interaction.clear(screen.getByRole("searchbox", { name: "Search capabilities" }));
    await interaction.type(screen.getByRole("searchbox", { name: "Search capabilities" }), "nothing matches this");
    await interaction.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByRole("button", { name: "Company 5 of 29 on" })).toBeInTheDocument();
  });

  it("filters to granted or not granted capabilities", async () => {
    const interaction = userEvent.setup();
    render(<RolesPermissionsPage initialData={structuredClone(rolesPermissionsFixture)} />);

    await interaction.click(screen.getByRole("radio", { name: "Granted" }));
    expect(screen.getByRole("switch", { name: "Studio lead: View organization profile" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Studio lead: Delete organization profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Client portal / })).not.toBeInTheDocument();
    await interaction.click(screen.getByRole("radio", { name: "Not granted" }));
    expect(screen.queryByRole("switch", { name: "Studio lead: View organization profile" })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Studio lead: Delete organization profile" })).toBeInTheDocument();
  });

  it("keeps built-in roles read-only with a lock note", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(rolesPermissionsFixture);
    data.roles = data.roles.filter((role) => role.code !== "studio_lead");
    render(<RolesPermissionsPage initialData={data} />);

    expect(screen.getByRole("heading", { level: 2, name: "Owner" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "1 member" })).toHaveAttribute("href", "/workspace/members?role=owner");
    expect(screen.getByRole("switch", { name: "Owner: View organization profile" })).toBeDisabled();
    expect(screen.queryByRole("checkbox", { name: "All Company capabilities for Owner" })).not.toBeInTheDocument();
    expect(screen.getByText("System role permissions are managed by Wodana and cannot be changed.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument();

    await interaction.click(rolesNav().getByRole("button", { name: /Administrator Built-in/ }));
    expect(screen.getByRole("heading", { level: 2, name: "Administrator" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Administrator: View organization profile" })).toBeDisabled();
    // Duplicating a built-in role is the way to start from its capabilities.
    await interaction.click(screen.getByRole("button", { name: "Actions for Administrator" }));
    expect(await screen.findByRole("menuitem", { name: "Duplicate" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("shows a restricted custom role without mutation controls", () => {
    const data = structuredClone(rolesPermissionsFixture);
    data.canCreate = false;
    data.canEdit = false;
    data.canDelete = false;
    data.memberCount = null;
    render(<RolesPermissionsPage initialData={data} />);

    expect(screen.getByRole("switch", { name: "Studio lead: View organization profile" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "New role" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actions for Studio lead" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "All Company capabilities for Studio lead" })).not.toBeInTheDocument();
    expect(screen.getByText("You can review this role. Permission changes require role editing access.")).toBeInTheDocument();
  });

  it("does not offer editing of a role with grants beyond the editor's access", () => {
    const data = structuredClone(rolesPermissionsFixture);
    data.canCreate = false;
    data.canDelete = false;
    data.delegablePermissions = ["module.roles.edit", "commercial.costs.manage"];
    render(<RolesPermissionsPage initialData={data} />);

    expect(screen.getByRole("switch", { name: "Studio lead: View organization profile" })).toBeDisabled();
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument();
    expect(screen.getByText("This role contains permissions outside your access and is read-only for you.")).toBeInTheDocument();
  });

  it("lets a scoped editor change only capabilities they hold", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(rolesPermissionsFixture);
    const customRole = data.roles.find((role) => role.code === "studio_lead")!;
    customRole.permissions = ["module.roles.edit"];
    data.canCreate = false;
    data.canDelete = false;
    data.delegablePermissions = ["module.roles.edit", "commercial.costs.manage"];
    render(<RolesPermissionsPage initialData={data} />);

    await interaction.click(area("Quotations & finance"));
    expect(screen.getByRole("switch", { name: "Studio lead: Manage internal quotation costs" })).toBeEnabled();
    expect(screen.getByRole("switch", { name: "Studio lead: Approve deal file" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "All Quotations & finance capabilities for Studio lead" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "All Sales capabilities for Studio lead" })).toBeDisabled();
    expect(screen.getByText("You can grant only permissions you hold.")).toBeInTheDocument();
  });

  it("creates a custom role with an automatically generated code", async () => {
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
      permissions: [],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => createdRole });
    vi.stubGlobal("fetch", fetchMock);

    render(<RolesPermissionsPage initialData={data} />);
    await interaction.click(screen.getByRole("button", { name: "New role" }));
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
    expect(screen.getByRole("heading", { level: 2, name: "Project coordinator" })).toBeInTheDocument();
  });

  it("duplicates a role with its capabilities", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(rolesPermissionsFixture);
    const source = data.roles.find((role) => role.code === "studio_lead")!;
    const createdRole = { ...source, id: "00000000-0000-4000-8000-000000000010", code: "studio_lead_copy", name: "Studio lead copy" };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => createdRole });
    vi.stubGlobal("fetch", fetchMock);

    render(<RolesPermissionsPage initialData={data} />);
    await interaction.click(screen.getByRole("button", { name: "Actions for Studio lead" }));
    await interaction.click(await screen.findByRole("menuitem", { name: "Duplicate" }));
    const dialog = await screen.findByRole("dialog", { name: "Duplicate Studio lead" });
    expect(within(dialog).getByRole("textbox", { name: /Role name/ })).toHaveValue("Studio lead copy");
    expect(within(dialog).getByRole("textbox", { name: /Role code/ })).toHaveValue("studio_lead_copy");
    await interaction.click(within(dialog).getByRole("button", { name: "Save role" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      code: "studio_lead_copy",
      name: "Studio lead copy",
      description: source.description,
      permissionCodes: source.permissions,
    });
    expect(await screen.findByText("Studio lead copy was saved.")).toBeInTheDocument();
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
    await interaction.click(area("Quotations & finance"));
    await interaction.click(screen.getByRole("switch", { name: "Studio lead: Manage internal quotation costs" }));
    await interaction.click(screen.getByRole("button", { name: "Actions for Studio lead" }));
    await interaction.click(await screen.findByRole("menuitem", { name: "Edit details" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit custom role" });
    await interaction.clear(within(dialog).getByRole("textbox", { name: /Role name/ }));
    await interaction.type(within(dialog).getByRole("textbox", { name: /Role name/ }), "Studio director");
    await interaction.click(within(dialog).getByRole("button", { name: "Save role" }));

    expect(await screen.findByText(/Studio director details saved.*unsaved permission changes remain/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Studio director: Manage internal quotation costs" })).toBeChecked();
    await interaction.click(within(screen.getByRole("region", { name: "Unsaved changes" })).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      workspaceId: data.workspaceId, version: 2,
      permissionCodes: expect.arrayContaining(["commercial.costs.manage"]),
    });
  });

  it("asks for reassignment instead of deleting an assigned role", async () => {
    const interaction = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const data = structuredClone(rolesPermissionsFixture);
    const role = data.roles.find((item) => item.code === "studio_lead")!;
    role.teamCount = 1;
    role.pendingInvitationCount = 2;
    render(<RolesPermissionsPage initialData={data} />);

    expect(screen.getByText("1 team")).toBeInTheDocument();
    expect(screen.getByText("2 pending invites")).toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Actions for Studio lead" }));
    await interaction.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete custom role?" });
    expect(within(dialog).getByText("Reassign members, teams and pending invites before deleting this role.")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open People" })).toHaveAttribute("href", "/workspace/members?role=studio_lead");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deletes an unassigned custom role after confirmation", async () => {
    const interaction = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const data = structuredClone(rolesPermissionsFixture);
    render(<RolesPermissionsPage initialData={data} />);

    await interaction.click(screen.getByRole("button", { name: "Actions for Studio lead" }));
    await interaction.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete custom role?" });
    await interaction.click(within(dialog).getByRole("button", { name: "Delete role" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/workspace/roles/00000000-0000-4000-8000-000000000008?workspaceId=");
    expect(await screen.findByText("Studio lead was deleted.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Owner" })).toBeInTheDocument();
  });
});
