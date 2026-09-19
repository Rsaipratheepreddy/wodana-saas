import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProvisioningPage } from "./provisioning-page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/use-workspace-theme", () => ({ useWorkspaceTheme: () => ({ theme: "light", toggleTheme: vi.fn() }) }));

const profiles = [
  { kind: "region", code: "AE", version: 1, configuration: { countryCode: "AE", currency: "AED", locale: "en-AE", timezone: "Asia/Dubai", unitSystem: "metric", weekStartsOn: 1 } },
  { kind: "firm_kit", code: "design_build", version: 2, configuration: { label: "Design & build" } },
  { kind: "plan", code: "starter", version: 1, configuration: { label: "Starter", seatLimit: 5, projectLimit: 25 } },
];
const draftId = "00000000-0000-4000-8000-000000000111";
const draft = {
  id: draftId, externalTenantId: "tenant_local_test", account: { displayName: "Palm Group", contactName: "Contract Contact", contactEmail: "contact@example.test" },
  organization: { name: "Palm Living", slug: "palm-living", firstLegalEntity: { registeredName: "Palm Living" } },
  owner: { displayName: "Workspace Owner", email: "owner@example.test" },
  defaults: { region: { code: "AE" }, firmKit: { code: "design_build" }, plan: { code: "starter" } },
  status: "draft", version: 1,
};
const tenant = {
  externalTenantId: "tenant_local_test", account: { displayName: "Palm Group" },
  workspace: { name: "Palm Living", slug: "palm-living" },
  ownerInvitation: { email: "owner@example.test", status: "pending", deliveryStatus: "not_requested", invitationToken: "initial-secret" },
  onboarding: { status: "in_progress" },
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/internal/new");
  sessionStorage.clear();
});

describe("operator provisioning page", () => {
  it("reviews separate identities, provisions once and reports failed delivery truthfully", async () => {
    window.history.replaceState(null, "", "/internal/new");
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
      requests.push({ path, init });
      if (path.endsWith("/profiles")) return Response.json(profiles);
      if (path.endsWith("/drafts")) return Response.json(draft, { status: 201 });
      if (path.endsWith("/provision")) return Response.json({ draft: { ...draft, status: "provisioned", version: 3 }, tenant }, { status: 201 });
      if (path.endsWith("/send")) return Response.json({ ...tenant.ownerInvitation, deliveryStatus: "not_configured", invitationToken: "replacement-secret" }, { status: 201 });
      throw new Error(`Unexpected request ${path}`);
    }));
    const interaction = userEvent.setup();
    render(<ProvisioningPage />);
    expect(await screen.findByRole("textbox", { name: /Customer account/ })).toBeVisible();
    await interaction.type(screen.getByRole("textbox", { name: /Customer account/ }), "Palm Group");
    expect(screen.getByRole("textbox", { name: /Organization/ })).toHaveValue("Palm Group");
    await interaction.clear(screen.getByRole("textbox", { name: /Organization/ }));
    await interaction.type(screen.getByRole("textbox", { name: /Organization/ }), "Palm Living");
    await interaction.type(screen.getByRole("textbox", { name: /Contract contact/ }), "Contract Contact");
    await interaction.type(screen.getByRole("textbox", { name: /Contact email/ }), "contact@example.test");
    await interaction.type(screen.getByRole("textbox", { name: /Owner name/ }), "Workspace Owner");
    await interaction.type(screen.getByRole("textbox", { name: /Owner email/ }), "owner@example.test");
    await interaction.click(screen.getByRole("button", { name: "Review setup" }));
    expect(screen.getByText("Palm Group")).toBeVisible();
    expect(screen.getByText("palm-living.wodana.ai")).toBeVisible();
    await interaction.click(screen.getByRole("button", { name: "Create customer" }));
    expect(await screen.findByText("Customer and organization created")).toBeVisible();
    const create = requests.find((request) => request.path.endsWith("/drafts"));
    expect(create).toBeDefined();
    const body = JSON.parse(String(create?.init?.body));
    expect(body.account.displayName).toBe("Palm Group");
    expect(body.organization.name).toBe("Palm Living");
    expect(body.defaults.firmKit.version).toBe(2);
    expect(screen.getByText("Not sent")).toBeVisible();
    await interaction.click(screen.getByRole("button", { name: "Send owner email" }));
    expect(await screen.findByText("Email is not configured")).toBeVisible();
    expect(screen.getByText("Manual activation link")).toBeVisible();
    expect(requests.filter((request) => request.path.endsWith("/send"))).toHaveLength(1);
  });
});
