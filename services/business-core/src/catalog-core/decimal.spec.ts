import { describe, expect, it } from "vitest";
import { Dec } from "./decimal";

describe("Dec", () => {
  it("adds and multiplies exactly where floats drift", () => {
    expect(Dec.of("0.1").add("0.2").toString()).toBe("0.3");
    expect(Dec.of("1.1").mul("1.1").toString()).toBe("1.21");
    expect(Dec.of("10").div("3").toFixed(2)).toBe("3.33");
  });
  it("rounds half away from zero and supports 3-decimal currencies", () => {
    expect(Dec.of("2.345").toFixed(2)).toBe("2.35");
    expect(Dec.of("-2.345").toFixed(2)).toBe("-2.35");
    expect(Dec.of("1.23456").toFixed(3)).toBe("1.235");
  });
  it("ceil and floor to places", () => {
    expect(Dec.of("2.01").ceil().toString()).toBe("3");
    expect(Dec.of("-2.01").floor().toString()).toBe("-3");
    expect(Dec.of("2.001").ceil(2).toString()).toBe("2.01");
  });
  it("rejects bad input", () => {
    expect(() => Dec.of("1e5")).toThrow();
    expect(() => Dec.of("1").div(0)).toThrow(/zero/);
  });
});
