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

  it("opens New item empty again after it was closed with something typed (no draft is kept)", async () => {
    stub();
    const user = userEvent.setup();
    render(<DesignSystemProvider><CatalogPage workspaceId="w" canManage currency="USD" initialCatalogs={[catalog]} /></DesignSystemProvider>);
    for (let round = 0; round < 2; round += 1) {
      await user.click(screen.getByRole("button", { name: "Add item" }));
      await screen.findByRole("dialog", { name: "New item" });
      expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("");
      await user.type(screen.getByRole("textbox", { name: "Name" }), "Oak veneer");
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await user.click(await screen.findByRole("button", { name: "Discard changes" }));
      await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: "New item" })).not.toBeInTheDocument());
    }
    expect(Object.keys(window.localStorage).filter((key) => key.includes("new-item"))).toEqual([]);
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
      "^\\.recipeRow$", // one line per recipe component (PLM-162): its kind, whether per unit or per batch, the batch size or hours
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

describe("Catalog grid", () => {
  const sized: CatalogStructure = { ...structure, attributes: [...structure.attributes,
    { id: "a2", code: "depth_cm", label: "DEPTH (CM)", valueType: "text", required: false, choices: [], unitCode: null, categoryId: null },
    { id: "a3", code: "height_cm", label: "HEIGHT (CM)", valueType: "text", required: false, choices: [], unitCode: null, categoryId: null }] };
  const row = { id: "i1", code: "ACE-BURGUNDY-MARBLE-SIDE-TABLE", name: "Ace side table", itemType: "product", unitCode: "pcs", status: "active", version: 1, categoryId: "c1", categoryName: "Boards",
    values: { finish: "Marble" }, sellPrice: { method: "fixed", price: "4800", rate: null, currency: "AED", status: "active" }, image: null };

  it("shows only attribute columns the items fill, and the price as one end-aligned line", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => url.includes("/structure") ? sized : { items: [row] } })));
    render(<DesignSystemProvider><CatalogPage workspaceId="w" canManage currency="AED" initialCatalogs={[catalog]} locale="en" /></DesignSystemProvider>);
    await screen.findByText("Ace side table");
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent?.trim())).toEqual(["Photo", "Item", "Category", "Finish", "Price"]);
    const price = screen.getAllByRole("columnheader").at(-1)!;
    expect(price).toHaveAttribute("data-align", "end");
    const cell = screen.getByText(/4,800\.00/).closest("td")!;
    expect(cell).toHaveAttribute("data-align", "end");
    expect(cell.textContent).toMatch(/4,800\.00 \/ pcs$/);
    expect(screen.getByTitle("ACE-BURGUNDY-MARBLE-SIDE-TABLE · Product")).toBeInTheDocument();
  });

  it("keeps figures on one line, puts end-aligned headers over them, and keeps item rows compact", () => {
    const read = (file: string) => readFileSync(join(__dirname, file), "utf8").replace(/\s+/g, " ");
    const tables = read("../../design-system/styles/record-tables.css");
    expect(tables).toMatch(/td\[data-align="end"\] :is\(span, strong, small, b, div, p, a, time\) \{ font-variant-numeric: tabular-nums; white-space: nowrap; \}/);
    expect(read("../../design-system/styles/page.css")).toContain('.wd-data-grid th[data-align="end"] .wd-sort-button > svg:last-child { order: -1; margin-inline-start: 0; }');
    const page = read("catalog-page.module.css");
    expect(page).toContain(".content .itemCell .itemCode { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }");
    expect(page).toMatch(/\.content \.itemCell \.itemName \{[^}]*-webkit-line-clamp: 2;/);
  });
});
