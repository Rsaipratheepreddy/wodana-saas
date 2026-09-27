import { describe, expect, it } from "vitest";
import { labourCost, rateOn, tradeKey, tradeName } from "./labour-rates";

const rates = [
  { key: "carpenters", from: "2026-01-01", rate: "180" },
  { key: "carpenters", from: "2026-10-01", rate: "200" },
  { key: "painters", from: "2026-09-15", rate: "150" },
];

describe("labour rates", () => {
  it("matches a trade however it was typed", () => {
    expect(tradeKey("  Tile   Fixers ")).toBe("tile fixers");
    expect(tradeKey("CARPENTERS")).toBe(tradeKey("carpenters"));
    expect(tradeName("  Tile   Fixers ")).toBe("Tile Fixers");
  });

  it("uses the rate in force on the day: set from that day or the latest before it", () => {
    expect(rateOn(rates, "carpenters", "2026-09-30")?.rate).toBe("180");
    expect(rateOn(rates, "carpenters", "2026-10-01")?.rate).toBe("200");
    expect(rateOn(rates, "carpenters", "2027-03-01")?.rate).toBe("200");
    // Nothing before the first rate, and nothing for a trade without one: those days aren't costed.
    expect(rateOn(rates, "carpenters", "2025-12-31")).toBeNull();
    expect(rateOn(rates, "painters", "2026-09-14")).toBeNull();
    expect(rateOn(rates, "electricians", "2026-10-01")).toBeNull();
  });

  it("finds the rate whatever order the history comes in", () => {
    expect(rateOn([...rates].reverse(), "carpenters", "2026-11-01")?.from).toBe("2026-10-01");
  });

  it("costs people or hours exactly, to the currency's minor units, half away from zero", () => {
    expect(labourCost(4, "187.505", "AED").toFixed(2)).toBe("750.02");
    expect(labourCost(1, "0.125", "AED").toFixed(2)).toBe("0.13");
    expect(labourCost("7.5", "45.333", "AED").toFixed(2)).toBe("340.00");
    expect(labourCost("7.5", "45.333", "KWD").toFixed(3)).toBe("339.998");
    expect(labourCost("7.5", "1333", "JPY").toFixed(0)).toBe("9998");
    // Never a float: 0.1 + 0.2 kinds of error don't creep in.
    expect(labourCost(3, "0.1", "AED").toFixed(4)).toBe("0.3000");
  });
});
