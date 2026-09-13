import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { integrationsPageFixture } from "@/lib/workspace/integrations";
import { IntegrationTools } from "./integration-tools";

afterEach(() => vi.unstubAllGlobals());
describe("connected accounting tools", () => {
  it("retrieves the current invoice and renders only the provider-returned payment link", async () => {
    const interaction = userEvent.setup();
    const connection = { ...integrationsPageFixture.connections[0], provider: "quickbooks" as const };
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ Id: "31", DocNumber: "INV-31", Balance: 100 }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "31", balance: 100, status: "unpaid", paymentUrl: "https://connect.intuit.com/pay/example" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<DesignSystemProvider><IntegrationTools connection={connection} workspaceId={integrationsPageFixture.workspaceId} canManage onClose={() => {}} /></DesignSystemProvider>);
    await interaction.click(screen.getByRole("button", { name: "Load from provider" }));
    await interaction.click(await screen.findByRole("button", { name: "Refresh payment status" }));
    expect(await screen.findByRole("link", { name: "Open invoice payment page" })).toHaveAttribute("href", "https://connect.intuit.com/pay/example");
    await waitFor(() => expect(fetchMock.mock.calls[1][0]).toContain("invoiceId=31"));
    expect(fetchMock.mock.calls.every((call) => (call[1] as RequestInit).method !== "POST")).toBe(true);
  });
  it("does not claim success when the provider rejects the request", async () => {
    const interaction = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: "Reconnect this provider" }) }));
    const connection = { ...integrationsPageFixture.connections[0], provider: "zoho_books" as const };
    render(<DesignSystemProvider><IntegrationTools connection={connection} workspaceId={integrationsPageFixture.workspaceId} canManage={false} onClose={() => {}} /></DesignSystemProvider>);
    await interaction.click(screen.getByRole("button", { name: "Load from provider" }));
    expect(await screen.findByText("Reconnect this provider")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open invoice payment page" })).not.toBeInTheDocument();
  });
});
