import { describe, expect, it } from "vitest";
import { currencyDecimals, orderTotals, priceLine } from "./orders";

describe("purchase order amounts", () => {
  it("prices a line exactly: discount on the gross, tax on the net, rounded to the currency", () => {
    expect(priceLine({ quantity: "4.5", unitPrice: "1200", discountPercent: "10", taxRate: "5" }, 2))
      .toEqual({ gross: "5400.00", discount: "540.00", net: "4860.00", tax: "243.00", total: "5103.00" });
    // 3 × 33.335 = 100.005 → 100.01 (half away from zero); 7.5% discount → 92.504625 → 92.50; 5% tax → 4.625 → 4.63
    expect(priceLine({ quantity: "3", unitPrice: "33.335", discountPercent: "7.5", taxRate: "5" }, 2))
      .toEqual({ gross: "100.01", discount: "7.51", net: "92.50", tax: "4.63", total: "97.13" });
    expect(priceLine({ quantity: "2", unitPrice: "1.2345", discountPercent: "0", taxRate: "0" }, 3)).toMatchObject({ net: "2.469", total: "2.469" });
  });

  it("adds lines from their own rounded amounts, so the order always equals the sum of its lines", () => {
    const lines = [priceLine({ quantity: "1", unitPrice: "0.335", discountPercent: "0", taxRate: "5" }, 2), priceLine({ quantity: "1", unitPrice: "0.335", discountPercent: "0", taxRate: "5" }, 2)];
    expect(orderTotals(lines, 2)).toEqual({ subtotal: "0.68", discountTotal: "0.00", net: "0.68", taxTotal: "0.04", total: "0.72" });
  });

  it("knows each currency's minor units", () => {
    expect([currencyDecimals("AED"), currencyDecimals("JPY"), currencyDecimals("KWD"), currencyDecimals("INR")]).toEqual([2, 0, 3, 2]);
  });
});

describe("pack rounding", () => {
  it("orders at least the minimum, in whole packs", async () => {
    const { packQuantity } = await import("./orders");
    expect(packQuantity("10", "4", null)).toBe("12");
    expect(packQuantity("12", "4", null)).toBe("12");
    expect(packQuantity("3", "4", "10")).toBe("12");
    expect(packQuantity("2.5", "0.5", null)).toBe("2.5");
    expect(packQuantity("7", null, "5")).toBe("7");
    expect(packQuantity("7", null, null)).toBe("7");
  });
});
