import { describe, expect, it } from "vitest";
import { checkMapping, readRows } from "./linked-import-source";
import { sheetPhone, supplierCodeOf, type PhoneRule } from "./linked-import-suppliers";

const UAE: PhoneRule = { country: "AE", callingCode: "971", lengths: [9, 9] };

describe("supplier lists as a linked import (PLM-111)", () => {
  it("matches rows by the supplier code, or by the name when the list has no codes", () => {
    expect(() => checkMapping("suppliers", { columns: { Phone: "phone" } })).toThrow(/code or name/);
    const byName = checkMapping("suppliers", { columns: { "Company Name": "name", TRN: "taxNumber", Remarks: "attribute" } });
    const { rows } = readRows("suppliers", [{ name: "List", rows: [["Suppliers 2026"], ["Company Name", "TRN", "Remarks"], ["SIOM Marble", "100123456700003", "Slow"]] }], byName);
    expect(rows).toEqual([{ sheet: "List", line: 3, key: "SIOM Marble", values: { name: "SIOM Marble", taxNumber: "100123456700003" }, attributes: { Remarks: "Slow" } }]);
    const byCode = checkMapping("suppliers", { columns: { Code: "code", Name: "name" } });
    expect(readRows("suppliers", [{ name: "List", rows: [["Code", "Name"], ["SUP-1", "Gulf Lighting"]] }], byCode).rows[0].key).toBe("SUP-1");
  });

  it("writes phone numbers in the region's international form, taking the first of several", () => {
    expect(sheetPhone("052 846 6806", UAE)).toEqual({ phone: "+971528466806", problem: null });
    expect(sheetPhone("Ramiz - +971 52 846 6806", UAE)).toEqual({ phone: "+971528466806", problem: null });
    expect(sheetPhone("00971 50 123 4567 / 04 331 2222", UAE)).toEqual({ phone: "+971501234567", problem: null });
    expect(sheetPhone("971528466806", UAE)).toEqual({ phone: "+971528466806", problem: null });
    expect(sheetPhone("", UAE)).toEqual({ phone: null, problem: null });
    expect(sheetPhone("123", UAE).problem).toMatch(/isn't a valid number/);
    // Without a region, only an international number can be read.
    expect(sheetPhone("+44 20 7946 0958", { country: null, callingCode: null, lengths: null }).phone).toBe("+442079460958");
  });

  it("makes a sheet's supplier code a Wodana code", () => {
    expect(supplierCodeOf("sup 001")).toBe("SUP-001");
    expect(supplierCodeOf("V_12")).toBe("V_12");
    expect(supplierCodeOf("—")).toBeNull();
  });
});
