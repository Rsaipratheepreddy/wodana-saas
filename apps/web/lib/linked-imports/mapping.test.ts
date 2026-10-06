import { describe, expect, it } from "vitest";
import { hasKey, headingRow, headingsOf, mappedColumns, suggestMapping } from "./mapping";

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
    expect(sheets).toEqual([{ name: "Stock", rows: [[], ["Item Code", "Qty"], ["MAT-001", "120"]] }, { name: "Notes", rows: [] }]);
  });

  it("guesses a supplier list's columns and matches it by the name when it has no codes", () => {
    const headings = ["Company Name", "Contact Person", "Contact Number", "Email ID", "TRN No", "Payment Terms", "Supplier Type", "Directors Approved"];
    const mapping = suggestMapping("suppliers", headings);
    expect(mapping.columns).toEqual({ "Company Name": "name", "Contact Person": "contactName", "Contact Number": "phone", "Email ID": "email", "TRN No": "taxNumber",
      "Payment Terms": "paymentTerms", "Supplier Type": "categories" });
    expect(hasKey(mapping, "suppliers")).toBe(true);
    expect(hasKey(mapping)).toBe(false);
    const sheets = mappedColumns([{ name: "List", rows: [["Suppliers"], headings, ["SIOM Marble", "Ramiz", "052 846 6806", "", "", "", "Marble", "Yes"]] }], mapping, "suppliers");
    expect(sheets[0].rows[1]).toEqual(["Company Name", "Contact Person", "Contact Number", "Email ID", "TRN No", "Payment Terms", "Supplier Type"]);
  });
});
