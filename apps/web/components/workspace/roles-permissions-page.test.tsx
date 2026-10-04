import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rolesPermissionsFixture } from "@/lib/workspace/roles-permissions";
import { RolesPermissionsPage } from "./roles-permissions-page";

afterEach(() => {
  vi.unstubAllGlobals();
});

const rolesNav = () => within(screen.getByRole("navigation", { name: "Roles" }));
const level = (module: string) => within(screen.getByRole("radiogroup", { name: `${module} access` }));
const saveBar = () => within(screen.getByRole("region", { name: "Unsaved changes" }));
const body = (mock: ReturnType<typeof vi.fn>, call = 0) => JSON.parse(String(mock.mock.calls[call][1]?.body));

describe("RolesPermissionsPage", () => {
  it("says when only one person, or nobody, can approve orders, output, stock corrections or bills", () => {
    const data = structuredClone(rolesPermissionsFixture);
    const owner = data.roles.find((role) => role.code === "owner")!;
    owner.permissions = [...new Set([...owner.permissions, "purchasing.approve", "factory.approve"])];
    data.roles.push({ ...owner, id: "approver-role", code: "purchasing_approver", name: "Purchasing approver", isSystem: false, permissions: ["purchasing.approve"] });
    data.members = [...(data.members ?? []), { ...(data.members ?? [])[0], id: "second", displayName: "Second approver", roles: ["purchasing_approver"] }];
    render(<RolesPermissionsPage initialData={data} />);
    const warning = screen.getByText(/Approvals need a second person/).closest(".wd-callout") ?? document.body;
    expect(within(warning as HTMLElement).queryByText(/approve orders/)).not.toBeInTheDocument();
    expect(within(warning as HTMLElement).getByText(/Only one person can approve factory output\./)).toBeInTheDocument();
    expect(within(warning as HTMLElement).getByText(/Only one person can approve supplier bills\./)).toBeInTheDocument();
  });

  it("lists roles with their people and shows one access level per module", () => {
    render(<RolesPermissionsPage initialData={structuredClone(rolesPermissionsFixture)} />);
    const nav = rolesNav();
    expect(nav.getByRole("button", { name: /^Studio lead.*0 members/ })).toHaveAttribute("aria-current", "true");
    expect(nav.getByRole("button", { name: /^Owner.*1 member/ }).querySelectorAll(".wd-avatar")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "Studio lead" })).toBeInTheDocument();
    expect(level("Planning").getByRole("radio", { name: "View" })).toHaveAttribute("aria-checked", "true");
    expect(level("Woddy").getByRole("radio", { name: "View" })).toHaveAttribute("aria-checked", "true");
    expect(level("Purchasing").getByRole("radio", { name: "No access" })).toHaveAttribute("aria-checked", "true");
    // Woddy has nothing to edit or manage; each level says what it gives on hover.
    expect(level("Woddy").getByRole("radio", { name: "Manage" })).toBeDisabled();
    expect(level("Sales").getByRole("radio", { name: "Edit" }).getAttribute("title")).toMatch(/^Edit: .*Manage opportunities/);
  });

  it("saves a module level from the change bar as levels and extras", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(rolesPermissionsFixture);
    const role = data.roles.find((item) => item.code === "studio_lead")!;
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => ({ ok: true, json: async () => ({ ...role, version: 2, permissions: [...role.permissions, "purchasing.view", "vendors.view", "supplier_offers.view"], ...(init ? {} : {}) }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<RolesPermissionsPage initialData={data} />);

    await interaction.click(level("Purchasing").getByRole("radio", { name: "View" }));
    expect(saveBar().getByText("3 changes")).toBeInTheDocument();
    expect(rolesNav().getByText("Unsaved")).toBeInTheDocument();
    await interaction.click(saveBar().getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/workspace/roles/${role.id}/access`);
    expect(body(fetchMock)).toMatchObject({ workspaceId: data.workspaceId, version: 1, levels: { purchasing: "view", planning: "view" }, extras: expect.arrayContaining(["pre_projects.create", "commercial.approve"]) });
    expect(await screen.findByText("Studio lead permissions updated.")).toBeInTheDocument();
  });

  it("gives a single permission under Advanced and shows what the level already includes", async () => {
    const interaction = userEvent.setup();
    render(<RolesPermissionsPage initialData={structuredClone(rolesPermissionsFixture)} />);
    const planning = screen.getByRole("radiogroup", { name: "Planning access" }).closest("li")!;
    await interaction.click(within(planning).getByRole("button", { name: /Advanced/ }));
    const fine = within(planning).getByRole("list", { name: "Planning permissions" });
    expect(within(fine).getByRole("checkbox", { name: /View planning cases/ })).toBeDisabled();
    expect(within(fine).getAllByText("Included in View").length).toBeGreaterThan(0);
    await interaction.click(within(fine).getByRole("checkbox", { name: /Publish scope confirmation/ }));
    expect(saveBar().getByText("1 change")).toBeInTheDocument();
    await interaction.click(saveBar().getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument();
  });

  it("keeps built-in roles read-only", async () => {
    const interaction = userEvent.setup();
    render(<RolesPermissionsPage initialData={structuredClone(rolesPermissionsFixture)} />);
    await interaction.click(rolesNav().getByRole("button", { name: /Owner/ }));
    expect(screen.getByText(/Built-in roles keep their access/)).toBeInTheDocument();
    expect(level("Settings").getByRole("radio", { name: "Manage" })).toHaveAttribute("aria-checked", "true");
    expect(level("Settings").getByRole("radio", { name: "View" })).toBeDisabled();
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument();
  });

  it("offers only the levels a scoped editor can give", () => {
    const data = structuredClone(rolesPermissionsFixture);
    const role = data.roles.find((item) => item.code === "studio_lead")!;
    data.delegablePermissions = [...role.permissions, "purchasing.view", "vendors.view", "supplier_offers.view"];
    render(<RolesPermissionsPage initialData={data} />);
    expect(level("Purchasing").getByRole("radio", { name: "View" })).toBeEnabled();
    expect(level("Purchasing").getByRole("radio", { name: "Edit" })).toBeDisabled();
  });

  it("resets a role built from a template after confirmation", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(rolesPermissionsFixture);
    const role = data.roles.find((item) => item.code === "studio_lead")!;
    role.templateCode = "studio_lead";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...role, version: 2 }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<RolesPermissionsPage initialData={data} />);
    expect(screen.getByText("From a template")).toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Actions for Studio lead" }));
    await interaction.click(await screen.findByRole("menuitem", { name: "Reset to template" }));
    const dialog = await screen.findByRole("dialog", { name: "Reset to template?" });
    await interaction.click(within(dialog).getByRole("button", { name: "Reset to template" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/workspace/roles/${role.id}/reset-to-template`);
    expect(body(fetchMock)).toEqual({ workspaceId: data.workspaceId, version: 1 });
    expect(await screen.findByText("Studio lead is back to its template.")).toBeInTheDocument();
  });

  it("adds and removes people on the Members tab, and keeps the last owner", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(rolesPermissionsFixture);
    data.members = [...(data.members ?? []), { id: "m-2", displayName: "Sara Sales", email: "sara@example.com", roles: ["member"], directRoles: ["member"], version: 4 }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "m-2", version: 5, roles: ["member", "studio_lead"] }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<RolesPermissionsPage initialData={data} />);

    await interaction.click(screen.getByRole("tab", { name: /Members/ }));
    expect(screen.getByText("Nobody has this role yet")).toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: /Add a person/ }));
    await interaction.click(await screen.findByRole("option", { name: /Sara Sales/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspace/members/m-2");
    expect(body(fetchMock)).toEqual({ workspaceId: data.workspaceId, version: 4, roleCodes: ["member", "studio_lead"] });
    expect(await screen.findByText("Sara Sales now has Studio lead.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();

    await interaction.click(rolesNav().getByRole("button", { name: /Owner/ }));
    await interaction.click(screen.getByRole("tab", { name: /Members/ }));
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
  });

  it("creates a custom role with an automatically generated code", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(rolesPermissionsFixture);
    const createdRole = { id: "00000000-0000-4000-8000-000000000009", code: "project_coordinator", name: "Project coordinator", description: "Coordinates project access.", isSystem: false, version: 1, memberCount: 0, permissions: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => createdRole });
    vi.stubGlobal("fetch", fetchMock);
    render(<RolesPermissionsPage initialData={data} />);
    await interaction.click(screen.getByRole("button", { name: "New role" }));
    const dialog = await screen.findByRole("dialog", { name: "Create custom role" });
    await interaction.type(within(dialog).getByRole("textbox", { name: /Role name/ }), "Project coordinator");
    expect(within(dialog).getByRole("textbox", { name: /Role code/ })).toHaveValue("project_coordinator");
    await interaction.click(within(dialog).getByRole("button", { name: "Save role" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(body(fetchMock)).toMatchObject({ code: "project_coordinator", name: "Project coordinator", permissionCodes: [] });
    expect(await screen.findByText("Project coordinator was saved.")).toBeInTheDocument();
    expect(level("Sales").getByRole("radio", { name: "No access" })).toHaveAttribute("aria-checked", "true");
  });

  it("duplicates a role with its access", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(rolesPermissionsFixture);
    const source = data.roles.find((role) => role.code === "studio_lead")!;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...source, id: "copy", code: "studio_lead_copy", name: "Studio lead copy" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<RolesPermissionsPage initialData={data} />);
    await interaction.click(screen.getByRole("button", { name: "Actions for Studio lead" }));
    await interaction.click(await screen.findByRole("menuitem", { name: "Duplicate role" }));
    const dialog = await screen.findByRole("dialog", { name: "Duplicate Studio lead" });
    await interaction.click(within(dialog).getByRole("button", { name: "Save role" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(body(fetchMock)).toMatchObject({ code: "studio_lead_copy", permissionCodes: source.permissions });
  });

  it("asks for reassignment before deleting an assigned role, and deletes an unassigned one", async () => {
    const interaction = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const data = structuredClone(rolesPermissionsFixture);
    const { unmount } = render(<RolesPermissionsPage initialData={{ ...data, roles: data.roles.map((role) => role.code === "studio_lead" ? { ...role, teamCount: 1 } : role) }} />);
    await interaction.click(screen.getByRole("button", { name: "Actions for Studio lead" }));
    await interaction.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(within(await screen.findByRole("dialog", { name: "Delete custom role?" })).getByText("Reassign members, teams and pending invites before deleting this role.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();

    render(<RolesPermissionsPage initialData={structuredClone(rolesPermissionsFixture)} />);
    await interaction.click(screen.getByRole("button", { name: "Actions for Studio lead" }));
    await interaction.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await interaction.click(within(await screen.findByRole("dialog", { name: "Delete custom role?" })).getByRole("button", { name: "Delete role" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(await screen.findByText("Studio lead was deleted.")).toBeInTheDocument();
  });
});
