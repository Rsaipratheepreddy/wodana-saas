import { describe, expect, it } from "vitest";
import { normalizePersonName, personNameProblem } from "./person-name.js";

export const ACCEPTED_NAMES = [
  "Priya Sharma", "Mohammed Al-Suwaidi", "Anil D'Souza", "Anil D’Souza", "John Smith Jr.", "A. K. Sharma", "A.K. Sharma",
  "José Álvarez", "Zoë Brontë", "François", "محمد عبد الله", "عائشة", "राम कुमार", "Ng", "O'Neil-Smith",
];
export const REFUSED_NAMES = [
  "Priya2", "R2D2", "Ahmed@home", "Ali_Khan", "Ali/Khan", "Sam & Co", "-Ali", "Ali-", "Ali--Khan", "'Ali", ".Ali", "Ali..", "١٢٣", "+971501234567", "Hi!",
];

describe("person names", () => {
  it("accepts letters of any script with the punctuation real names need", () => {
    for (const name of ACCEPTED_NAMES) expect(personNameProblem(name), name).toBeNull();
  });
  it("refuses digits and other symbols", () => {
    for (const name of REFUSED_NAMES) expect(personNameProblem(name), name).toBe("characters");
  });
  it("trims and asks for a name when there is none", () => {
    expect(normalizePersonName("  Priya   Sharma ")).toBe("Priya Sharma");
    expect(personNameProblem("  Priya Sharma  ")).toBeNull();
    expect(personNameProblem("   ")).toBe("required");
    expect(personNameProblem(undefined)).toBe("required");
  });
});
