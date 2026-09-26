import { describe, expect, it } from "vitest";
import { guessCompany, readSupplierSheet, supplierRows } from "./import";

describe("reading a supplier list", () => {
  const preferred = [
    ["LOCATION", "Supplier Type", "Company Name", "DIRECTORS APPROVED/NOT APPROVED", "DISCOUNT / COMMISSION", "PAYMENT TERMS", "Contact Person / Number", "Email", "Description", "Total Spends Feb-July 2026", "REMARKS"],
    ["PLM HOME FURNITURE MANUFACTURING LLC - SUPPLIER LIST", "", "", "", "", "", "", "", "", "", ""],
    ["MARBLE TRAVERTINE", "", "", "", "", "", "", "", "", "", ""],
    ["SHARJAH", "Marble", "SIOM MARBLE & GRANITE TR. LLC", "APPROVED MARBLE SUPPLIER ", "Discount as Requested / Approval", "Payment Upfront", "Ramiz - +971 52 846 6806", "Ramiz@siommarble.com", "Marble / Travertine", "91249.42", ""],
  ];

  it("finds the columns by their names and splits a contact from its number", () => {
    const sheet = readSupplierSheet("PLM Manu Prefered Suppliers", preferred);
    expect(sheet).toMatchObject({ header: 0, likely: true, columns: { locality: 0, categories: 1, name: 2, approval: 3, deal: 4, terms: 5, contactName: 6, email: 7, notes: 8 } });
    expect(supplierRows(sheet, "e1")).toEqual([{ key: "PLM Manu Prefered Suppliers:4", name: "SIOM MARBLE & GRANITE TR. LLC", categories: "Marble", approval: "APPROVED MARBLE SUPPLIER",
      deal: "Discount as Requested / Approval", terms: "Payment Upfront", contactName: "Ramiz", phone: "+971 52 846 6806", email: "Ramiz@siommarble.com", locality: "SHARJAH",
      notes: "Marble / Travertine", entityId: "e1" }]);
  });

  it("leaves out sheets that only list names and amounts", () => {
    expect(readSupplierSheet("bank", [["Date", "Supplier", "Amount"], ["2026-07-26", "To Nile Marble", "-2028.6"]]).likely).toBe(false);
    expect(readSupplierSheet("Notes", [["Nothing here"]]).header).toBe(-1);
  });

  it("matches a sheet to the company it's for", () => {
    const companies = [{ id: "m", code: "PLMM", name: "PLM Home Furniture Manufacturing LLC" }, { id: "i", code: "PLMI", name: "PLM Interiors Trading LLC" }];
    expect(guessCompany("PLM Interiors", companies)).toBe("i");
    expect(guessCompany("PLM Manufacturing", companies)).toBe("m");
    expect(guessCompany("Sheet1", companies)).toBeNull();
  });
});
