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
  it("needs a known field per column and the code or name column; a field may come from headings tabs spell differently", () => {
    expect(() => checkMapping("stock", { columns: { Qty: "quantity" } })).toThrow(/item code or name/);
    expect(checkMapping("stock", { columns: { Item: "name" } })).toEqual({ columns: { Item: "name" } });
    expect(checkMapping("stock", { columns: { Code: "code", A: "name", B: "name" } }).columns).toEqual({ Code: "code", A: "name", B: "name" });
    expect(() => checkMapping("stock", { columns: { Code: "code", Price: "price" } })).toThrow(SourceError);
    expect(checkMapping("catalog", { columns: { Name: "name" }, tabs: [" Sofa ", "Sofa", "Beds"] })).toEqual({ columns: { Name: "name" }, tabs: ["Sofa", "Beds"] });
    expect(() => checkMapping("catalog", { columns: { Name: "name" }, tabs: [] })).toThrow(/tabs/);
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

  it("reads blocks of a category title and its heading row, each block's title its rows' category, notes skipped", () => {
    const mapping = checkMapping("catalog", { columns: { DESCRIPTION: "name", "PRICE (AED)": "price", "Technical Drawing": "technicalDrawing", "Drawings links": "technicalDrawing",
      REMARKS: "attribute" }, tabs: ["Living", "Dining"] });
    const living = { name: "Living", rows: [
      ["", "", "Ask the workshop for more", ""],
      ["", "SOFA", "", ""],
      ["REMARKS", "DESCRIPTION", "PRICE (AED)", "Technical Drawing"],
      ["", "Aria Sofa – 3 seater", "AED23,500.00", "Aria Sofa 3"],
      ["Check the fabric", "", "", ""],
      ["", "", "", ""],
      ["", "ARMCHAIRS", "", ""],
      ["REMARKS", "DESCRIPTION", "PRICE (AED)", "Technical Drawing"],
      ["", "Luna Chair", "ENQUIRE", "no cad file"],
    ], links: { "3:3": "https://drive.example/aria.pdf", "8:9": "https://drive.example/elsewhere.pdf" } };
    const dining = { name: "Dining", rows: [["DESCRIPTION", "Technical Drawing", "Drawings links"], ["Oak Table", "Oak painted", "Oak Table"]], links: { "1:2": "https://drive.example/oak.pdf" } };
    const notes = { name: "Notes", rows: [["DESCRIPTION", "PRICE (AED)"], ["Not imported", "1"]] };
    const { rows, skippedTabs } = readRows("catalog", [living, dining, notes], mapping);
    expect(skippedTabs).toEqual([]);
    expect(rows.map((row) => [row.line, row.key, row.values.category, row.values.price, row.links?.technicalDrawing ?? null])).toEqual([
      [4, "SOFA / Aria Sofa – 3 seater", "SOFA", "AED23,500.00", "https://drive.example/aria.pdf"],
      [9, "ARMCHAIRS / Luna Chair", "ARMCHAIRS", "ENQUIRE", null],
      [2, "Dining / Oak Table", "Dining", undefined, "https://drive.example/oak.pdf"],
    ]);
    // A field from two columns: the first filled value, and the first link.
    expect(rows[2].values.technicalDrawing).toBe("Oak painted");
    expect(rows[0].headings).toMatchObject({ name: "DESCRIPTION", price: "PRICE (AED)" });
    // A mapped category column wins over the block's title.
    const withCategory = checkMapping("catalog", { columns: { DESCRIPTION: "name", Type: "category" } });
    expect(readRows("catalog", [{ name: "T", rows: [["COLLECTION"], ["Type", "DESCRIPTION"], ["Chairs", "Luna"]] }], withCategory).rows[0].values.category).toBe("Chairs");
    // Titles the browser worked out replace reading title rows (a one-cell row is then a row).
    const trimmed = { name: "T", rows: [[], ["DESCRIPTION", "PRICE (AED)"], ["Luna", ""]], titles: { 1: "CHAIRS" } };
    expect(readRows("catalog", checkSheets([trimmed]), { ...mapping, tabs: undefined }).rows.map((row) => [row.key, row.values.category])).toEqual([["CHAIRS / Luna", "CHAIRS"]]);
  });

  it("tells two rows of one name apart by their size, and keys a stock row without a code by its name, size and colour", () => {
    const mapping = checkMapping("catalog", { columns: { Name: "name", Length: "width", Height: "height" } });
    const { rows } = readRows("catalog", [{ name: "Desks", rows: [["Name", "Length", "Height"], ["Daisy Desk", "170 cm", "75 cm"], ["Daisy Desk", "200 cm", "75 cm"]] }], mapping);
    expect(rows.map((row) => row.key)).toEqual(["Daisy Desk · 170 cm × 75 cm", "Daisy Desk · 200 cm × 75 cm"]);
    const stock = checkMapping("stock", { columns: { "Model code": "code", "Item name": "name", Size: "size", Colour: "colour", Qty: "quantity", Used: "usedQuantity" } });
    const read = readRows("stock", [{ name: "Wood", rows: [["WOOD MATERIALS"], ["Model code", "Item name", "Size", "Colour", "Qty", "Used"],
      ["W-1", "White wood", "2x2", "", "10", "2"], ["", "Drawer channel", "250MM", "Grey", "4", ""], ["", "Hinge", "", "", "", ""]] }], stock).rows;
    expect(read.map((row) => row.key)).toEqual(["W-1", "Drawer channel · 250MM · Grey", "Hinge"]);
  });

  it("keeps cell links that are http(s), within bounds", () => {
    const [sheet] = checkSheets([{ name: "S", rows: [["a"]], links: { "0:0": "https://x.example/a.pdf", "0:1": "javascript:alert(1)", bad: "https://x.example", "1:0": 5 }, hidden: true }]);
    expect(sheet).toEqual({ name: "S", rows: [["a"]], links: { "0:0": "https://x.example/a.pdf" }, hidden: true });
  });

  it("reads numbers the way sheets write them", () => {
    expect(sheetNumber("1,240.5", "Qty")).toBe("1240.5");
    expect(sheetNumber("AED 42", "Cost")).toBe("42");
    expect(sheetNumber("AED23,500.00", "Price")).toBe("23500");
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
