import { describe, expect, it } from "vitest";
import { splitMilestone } from "./receivables";

describe("a milestone split by the quotation's tax rates", () => {
  it("carves tax out of what the client pays at one rate", () => {
    // Quote: 7,475.00 + 5% = 7,848.75; the advance is 3,924.38 of it.
    expect(splitMilestone("3924.38", { total: "7848.75", taxes: [{ rate: "5", base: "7475.00", tax: "373.75" }] }, "AED"))
      .toEqual([{ rate: "5", net: "3737.5000", tax: "186.8800", total: "3924.3800" }]);
  });

  it("splits by each rate's share of the total, the largest share taking the rounding", () => {
    // 1,000 at 5% (1,050 with tax) and 500 not taxed: half the quote is 775.
    expect(splitMilestone("775", { total: "1550", taxes: [{ rate: "5", base: "1000", tax: "50" }] }, "AED")).toEqual([
      { rate: "5", net: "500.0000", tax: "25.0000", total: "525.0000" },
      { rate: "0", net: "250.0000", tax: "0.0000", total: "250.0000" }]);
    // Thirds: the parts still add up to the milestone exactly.
    const parts = splitMilestone("100", { total: "300", taxes: [{ rate: "5", base: "95.24", tax: "4.76" }, { rate: "15", base: "86.96", tax: "13.04" }] }, "AED");
    expect(parts.reduce((sum, part) => sum + Math.round(Number(part.total) * 100), 0)).toBe(10000);
    for (const part of parts) expect(Math.round((Number(part.net) + Number(part.tax)) * 100)).toBe(Math.round(Number(part.total) * 100));
  });

  it("is all net when the quotation has no tax, and follows the currency's minor units", () => {
    expect(splitMilestone("3925", { total: "7850", taxes: [] }, "AED")).toEqual([{ rate: "0", net: "3925.0000", tax: "0.0000", total: "3925.0000" }]);
    expect(splitMilestone("1050", { total: "2100", taxes: [{ rate: "5", base: "2000", tax: "100" }] }, "JPY")).toEqual([{ rate: "5", net: "1000.0000", tax: "50.0000", total: "1050.0000" }]);
    expect(splitMilestone("10.5", { total: "21", taxes: [{ rate: "5", base: "20", tax: "1" }] }, "KWD")).toEqual([{ rate: "5", net: "10.0000", tax: "0.5000", total: "10.5000" }]);
  });
});
