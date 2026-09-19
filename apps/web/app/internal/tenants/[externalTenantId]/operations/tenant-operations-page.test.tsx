import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EntitlementCatalog, TenantBillingOverview, TenantLifecycleOverview, TenantOperationsOverview } from "@/lib/internal/types";
import { TenantOperationsPage } from "./tenant-operations-page";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/lib/use-workspace-theme", () => ({ useWorkspaceTheme: () => ({ theme: "light" }) }));

const overview: TenantOperationsOverview = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  externalTenantId: "palm-living",
  organization: { id: "00000000-0000-4000-8000-000000000001", name: "Palm Living", slug: "palm-living", status: "active", version: 4 },
  entitlements: { status: "not_configured" },
  dataPolicy: { status: "not_configured", scannerStatus: "baseline" },
  usage: {
    members: 2, pendingInvitations: 0, projects: 1, knownFileBytes: 1024, knownFileCount: 1,
    storageQuotaBytes: null, storagePercent: null, coverage: "managed_objects_and_known_legacy",
  },
  adoption: { windowDays: 30, eventCount: 12, activeActors: 2, lastActivityAt: "2026-09-18T08:00:00.000Z" },
  entitlementHistory: [],
  supportSessions: [],
  operations: [],
  observedAt: "2026-09-18T08:00:00.000Z",
};

const catalog: EntitlementCatalog = {
  plans: [{ code: "starter", version: 1, configuration: { label: "Starter", seatLimit: 5, projectLimit: 25 }, publishedAt: "2026-09-18T08:00:00.000Z" }],
  capabilityFlags: [],
  observedAt: "2026-09-18T08:00:00.000Z",
};

const billing: TenantBillingOverview = {
  account: { id: "00000000-0000-4000-8000-000000000010", displayName: "Palm Living", status: "active", isDefaultOrganization: true },
  contract: { status: "not_configured", taxValidationState: "unverified" },
  contractHistory: [], organizationAllocation: { status: "not_configured" },
  organizationAllocationHistory: [], organizations: [],
  collection: { status: "not_configured" }, collectionHistory: [], documents: [], documentEvents: [], usageSnapshots: [],
  authority: "account_contract", taxCompliance: "unverified", observedAt: "2026-09-18T08:00:00.000Z",
};

const lifecycle: TenantLifecycleOverview = {
  workspaceId: overview.workspaceId,
  state: "active", version: 1, source: "versioned", workspaceStatus: "active",
  graceEndsAt: null, graceExpired: false, nextStates: ["grace", "suspended", "archived"],
  readiness: { onboardingStatus: "completed", ownerInvitationStatus: "accepted" },
  noticeDeliveryState: "not_required", history: [], observedAt: "2026-09-18T08:00:00.000Z",
};

function loaded(input: string | URL | Request) {
  return Response.json(String(input).includes("/entitlements/catalog") ? catalog
    : String(input).endsWith("/billing") ? billing
      : String(input).endsWith("/lifecycle") ? lifecycle : overview);
}

afterEach(() => {
  vi.unstubAllGlobals();
  navigation.push.mockClear();
});

