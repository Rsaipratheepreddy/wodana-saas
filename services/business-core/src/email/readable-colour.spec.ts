import { describe, expect, it } from "vitest";
import { contrastWithWhite, readableOnWhite } from "./readable-colour";

describe("readableOnWhite", () => {
  it("keeps colours that already read well", () => {
    expect(readableOnWhite("#0F5C4A", "#292D32")).toBe("#0F5C4A");
  });
  it("darkens light brand colours until white text reads at 4.5:1", () => {
    const result = readableOnWhite("#E4E3DE", "#292D32");
    expect(result).not.toBe("#E4E3DE");
    expect(contrastWithWhite(result)).toBeGreaterThanOrEqual(4.5);
  });
  it("falls back for missing or invalid colours", () => {
    expect(readableOnWhite(null, "#292D32")).toBe("#292D32");
    expect(readableOnWhite("teal", "#292D32")).toBe("#292D32");
  });
});
