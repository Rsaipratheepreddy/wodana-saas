import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { ProjectPettyCash as State } from "@/lib/petty-cash/types";
import { ProjectPettyCash } from "./project-petty-cash";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/workspace/projects/p1/petty-cash", useSearchParams: () => new URLSearchParams() }));

// §5c D.4: the claim form is one column, label above field, in Expense and Receipt sections, Submit at the bottom end.
const sectionTitles = (dialog: HTMLElement) => [...dialog.querySelectorAll(".wd-form-section-title")].map((title) => title.textContent);
const rows = (dialog: HTMLElement) => dialog.querySelectorAll(".wd-form-row").length;
const saveAtTheEnd = (dialog: HTMLElement, name: string) => {
  const actions = dialog.querySelector(".wd-form-footer .wd-dialog-actions");
  expect(actions?.lastElementChild?.textContent).toBe(name);
};
const state: State = { claims: [], packages: [{ id: "k1", name: "Kitchen joinery" }], currency: "AED", today: "2026-09-27", me: "u2", canClaim: true, canApprove: false };

describe("Petty cash form dialogs", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("writes a claim in one column, its receipt in its own section", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => state })));
    render(<DesignSystemProvider><ProjectPettyCash workspaceId="w" projectId="p1" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "New claim" }));
    const dialog = await screen.findByRole("dialog", { name: "New claim" });
    expect(sectionTitles(dialog)).toEqual(["Expense", "Receipt"]);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Submit");
  });

  it("keeps two-column grids out of the petty cash styles", () => {
    const twoColumns = /grid-template-columns:\s*(repeat\(2,|repeat\(auto-fit|1fr 1fr|minmax\(0, ?1fr\) minmax\(0, ?1fr\))/;
    // Nothing allowed: the claim's facts (label · value) use a fixed label track, never two equal field columns.
    for (const sheet of readdirSync(__dirname).filter((name) => name.endsWith(".module.css"))) {
      const offenders = readFileSync(join(__dirname, sheet), "utf8").split("\n").filter((line) => twoColumns.test(line));
      expect(offenders, sheet).toEqual([]);
    }
  });
});
