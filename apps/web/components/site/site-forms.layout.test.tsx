import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { HandoverState, SiteState, WarrantyState } from "@/lib/site/types";
import { ProjectHandover } from "./project-handover";
import { ProjectSite } from "./project-site";
import { ProjectWarranty } from "./project-warranty";

// §5c D.4: site forms are one column, label above field, titled sections when there are more than about five fields,
// Save at the bottom end. No two-column field rows here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/workspace/projects/p1/site", useSearchParams: () => new URLSearchParams() }));
afterEach(() => { vi.unstubAllGlobals(); });

const sectionTitles = (dialog: HTMLElement) => [...dialog.querySelectorAll(".wd-form-section-title")].map((title) => title.textContent);
const rows = (dialog: HTMLElement) => dialog.querySelectorAll(".wd-form-row, [class*=pair]").length;
const saveAtTheEnd = (dialog: HTMLElement, name: string) => {
  const actions = dialog.querySelector(".wd-form-footer .wd-dialog-actions");
  expect(actions?.lastElementChild?.textContent).toBe(name);
};
const respond = (value: unknown) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => value })));
const PID = "0c6b0c7e-4c4d-4a9e-9d64-3b6f0f2d7a11";

describe("Site form dialogs", () => {
  it("records a warranty claim in Raised and Problem sections", async () => {
    const state: WarrantyState = { items: [], claims: [], lines: [{ id: "l1", title: "Kitchen cabinets" }], areas: [{ id: "a1", name: "Kitchen" }], today: "2027-06-01", canRecord: true, canManage: true };
    respond(state);
    render(<DesignSystemProvider><ProjectWarranty workspaceId="w" projectId={PID} /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Record a claim" }));
    const dialog = await screen.findByRole("dialog", { name: "Record a claim" });
    expect(sectionTitles(dialog)).toEqual(["Raised", "Problem"]);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Save");
  });

  it("records a handover acceptance in Client decision and Still outstanding sections", async () => {
    const state: HandoverState = {
      packs: [{ id: "k1", revision: 1, title: "Kitchen handover", areaIds: [], status: "issued", replacesId: null, contentHash: "b".repeat(64), issuedAt: "2026-09-26T10:00:00Z", issuedByName: null,
        decidedOn: null, decidedByName: null, decisionMethod: null, decisionNote: "", version: 2, documents: [] }],
      areas: [], covered: false, canManage: true, open: { stages: [], snags: [] },
    };
    respond(state);
    render(<DesignSystemProvider><ProjectHandover workspaceId="w" projectId={PID} /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Record acceptance" }));
    const dialog = await screen.findByRole("dialog", { name: "Record acceptance" });
    expect(sectionTitles(dialog)).toEqual(["Client decision", "Still outstanding"]);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Save");
  });

  it("writes the day's report in sections, the conditions stacked", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:photo"), revokeObjectURL: vi.fn() }));
    const state: SiteState = {
      site: { startedOn: "2026-09-21", finishedOn: null }, reports: [], lines: [], members: [{ membershipId: "m1", name: "Omar Haddad" }], today: "2026-09-27", me: "u1",
      canReport: true, canApprove: true, canManage: true, dueTime: "18:00", plan: { today: [], tomorrow: { day: "2026-09-28", tasks: [] } }, areas: [], deliveries: [], crew: [], missing: [],
    };
    respond(state);
    render(<DesignSystemProvider timeZone="UTC"><ProjectSite workspaceId="w" projectId={PID} /></DesignSystemProvider>);
    await userEvent.click((await screen.findAllByRole("button", { name: "Add today's report" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Today's report" });
    expect(sectionTitles(dialog)).toEqual(["Today's work", "Photos", "Crew", "Issues", "Tomorrow", "Materials", "Installed", "Conditions"]);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Submit");
  });

  it("keeps two-column grids out of the site form styles, except photo grids and the printed report", () => {
    const twoColumns = /grid-template-columns:\s*(repeat\(2,|repeat\(auto-fit|1fr 1fr|minmax\(0, ?1fr\) minmax\(0, ?1fr\))/;
    const allowed: Record<string, RegExp> = {
      // Each crew line (trade, people, hours) in the report's crew list: a line editor, not a form row.
      "daily-capture.module.css": /^\.crew$/,
      // A before/after photo pair in the client's progress card.
      "progress-card.module.css": /^\.strip li\[data-pair\]$/,
      // The printed report's photo rows.
      "progress-print.module.css": /^\.row$/,
    };
    for (const sheet of readdirSync(__dirname).filter((name) => name.endsWith(".module.css"))) {
      const css = readFileSync(join(__dirname, sheet), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const offenders = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, , body]) => twoColumns.test(body))
        .map(([, selector]) => selector.trim())
        .filter((selector) => !allowed[sheet]?.test(selector));
      expect(offenders, sheet).toEqual([]);
    }
  });
});
