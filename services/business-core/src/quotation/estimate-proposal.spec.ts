import { describe, expect, it } from "vitest";
import { estimateReference, estimateReferences } from "../commercial/case-quote-facts";
import { addedClauses } from "./locked-terms";
import { dimensionSide, sizeFromDimensions } from "./pricing-sheet";

describe("estimate proposal (guide M)", () => {
  it("takes its reference from the quotation number, and each revision adds rev n", () => {
    expect(estimateReference("PLM-QUO-2026-00001", 0)).toBe("PLM-EST-2026-00001");
    expect(estimateReference("PLM-QUO-2026-00001", 2)).toBe("PLM-EST-2026-00001 rev 2");
    expect(estimateReference("Q-1", 1)).toBe("EST-Q-1 rev 1");
    const quotes = [
      { id: "a", number: 1, kind: "quotation", round: "main" }, { id: "b", number: 2, kind: "quotation", round: "main", familyId: "a" },
      { id: "d", number: 3, kind: "quotation", round: "design" }, { id: "v", number: 4, kind: "variation" }, { id: "n", number: 5, kind: "quotation" },
    ];
    expect(estimateReferences(quotes, { a: "S-QUO-7", b: "S-QUO-7", d: "S-QUO-8", v: "S-QUO-9" })).toEqual({ a: "S-EST-7", b: "S-EST-7 rev 1" });
  });

  it("keeps the firm's terms locked: only clauses after them change, and those are what's logged", () => {
    const firm = "1. Payment as scheduled.\n2. Lead time 8–12 weeks.";
    expect(addedClauses(firm, firm, firm)).toBeNull();
    expect(addedClauses("", "anything", "else")).toBeNull();
    expect(addedClauses(firm, "Payment terms follow the contract.", firm)).toBe("");
    expect(addedClauses(firm, firm, `${firm}\n3. Site access from 8 am.`)).toBe("3. Site access from 8 am.");
    expect(() => addedClauses(firm, firm, "1. Payment as scheduled.")).toThrow("locked");
  });
});

describe("pricing request sheet (guide step 12)", () => {
  it("reads L / H / D from named dimensions, measured first, in the first one's unit", () => {
    expect([dimensionSide("Width"), dimensionSide("Overall height"), dimensionSide("Depth"), dimensionSide("Notes")]).toEqual(["length", "height", "width", null]);
    expect(sizeFromDimensions([{ name: "Length", measured: 2.4, approximate: 2.5, unit: "m" }, { name: "Height", measured: 900, unit: "mm" }]))
      .toEqual({ length: "2.4", height: "0.9", width: null, unit: "m", from: "site_measure" });
    expect(sizeFromDimensions([{ name: "Length", measured: 240, unit: "cm" }, { name: "Depth", approximate: 60, unit: "cm" }]))
      .toEqual({ length: null, height: null, width: "60", unit: "cm", from: "estimate" });
    expect(sizeFromDimensions([{ name: "Colour", measured: 1, unit: "m" }])).toBeNull();
  });
});
