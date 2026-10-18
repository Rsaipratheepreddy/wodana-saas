import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import { stillTypingYear } from "./day-input";

describe("a date still being typed", () => {
  it("is one whose year has fewer than four digits so far", () => {
    expect(stillTypingYear(parseDate("0002-11-10"))).toBe(true);
    expect(stillTypingYear(parseDate("0202-11-10"))).toBe(true);
    expect(stillTypingYear(parseDate("2026-11-10"))).toBe(false);
    expect(stillTypingYear(null)).toBe(false);
  });
});
