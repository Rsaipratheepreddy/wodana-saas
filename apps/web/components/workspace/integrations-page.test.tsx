import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { integrationsPageFixture, type IntegrationConnection } from "@/lib/workspace/integrations";
import { IntegrationsPage } from "./integrations-page";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IntegrationsPage", () => {
  it("separates available and planned integrations while keeping search useful", async () => {
    const interaction = userEvent.setup();
    render(<IntegrationsPage initialData={structuredClone(integrationsPageFixture)} />);

    expect(screen.getAllByRole("article")).toHaveLength(12);
    const googleCard = screen.getByRole("article", { name: "Google Workspace integration" });
    expect(googleCard).toBeInTheDocument();
    expect(within(googleCard).getByRole("link", { name: /workspace.google.com/ })).toHaveAttribute("href", "https://workspace.google.com/");
    expect(within(screen.getByRole("article", { name: "Zoho Books integration" })).getByRole("button", { name: "Connect" })).toBeEnabled();
    expect(within(screen.getByRole("article", { name: "WhatsApp Business integration" })).getByRole("button", { name: "Connect" })).toBeEnabled();
    expect(within(googleCard).getByText("Setup: Configured · Evidence: Provider operation confirmed")).toBeVisible();
    expect(screen.getByRole("region", { name: "Built into Wodana" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Wodana AI review integration" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Planned" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "External lead capture" })).toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "Meta Lead Ads integration" })).getByText("Details required")).toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "PlyLeads integration" })).getByText("Details required")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Custom integration" })).not.toBeInTheDocument();

    await interaction.type(screen.getByRole("searchbox", { name: "Search integrations" }), "accounting");

    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByRole("article", { name: "QuickBooks integration" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Zoho Books integration" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Google Workspace integration" })).not.toBeInTheDocument();
  });

  it("creates a provider connection as a draft through the integration contract", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(integrationsPageFixture);
    data.connections = [];
    const created: IntegrationConnection = {
      id: "40000000-0000-4000-8000-000000000002",
      legalEntityId: data.legalEntities[0].id,
      provider: "google_workspace",
      displayName: "Google Workspace connection",
      externalDomain: "igloarchitects.com",
      status: "draft",
      configuration: {},
      version: 1,
      createdAt: "2026-09-06T05:00:00.000Z",
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => created });
    vi.stubGlobal("fetch", fetchMock);
    render(<IntegrationsPage initialData={data} />);

    const card = screen.getByRole("article", { name: "Google Workspace integration" });
    await interaction.click(within(card).getByRole("button", { name: "Connect" }));
    const dialog = await screen.findByRole("dialog", { name: "Connect Google Workspace" });
    await interaction.click(within(dialog).getByRole("button", { name: /Organization/ }));
    await interaction.click(await screen.findByRole("option", { name: data.legalEntities[0].displayName }));
    await interaction.type(within(dialog).getByRole("textbox", { name: /Domain/ }), "igloarchitects.com");
    await interaction.click(within(dialog).getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspace/integration-connections");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      workspaceId: data.workspaceId,
      provider: "google_workspace",
      displayName: "Google Workspace connection",
      legalEntityId: data.legalEntities[0].id,
      externalDomain: "igloarchitects.com",
      configuration: {},
    });
    expect(await screen.findByText("Google Workspace connection was saved as a draft.")).toBeInTheDocument();
  });

  it("opens setup before enabling an unconfigured provider", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(integrationsPageFixture);
    data.connections = [];
    render(<IntegrationsPage initialData={data} />);

    await interaction.click(within(screen.getByRole("article", { name: "Google Workspace integration" })).getByRole("button", { name: "Connect" }));

    const dialog = await screen.findByRole("dialog", { name: "Connect Google Workspace" });
    expect(within(dialog).getByRole("button", { name: "Save and connect" })).toBeInTheDocument();
    expect(within(dialog).getByText(/credentials are never stored in this form/i)).toBeInTheDocument();
  });

  it("starts authorization from a saved draft", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(integrationsPageFixture);
    const draft: IntegrationConnection = {
      id: "40000000-0000-4000-8000-000000000003",
      legalEntityId: data.legalEntities[0].id,
      provider: "google_workspace",
      displayName: "Iglo Google Workspace",
      externalDomain: "igloarchitects.com",
      status: "draft",
      configuration: {},
      version: 2,
      createdAt: "2026-09-06T05:00:00.000Z",
    };
    data.connections = [draft];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...draft, status: "pending", version: 3 }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<IntegrationsPage initialData={data} />);

    await interaction.click(within(screen.getByRole("article", { name: "Google Workspace integration" })).getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/workspace/integration-connections/${draft.id}/connect`);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ workspaceId: data.workspaceId, provider: "google_workspace", version: 2, gmailSend: false, driveFiles: false });
    expect(await screen.findByText("Iglo Google Workspace is connecting.")).toBeInTheDocument();
  });

  it("opens another account setup without changing the current connection", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(integrationsPageFixture);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<IntegrationsPage initialData={data} />);

    const card = screen.getByRole("article", { name: "Google Workspace integration" });
    await interaction.click(within(card).getByRole("button", { name: "Add account" }));

    const setup = await screen.findByRole("dialog", { name: "Connect Google Workspace" });
    expect(within(setup).getByRole("button", { name: "Save and connect" })).toBeInTheDocument();
    expect(within(setup).getByRole("textbox", { name: "Connection name" })).toHaveValue("Google Workspace connection");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(within(card).getByText("Iglo Google Workspace · Iglo Architects")).toBeInTheDocument();
  });

  it("keeps disconnect behind an account action and confirmation", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(integrationsPageFixture);
    const account = data.connections[0];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...account, status: "revoked", version: account.version + 1 }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<IntegrationsPage initialData={data} />);

    await interaction.click(screen.getByRole("button", { name: `Actions for ${account.displayName}` }));
    await interaction.click(await screen.findByRole("menuitem", { name: "Disconnect" }));
    const confirmation = await screen.findByRole("dialog", { name: "Disconnect integration?" });
    expect(fetchMock).not.toHaveBeenCalled();
    await interaction.click(within(confirmation).getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/workspace/integration-connections/${account.id}?workspaceId=${data.workspaceId}&version=${account.version}`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
  });
});
