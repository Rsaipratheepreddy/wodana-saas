import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { blankEntry, briefFields, deriveDiscoveryCoverage, type CaseContent } from "@/lib/pre-project/content";
import type { DefinitionPageData } from "@/lib/pre-project/definition";
import { BriefScopePage } from "./brief-scope-page";
import { DefinitionPage } from "./definition-page";
import { DesignJourney, type JourneyView } from "./design-journey";
import { MeasurementCreateForm } from "./measurement-create-form";

vi.mock("next/font/google", () => ({ Caveat: () => ({ variable: "note-font" }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn() }) }));

// §5c D.4: Planning dialogs are one column, label above field, sections divided by a hairline under a title, Save at the
// bottom end. FormRow stays only for two tightly coupled fields (a start and its length).
afterEach(() => vi.unstubAllGlobals());

const sectionTitles = (dialog: HTMLElement) => [...dialog.querySelectorAll(".wd-form-section-title")].map((title) => title.textContent);
const rows = (dialog: HTMLElement) => dialog.querySelectorAll(".wd-form-row").length;
const saveAtTheEnd = (dialog: HTMLElement, name: string) => {
  const actions = dialog.querySelector(".wd-form-footer .wd-dialog-actions");
  expect(actions?.lastElementChild?.textContent).toBe(name);
};

const brief = { ...(Object.fromEntries(Object.keys(briefFields).map((key) => [key, ""])) as Record<keyof typeof briefFields, string>), version: 0, currencyCode: "USD", budgetAmount: "" };
const content: CaseContent = { workspaceId: "workspace", caseId: "case", canEdit: true, rooms: [], entries: [{ ...blankEntry(null), id: "one", title: "Kitchen drawers", version: 1 }],
  coverage: deriveDiscoveryCoverage([], []), caseStatus: "active", fromCrm: false, crmContext: { description: null, opportunityAmount: null, currencyCode: "USD" }, brief };

const definition: DefinitionPageData = { workspaceId: "workspace", caseId: "case", definition: {
  caseStatus: "active", draft: { sourceHash: "hash", readyToPublish: true, issues: [] },
  current: { id: "baseline", number: 1, status: "awaiting_confirmation", current: true, message: "", publishedAt: "2026-09-17T12:15:30.500Z", publishedBy: "Owner", decision: null,
    snapshot: { definition: { brief: {}, rooms: [], items: [] } } },
  history: [], confirmed: false, nextAction: "REQUEST_DEFINITION_CONFIRMATION", canPublish: true, canRecordClientDecision: true,
}, readiness: { ready: false, summary: { includedItemCount: 1, readyItemCount: 0, blockerCount: 1, warningCount: 0 }, blockers: [] } };

describe("Planning form dialogs", () => {
  it("records the client's answer in one column, the proof in its own section", async () => {
    render(<DesignSystemProvider><DefinitionPage initial={definition} /></DesignSystemProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Record the client's answer" }));
    const dialog = await screen.findByRole("dialog", { name: "Record the client's answer" });
    expect(sectionTitles(dialog)).toEqual(["Proof"]);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Save");
  });

  it("edits the project brief in Property and Budget and timeline sections", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [], canEdit: true }) }));
    render(<DesignSystemProvider><BriefScopePage initialData={content} /></DesignSystemProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Project brief" }));
    const dialog = await screen.findByRole("dialog", { name: "Project brief" });
    expect(sectionTitles(dialog)).toEqual(["Property", "Budget and timeline"]);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Save brief");
  });

  it("books a site visit with only the start and its length side by side", async () => {
    const view: JourneyView = { journey: { packageName: "Design", includedRevisions: 2 }, measurements: [], siteEvidenceProblem: null, timezone: "Europe/London", canStart: false,
      stages: [{ stage: "site_visit", label: "Site visit", status: "active", ownerName: "Dana", dueAt: null, completedAt: null, overdue: false, version: 1, scheduledAt: null, scheduledEnd: null, scheduledTimezone: null, scheduledLocation: null }] };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => view })));
    render(<DesignSystemProvider><DesignJourney workspaceId="ws" caseId="c1" locale="en-GB" /></DesignSystemProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Book visit" }));
    const dialog = await screen.findByRole("dialog", { name: "Book site visit" });
    expect(rows(dialog)).toBe(1);
    saveAtTheEnd(dialog, "Book");
  });

  it("adds a measurement in Item and Measurement sections, Save last", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) })));
    render(<DesignSystemProvider><MeasurementCreateForm data={content} entries={[]} initialRoom="all" onClose={vi.fn()} onCreateRequirement={vi.fn()} onSaved={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Add measurement" });
    await waitFor(() => expect(sectionTitles(dialog)).toEqual(["Item", "Measurement"]));
    expect(rows(dialog)).toBe(0);
    const buttons = [...dialog.querySelectorAll("button")].filter((button) => ["Cancel", "Save measurement"].includes(button.textContent ?? ""));
    expect(buttons.map((button) => button.textContent)).toEqual(["Cancel", "Save measurement"]);
  });

  it("keeps two-column grids out of the Planning form styles, except coupled measurements and non-form grids", () => {
    const twoColumns = /grid-template-columns:\s*(repeat\(2,|repeat\(auto-fi(t|ll)|1fr 1fr|minmax\(0, ?1fr\) minmax\(0, ?1fr\))/;
    const allowed = new RegExp([
      "\\.dimensionValues", // approximate, measured and unit of one dimension (a coupled measurement)
      "\\.(handoffFacts|facts|pulseFacts|overview)\\b", // read-only facts
      "\\.(dimensionLabels|dimensionRow)\\b", // the read-only dimension readout's table rows
      "\\.(cards|rooms|mosaic|photos|sheetPhotos|panelPhotos|grid|folderGrid|fileGrid|comparisonGrid)\\b", // cards, photos, files and side-by-side drawings
    ].join("|"));
    const sheets = readdirSync(__dirname).filter((file) => file.endsWith(".module.css"));
    for (const sheet of sheets) {
      const css = readFileSync(join(__dirname, sheet), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "");
      const offenders = [...css.matchAll(/([^{};]+)\{([^{}]*)\}/g)]
        .filter(([, , body]) => twoColumns.test(body))
        .map(([, selector]) => selector.trim())
        .filter((selector) => !allowed.test(selector));
      expect(offenders, sheet).toEqual([]);
    }
  });
});
