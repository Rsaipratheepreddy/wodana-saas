import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { I18nProvider } from "@/lib/i18n/i18n-provider";
import type { AccountSummary, LifecycleOverview, SupportSession } from "@/lib/internal/console";
import { AccountPage } from "./account-page";
import { AccountsPage } from "./accounts-page";
import { CreateTenantPage } from "./create-tenant-page";
import { SupportTab } from "./support-tab";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const search = vi.hoisted(() => ({ value: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => search.value, usePathname: () => "/internal" }));

type Call = { url: string; init?: RequestInit; body?: Record<string, unknown> };
function mount(respond: (url: string, init?: RequestInit) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    const value = respond(url, init);
    if (value instanceof Error) return Response.json({ message: value.message }, { status: 409 });
    return Response.json(value ?? {});
  }));
  return calls;
}

const org = (overrides: Partial<AccountSummary["organizations"][number]> = {}): AccountSummary["organizations"][number] => ({
  workspaceId: "11111111-1111-4111-8111-111111111111", key: "tenant_acme", externalTenantId: "tenant_acme", name: "Acme Interiors",
  slug: "acme", address: "acme.wodana.ai", isDefault: true, state: "active", lifecycleVersion: 2, graceEndsAt: null,
  onboardingStatus: "completed", plan: { code: "starter", version: 1 }, contract: { status: "trial_uncontracted", trialEndsAt: null },
  seats: { limit: 5, members: 3, reserved: 3, available: 2, overLimit: false, invitesBlocked: false },
  owner: { email: "owner@acme.test", invitationStatus: "accepted", deliveryStatus: "sent" },
  lastActivityAt: new Date().toISOString(), createdAt: "2026-09-01T08:00:00.000Z", attention: [], ...overrides,
});
const account = (overrides: Partial<AccountSummary> = {}): AccountSummary => ({
  id: "22222222-2222-4222-8222-222222222222", name: "Acme Group", status: "active", externalCustomerId: "tenant_acme",
  contactEmail: "contract@acme.test", organizationLimit: 1, state: "active", plan: { code: "starter", version: 1 },
  seats: { members: 3, limit: 5 }, lastActivityAt: new Date().toISOString(), attention: [], createdAt: "2026-09-01T08:00:00.000Z",
  organizations: [org()], ...overrides,
});
const lifecycle = (overrides: Partial<LifecycleOverview> = {}): LifecycleOverview => ({
  workspaceId: "11111111-1111-4111-8111-111111111111", externalTenantId: "tenant_acme", state: "active", version: 2,
  workspaceStatus: "active", graceEndsAt: null, nextStates: ["grace", "suspended", "archived"],
  readiness: { onboardingStatus: "completed", ownerInvitationStatus: "accepted", retentionPolicySet: false, legalHold: false,
    exportReady: false, exportExpiresAt: null, entitlementStatus: "active" },
  history: [], notices: [], ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
  router.push.mockReset(); router.replace.mockReset();
  search.value = new URLSearchParams();
});

