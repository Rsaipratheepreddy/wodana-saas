import { describe, expect, it } from "vitest";
import * as shared from "../../../../packages/contracts/src/person-name";
import * as local from "./person-name";

const samples = [
  "Priya Sharma", "Mohammed Al-Suwaidi", "Anil D'Souza", "John Smith Jr.", "A. K. Sharma", "José Álvarez", "محمد عبد الله", "राम कुमार",
  "Priya2", "Ahmed@home", "Ali_Khan", "-Ali", "Ali--Khan", "١٢٣", "+971501234567", "  Priya   Sharma ", "", "Hi!",
];

describe("person name rule (parity with packages/contracts)", () => {
  it("uses the same pattern as the web", () => {
    expect(local.PERSON_NAME_PATTERN.source).toBe(shared.PERSON_NAME_PATTERN.source);
    expect(local.PERSON_NAME_PATTERN.flags).toBe(shared.PERSON_NAME_PATTERN.flags);
  });
  it("gives the same answer for every sample", () => {
    for (const name of samples) {
      expect(local.personNameProblem(name), name).toBe(shared.personNameProblem(name));
      expect(local.normalizePersonName(name), name).toBe(shared.normalizePersonName(name));
    }
  });
  it("accepts real UAE and India names and refuses digits and symbols", () => {
    expect(local.personNameProblem("Mohammed Al-Suwaidi")).toBeNull();
    expect(local.personNameProblem("Anil D'Souza")).toBeNull();
    expect(local.personNameProblem("Priya2")).toBe("characters");
    expect(local.personNameProblem("  ")).toBe("required");
  });
});
