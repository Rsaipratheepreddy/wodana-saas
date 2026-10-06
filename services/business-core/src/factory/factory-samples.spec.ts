import { describe, expect, it } from "vitest";
import { sampleDueProblem, sampleFor, sampleNumber, suggestedDue } from "./factory-samples";

describe("sample requests (PLM-061)", () => {
  it("is needed before a material selection appointment still to come, and never in the past", () => {
    expect(sampleDueProblem("2026-10-09", "2026-10-10", null)).toBe("The sample can't be due in the past.");
    expect(sampleDueProblem("2026-10-15", "2026-10-10", "2026-10-15")).toBe("The sample is needed before the material selection on 2026-10-15.");
    expect(sampleDueProblem("2026-10-14", "2026-10-10", "2026-10-15")).toBeNull();
    // An appointment already past (or today) doesn't hold a new request back.
    expect(sampleDueProblem("2026-10-20", "2026-10-10", "2026-10-08")).toBeNull();
    expect(sampleDueProblem("2026-10-20", "2026-10-10", null)).toBeNull();
  });

  it("suggests the day before the appointment, else a week ahead", () => {
    expect(suggestedDue("2026-10-10", "2026-10-15")).toBe("2026-10-14");
    expect(suggestedDue("2026-10-10", "2026-10-11")).toBe("2026-10-10");
    expect(suggestedDue("2026-10-10", null)).toBe("2026-10-17");
    expect(suggestedDue("2026-10-10", "2026-10-01")).toBe("2026-10-17");
  });

  it("names the sample and what it's for", () => {
    expect(sampleNumber(7)).toBe("SR-0007");
    expect(sampleFor({ projectReference: "PRJ-0004", caseReference: "O-12", clientName: "Maya" })).toBe("PRJ-0004 · Maya");
    expect(sampleFor({ projectReference: null, caseReference: "O-12", clientName: "Maya" })).toBe("O-12 · Maya");
  });
});
