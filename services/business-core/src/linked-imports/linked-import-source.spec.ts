import { describe, expect, it } from "vitest";
import { checkMapping, checkSheets, fingerprint, readRows, sameNumber, sheetNumber, SourceError } from "./linked-import-source";

// A typical stock list, with a title row above the headings and a blank row in the middle.
const STOCK = [
  ["Factory stock list", "", "", "", "", ""],
  ["Code", "Item", "Unit", "Qty", "Location", "Cost"],
  ["MAT-001", "Oak veneer 0.6mm", "sqm", "120", "", "18.50"],
  ["", "", "", "", "", ""],
  ["MAT-002", "Velvet fabric – Sage", "m", "1,240.5", "Showroom", "AED 42"],
];

describe("linked import source", () => {
  it("needs a known field per column, one column per field and the code column", () => {
    expect(() => checkMapping("stock", { columns: { Item: "name" } })).toThrow(/item code/);
    expect(() => checkMapping("stock", { columns: { Code: "code", A: "name", B: "name" } })).toThrow(/one column only/);
    expect(() => checkMapping("stock", { columns: { Code: "code", Price: "price" } })).toThrow(SourceError);
    expect(checkMapping("catalog", { columns: { " Code ": "code", Fabric: "attribute", Finish: "attribute", Notes: "" } })).toEqual({ columns: { Code: "code", Fabric: "attribute", Finish: "attribute" } });
  });

  it("reads rows under the heading row through the mapping and skips blank rows", () => {
    const mapping = checkMapping("stock", { columns: { code: "code", item: "name", unit: "unit", QTY: "quantity", Location: "location", Cost: "cost" } });
    const { rows, skippedTabs } = readRows("stock", [{ name: "Stock", rows: STOCK }, { name: "Notes", rows: [["Read me"]] }], mapping);
    expect(skippedTabs).toEqual(["Notes"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sheet: "Stock", line: 3, key: "MAT-001", values: { name: "Oak veneer 0.6mm", unit: "sqm", quantity: "120", location: "", cost: "18.50" } });
    expect(rows[1]).toMatchObject({ line: 5, key: "MAT-002", values: { quantity: "1,240.5", location: "Showroom" } });
  });

  it("takes each tab's name as the category of a multi-tab product list without a category column, and keeps extra columns as attributes", () => {
    const mapping = checkMapping("catalog", { columns: { Code: "code", Name: "name", Fabric: "attribute" } });
    const sheets = [
      { name: "Sofas", rows: [["Code", "Name", "Fabric"], ["SOF-1", "Aria sofa", "Boucle"]] },
      { name: "Chairs", rows: [["Code", "Name", "Fabric"], ["CHR-1", "Luna chair", ""]] },
    ];
    const { rows } = readRows("catalog", sheets, mapping);
    expect(rows.map((row) => [row.key, row.values.category, row.attributes])).toEqual([["SOF-1", "Sofas", { Fabric: "Boucle" }], ["CHR-1", "Chairs", {}]]);
  });

  it("reads numbers the way sheets write them", () => {
    expect(sheetNumber("1,240.5", "Qty")).toBe("1240.5");
    expect(sheetNumber("AED 42", "Cost")).toBe("42");
    expect(sheetNumber("€ 1.234,50", "Cost")).toBe("1234.5");
    expect(sheetNumber("12,5", "Qty")).toBe("12.5");
    expect(sheetNumber("1 200", "Qty")).toBe("1200");
    expect(sheetNumber("", "Qty")).toBeNull();
    expect(sheetNumber("0.123456", "Qty")).toBe("0.1235");
    expect(() => sheetNumber("-3", "Qty")).toThrow(/below zero/);
    expect(() => sheetNumber("ten", "Qty")).toThrow(/isn't a number/);
    expect(() => sheetNumber("2.5", "Production time", { places: 0, whole: true })).toThrow(/whole days/);
    expect(sameNumber("12.50", "12.5")).toBe(true);
    expect(sameNumber(null, "")).toBe(true);
    expect(sameNumber("0", null)).toBe(false);
  });

  it("fingerprints the same data the same way, whatever the unmapped columns hold", () => {
    const mapping = checkMapping("stock", { columns: { Code: "code", Qty: "quantity" } });
    const a = readRows("stock", [{ name: "S", rows: [["Code", "Qty", "Note"], ["A", "1", "x"]] }], mapping).rows;
    const b = readRows("stock", [{ name: "S", rows: [["Code", "Qty", "Note"], ["A", "1", "y"]] }], mapping).rows;
    const c = readRows("stock", [{ name: "S", rows: [["Code", "Qty", "Note"], ["A", "2", "x"]] }], mapping).rows;
    expect(fingerprint("stock", mapping, a)).toBe(fingerprint("stock", mapping, b));
    expect(fingerprint("stock", mapping, a)).not.toBe(fingerprint("stock", mapping, c));
  });

  it("bounds what it reads", () => {
    expect(() => checkSheets([])).toThrow(/no sheets/);
    expect(() => checkSheets([{ name: "S", rows: Array.from({ length: 5001 }, () => ["x"]) }])).toThrow(/5000 rows/);
    expect(checkSheets([{ name: " S ", rows: [[" a ", null, 3]] }])).toEqual([{ name: "S", rows: [["a", "", "3"]] }]);
  });
});