describe("accounts list", () => {
  it("shows state, plan, seats used of allowed and filters by state and search", async () => {
    mount(() => ({ accounts: [account(), account({ id: "33333333-3333-4333-8333-333333333333", name: "Birch Studio", state: "suspended",
      attention: ["suspended", "payment_past_due"], organizations: [org({ name: "Birch Studio", slug: "birch", address: "birch.wodana.ai", state: "suspended" })] })],
    total: 2, counts: { active: 1, suspended: 1 } }));
    render(<DesignSystemProvider><AccountsPage canProvision /></DesignSystemProvider>);
    expect(await screen.findByText("Acme Group")).toBeInTheDocument();
    expect(screen.getAllByText("3 of 5").length).toBeGreaterThan(0);
    expect(screen.getByText("Payment past due")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Suspended/ }));
    await waitFor(() => expect(screen.queryByText("Acme Group")).not.toBeInTheDocument());
    expect(screen.getByText("Birch Studio")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create tenant" })).toBeInTheDocument();
  });

  it("offers no create action without the provisioning permission", async () => {
    mount(() => ({ accounts: [], total: 0, counts: {} }));
    render(<DesignSystemProvider><AccountsPage canProvision={false} /></DesignSystemProvider>);
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create tenant" })).not.toBeInTheDocument();
  });

  it("lays out right to left in Arabic", async () => {
    mount(() => ({ accounts: [account()], total: 1, counts: { active: 1 } }));
    const { container } = render(<I18nProvider language="ar"><DesignSystemProvider direction="rtl" locale="ar"><AccountsPage canProvision /></DesignSystemProvider></I18nProvider>);
    expect(await screen.findByText("Acme Group")).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});

describe("account inspector", () => {
  it("changes state with a reason, the version it saw and one idempotency key", async () => {
    const calls = mount((url) => {
      if (url.endsWith(`/accounts/${account().id}`)) return account();
      if (url.endsWith("/lifecycle")) return lifecycle({ nextStates: ["suspended", "grace", "archived"] });
      if (url.endsWith("/lifecycle/transitions")) return { state: "suspended" };
      if (url.endsWith("/operations")) return { operations: [] };
      return {};
    });
    render(<DesignSystemProvider><AccountPage accountId={account().id} permissions={["tenants.read", "lifecycle.manage"]} operatorUserId="op-1" /></DesignSystemProvider>);
    expect(await screen.findByRole("heading", { name: "Acme Group" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Change state" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Payment missing after three reminders");
    await userEvent.click(within(dialog).getByRole("button", { name: "Suspend" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/lifecycle/transitions"))).toBe(true));
    const transition = calls.find((call) => call.url.endsWith("/lifecycle/transitions"))!;
    expect(transition.body).toMatchObject({ expectedVersion: 2, to: "suspended", reason: "Payment missing after three reminders" });
    expect(new Headers(transition.init?.headers).get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("names what archiving still needs", async () => {
    mount((url) => {
      if (url.endsWith(`/accounts/${account().id}`)) return account();
      if (url.endsWith("/lifecycle")) return lifecycle({ nextStates: ["archived"] });
      if (url.endsWith("/operations")) return { operations: [] };
      return {};
    });
    render(<DesignSystemProvider><AccountPage accountId={account().id} permissions={["tenants.read", "lifecycle.manage"]} operatorUserId="op-1" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Change state" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Download a current export")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Archive" })).toBeDisabled();
  });

  it("offers no state change without the lifecycle permission", async () => {
    mount((url) => (url.endsWith("/lifecycle") ? lifecycle() : url.endsWith("/operations") ? { operations: [] } : account()));
    render(<DesignSystemProvider><AccountPage accountId={account().id} permissions={["tenants.read"]} operatorUserId="op-1" /></DesignSystemProvider>);
    expect(await screen.findByRole("heading", { name: "Acme Group" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change state" })).not.toBeInTheDocument();
  });
});

describe("support sessions", () => {
  const session = (overrides: Partial<SupportSession> = {}): SupportSession => ({
    id: "44444444-4444-4444-8444-444444444444", status: "approved", reason: "Customer asked for help with roles", durationMinutes: 30,
    requestedBy: "op-1", requestedByName: "Ada Operator", approvedBy: "op-2", approvedByName: "Ben Approver",
    requestedAt: new Date().toISOString(), approvedAt: new Date().toISOString(), startsAt: null,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(), endedAt: null, endReason: null, version: 2,
    canApprove: false, canReject: false, canStart: true, canRevoke: true, ...overrides,
  });

  it("keeps tenant records closed until the requester starts the approved session", async () => {
    let started = false;
    const calls = mount((url) => {
      if (url.endsWith("/support-sessions")) return { sessions: [started ? session({ status: "active", canStart: false }) : session()] };
      if (url.endsWith("/start")) { started = true; return session({ status: "active" }); }
      if (url.endsWith("/support/members")) return { members: [{ id: "m1", displayName: "Owner Person", email: "owner@acme.test", status: "active", joinedAt: null, roles: ["Owner"] }], session: { id: "s", expiresAt: session().expiresAt } };
      if (url.endsWith("/support/activity")) return { events: [], session: { id: "s", expiresAt: session().expiresAt } };
      return {};
    });
    render(<DesignSystemProvider><SupportTab orgKey="tenant_acme" permissions={["tenants.read", "support.request"]} operatorUserId="op-1" /></DesignSystemProvider>);
    expect(await screen.findByText("Tenant records are closed")).toBeInTheDocument();
    expect(calls.some((call) => call.url.endsWith("/support/members"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("Owner Person")).toBeInTheDocument();
    expect(calls.find((call) => call.url.endsWith("/start"))?.body).toEqual({ expectedVersion: 2 });
  });

  it("lets a second operator approve but not start someone else's request", async () => {
    mount(() => ({ sessions: [session({ status: "requested", requestedBy: "op-2", requestedByName: "Other Operator",
      approvedBy: null, approvedByName: null, canApprove: true, canReject: true, canStart: false })] }));
    render(<DesignSystemProvider><SupportTab orgKey="tenant_acme" permissions={["tenants.read", "support.approve"]} operatorUserId="op-1" /></DesignSystemProvider>);
    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(screen.queryByText("Tenant records are closed")).not.toBeInTheDocument();
  });
});

describe("create tenant", () => {
  const profiles = [
    { kind: "region", code: "SG", version: 1, configuration: { countryCode: "SG", currency: "SGD", locale: "en-SG", timezone: "Asia/Singapore", unitSystem: "metric", weekStartsOn: 1 } },
    { kind: "firm_kit", code: "interior_studio", version: 2, configuration: { label: "Interior design studio" } },
    { kind: "plan", code: "starter", version: 1, configuration: { seatLimit: 5, projectLimit: 25 } },
  ];

  it("catches a taken login address, creates once and shows the invitation's delivery", async () => {
    const calls = mount((url) => {
      if (url.endsWith("/profiles")) return profiles;
      if (url.includes("/provisioning/slug?slug=acme-interiors-2")) return { slug: "acme-interiors-2", available: true, suggestion: null, address: "acme-interiors-2.wodana.ai" };
      if (url.includes("/provisioning/slug?slug=acme-interiors")) return { slug: "acme-interiors", available: false, suggestion: "acme-interiors-2", address: "acme-interiors.wodana.ai" };
      if (url.endsWith("/drafts")) return { id: "55555555-5555-4555-8555-555555555555", externalTenantId: "tenant_x", status: "draft", version: 1 };
      if (url.endsWith("/provision")) return { draft: { id: "d", externalTenantId: "tenant_x", status: "provisioned", version: 3 },
        tenant: { externalTenantId: "tenant_x", account: { id: account().id, displayName: "Acme Interiors" }, workspace: { name: "Acme Interiors", slug: "acme-interiors-2" },
          ownerInvitation: { email: "owner@acme.test", status: "pending", deliveryStatus: "not_requested", invitationToken: "first" } } };
      if (url.endsWith("/owner-invitation/send")) return { deliveryStatus: "not_configured", invitationToken: "rotated", status: "pending", expiresAt: new Date().toISOString() };
      return {};
    });
    render(<DesignSystemProvider><CreateTenantPage /></DesignSystemProvider>);
    await userEvent.type(await screen.findByRole("textbox", { name: /Account name/ }), "Acme Interiors");
    await userEvent.type(screen.getByRole("textbox", { name: /Contract contact/ }), "Contract Person");
    await userEvent.type(screen.getByRole("textbox", { name: /Contact email/ }), "contract@acme.test");
    await userEvent.type(screen.getByRole("textbox", { name: /Owner name/ }), "Owner Person");
    await userEvent.type(screen.getByRole("textbox", { name: /Owner email/ }), "owner@acme.test");
    await userEvent.click(await screen.findByRole("button", { name: "Use acme-interiors-2" }));
    expect(await screen.findByText("acme-interiors-2.wodana.ai is free")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByText("Interior design studio")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create tenant" }));
    expect(await screen.findByText("Tenant created")).toBeInTheDocument();
    expect(screen.getByText("Email off")).toBeInTheDocument();
    expect(screen.getByText(/invitation=rotated/)).toBeInTheDocument();
    const draft = calls.find((call) => call.url.endsWith("/drafts"))!;
    expect(draft.body).toMatchObject({ organization: { slug: "acme-interiors-2", defaultCurrency: "SGD" }, defaults: { region: { code: "SG" } } });
    expect(draft.body?.defaults).not.toHaveProperty("seatLimit");
    expect(calls.filter((call) => call.url.endsWith("/drafts"))).toHaveLength(1);
  });
});