describe("TenantOperationsPage", () => {
  it("reviews a lifecycle decision and sends one keyed, versioned command", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
      init?.method === "POST" ? Response.json({ state: "suspended" }) : loaded(input));
    vi.stubGlobal("fetch", fetchMock);
    const interaction = userEvent.setup();
    render(<TenantOperationsPage externalTenantId="palm-living" />);
    expect(await screen.findByRole("heading", { name: "Lifecycle" })).toBeVisible();
    await interaction.click(screen.getByRole("button", { name: /Move to/ }));
    await interaction.click(screen.getByRole("option", { name: "Suspended" }));
    await interaction.type(screen.getAllByRole("textbox", { name: "Reason" })[0], "Customer-approved access pause");
    await interaction.click(screen.getByRole("button", { name: "Review lifecycle change" }));
    const review = screen.getByRole("dialog", { name: "Record lifecycle decision?" });
    expect(review).toBeVisible();
    expect(screen.getByText("Customer access will stop")).toBeVisible();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    await interaction.click(screen.getByRole("button", { name: "Record decision" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/lifecycle/transitions"))).toBe(true));
    const command = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/lifecycle/transitions"));
    expect(new Headers(command?.[1]?.headers).get("idempotency-key")).toBeTruthy();
    expect(JSON.parse(String(command?.[1]?.body))).toEqual({ expectedVersion: 1, to: "suspended", reason: "Customer-approved access pause" });
  });

  it("shows honest governance state and uses the shared operation table", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => loaded(input)));
    render(<TenantOperationsPage externalTenantId="palm-living" />);

    expect(await screen.findByRole("heading", { name: "Palm Living" })).toBeVisible();
    expect(screen.getAllByText("not configured").length).toBeGreaterThan(0);
    expect(screen.getByText("No module allocation configured")).toBeVisible();
    expect(screen.getByText(/New uploads reserve quota before storage/)).toBeVisible();
    expect(screen.getByText("No operation plans")).toBeVisible();
    expect(screen.queryByRole("table", { name: "Tenant operation history" })).not.toBeInTheDocument();
  });

  it("saves allocations and sends dry-run plans with an idempotency key", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") return loaded(_input);
      return Response.json({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const interaction = userEvent.setup();
    render(<TenantOperationsPage externalTenantId="palm-living" />);
    await screen.findByRole("heading", { name: "Palm Living" });

    await interaction.click(screen.getByRole("button", { name: "Review allocation" }));
    expect(screen.getByRole("dialog", { name: "Apply module allocation?" })).toBeVisible();
    await interaction.click(screen.getByRole("button", { name: "Apply allocation" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/internal/tenants/palm-living/operations/entitlements",
      expect.objectContaining({ method: "PATCH" }),
    ));
    const entitlementCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/entitlements"));
    expect(JSON.parse(String(entitlementCall?.[1]?.body))).toMatchObject({
      expectedVersion: 0,
      planCode: "starter",
      modules: ["workspace", "crm"],
    });

    const reasonFields = screen.getAllByRole("textbox", { name: "Reason" });
    await interaction.type(reasonFields.at(-1)!, "Prepare a verified tenant export");
    await interaction.click(screen.getByRole("button", { name: "Run dry check" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/plans"))).toBe(true));
    const planCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/plans"));
    expect(new Headers(planCall?.[1]?.headers).get("idempotency-key")).toBeTruthy();
    expect(JSON.parse(String(planCall?.[1]?.body))).toMatchObject({
      operationType: "export",
      reason: "Prepare a verified tenant export",
    });
  });

  it("shows and submits the reviewed clone action only for a second operator", async () => {
    const planned: TenantOperationsOverview = {
      ...overview,
      operations: [{
        id: "00000000-0000-4000-8000-000000000222",
        operationType: "clone",
        phase: "dry_run",
        status: "planned",
        reason: "Copy the approved configuration into an empty test tenant",
        plan: { executable: true },
        targetWorkspaceId: "00000000-0000-4000-8000-000000000333",
        targetExternalTenantId: "palm-living-test",
        rollbackOf: null,
        version: 1,
        canApprove: true,
        createdAt: "2026-09-18T08:00:00.000Z",
      }],
    };
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
      !init?.method || init.method === "GET"
        ? Response.json(String(_input).includes("/entitlements/catalog") ? catalog : String(_input).endsWith("/billing") ? billing : String(_input).endsWith("/lifecycle") ? lifecycle : planned)
        : Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const interaction = userEvent.setup();
    render(<TenantOperationsPage externalTenantId="palm-living" />);

    await interaction.click(await screen.findByRole("button", { name: "Approve and apply" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/00000000-0000-4000-8000-000000000222/decision"))).toBe(true));
    const decision = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/00000000-0000-4000-8000-000000000222/decision"));
    expect(JSON.parse(String(decision?.[1]?.body))).toMatchObject({ expectedVersion: 1, decision: "approve" });
  });

  it("shows verified export evidence and a secure download action", async () => {
    const exported: TenantOperationsOverview = {
      ...overview,
      operations: [{
        id: "00000000-0000-4000-8000-000000000555",
        operationType: "export",
        phase: "apply",
        status: "succeeded",
        reason: "Prepare a verified tenant export",
        plan: { executable: true },
        result: {
          exportId: "00000000-0000-4000-8000-000000000666",
          sha256: "a".repeat(64), recordCount: 24, fileCount: 3, expiresInDays: 7,
        },
        version: 3,
        canApprove: false,
        createdAt: "2026-09-18T08:00:00.000Z",
      }],
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) =>
      Response.json(String(input).includes("/entitlements/catalog") ? catalog : String(input).endsWith("/billing") ? billing : String(input).endsWith("/lifecycle") ? lifecycle : exported)));
    render(<TenantOperationsPage externalTenantId="palm-living" />);

    expect(await screen.findByText("24 records · 3 referenced files · expires in 7 days")).toBeVisible();
    expect(screen.getByRole("button", { name: "Download export" })).toBeVisible();
  });

  it("keeps support observers read-only outside support requests", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => loaded(input)));
    render(<TenantOperationsPage
      externalTenantId="palm-living"
      permissions={["tenants.read", "support.request"]}
    />);

    expect(await screen.findByText("Read-only module allocation")).toBeVisible();
    expect(screen.getByText("Read-only data policy")).toBeVisible();
    expect(screen.getByText("Operation planning is read-only")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Review allocation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save data policy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run dry check" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request access" })).toBeVisible();
  });

  it("separates sold, allocated and unavailable platform states", async () => {
    const configured: TenantOperationsOverview = {
      ...overview,
      entitlements: {
        status: "active", planCode: "starter", planVersion: 2,
        modules: ["workspace", "crm"], soldModules: ["workspace", "crm", "projects"],
        limits: { seatLimit: 8, projectLimit: 50 }, soldLimits: { seatLimit: 8, projectLimit: 50 },
        customOverride: false, effectiveAt: "2026-09-18T08:00:00.000Z", source: "allocation", version: 1,
      },
      entitlementHistory: [{
        version: 1, status: "active", modules: ["workspace", "crm"], limits: {},
        effectiveFrom: "2026-09-18T08:00:00.000Z", effectiveUntil: null,
        reason: "Initial contracted allocation", createdAt: "2026-09-18T08:00:00.000Z",
        planCode: "starter", planVersion: 2, soldModules: ["workspace", "crm", "projects"],
        soldLimits: { seatLimit: 8, projectLimit: 50 }, customOverride: false,
      }],
    };
    const configuredCatalog: EntitlementCatalog = {
      ...catalog,
      plans: [{ code: "starter", version: 2, configuration: { label: "Starter", modules: ["workspace", "crm", "projects"] }, publishedAt: "2026-09-18T08:00:00.000Z" }],
      capabilityFlags: [{ code: "projects.experimental_board", module: "projects", releaseState: "unavailable", reason: "Still under internal validation", version: 1, updatedAt: "2026-09-18T08:00:00.000Z" }],
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) =>
      Response.json(String(input).includes("/entitlements/catalog") ? configuredCatalog : String(input).endsWith("/billing") ? billing : String(input).endsWith("/lifecycle") ? lifecycle : configured)));
    render(<TenantOperationsPage externalTenantId="palm-living" />);

    expect(await screen.findByRole("table", { name: "Tenant module access" })).toBeVisible();
    expect(screen.getByRole("row", { name: /Projects Included Not allocated 1 unavailable/ })).toBeVisible();
    expect(screen.getByRole("table", { name: "Platform capability exceptions" })).toBeVisible();
    expect(screen.getByText("Still under internal validation")).toBeVisible();
  });
});
