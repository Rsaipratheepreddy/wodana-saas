import { describe, expect, it } from "vitest";
import { claimNumber } from "./petty-cash";

describe("petty cash", () => {
  it("numbers claims PC-0001 onwards", () => {
    expect(claimNumber(7)).toBe("PC-0007");
    expect(claimNumber(12345)).toBe("PC-12345");
  });
});
