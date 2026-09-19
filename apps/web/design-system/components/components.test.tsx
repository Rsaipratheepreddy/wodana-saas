import axe from "axe-core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "../foundations/provider";
import { Button } from "./actions";
import { Checkbox, TextInput } from "./forms";
import { AppShell } from "./navigation";
import { SideSheet } from "./overlays";

describe("universal components", () => {
  it("applies locale, direction, density, and theme", () => {
    render(<DesignSystemProvider density="compact" direction="rtl" locale="ar-AE" theme="dark"><span>مرحبا</span></DesignSystemProvider>);
    const root = screen.getByText("مرحبا").parentElement;
    expect(root).toHaveAttribute("dir", "rtl");
    expect(root).toHaveAttribute("data-wd-theme", "dark");
    expect(root).toHaveAttribute("data-wd-density", "compact");
  });
  it("supports keyboard activation and accessible fields", async () => {
    const user = userEvent.setup();
    const press = vi.fn();
    render(<DesignSystemProvider><Button onPress={press}>Save</Button><TextInput label="Project name" /><Checkbox>Include tax</Checkbox></DesignSystemProvider>);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(press).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox", { name: "Project name" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Include tax" })).toBeInTheDocument();
  });
  it("has no automatic accessibility violations", async () => {
    const { container } = render(<DesignSystemProvider><TextInput description="Required for client documents" isRequired label="Project name" /><Button variant="primary">Create project</Button></DesignSystemProvider>);
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
  it("opens and closes the responsive navigation explicitly", async () => {
    const user = userEvent.setup();
    render(<DesignSystemProvider><AppShell navigation={<a href="/projects">Projects</a>} title="Dashboard"><span>Content</span></AppShell></DesignSystemProvider>);
    const open = screen.getByRole("button", { name: "Open navigation" });
    await user.click(open);
    expect(open.closest(".wd-app-shell")).toHaveAttribute("data-mobile-open", "true");
    await user.click(screen.getAllByRole("button", { name: "Close navigation" })[0]);
    expect(open.closest(".wd-app-shell")).not.toHaveAttribute("data-mobile-open");
  });
  it("supports a header-only shell when a section has no navigation", () => {
    render(<DesignSystemProvider><AppShell title="Wodana Control"><span>Tenant overview</span></AppShell></DesignSystemProvider>);
    expect(screen.getByText("Tenant overview").closest(".wd-app-shell")).toHaveAttribute("data-navigation", "none");
    expect(screen.queryByRole("complementary", { name: "Primary navigation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open navigation" })).not.toBeInTheDocument();
  });
  it("protects dirty sheet content from accidental dismissal", async () => {
    const user = userEvent.setup();
    render(<DesignSystemProvider><SideSheet isDirty title="Edit project" trigger={<Button>Edit</Button>}><TextInput label="Name" /></SideSheet></DesignSystemProvider>);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Close inspector" }));
    expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("dialog", { name: "Edit project" })).toBeInTheDocument();
  });
});
