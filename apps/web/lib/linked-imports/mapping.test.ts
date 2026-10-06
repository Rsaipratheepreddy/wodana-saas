import { describe, expect, it } from "vitest";
import { chosenTabs, hasKey, headingRow, headingsOf, keyField, mappedColumns, suggestMapping } from "./mapping";

const stockList = [["Materials stock list"], ["Item Code", "Item", "Unit", "Qty", "Location", "Cost", "Notes"], ["MAT-001", "Oak veneer", "sqm", "120", "", "18.5", "Reorder"]];

describe("linked import mapping", () => {
  it("finds the heading row under a title row and samples each column", () => {
    expect(headingRow(stockList)).toBe(1);
    expect(headingsOf([{ name: "Empty", rows: [] }, { name: "Stock", rows: stockList }]).slice(0, 2)).toEqual([{ heading: "Item Code", sample: "MAT-001" }, { heading: "Item", sample: "Oak veneer" }]);
  });

  it("guesses a stock list's and a product list's columns, each field once", () => {
    expect(suggestMapping("stock", stockList[1]).columns).toEqual({ "Item Code": "code", Item: "name", Unit: "unit", Qty: "quantity", Location: "location", Cost: "cost" });
    expect(suggestMapping("catalog", ["Code", "Name", "Category", "Cost price", "Selling Price", "Production time", "Fabric"]).columns)
      .toEqual({ Code: "code", Name: "name", Category: "category", "Cost price": "cost", "Selling Price": "price", "Production time": "productionDays" });
  });

  it("sends only the mapped columns of an uploaded file, keeping its row numbers", () => {
    const sheets = mappedColumns([{ name: "Stock", rows: stockList }, { name: "Notes", rows: [["Read me"]] }], { columns: { "Item Code": "code", Qty: "quantity" } });
    expect(sheets).toEqual([{ name: "Stock", rows: [[], ["Item Code", "Qty"], ["MAT-001", "120"]], titles: { 1: "Materials stock list" } }, { name: "Notes", rows: [] }]);
  });

  it("guesses a supplier list's columns and matches it by the name when it has no codes", () => {
    const headings = ["Company Name", "Contact Person", "Contact Number", "Email ID", "TRN No", "Payment Terms", "Supplier Type", "Directors Approved"];
    const mapping = suggestMapping("suppliers", headings);
    expect(mapping.columns).toEqual({ "Company Name": "name", "Contact Person": "contactName", "Contact Number": "phone", "Email ID": "email", "TRN No": "taxNumber",
      "Payment Terms": "paymentTerms", "Supplier Type": "categories", "Directors Approved": "approval" });
    expect(hasKey(mapping)).toBe(true);
    expect(hasKey({ columns: { Qty: "quantity" } })).toBe(false);
    const sheets = mappedColumns([{ name: "List", rows: [["Suppliers"], headings, ["SIOM Marble", "Ramiz", "052 846 6806", "", "", "", "Marble", "Yes"]] }], mapping);
    expect(sheets[0].rows[1]).toEqual(headings);
  });

  it("suggests a collection sheet's drawing, size and price columns, never the pictures", () => {
    const headings = ["REMARKS", "ITEM", "DESCRIPTION", "IMAGE", "RENDER", "HEIGHT (CM)", "LENGTH (CM)", "DEPTH (CM)", "PRICE (AED)", "Technical Drawing Current", "Materials Needed"];
    const { columns } = suggestMapping("catalog", headings);
    expect(columns).toMatchObject({ "HEIGHT (CM)": "height", "LENGTH (CM)": "width", "DEPTH (CM)": "depth", "PRICE (AED)": "price", "Technical Drawing Current": "technicalDrawing" });
    expect(columns.RENDER).toBeUndefined();
    expect(columns.IMAGE).toBeUndefined();
    // A materials list: the model code, what was used, the size and colour.
    expect(suggestMapping("stock", ["SERIAL NO.", "MORAL CODE", "MODEL CODE", "DIMENSIONS & SIZE", "COLOR", "ITEM NAME", "QTY.", "USED QTY."]).columns)
      .toMatchObject({ "MODEL CODE": "code", "DIMENSIONS & SIZE": "size", COLOR: "colour", "ITEM NAME": "name", "QTY.": "quantity", "USED QTY.": "usedQuantity" });
    expect(suggestMapping("suppliers", ["Company Name", "Contact Person / Number"]).columns).toEqual({ "Company Name": "name", "Contact Person / Number": "contact" });
  });

  it("matches a catalog without codes by the name, and offers every tab's headings", () => {
    expect(hasKey({ columns: { DESCRIPTION: "name" } })).toBe(true);
    expect(keyField("catalog", { columns: { DESCRIPTION: "name" } })).toBe("name");
    const sheets = [{ name: "Sofa", rows: [["SOFA"], ["DESCRIPTION", "Technical Drawing"], ["Aria", "Aria drawing"]] },
      { name: "Desk", rows: [["DESCRIPTION", "TECHNICAL DRAWING", "Drawings links"], ["Daisy", "", "Daisy drawing"]] }];
    expect(headingsOf(sheets).map((entry) => entry.heading)).toEqual(["DESCRIPTION", "Technical Drawing", "Drawings links"]);
    expect(chosenTabs(sheets, { columns: {}, tabs: ["Desk"] }).map((sheet) => sheet.name)).toEqual(["Desk"]);
  });

  it("sends each block of a tab: titles alongside, repeated headings kept, notes above left out, links moved with their columns", () => {
    const mapping = { columns: { DESCRIPTION: "name", "PRICE (AED)": "price", "Technical Drawing": "technicalDrawing" }, tabs: ["Living"] };
    const living = { name: "Living", rows: [
      ["", "", "", "Ask the workshop", ""],
      ["", "SOFA", "", "", ""],
      ["REMARKS", "DESCRIPTION", "IMAGE", "PRICE (AED)", "Technical Drawing"],
      ["", "Aria Sofa", "", "AED23,500.00", "Aria drawing"],
      ["Check fabric", "", "", "", ""],
      [],
      ["", "ARMCHAIRS"],
      ["REMARKS", "DESCRIPTION", "IMAGE", "PRICE (AED)", "Technical Drawing"],
      ["", "Luna", "", "ENQUIRE", ""],
    ], links: { "3:4": "https://drive.example/aria.pdf", "0:3": "https://drive.example/note" } };
    const [sent, ...rest] = mappedColumns([living, { name: "Other", rows: [["DESCRIPTION"], ["x"]] }], mapping);
    expect(rest).toEqual([]);
    expect(sent).toEqual({ name: "Living", titles: { 2: "SOFA", 7: "ARMCHAIRS" }, links: { "3:2": "https://drive.example/aria.pdf" }, rows: [
      [], [], ["DESCRIPTION", "PRICE (AED)", "Technical Drawing"], ["Aria Sofa", "AED23,500.00", "Aria drawing"], [], [], [],
      ["DESCRIPTION", "PRICE (AED)", "Technical Drawing"], ["Luna", "ENQUIRE", ""],
    ] });
  });
});
