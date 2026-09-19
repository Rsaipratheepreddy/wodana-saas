import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { WorkspaceAccountMenu } from "./workspace-account-menu";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));

describe("WorkspaceAccountMenu", () => {
  it("does not expose the internal portal to a tenant user", async () => {
    const interaction = userEvent.setup();
    render(<DesignSystemProvider><WorkspaceAccountMenu user={{ email: "admin@igloarchitects.com", name: "Iglo Administrator" }} /></DesignSystemProvider>);

    await interaction.click(screen.getByRole("button", { name: "Account menu for Iglo Administrator" }));

    expect(screen.getByRole("link", { name: "Sign-in security" })).toHaveAttribute("href", "/workspace/settings/security");
    expect(screen.queryByRole("link", { name: "Internal portal" })).not.toBeInTheDocument();
  });

  it("does not link the Wodana control plane from a customer workspace", async () => {
    const interaction = userEvent.setup();
    render(<DesignSystemProvider><WorkspaceAccountMenu user={{ email: "platform@wodana.example", name: "Wodana Administrator" }} /></DesignSystemProvider>);

    await interaction.click(screen.getByRole("button", { name: "Account menu for Wodana Administrator" }));

    expect(screen.queryByRole("link", { name: "Internal portal" })).not.toBeInTheDocument();
  });
});
