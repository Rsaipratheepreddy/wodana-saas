import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { CatalogStructure } from "@/lib/workspace/catalog-v2";
import { CatalogItemForm } from "./catalog-item-editors";
import { CatalogPage } from "./catalog-page";

// §5c D.4: Catalog forms are one column, label above field, sections divided by a hairline under a title, Save at the end.
afterEach(() => vi.unstubAllGlobals());

const sectionTitles = (scope: HTMLElement) => [...scope.querySelectorAll(".wd-form-section-title")].map((title) => title.textContent);
const rows = (scope: HTMLElement) => scope.querySelectorAll(".wd-form-row").length;
const saveAtTheEnd = (dialog: HTMLElement, name: string) => {
  const actions = dialog.querySelector(".wd-form-footer .wd-dialog-actions");
  expect(actions?.lastElementChild?.textContent).toBe(name);
};

const structure: CatalogStructure = {
  categories: [{ id: "c1", parentId: null, code: "boards", name: "Boards" }],
  attributes: [{ id: "a1", code: "finish", label: "Finish", valueType: "text", required: false, choices: [], unitCode: null, categoryId: null }],
  units: [{ code: "sheet", label: "Sheet", kind: "count" }],
};
const catalog = { id: "k1", code: "MAIN", name: "Main catalog", purpose: "sell" as const, itemCount: 0, version: 1 };
const stub = () => vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => url.includes("/structure") ? structure : { items: [] } })));

describe("Catalog form dialogs", () => {
  it("creates a catalog in one column", async () => {
    render(<DesignSystemProvider><CatalogPage workspaceId="w" canManage currency="USD" initialCatalogs={[]} /></DesignSystemProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Create catalog" }));
    const dialog = await screen.findByRole("dialog", { name: "New catalog" });
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Create catalog");
  });

  it("adds an item in one column", async () => {
    stub();
    render(<DesignSystemProvider><CatalogPage workspaceId="w" canManage currency="USD" initialCatalogs={[catalog]} /></DesignSystemProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    const dialog = await screen.findByRole("dialog", { name: "New item" });
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Add item");
  });

  it("edits an item in Attributes and Quantities sections, Save last", () => {
    const { container } = render(<DesignSystemProvider><CatalogItemForm workspaceId="w" catalogId="k1" structure={structure} onSaved={vi.fn()} onCancel={vi.fn()}
      item={{ id: "i1", code: "PLY-18", name: "Plywood 18mm", itemType: "material", unitCode: "sheet", categoryId: null, description: null, wastePercent: "5", purchaseRoundTo: null, values: {}, version: 3, components: [] }} /></DesignSystemProvider>);
    const form = container.querySelector("form")!;
    expect(sectionTitles(form)).toEqual(["Attributes", "Quantities"]);
    expect(rows(form)).toBe(0);
    expect([...form.querySelectorAll("button")].at(-1)?.textContent).toBe("Save item");
  });

  it("keeps two-column grids out of the Catalog form styles, except line rows and read-only facts", () => {
    const twoColumns = /grid-template-columns:\s*(repeat\(2,|repeat\(auto-fi(t|ll)|1fr 1fr|minmax\(0, ?1fr\) minmax\(0, ?1fr\))/;
    const allowed = new RegExp([
      "^\\.facts$", // read-only item facts
      "^\\.sheets li$", // one line per spreadsheet sheet: its category and the columns found
      "^\\.tierRow$", // one line per price tier: the quantity it starts at and its price
    ].join("|"));
    for (const sheet of readdirSync(__dirname).filter((file) => file.endsWith(".module.css"))) {
      const css = readFileSync(join(__dirname, sheet), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "");
      const offenders = [...css.matchAll(/([^{};]+)\{([^{}]*)\}/g)]
        .filter(([, , body]) => twoColumns.test(body))
        .flatMap(([, selector]) => selector.split(",").map((part) => part.trim()))
        .filter((selector) => !allowed.test(selector));
      expect(offenders, sheet).toEqual([]);
    }
  });
});
