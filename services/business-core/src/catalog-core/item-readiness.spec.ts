import { describe, expect, it } from "vitest";
import { catalogCells, catalogRows, evidenceText, guessEvidence, missingCount, parseReadinessSettings, ReadinessSettingsError, type CatalogFacts } from "./item-readiness";

const facts = (input: Partial<CatalogFacts> = {}): CatalogFacts => ({
  itemType: "product", catalogPurpose: "sell", hasImage: false, hasSize: false, sizeNotes: "", price: null, drawingUrl: null,
  materialComponents: 0, labourComponents: 0, materialText: "", labourText: "", ...input,
});

describe("catalogue item readiness", () => {
  it("reads every record in hand as done", () => {
    const cells = catalogCells(facts({ itemType: "assembly", hasImage: true, hasSize: true, price: "live", drawingUrl: "https://files.example/d.pdf", materialComponents: 3, labourComponents: 1 }));
    expect(Object.values(cells).every((cell) => cell.state === "done")).toBe(true);
    expect(cells.materials.note).toBe("components");
  });

  it("asks a made item for its materials and labour, and a product only for what a product needs", () => {
    const made = catalogCells(facts({ itemType: "assembly" }));
    expect(made.materials.state).toBe("missing");
    expect(made.labour.state).toBe("missing");
    const product = catalogCells(facts());
    expect(product).toMatchObject({ picture: { state: "missing" }, size: { state: "missing" }, price: { state: "missing" }, drawing: { state: "missing" },
      materials: { state: "not_needed" }, labour: { state: "not_needed" } });
  });

  it("needs no picture for a service, no size or drawing for a material, and no selling price in a buying catalogue", () => {
    expect(catalogCells(facts({ itemType: "service" })).picture.state).toBe("not_needed");
    expect(catalogCells(facts({ itemType: "material" }))).toMatchObject({ size: { state: "not_needed" }, drawing: { state: "not_needed" } });
    expect(catalogCells(facts({ catalogPurpose: "buy" })).price.state).toBe("not_needed");
  });

  it("counts an imported sheet's text as done from the sheet, with the text", () => {
    const cells = catalogCells(facts({ itemType: "assembly", sizeNotes: "Total H 108 cm", materialText: "Wood, fabric, foam", labourText: "Carpentry · 12 hours" }));
    expect(cells.size).toEqual({ state: "done", note: "from_sheet", detail: "Total H 108 cm" });
    expect(cells.materials).toEqual({ state: "done", note: "from_sheet", detail: "Wood, fabric, foam" });
    expect(cells.labour).toEqual({ state: "done", note: "from_sheet", detail: "Carpentry · 12 hours" });
  });

  it("shows a price waiting for review as waiting, not missing", () => {
    expect(catalogCells(facts({ price: "pending" })).price).toEqual({ state: "waiting", note: "in_review" });
  });

  it("counts only the shown columns", () => {
    const cells = catalogCells(facts());
    expect(missingCount(cells, ["picture", "size", "price", "drawing"])).toBe(4);
    expect(missingCount(cells, ["picture"])).toBe(1);
  });

  it("joins the chosen attributes' text in the chosen order", () => {
    expect(evidenceText({ materials_needed: " Wood ", amount: "2 sheets", other: "x" }, ["materials_needed", "amount", "missing"])).toBe("Wood · 2 sheets");
  });

  it("builds rows from facts with the settings' attributes", () => {
    const [row] = catalogRows([{
      id: "i1", catalogId: "c1", code: "SOFA-1", name: "Sofa", itemType: "product", unitCode: "pcs", categoryName: null, image: null,
      catalogPurpose: "sell", hasImage: false, hasSize: false, price: "live", drawingUrl: null, materialComponents: 0, labourComponents: 0,
      values: { materials_needed: "Wood, fabric", hours_needed: "12", size_notes: "H 80" },
    }], { columns: ["picture", "size", "price", "drawing", "materials", "labour"], materialAttributes: ["materials_needed"], labourAttributes: ["hours_needed"] });
    expect(row.cells.materials).toMatchObject({ state: "done", note: "from_sheet" });
    expect(row.cells.labour).toMatchObject({ state: "done", detail: "12" });
    expect(row.cells.size.state).toBe("done");
    expect(row.missing).toBe(2);
    expect(row).not.toHaveProperty("values");
  });
});

describe("readiness settings", () => {
  it("guesses a sheet's material and labour columns from the attribute names", () => {
    expect(guessEvidence(["materials_needed", "amount", "trades_required", "hours_needed", "size_notes", "colour", "material"]))
      .toEqual({ materialAttributes: ["material", "materials_needed"], labourAttributes: ["hours_needed", "trades_required"] });
  });

  it("keeps known columns in the standard order and refuses anything else", () => {
    expect(parseReadinessSettings({ columns: ["price", "picture", "price"], materialAttributes: ["materials_needed"] }))
      .toEqual({ columns: ["picture", "price"], materialAttributes: ["materials_needed"], labourAttributes: [] });
    expect(() => parseReadinessSettings({ columns: [] })).toThrow(ReadinessSettingsError);
    expect(() => parseReadinessSettings({ columns: ["render"] })).toThrow("Unknown readiness column.");
    expect(() => parseReadinessSettings({ columns: ["picture"], labourAttributes: ["Hours Needed"] })).toThrow("Unknown attribute.");
    expect(() => parseReadinessSettings({ columns: "picture" })).toThrow("Columns must be a list.");
  });
});
