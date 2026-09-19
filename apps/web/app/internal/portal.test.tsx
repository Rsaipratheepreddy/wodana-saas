import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManagedDomain, ManagedTenant, ManagedTenantAccess, ManagedTenantStatus } from "@/lib/internal/types";
import InternalLoading from "./loading";
import { InternalPortal } from "./portal";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/lib/use-workspace-theme", () => ({
  useWorkspaceTheme: () => ({ theme: "light", toggleTheme: vi.fn() }),
}));

const tenant: ManagedTenant = {
  externalTenantId: "tenant-iglo",
  integrations: [{ count: 4, provider: "google", status: "connected" }],
  onboarding: { completedSteps: ["workspace_profile"], currentStep: null, status: "completed" },
  owner: { email: "owner@example.com", name: "Tenant owner" },
  ownerInvitation: { acceptedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-09-08T00:00:00.000Z", status: "accepted" },
  subscription: {
    amount: "999.00",
    billingCycle: "monthly",
    currency: "INR",
    note: null,
    planCode: "starter",
    projectLimit: 25,
    renewsAt: "2026-09-21T00:00:00.000Z",
    seatLimit: 5,
    startedAt: "2026-09-01T00:00:00.000Z",
    status: "trial",
    updatedAt: "2026-09-07T00:00:00.000Z",
    version: 1,
  },
  usage: { members: 4, pendingInvitations: 1, reservedSeats: 5, projects: 2 },
  workspace: {
    createdAt: "2026-09-01T00:00:00.000Z",
    defaultCurrency: "INR",
    defaultLocale: "en-IN",
    defaultTimezone: "Asia/Kolkata",
    id: "f81e8362-8d08-440a-89dd-06ec7a8b46e7",
    name: "Iglo Architects",
    slug: "iglo-architects",
    status: "active",
    updatedAt: "2026-09-07T00:00:00.000Z",
    version: 1,
  },
};

const status: ManagedTenantStatus = {
  account: { id: "account-1", displayName: "Iglo Group", status: "active", organizationCount: 1, organizationLimit: 2, isDefaultOrganization: true },
  organization: { id: tenant.workspace.id, name: tenant.workspace.name, slug: tenant.workspace.slug, status: "active", version: 1, updatedAt: tenant.workspace.updatedAt },
  owner: tenant.owner,
  onboarding: tenant.onboarding,
  ownerInvitation: { ...tenant.ownerInvitation!, deliveryStatus: "untracked" },
  seats: { limit: 5, activeMembers: 4, pendingInvitations: 1, reserved: 5, available: 0 },
  plan: { code: "starter", status: "trial", billingCycle: "monthly", currency: "INR", amount: "999.00", renewsAt: tenant.subscription.renewsAt, projectLimit: 25, version: 1, updatedAt: tenant.subscription.updatedAt },
  domain: { platformSlug: "iglo-architects", customDomainStatus: "not_configured" },
  commercialEntitlements: { status: "not_configured" },
  observedAt: "2026-09-17T00:00:00.000Z",
};

const access: ManagedTenantAccess = {
  externalTenantId: tenant.externalTenantId,
  organization: { id: tenant.workspace.id, name: tenant.workspace.name, slug: tenant.workspace.slug },
  entitlement: { status: "active", modules: ["workspace", "crm"], planCode: "starter", planVersion: 1, version: 1 },
  seats: {
    limit: 5, used: 4, activeMembers: 4, invitedMembers: 0,
    pendingInvitations: 1, reserved: 5, available: 0,
    policy: "Active and invited memberships plus non-expired pending invitations reserve one seat each.",
  },
  members: [{
    id: "membership-1", userId: "user-1", email: "owner@example.com", displayName: "Tenant owner",
    status: "active", joinedAt: "2026-09-01T00:00:00.000Z",
    access: {
      directRoles: [{ id: "role-1", code: "owner", name: "Owner" }],
      inheritedRoles: [{ teamId: "team-1", teamName: "Sales", roleId: "role-2", roleCode: "sales", roleName: "Sales manager" }],
      grantedPermissions: ["crm.leads.view", "workspace.settings.manage"],
      effectivePermissions: ["crm.leads.view", "workspace.settings.manage"],
      effectiveModules: ["crm", "workspace"],
      recordScope: { kind: "organization", explanation: "Organization-wide" },
      reasons: ["Direct role assignment grants workspace permissions.", "Active team membership contributes inherited roles."],
    },
  }],
  invitations: [{
    id: "invite-1", email: "sales@example.com", status: "pending",
    expiresAt: "2026-09-25T00:00:00.000Z", createdAt: "2026-09-18T00:00:00.000Z",
    reservesSeat: true, directRoles: [], teams: [{ id: "team-1", name: "Sales", roleCodes: ["sales"] }],
  }],
  observedAt: "2026-09-18T00:00:00.000Z",
};

afterEach(() => { vi.unstubAllGlobals(); navigation.push.mockClear(); });

describe("InternalPortal", () => {
  it("keeps tenant management focused until a tenant is selected", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith("/domains") ? { platformHostname: "iglo-architects.wodana.ai", domains: [] } : status })));
    const interaction = userEvent.setup();
    render(<InternalPortal initialTenants={[tenant]} user={{ email: "admin@wodana.test", name: "Wodana admin" }} />);

    expect(screen.getByRole("heading", { name: "Tenants" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Internal portal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open navigation" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search tenants" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Back to workspace" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Iglo Architects" })).not.toBeInTheDocument();

    await interaction.click(screen.getByRole("row", { name: /Iglo Architects/ }));
    expect(screen.getByRole("dialog", { name: "Iglo Architects" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Open Billing and usage" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Seat limit" })).not.toBeInTheDocument();
    expect(await screen.findByText("4 active · 0 invited · 1 pending · 0 available")).toBeVisible();
    expect(screen.getByText("Invitation accepted · delivery untracked")).toBeVisible();
    expect(screen.getByText("Next: review team access before inviting staff.")).toBeVisible();
    expect(screen.getByText("Custom domain not configured")).toBeVisible();

    await interaction.click(screen.getByRole("button", { name: "Close inspector" }));
    expect(screen.queryByRole("dialog", { name: "Iglo Architects" })).not.toBeInTheDocument();
  });

  it("keeps an unavailable status separate from existing tenant details", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/domains")
      ? { ok: true, json: async () => ({ platformHostname: "iglo-architects.wodana.ai", domains: [] }) }
      : url.endsWith("/access")
        ? { ok: true, json: async () => access }
        : { ok: false, json: async () => ({ message: "Status service unavailable" }) }));
    const interaction = userEvent.setup();
    render(<InternalPortal initialTenants={[tenant]} user={{ email: "admin@wodana.test", name: "Wodana admin" }} />);

    await interaction.click(screen.getByRole("row", { name: /Iglo Architects/ }));
    expect(await screen.findByText("Status service unavailable")).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Open Billing and usage" })).toBeVisible();
  });

  it("searches the shared tenant grid and opens the dedicated setup flow", async () => {
    const interaction = userEvent.setup();
    const second: ManagedTenant = {
      ...tenant,
      externalTenantId: "tenant-second",
      owner: { email: "owner@second.test", name: "Second owner" },
      workspace: { ...tenant.workspace, id: "5c382040-bd63-473f-9bd9-d93aef71a02d", name: "Second Studio", slug: "second-studio" },
    };
    render(<InternalPortal initialTenants={[tenant, second]} user={{ email: "admin@wodana.test", name: "Wodana admin" }} />);

    await interaction.type(screen.getByRole("searchbox", { name: "Search tenants" }), "Second");
    expect(screen.getByRole("row", { name: /Second Studio/ })).toBeVisible();
    expect(screen.queryByRole("row", { name: /Iglo Architects/ })).not.toBeInTheDocument();

    await interaction.click(screen.getByRole("button", { name: "Add customer" }));
    expect(navigation.push).toHaveBeenCalledWith("/internal/new");
    expect(screen.queryByRole("dialog", { name: "Add customer account" })).not.toBeInTheDocument();
  });

  it("shows a usable empty state instead of an empty table", async () => {
    render(<InternalPortal initialTenants={[]} user={{ email: "admin@wodana.test", name: "Wodana admin" }} />);
    expect(screen.getByText("No organizations yet")).toBeVisible();
    expect(screen.getByText("Add the first customer account to provision its organization.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Add customer" })).toBeVisible();
    expect(screen.queryByRole("table", { name: "Customer organizations" })).not.toBeInTheDocument();
  });

  it("gives a pending owner a truthful next action", async () => {
    const pending: ManagedTenantStatus = {
      ...status,
      onboarding: { completedSteps: [], currentStep: "owner_activation", status: "in_progress" },
      ownerInvitation: { acceptedAt: null, deliveryStatus: "untracked", expiresAt: "2026-09-24T00:00:00.000Z", status: "pending" },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => pending }));
    const interaction = userEvent.setup();
    render(<InternalPortal initialTenants={[tenant]} user={{ email: "admin@wodana.test", name: "Wodana admin" }} />);
    await interaction.click(screen.getByRole("row", { name: /Iglo Architects/ }));
    expect(await screen.findByText("Next: create and share an owner activation link.")).toBeVisible();
    expect(screen.getByText("Invitation pending · delivery untracked")).toBeVisible();
  });

  it("shows a DNS challenge without claiming the custom domain is live", async () => {
    const domain: ManagedDomain = {
      id: "36db8308-9b55-46fc-951f-a963d390e321", hostname: "portal.example.com", version: 1,
      dns: { status: "pending", record: { type: "TXT", name: "_wodana-verify.portal.example.com", value: "wodana-verify=opaque" }, expiresAt: "2026-09-19T00:00:00.000Z", verifiedAt: null },
      certificate: { status: "not_requested", expiresAt: null }, routing: { status: "not_requested", activatedAt: null },
      rollback: { status: "none" }, removedAt: null, updatedAt: "2026-09-17T00:00:00.000Z",
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/domains") && (!init?.method || init.method === "GET")) return { ok: true, json: async () => ({ domains: [domain] }) };
      if (url.endsWith("/verify")) {
        domain.dns.status = "verified";
        domain.certificate.status = "manual_setup_required";
        domain.version = 2;
        return { ok: true, json: async () => domain };
      }
      if (url.endsWith("/recheck")) {
        domain.dns.status = "failed";
        domain.version = 3;
        domain.issues = ["DNS ownership record is missing"];
        return { ok: true, json: async () => domain };
      }
      return { ok: true, json: async () => status };
    });
    vi.stubGlobal("fetch", fetchMock);
    const interaction = userEvent.setup();
    render(<InternalPortal initialTenants={[tenant]} user={{ email: "admin@wodana.test", name: "Wodana admin" }} />);
    await interaction.click(screen.getByRole("row", { name: /Iglo Architects/ }));
    expect(await screen.findByText("_wodana-verify.portal.example.com")).toBeVisible();
    expect(screen.getByText("wodana-verify=opaque")).toBeVisible();
    expect(screen.getByText("DNS pending")).toBeVisible();
    await interaction.click(screen.getByRole("button", { name: "Verify DNS" }));
    expect(await screen.findByText("Ownership is verified. Certificate and routing are not connected yet; keep using the Wodana address.")).toBeVisible();
    expect(screen.queryByText("Active", { selector: "[class*=domainTitle] *" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/verify"), expect.objectContaining({ method: "POST" }));
    await interaction.click(screen.getByRole("button", { name: "Recheck DNS" }));
    expect(await screen.findByText("DNS ownership record is missing", { exact: false })).toBeVisible();
    expect(screen.getByText("Needs attention")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/recheck"), expect.objectContaining({ method: "POST" }));
    await interaction.click(screen.getByRole("button", { name: "Remove request" }));
    expect(screen.getByRole("dialog", { name: "Remove domain request?" })).toBeVisible();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/remove"))).toBe(false);
  });

  it("explains team-inherited access and opens the authoritative lifecycle view", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/access")) return { ok: true, json: async () => access };
      if (url.endsWith("/domains")) return { ok: true, json: async () => ({ domains: [] }) };
      return { ok: true, json: async () => status };
    });
    vi.stubGlobal("fetch", fetchMock);
    const interaction = userEvent.setup();
    render(<InternalPortal initialTenants={[tenant]} user={{
      email: "security@wodana.test", name: "Security owner",
      role: "platform_security_owner", permissions: ["tenants.read", "lifecycle.manage", "billing.manage"],
    }} />);

    await interaction.click(screen.getByRole("row", { name: /Iglo Architects/ }));
    expect(await screen.findByRole("table", { name: "Tenant member access" })).toBeVisible();
    expect(screen.getByText("Team · Sales → Sales manager")).toBeVisible();
    expect(screen.getByText("crm · workspace")).toBeVisible();
    expect(screen.getByText("1 live invitation reservation. Roles and teams become effective only after acceptance.")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Seat limit" })).not.toBeInTheDocument();
    expect(screen.getByText("Workspace access · active")).toBeVisible();
    await interaction.click(screen.getByRole("button", { name: "Manage lifecycle" }));
    expect(navigation.push).toHaveBeenCalledWith("/internal/tenants/tenant-iglo/operations");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("lets a billing operator inspect billing without changing workspace access", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/domains")
      ? { ok: true, json: async () => ({ domains: [] }) }
      : { ok: true, json: async () => status }));
    const interaction = userEvent.setup();
    render(<InternalPortal initialTenants={[tenant]} user={{
      email: "billing@wodana.test", name: "Billing operator",
      role: "account_billing_operator", permissions: ["tenants.read", "billing.manage"],
    }} />);
    await interaction.click(screen.getByRole("row", { name: /Iglo Architects/ }));
    expect(screen.getByText("Workspace access · active")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Workspace access/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Billing and usage" })).toBeVisible();
  });

  it("keeps a support observer read-only while still showing access reasons", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/access")) return { ok: true, json: async () => access };
      if (url.endsWith("/domains")) return { ok: true, json: async () => ({ domains: [] }) };
      return { ok: true, json: async () => status };
    }));
    const interaction = userEvent.setup();
    render(<InternalPortal initialTenants={[tenant]} user={{
      email: "support@wodana.test", name: "Support observer",
      role: "support_observer", permissions: ["tenants.read", "support.request"],
    }} />);

    expect(screen.queryByRole("button", { name: "Add customer" })).not.toBeInTheDocument();
    await interaction.click(screen.getByRole("row", { name: /Iglo Architects/ }));
    expect(await screen.findByText("Workspace access · active")).toBeVisible();
    expect(screen.getByText("Team · Sales → Sales manager")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Review access change" })).not.toBeInTheDocument();
  });
});

describe("InternalLoading", () => {
  it("uses the shared tenant grid loading state without a one-item sidebar", () => {
    render(<InternalLoading />);
    expect(screen.getByRole("heading", { name: "Tenants" })).toBeVisible();
    expect(screen.getByRole("status", { name: "Loading Customer organizations" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open navigation" })).not.toBeInTheDocument();
  });
});
