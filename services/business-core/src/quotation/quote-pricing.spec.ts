import { describe, expect, it } from "vitest";
import { priceQuote, PricingError, type PricedLineInput } from "./quote-pricing";

const policy = { currencyDecimals: 2, pricesIncludeTax: false, rounding: "line" as const };
const line = (id: string, quantity: string, rate: string, extra: Partial<PricedLineInput> = {}): PricedLineInput => ({ id, quantity, rate, areaKey: "kitchen", tradeKey: "joinery", ...extra });

describe("quote pricing", () => {
  it("adds lines, discounts in order, then tax", () => {
    const result = priceQuote([
      line("a", "2", "100", { discountKind: "percent", discountValue: "10", taxRate: "5", unitCost: "60" }),
      line("b", "1", "300", { areaKey: "living", taxRate: "5", unitCost: "200" }),
    ], [{ scope: "area", target: "living", kind: "amount", value: "30" }, { scope: "quote", target: "", kind: "percent", value: "10" }], policy);
    // a: 200 − 20 = 180; b: 300 − 30 = 270; quote 10 % of 450 = 45 → 405 net; tax 5 % = 20.25
    expect(result.subtotal).toBe("500.00");
    expect(result.discounts).toEqual({ line: "20.00", section: "30.00", quote: "45.00", total: "95.00" });
    expect(result.net).toBe("405.00");
    expect(result.tax).toBe("20.25");
    expect(result.total).toBe("425.25");
    expect(result.cost).toBe("320.00");
    expect(result.margin).toBe("20.99");
    expect(result.areas.find((area) => area.key === "living")).toEqual({ key: "living", gross: "300.00", discount: "30.00", net: "270.00" });
  });

  it("prices a removal as an exact credit that takes no discount and carries its tax", () => {
    const result = priceQuote([
      line("add", "1", "900", { taxRate: "5", unitCost: "600" }),
      line("remove", "1", "800", { taxRate: "5", unitCost: "500", credit: true }),
    ], [{ scope: "quote", target: "", kind: "percent", value: "10" }], policy);
    // The 10 % discount applies only to what's charged (900 → 810); the credit returns exactly 800.
    expect(result.lines.map((item) => [item.id, item.net, item.tax, item.total])).toEqual([["add", "810.00", "40.50", "850.50"], ["remove", "-800.00", "-40.00", "-840.00"]]);
    expect(result.subtotal).toBe("100.00");
    expect(result.net).toBe("10.00");
    expect(result.total).toBe("10.50");
    expect(result.cost).toBe("100.00");
    expect(() => priceQuote([line("remove", "1", "800", { credit: true, discountKind: "percent", discountValue: "5" })], [], policy)).toThrow(PricingError);
  });

  it("carves tax out of inclusive prices", () => {
    const result = priceQuote([line("a", "1", "105", { taxRate: "5" })], [], { ...policy, pricesIncludeTax: true });
    expect(result).toMatchObject({ net: "100.00", tax: "5.00", total: "105.00" });
  });

  it("rounds once per document when asked", () => {
    const lines = [line("a", "1", "0.333", { taxRate: "5" }), line("b", "1", "0.333", { taxRate: "5" }), line("c", "1", "0.333", { taxRate: "5" })];
    expect(priceQuote(lines, [], policy).subtotal).toBe("0.99");
    expect(priceQuote(lines, [], { ...policy, rounding: "document" }).subtotal).toBe("1.00");
  });

  it("keeps optional lines out of the total and shares an amount discount exactly", () => {
    const result = priceQuote([line("a", "1", "100"), line("b", "1", "200"), line("c", "1", "999", { optional: true })],
      [{ scope: "quote", target: "", kind: "amount", value: "100" }], policy);
    expect(result.total).toBe("200.00");
    expect(result.optionalTotal).toBe("999.00");
    expect(result.lines.map((item) => item.quoteDiscount)).toEqual(["33.33", "66.67", "0.00"]);
  });

  it("handles three-decimal currencies and missing costs", () => {
    const result = priceQuote([line("a", "3", "1.2345"), line("b", "1", "1", { unitCost: "0.5" })], [], { ...policy, currencyDecimals: 3 });
    expect(result.subtotal).toBe("4.704");
    expect(result.cost).toBeNull();
    expect(result.margin).toBeNull();
  });

  it("refuses discounts bigger than what they apply to", () => {
    expect(() => priceQuote([line("a", "1", "10", { discountKind: "amount", discountValue: "11" })], [], policy)).toThrow(PricingError);
    expect(() => priceQuote([line("a", "1", "10")], [{ scope: "quote", target: "", kind: "amount", value: "11" }], policy)).toThrow(PricingError);
  });
});
