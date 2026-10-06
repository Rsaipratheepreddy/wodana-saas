import { describe, expect, it } from "vitest";
import { checkMapping, readRows } from "./linked-import-source";
import { suggestMapping } from "./import-mapping";
import { sheetApproval, sheetPhone, splitContact, supplierCodeOf, type PhoneRule } from "./linked-import-suppliers";

const UAE: PhoneRule = { country: "AE", callingCode: "971", lengths: [9, 9] };

describe("supplier lists as a linked import (PLM-111)", () => {
  it("matches rows by the supplier code, or by the name when the list has no codes", () => {
    expect(() => checkMapping("suppliers", { columns: { Phone: "phone" } })).toThrow(/code or name/);
    const byName = checkMapping("suppliers", { columns: { "Company Name": "name", TRN: "taxNumber", Remarks: "attribute" } });
    const { rows } = readRows("suppliers", [{ name: "List", rows: [["Suppliers 2026"], ["Company Name", "TRN", "Remarks"], ["SIOM Marble", "100123456700003", "Slow"]] }], byName);
    expect(rows).toEqual([{ sheet: "List", line: 3, key: "SIOM Marble", values: { name: "SIOM Marble", taxNumber: "100123456700003" }, attributes: { Remarks: "Slow" },
      headings: { name: "Company Name", taxNumber: "TRN" } }]);
    const byCode = checkMapping("suppliers", { columns: { Code: "code", Name: "name" } });
    expect(readRows("suppliers", [{ name: "List", rows: [["Code", "Name"], ["SUP-1", "Gulf Lighting"]] }], byCode).rows[0].key).toBe("SUP-1");
  });

  it("writes phone numbers in the region's international form, taking the first of several", () => {
    expect(sheetPhone("052 846 6806", UAE)).toEqual({ phone: "+971528466806", problem: null });
    expect(sheetPhone("Ramiz - +971 52 846 6806", UAE)).toEqual({ phone: "+971528466806", problem: null });
    expect(sheetPhone("00971 50 123 4567 / 04 331 2222", UAE)).toEqual({ phone: "+971501234567", problem: null });
    expect(sheetPhone("971528466806", UAE)).toEqual({ phone: "+971528466806", problem: null });
    expect(sheetPhone("", UAE)).toEqual({ phone: null, problem: null });
    // Two numbers, or a number and a name, in one cell without a separator: the first number that's valid.
    expect(sheetPhone("050 123 4567 +971 4 331 2222", UAE)).toEqual({ phone: "+971501234567", problem: null });
    expect(sheetPhone("0501234567-Office 043312222", UAE)).toEqual({ phone: "+971501234567", problem: null });
    expect(sheetPhone("123", UAE).problem).toMatch(/isn't a valid number/);
    // Without a region, only an international number can be read.
    expect(sheetPhone("+44 20 7946 0958", { country: null, callingCode: null, lengths: null }).phone).toBe("+442079460958");
  });

  it("skips a company's section row and supplier-type sub-headings, and a tab without the list's columns", () => {
    const mapping = checkMapping("suppliers", { columns: { "Company Name": "name", "Supplier Type": "categories", Email: "email", Supplier: "attribute" },
      entities: { List: "4f0c3f1e-8a1b-4c1d-9e2f-0a1b2c3d4e5f" }, fillOnly: true });
    expect(mapping).toMatchObject({ entities: { List: "4f0c3f1e-8a1b-4c1d-9e2f-0a1b2c3d4e5f" }, fillOnly: true });
    const sheets = [
      { name: "List", rows: [["Supplier Type", "Company Name", "Email"], ["Studio Furniture LLC – suppliers", "", ""], ["MARBLE", "", ""], ["Marble", "Stone Co", "a@stone.example"]] },
      // A spend summary: the name column alone isn't the list's heading row.
      { name: "Spend", rows: [["Company Name", "Jan", "Feb"], ["Stone Co", "10", "20"]] },
    ];
    const { rows, skippedTabs } = readRows("suppliers", sheets, mapping);
    expect(rows.map((row) => [row.line, row.key, row.values.categories])).toEqual([[4, "Stone Co", "Marble"]]);
    expect(skippedTabs).toEqual(["Spend"]);
    expect(() => checkMapping("suppliers", { columns: { Name: "name" }, entities: { List: "acme" } })).toThrow(/companies/);
  });

  it("reads a contact cell holding the name and the number", () => {
    expect(splitContact("Ramiz - +971 52 846 6806")).toEqual({ name: "Ramiz", phone: "+971 52 846 6806" });
    expect(splitContact("Mohamad - 971553001445")).toEqual({ name: "Mohamad", phone: "971553001445" });
    expect(splitContact("Antony")).toEqual({ name: "Antony", phone: "" });
    expect(splitContact("050 6579563")).toEqual({ name: "", phone: "050 6579563" });
  });

  it("makes a sheet's supplier code a Wodana code", () => {
    expect(supplierCodeOf("sup 001")).toBe("SUP-001");
    expect(supplierCodeOf("V_12")).toBe("V_12");
    expect(supplierCodeOf("—")).toBeNull();
  });

  it("reads a directors' approval column as the supplier's approval; N/A or blank decides nothing (L6)", () => {
    expect(sheetApproval("APPROVED MARBLE SUPPLIER")).toEqual({ approval: "approved", preferred: false });
    expect(sheetApproval("NOMINATED PAINT SUPPLIER")).toEqual({ approval: "approved", preferred: true });
    expect(sheetApproval("Preferred joinery")).toEqual({ approval: "approved", preferred: true });
    expect(sheetApproval("NOT APPROVED")).toEqual({ approval: "not_approved", preferred: false });
    expect(sheetApproval("not-approved (quality)")).toEqual({ approval: "not_approved", preferred: false });
    for (const undecided of ["N/A", "", "  ", "TBC", "Pending review"]) expect(sheetApproval(undecided)).toBeNull();
    for (const heading of ["DIRECTORS APPROVED/NOT APPROVED", "DIRECTORS APPROVED", "Approval status", "Approved?"])
      expect(suggestMapping("suppliers", ["Company Name", heading]).columns).toEqual({ "Company Name": "name", [heading]: "approval" });
  });
});
