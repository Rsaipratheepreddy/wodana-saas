import { render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { describe, expect, it } from "vitest";
import { PageChrome, PageShell, usePageToolbarElement } from "./page-shell";
import { PageHeader } from "./page-header";
import { SettingsPage } from "./settings";

const tabs = <div role="group" aria-label="Lists"><button type="button">All</button><button type="button">Open</button></div>;
const toolbar = <div role="toolbar" aria-label="Tools"><button type="button">Search</button></div>;
const action = <button type="button">New enquiry</button>;

function GridTools() {
  const slot = usePageToolbarElement();
  const tools = <div role="toolbar" aria-label="Grid tools"><button type="button">Filter</button></div>;
  return slot ? createPortal(tools, slot) : tools;
}

describe("PageShell: one title per view", () => {
  it("keeps a compact title row with its action when nothing around the page names it", () => {
    render(<PageShell title="Design inspection" action={action} tabs={tabs} toolbar={toolbar}>Body</PageShell>);
    const title = screen.getByRole("heading", { level: 1, name: "Design inspection" });
    expect(title).not.toHaveClass("wd-visually-hidden");
    expect(title.closest(".wd-page-shell-bar")).toContainElement(screen.getByRole("button", { name: "New enquiry" }));
    expect(screen.getByRole("group", { name: "Lists" }).closest(".wd-page-shell-tabs")).toContainElement(screen.getByRole("toolbar", { name: "Tools" }));
  });

  it("keeps the title for screen readers only and puts tabs, tools and the action in one row when the chrome names the page", () => {
    const { container } = render(<PageChrome names={["Sales"]}><PageChrome names={["Pipeline"]}>
      <PageShell title="Pipeline" action={action} tabs={tabs} toolbar={toolbar}>Body</PageShell>
    </PageChrome></PageChrome>);
    expect(screen.getByRole("heading", { level: 1, name: "Pipeline" })).toHaveClass("wd-visually-hidden");
    expect(container.querySelector(".wd-page-shell-bar")).toBeNull();
    const row = screen.getByRole("group", { name: "Lists" }).closest(".wd-page-shell-tabs");
    expect(row).toContainElement(screen.getByRole("toolbar", { name: "Tools" }));
    expect(row).toContainElement(screen.getByRole("button", { name: "New enquiry" }));
    expect(container.querySelectorAll(".wd-page-shell-header > div")).toHaveLength(1);
  });

  it("matches the name whatever its case or spacing, and only the exact name", () => {
    render(<PageChrome names={[" calendar ", null, ""]}><PageShell title="Calendar" toolbar={toolbar} action={action}>Body</PageShell><PageShell title="Calendar settings">Other</PageShell></PageChrome>);
    expect(screen.getByRole("heading", { level: 1, name: "Calendar" })).toHaveClass("wd-visually-hidden");
    expect(screen.getByRole("heading", { level: 1, name: "Calendar settings" })).not.toHaveClass("wd-visually-hidden");
    // Without tabs the toolbar spans the row and the action ends it.
    const row = screen.getByRole("toolbar", { name: "Tools" }).closest(".wd-page-shell-tabs");
    expect(row).not.toHaveAttribute("data-tabs");
    expect(row).toContainElement(screen.getByRole("button", { name: "New enquiry" }));
  });

  it("brings a named list's grid tools up into its one row", () => {
    render(<PageChrome names={["Clients"]}><PageShell title="Clients" action={action}><GridTools /></PageShell></PageChrome>);
    expect(screen.getByRole("toolbar", { name: "Grid tools" }).closest(".wd-page-shell-tabs")).toContainElement(screen.getByRole("button", { name: "New enquiry" }));
  });

  it("names a page by its title once in PageHeader and SettingsPage too", () => {
    render(<PageChrome names={["Notifications", "Profile"]}>
      <PageHeader title="Notifications" actions={<button type="button">Mark all as read</button>} />
      <SettingsPage title="Profile">Rows</SettingsPage>
      <PageHeader title="Good morning, Sam" />
    </PageChrome>);
    expect(screen.getByRole("heading", { level: 1, name: "Notifications" })).toHaveClass("wd-visually-hidden");
    expect(screen.getByRole("button", { name: "Mark all as read" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Profile" })).toHaveClass("wd-visually-hidden");
    expect(screen.getByRole("heading", { level: 1, name: "Good morning, Sam" })).not.toHaveClass("wd-visually-hidden");
  });
});
