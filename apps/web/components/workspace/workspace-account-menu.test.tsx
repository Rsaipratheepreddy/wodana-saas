import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { WorkspaceAccountMenu } from "./workspace-account-menu";

vi.mock("next/navigation", () => ({ usePathname: () => "/workspace", useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());

describe("WorkspaceAccountMenu", () => {
  it("does not expose the internal portal to a tenant user", async () => {
    const interaction = userEvent.setup();
    render(<DesignSystemProvider><WorkspaceAccountMenu user={{ email: "admin@igloarchitects.com", name: "Iglo Administrator" }} /></DesignSystemProvider>);

    await interaction.click(screen.getByRole("button", { name: "Account menu for Iglo Administrator" }));

    expect(screen.getByRole("link", { name: "Sign-in security" })).toHaveAttribute("href", "/workspace/settings/security");
    expect(screen.queryByRole("link", { name: "Internal portal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Set up your workspace/ })).not.toBeInTheDocument();
  });

  it("does not link the Wodana control plane from a customer workspace", async () => {
    const interaction = userEvent.setup();
    render(<DesignSystemProvider><WorkspaceAccountMenu user={{ email: "platform@wodana.example", name: "Wodana Administrator" }} /></DesignSystemProvider>);

    await interaction.click(screen.getByRole("button", { name: "Account menu for Wodana Administrator" }));

    expect(screen.queryByRole("link", { name: "Internal portal" })).not.toBeInTheDocument();
  });

  it("shows setup progress around the avatar for a manager and opens the checklist from the menu", async () => {
    const readiness = { company: true, regional: true, people: false, connections: false };
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => ({ ok: true, status: 200, json: async () => readiness }));
    vi.stubGlobal("fetch", fetcher);
    const interaction = userEvent.setup();
    render(<DesignSystemProvider><WorkspaceAccountMenu setup={{ workspaceId: "11111111-1111-4111-8111-111111111111", modules: ["crm", "pre-project"] }} user={{ email: "owner@palmliving.test", name: "Olivia" }} /></DesignSystemProvider>);

    const trigger = await screen.findByRole("button", { name: "Account menu for Olivia. Setup 2 of 6 done" });
    expect(fetcher.mock.calls[0]?.[0]).toContain("/api/workspace/setup-readiness?workspaceId=11111111-1111-4111-8111-111111111111");
    await interaction.click(trigger);
    await interaction.click(screen.getByRole("button", { name: "Set up your workspace · 2 of 6" }));

    expect(await screen.findByRole("dialog", { name: "Set up your workspace" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Manage people/ })).toHaveAttribute("href", "/workspace/members");
    expect(screen.queryByRole("link", { name: /Review company/ })).not.toBeInTheDocument();
  });

  it("drops the ring once every step is done", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ company: true, regional: true, people: true, connections: true }) })));
    render(<DesignSystemProvider><WorkspaceAccountMenu setup={{ workspaceId: "11111111-1111-4111-8111-111111111111", modules: [] }} user={{ email: "owner@palmliving.test", name: "Olivia" }} /></DesignSystemProvider>);

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Account menu for Olivia" })).not.toHaveAttribute("data-setup");
  });
});
