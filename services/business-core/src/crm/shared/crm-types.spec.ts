import { describe, expect, it } from "vitest";
import { canonicalHash, decodeCursor, encodeCursor, normalizeEmail, normalizeLoosePhone, normalizeName, stableHash } from "./crm-types";
describe("CRM shared normalization", () => {
  it("normalizes multilingual names without corrupting Unicode", () => {
    expect(normalizeName("  مريم   أحمد  ")).toBe("مريم أحمد");
  });
  it("normalizes exact identifiers deterministically", () => {
    expect(normalizeEmail(" PERSON@Example.COM ")).toBe("person@example.com");
    expect(normalizeLoosePhone("+971 (50) 123-4567")).toBe("+971501234567");
    expect(stableHash({ b: 2, a: 1 })).toHaveLength(64);
    expect(canonicalHash({ b: 2, a: { d: 4, c: 3 } })).toBe(canonicalHash({ a: { c: 3, d: 4 }, b: 2 }));
    expect(canonicalHash({ values: ["a", "b"] })).not.toBe(canonicalHash({ values: ["b", "a"] }));
  });
  it("round trips keyset cursors and rejects malformed values", () => {
    const cursor = { value: "2026-09-05T00:00:00.000Z", id: "11111111-1111-4111-8111-111111111111" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(decodeCursor("not-a-cursor")).toBeNull();
  });
});
