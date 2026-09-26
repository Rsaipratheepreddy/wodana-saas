import { describe, expect, it } from "vitest";
import { currencyDecimals, orderTotals, priceLine } from "./amounts";

// The same cases as the server's purchase order amounts, so the browser shows what the server saves.
describe("order amounts in the browser", () => {
  it("prices lines exactly like the server", () => {
    expect(priceLine({ quantity: "4.5", unitPrice: "1200", discountPercent: "10", taxRate: "5" }, 2)).toMatchObject({ net: "4860.00", tax: "243.00", total: "5103.00" });
    expect(priceLine({ quantity: "3", unitPrice: "33.335", discountPercent: "7.5", taxRate: "5" }, 2)).toMatchObject({ net: "92.50", tax: "4.63", total: "97.13" });
    expect(priceLine({ quantity: "2", unitPrice: "1.2345", discountPercent: "", taxRate: "" }, 3)).toMatchObject({ net: "2.469", total: "2.469" });
    expect(priceLine({ quantity: "10", unitPrice: "350", discountPercent: "10", taxRate: "5" }, 2)).toMatchObject({ net: "3150.00", tax: "157.50", total: "3307.50" });
    expect(priceLine({ quantity: "2.", unitPrice: "5", discountPercent: "0", taxRate: "0" }, 2)).toBeNull();
  });

  it("adds the lines' rounded amounts", () => {
    const line = priceLine({ quantity: "1", unitPrice: "0.335", discountPercent: "0", taxRate: "5" }, 2);
    expect(orderTotals([line, line], 2)).toEqual({ net: "0.68", tax: "0.04", total: "0.72" });
    expect(currencyDecimals("KWD")).toBe(3);
  });
});
