import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ManagedTenant } from "@/lib/internal/types";
import { InternalPortal } from "./portal";

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
  usage: { members: 4, projects: 2 },
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

describe("InternalPortal", () => {
  it("keeps tenant management focused until a tenant is selected", async () => {
    const interaction = userEvent.setup();
    render(<InternalPortal initialTenants={[tenant]} user={{ email: "admin@wodana.test", name: "Wodana admin" }} />);

    expect(screen.getByRole("heading", { name: "Tenants" })).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "Search tenants" })).toBeVisible();
    expect(screen.queryByRole("complementary", { name: "Iglo Architects tenant details" })).not.toBeInTheDocument();

    await interaction.click(screen.getByRole("button", { name: "Manage Iglo Architects" }));
    expect(screen.getByRole("complementary", { name: "Iglo Architects tenant details" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save tenant" })).toBeVisible();

    await interaction.click(screen.getAllByRole("button", { name: "Close tenant details" }).at(-1)!);
    expect(screen.queryByRole("complementary", { name: "Iglo Architects tenant details" })).not.toBeInTheDocument();
  });
});
