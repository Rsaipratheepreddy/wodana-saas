import { describe, expect, it } from "vitest";
import { Dec } from "./decimal";
import { evaluateFormula, formulaInputs, parseFormula } from "./formula";
import { convert, STANDARD_UNITS } from "./units";

describe("units", () => {
  it("converts within a kind exactly", () => {
    expect(convert("1", "sqm", "sqft").toFixed(4)).toBe("10.7639");
    expect(convert("600", "mm", "m").toString()).toBe("0.6");
    expect(convert("10", "ft", "mm").toString()).toBe("3048");
  });
  it("bridges kinds through item conversions (sheets, boxes)", () => {
    const sheet = [{ from: "sheet", to: "sqft", factor: "32" }];
    expect(convert("64", "sqft", "sheet", undefined, sheet).toString()).toBe("2");
    expect(convert("2", "sheet", "sqft", undefined, sheet).toString()).toBe("64");
    expect(convert("5.9458", "sqm", "sheet", [...STANDARD_UNITS, { code: "sheet", kind: "count", toBase: "1", label: "sheet" }], sheet).toFixed(2)).toBe("2.00");
  });
  it("refuses meaningless conversions", () => {
    expect(() => convert("1", "kg", "m")).toThrow(/Cannot convert/);
  });
});

describe("formulas", () => {
  it("evaluates hinges, areas and waste exactly", () => {
    expect(evaluateFormula(parseFormula("ceil(height / 450) * 2"), { height: 2100 }).toString()).toBe("10");
    expect(evaluateFormula(parseFormula("width * height / 1000000 * 1.05"), { width: "2400", height: "2700" }).toString()).toBe("6.804");
    expect(evaluateFormula(parseFormula("max(perimeter - openings, 0)"), { perimeter: 20, openings: 3.5 }).toString()).toBe("16.5");
    expect(evaluateFormula(parseFormula("-(2 + 3) * 2"), {}).toString()).toBe("-10");
  });
  it("lists its inputs for the quote line", () => {
    expect(formulaInputs(parseFormula("ceil(height / 450) * 2 + width * height"))).toEqual(["height", "width"]);
  });
  it("gives a positioned error instead of running code", () => {
    expect(() => parseFormula("height * ")).toThrow(/ends too early/);
    expect(() => parseFormula("process.exit()")).toThrow(/Unexpected "\."/);
    expect(() => parseFormula("eval(1)")).toThrow(/Unknown function eval/);
    expect(() => evaluateFormula(parseFormula("area * 2"), {})).toThrow(/area has no value/);
    expect(() => evaluateFormula(parseFormula("1 / (a - a)"), { a: 3 })).toThrow(/Division by zero/);
  });
  it("keeps decimals exact", () => {
    expect(evaluateFormula(parseFormula("a + b"), { a: Dec.of("0.1"), b: "0.2" }).toString()).toBe("0.3");
  });
});
