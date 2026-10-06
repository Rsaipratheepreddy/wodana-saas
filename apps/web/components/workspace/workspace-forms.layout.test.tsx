import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { companyProfileFixture } from "@/lib/workspace/company-profile";
import { integrationsPageFixture } from "@/lib/workspace/integrations";
import { membersPageFixture } from "@/lib/workspace/members";
import { organizationStructureFixture } from "@/lib/workspace/organization-structure";
import { rolesPermissionsFixture } from "@/lib/workspace/roles-permissions";
import { CompanyProfile } from "./company-profile";
import { IntegrationTools } from "./integration-tools";
import { LegalEntitiesPanel } from "./legal-entities-panel";
import { MembersPage } from "./members-page";
import { OrganizationStructurePage } from "./organization-structure-page";
import { RolesPermissionsPage } from "./roles-permissions-page";

// §5c D.4: settings dialogs are one column, label above field, titled sections divided by a hairline, Save at the
// bottom end, no explanatory paragraphs. Two fields share a row only when they are one value (a rate and its currency).
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/workspace/settings", useSearchParams: () => new URLSearchParams() }));
afterEach(() => vi.unstubAllGlobals());

const sectionTitles = (dialog: HTMLElement) => [...dialog.querySelectorAll(".wd-form-section-title")].map((title) => title.textContent);
const rows = (dialog: HTMLElement) => dialog.querySelectorAll(".wd-form-row").length;
const saveAtTheEnd = (dialog: HTMLElement, name: string) => {
  const actions = dialog.querySelector(".wd-form-footer .wd-dialog-actions") ?? dialog.querySelector(".wd-dialog-actions");
  expect(actions?.lastElementChild?.textContent).toBe(name);
};
const noDescription = (dialog: HTMLElement) => expect(dialog.querySelector("header p")).toBeNull();
const stubFetch = (json: unknown = []) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => json })));

describe("Settings form dialogs", () => {
  it("edits the company profile in one column: Legal & tax, Registered office, Regional defaults", async () => {
    stubFetch();
    render(<CompanyProfile canManage initialData={structuredClone(companyProfileFixture)} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit profile" });
    expect(sectionTitles(dialog)).toEqual(["Legal & tax", "Registered office", "Regional defaults"]);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Save");
  });

  it("adds a business in the same sections, without an introduction", async () => {
    render(<DesignSystemProvider><LegalEntitiesPanel canManage initialEntities={companyProfileFixture.legalEntities} onChange={vi.fn()} workspace={companyProfileFixture.workspace} /></DesignSystemProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Add business" }));
    const dialog = await screen.findByRole("dialog", { name: "Add business" });
    expect(sectionTitles(dialog)).toEqual(["Legal & tax", "Registered office", "Contact", "Letterhead", "Regional defaults"]);
    expect(rows(dialog)).toBe(0);
    noDescription(dialog);
    saveAtTheEnd(dialog, "Add business");
  });

  it("creates a team with Members and Access sections and a business unit with its Structure", async () => {
    render(<OrganizationStructurePage initialData={structuredClone(organizationStructureFixture)} />);
    await userEvent.click(screen.getByRole("button", { name: "Team" }));
    const team = await screen.findByRole("dialog", { name: "Create team" });
    expect(sectionTitles(team)).toEqual(["Members", "Access"]);
    expect(rows(team)).toBe(0);
    saveAtTheEnd(team, "Save team");
    await userEvent.click(within(team).getByRole("button", { name: "Cancel" }));

    await userEvent.click(screen.getByRole("button", { name: "Department" }));
    const unit = await screen.findByRole("dialog", { name: "Create business unit" });
    expect(sectionTitles(unit)).toEqual(["Structure"]);
    expect(rows(unit)).toBe(0);
    saveAtTheEnd(unit, "Save business unit");
  });

  it("creates a role in one column without explaining the form", async () => {
    render(<RolesPermissionsPage initialData={structuredClone(rolesPermissionsFixture)} />);
    await userEvent.click(screen.getByRole("button", { name: "New role" }));
    const dialog = await screen.findByRole("dialog", { name: "Create custom role" });
    expect(rows(dialog)).toBe(0);
    noDescription(dialog);
    expect(within(dialog).queryByText("Used internally for access assignments.")).not.toBeInTheDocument();
    saveAtTheEnd(dialog, "Save role");
  });

  it("invites a member in one column without an introduction", async () => {
    render(<MembersPage initialData={structuredClone(membersPageFixture)} />);
    await userEvent.click(screen.getByRole("button", { name: "Invite with details" }));
    const dialog = await screen.findByRole("dialog", { name: "Invite a member" });
    expect(rows(dialog)).toBe(0);
    noDescription(dialog);
    saveAtTheEnd(dialog, "Create invitation");
  });

  it("creates an invoice through a connected account in sections, the action at the bottom end", async () => {
    stubFetch({ items: [] });
    const connection = { ...integrationsPageFixture.connections[0], provider: "quickbooks" as const };
    render(<DesignSystemProvider><IntegrationTools connection={connection} workspaceId={integrationsPageFixture.workspaceId} canManage onClose={vi.fn()} /></DesignSystemProvider>);
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /What would you like to do\?/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Create an invoice" }));
    expect(sectionTitles(dialog)).toEqual(["Amount", "Dates"]);
    noDescription(dialog);
    saveAtTheEnd(dialog, "Create invoice");
  });

  it("keeps two-column grids out of the settings form styles, except coupled pairs and card grids", () => {
    const sheets = ["company-profile", "integration-tools", "integrations-page", "members-page", "organization-structure-page", "roles-permissions-page", "security-page", "tax-numbering-sheet"];
    const twoColumns = /grid-template-columns:\s*(repeat\(2,|repeat\(auto-fit|1fr 1fr|minmax\(0, ?1fr\) minmax\(0, ?1fr\))/;
    const allowed = [
      /^\.amountCurrency, \.dateRange$/, // a rate and its currency; an invoice date and its due date
      /^\.catalogGrid$/, /^\.plannedGrid$/, // integration cards, not fields
      /^\.recoveryCodes$/, // a printed list of recovery codes
    ];
    for (const sheet of sheets) {
      const css = readFileSync(join(__dirname, `${sheet}.module.css`), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "");
      const offenders = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .map(([, selector, body]) => ({ selector: selector.trim().replace(/\s+/g, " "), body }))
        .filter(({ selector, body }) => twoColumns.test(body) && !allowed.some((pattern) => pattern.test(selector)))
        .map(({ selector }) => selector);
      expect(offenders, `${sheet}.module.css`).toEqual([]);
    }
  });
});
