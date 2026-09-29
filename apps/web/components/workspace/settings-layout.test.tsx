import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider, SaveBar } from "@/design-system";
import { SettingsLayout } from "./settings-layout";
import { workspaceModules } from "./workspace-navigation";

vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace/company",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const settings = workspaceModules.find((module) => module.id === "workspace")!;

describe("Settings menu", () => {
  it("is a short grouped index: Account, Company, Modules, People & access, Connections", () => {
    render(<DesignSystemProvider><SettingsLayout module={settings} pathname="/workspace/company"><p>Company</p></SettingsLayout></DesignSystemProvider>);
    const menu = screen.getByRole("navigation", { name: "Settings" });
    expect(within(menu).getAllByRole("region").map((group) => group.getAttribute("aria-label"))).toEqual(["Account", "Company", "Modules", "People & access", "Apps & delivery"]);
    expect(within(within(menu).getByRole("region", { name: "Modules" })).getByRole("link", { name: "Quotations" })).toHaveAttribute("href", "/workspace/settings/quotations");
    // People & access links into People rather than copying it.
    expect(within(within(menu).getByRole("region", { name: "People & access" })).getByRole("link", { name: "Teams" })).toHaveAttribute("href", "/workspace/teams");
    expect(within(menu).getByRole("link", { name: "Company profile" })).toHaveAttribute("aria-current", "page");
  });

  it("finds a page by its name or its group, and says when nothing matches", async () => {
    const user = userEvent.setup();
    render(<DesignSystemProvider><SettingsLayout module={settings} pathname="/workspace/company"><p>Company</p></SettingsLayout></DesignSystemProvider>);
    const menu = screen.getByRole("navigation", { name: "Settings" });
    const search = within(menu).getByRole("searchbox", { name: "Search settings" });
    await user.type(search, "purch");
    expect(within(menu).getAllByRole("link").map((link) => link.textContent)).toEqual(["Purchasing"]);
    await user.clear(search);
    await user.type(search, "modules");
    expect(within(menu).getAllByRole("link")).toHaveLength(11); // Modules, Inbox included
    await user.clear(search);
    await user.type(search, "zzz");
    expect(within(menu).queryAllByRole("link")).toHaveLength(0);
    expect(within(menu).getByRole("status")).toHaveTextContent("No settings match");
  });
});

describe("SaveBar", () => {
  it("offers Discard and Save while something is unsaved, then says Saved", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const { rerender } = render(<DesignSystemProvider><SaveBar isDirty={false} onSave={onSave} onDiscard={onDiscard} /></DesignSystemProvider>);
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(<DesignSystemProvider><SaveBar isDirty onSave={onSave} onDiscard={onDiscard} /></DesignSystemProvider>);
    const bar = within(screen.getByRole("region", { name: "Unsaved changes" }));
    await user.click(bar.getByRole("button", { name: "Discard" }));
    await user.click(bar.getByRole("button", { name: "Save" }));
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();
    rerender(<DesignSystemProvider><SaveBar isDirty={false} saved onSave={onSave} /></DesignSystemProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });
});
