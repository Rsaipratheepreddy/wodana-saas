import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { leadsPageFixture } from "@/lib/crm/leads";
import { forgetAiReady } from "@/lib/workspace/ai-settings";
import { ActionDialog } from "./crm-workbench";
import { CreateDealDialog } from "./create-deal-dialog";
import { NewFollowUpDialog } from "./follow-up-editor";
import { LeadEnquiryForm } from "./lead-enquiry-form";
import { LogContactDialog } from "./log-contact-dialog";
import { OpportunityEditDialog } from "./opportunity-edit-dialog";

// §5c D.4: Sales dialogs are one column, label above field, sections divided by a hairline under a title, Save at the
// bottom end. FormRow stays only for two tightly coupled fields (a date and its time, a start and its length).
afterEach(() => { vi.unstubAllGlobals(); forgetAiReady(); });

const sectionTitles = (dialog: HTMLElement) => [...dialog.querySelectorAll(".wd-form-section-title")].map((title) => title.textContent);
const rows = (dialog: HTMLElement) => dialog.querySelectorAll(".wd-form-row").length;
const saveAtTheEnd = (dialog: HTMLElement, name: string) => {
  const actions = dialog.querySelector(".wd-form-footer .wd-dialog-actions");
  expect(actions?.lastElementChild?.textContent).toBe(name);
};

function leadsData() {
  const data = structuredClone(leadsPageFixture);
  data.defaultLocale = "en-AE";
  data.leadOptions = {
    enquiryTypes: [{ id: "design", label: "Design consultation" }], budgetRanges: [], customerTypes: [],
    emirates: [{ id: "dubai", label: "Dubai" }], areas: { dubai: [{ id: "marina", label: "Dubai Marina" }] },
    sources: [{ id: "company", label: "Company" }], channels: { company: [{ id: "call", label: "Call" }] },
  };
  return data;
}

describe("Sales form dialogs", () => {
  it("lays the enquiry form out in one column with Client and Enquiry sections", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ matches: [] }) })));
    render(<DesignSystemProvider><LeadEnquiryForm initialData={leadsData()} onClose={vi.fn()} onSaved={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "New enquiry" });
    expect(sectionTitles(dialog)).toEqual(["Client", "Enquiry"]);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Create enquiry");
  });

  it("edits an opportunity in one column", async () => {
    render(<DesignSystemProvider><OpportunityEditDialog workspaceId="w1" members={[{ id: "m1", label: "Dana" }]} onClose={vi.fn()} onSaved={vi.fn()}
      opportunity={{ id: "o1", version: 2, title: "Villa", amount: "1000", currencyCode: "USD", ownerMembershipId: "m1" }} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Edit opportunity" });
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Save");
  });

  it("converts an enquiry in one column", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
    const data = leadsData();
    render(<DesignSystemProvider><CreateDealDialog lead={data.items[0]} initialData={data} onClose={vi.fn()} onCreated={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Convert to opportunity" });
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Convert to opportunity");
  });

  it("logs a contact in How and Outcome sections", async () => {
    render(<DesignSystemProvider><LogContactDialog workspaceId="w1" lead={{ id: "l1", version: 1, name: "Amira" }} onClose={vi.fn()} onLogged={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Log contact" });
    expect(sectionTitles(dialog)).toEqual(["How", "Outcome"]);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Log contact");
  });

  it("adds a follow-up in one column, the reminder in its own section", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: [], nextCursor: null }) })));
    render(<DesignSystemProvider><NewFollowUpDialog workspaceId="w1" onClose={vi.fn()} onCreated={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Add follow-up" });
    expect(sectionTitles(dialog)).toEqual(["Reminder", "Details"]);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Save reminder");
  });

  it("gives the generic CRM dialog one column", async () => {
    render(<DesignSystemProvider><ActionDialog workspaceId="w1" onClose={vi.fn()} onSaved={vi.fn()}
      action={{ title: "Add address", path: "parties/p1/addresses", fields: [{ key: "line1", label: "Street" }, { key: "locality", label: "City", required: true }] }} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Add address" });
    const fields = dialog.querySelector("fieldset > div");
    expect(fields?.className).toMatch(/fields/);
    expect(rows(dialog)).toBe(0);
  });

  it("keeps two-column grids out of the Sales form styles, except the coupled date-and-time pair", () => {
    const sheets = ["crm-workbench", "create-deal-dialog", "log-contact-dialog", "follow-up-editor", "client-match-list", "lead-import-dialog", "leads-page", "lead-forms", "opportunity-flow"];
    const twoColumns = /grid-template-columns:\s*(repeat\(2,|repeat\(auto-fit|1fr 1fr|minmax\(0, ?1fr\) minmax\(0, ?1fr\))/;
    // Allowed: the date and time of one moment (crm-date-time-field) and option cards that are choices, not fields.
    const allowed = /^\.(dateFields|pathPicker|listControls)\b/;
    for (const sheet of sheets) {
      const css = readFileSync(join(__dirname, `${sheet}.module.css`), "utf8");
      const offenders = css.split("\n").filter((line) => twoColumns.test(line) && !allowed.test(line.trim().replace(/^@media[^{]*\{\s*/, "")));
      expect(offenders, `${sheet}.module.css`).toEqual([]);
    }
  });
});
