import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { crmScreenFixture, type CrmScreenId } from "@/lib/crm/screens";
import { CrmScreenPage } from "./crm-screen-page";

const screens: Array<[CrmScreenId, string, string]> = [
  ["customers", "People", "CRM people"],
  ["organizations", "Companies", "CRM companies"],
  ["opportunities", "Deals", "CRM deals"],
  ["activities", "Activities", "CRM activities"],
  ["sequences", "Sequences", "CRM sequences"],
  ["crm-reports", "CRM reports", "CRM report rows"],
];

afterEach(() => vi.unstubAllGlobals());

describe("CrmScreenPage", () => {
  it.each([["crm-overview", "Overview", "Upcoming reminders"], ["conversations", "Chats", "WhatsApp chats"], ["automations", "Automations", "Automation workflows"]] as const)("renders %s as a purpose-built workspace, not a table", (id, title, region) => {
    render(<CrmScreenPage initialData={structuredClone(crmScreenFixture(id))} />);
    expect(screen.getByRole("heading", { name: title, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: region })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it.each(screens)("renders the %s backend data in the shared table theme", (id, title, tableName) => {
    render(<CrmScreenPage initialData={structuredClone(crmScreenFixture(id))} />);

    expect(screen.getByRole("heading", { name: title, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: tableName })).toBeInTheDocument();
    expect(screen.getByLabelText(`${title} summary`)).toBeInTheDocument();
  });

  it("filters opportunities and opens the record inspector", async () => {
    const interaction = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    render(<CrmScreenPage initialData={structuredClone(crmScreenFixture("opportunities"))} />);

    await interaction.click(screen.getByRole("button", { name: /Table view/ }));
    await interaction.click(screen.getByRole("option", { name: "Open (2)" }));
    expect(screen.getByText("Emirates Hills villa interior renovation")).toBeInTheDocument();

    await interaction.click(screen.getByRole("button", { name: /DIFC executive office fit-out/ }));
    const dialog = await screen.findByRole("dialog", { name: "DIFC executive office fit-out" });
    expect(within(dialog).getByText("Pipeline")).toBeInTheDocument();
    expect(within(dialog).getByText("Design & build sales")).toBeInTheDocument();
  });

  it("shows a permission state without exposing a misleading empty grid", () => {
    const fixture = crmScreenFixture("customers");
    render(<CrmScreenPage initialData={{ ...fixture, canView: false, items: [] }} />);

    expect(screen.getByText("People access is restricted")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "CRM people" })).not.toBeInTheDocument();
  });
});
