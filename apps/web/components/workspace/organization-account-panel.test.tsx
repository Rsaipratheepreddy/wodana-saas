import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { companyProfileFixture } from "@/lib/workspace/company-profile";
import type { CustomerAccount, OrganizationRequest } from "@/lib/workspace/customer-account";
import { OrganizationAccountPanel } from "./organization-account-panel";

const account: CustomerAccount = {
  id: "10000000-0000-4000-8000-000000000001",
  displayName: "Iglo Architects",
  status: "active",
  organizationLimit: 1,
  accountRole: "owner",
  organizationCount: 1,
  availableOrganizationSlots: 0,
  canRequestOrganization: true,
  organizations: [{
    id: companyProfileFixture.workspace.id,
    name: "Iglo Architects",
    slug: "iglo-architects",
    status: "active",
    isDefault: true,
    membershipId: "20000000-0000-4000-8000-000000000001",
    membershipStatus: "active",
    roles: ["owner"],
  }],
};

function request(overrides: Partial<OrganizationRequest> = {}): OrganizationRequest {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    name: "Palm Living Projects",
    slug: "palm-living-projects",
    reason: "A separate operating company",
    status: "pending",
    decisionReason: null,
    approvedWorkspaceId: null,
    version: 1,
    createdAt: "2026-09-16T12:00:00.000Z",
    updatedAt: "2026-09-16T12:00:00.000Z",
    ...overrides,
  };
}

function renderPanel(props: Partial<React.ComponentProps<typeof OrganizationAccountPanel>> = {}) {
  return render(<DesignSystemProvider><OrganizationAccountPanel account={account} canManage initialRequests={[]} profile={companyProfileFixture} {...props} /></DesignSystemProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OrganizationAccountPanel", () => {
  it("keeps a failed cancellation visible and preserves the pending request", async () => {
    const interaction = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: "Request changed. Refresh and try again." }) }));
    renderPanel({ initialRequests: [request()] });
    await interaction.click(screen.getByRole("button", { name: "Cancel Palm Living Projects request" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel organization request?" });
    await interaction.click(within(dialog).getByRole("button", { name: "Cancel request" }));
    expect(await screen.findByText("Request changed. Refresh and try again.")).toBeVisible();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel Palm Living Projects request" })).toBeEnabled();
  });
  it("explains that workspaces are independent companies", () => {
    renderPanel();

    expect(screen.getByRole("heading", { name: "Other workspaces" })).toBeInTheDocument();
    expect(screen.getByText("Each workspace is a separate company with its own people, data and settings.")).toBeInTheDocument();
    expect(screen.getByText("Iglo Architects")).toBeInTheDocument();
    expect(screen.getByText("iglo-architects · Main company")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add workspace" })).toBeInTheDocument();
  });

  it("sends a version-safe independent-organization request using the current regional defaults", async () => {
    const interaction = userEvent.setup();
    const created = request();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => created });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("40000000-0000-4000-8000-000000000001");
    renderPanel();

    await interaction.click(screen.getByRole("button", { name: "Add workspace" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a workspace" });
    await interaction.type(within(dialog).getByRole("textbox", { name: "Company name" }), "Palm Living Projects");
    expect(within(dialog).getByRole("textbox", { name: "Registered company name" })).toHaveValue("Palm Living Projects");
    expect(within(dialog).getByRole("textbox", { name: "Entity code" })).toHaveValue("PALM_LIVING_PROJECTS");
    await interaction.click(within(dialog).getByRole("button", { name: "Send request" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspace/organization-requests");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      workspaceId: companyProfileFixture.workspace.id,
      idempotencyKey: "40000000-0000-4000-8000-000000000001",
      name: "Palm Living Projects",
      registeredName: "Palm Living Projects",
      entityCode: "PALM_LIVING_PROJECTS",
      countryCode: "AE",
      defaultCurrency: "AED",
      defaultLocale: "en-AE",
      defaultTimezone: "Asia/Dubai",
      unitSystem: "metric",
      weekStartsOn: 1,
    });
    expect(await screen.findByText("Palm Living Projects was sent to Wodana for review.")).toBeInTheDocument();
    expect(screen.getByText("A separate operating company")).toBeInTheDocument();
  });

  it("allows only a pending request to be cancelled through the existing API", async () => {
    const interaction = userEvent.setup();
    const pending = request();
    const cancelled = request({ status: "cancelled", version: 2 });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => cancelled });
    vi.stubGlobal("fetch", fetchMock);
    renderPanel({ initialRequests: [pending] });

    await interaction.click(screen.getByRole("button", { name: "Cancel Palm Living Projects request" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel organization request?" });
    await interaction.click(within(dialog).getByRole("button", { name: "Cancel request" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/workspace/organization-requests/${pending.id}/cancel`);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ workspaceId: companyProfileFixture.workspace.id, expectedVersion: 1 });
    expect(await screen.findByText("Palm Living Projects request cancelled.")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });
});
