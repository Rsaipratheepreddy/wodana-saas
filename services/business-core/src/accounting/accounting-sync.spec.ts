import { describe, expect, it } from "vitest";
import { MAX_AUTOMATIC_ATTEMPTS, marker, retryDelayMinutes } from "./accounting-sync";

describe("accounting postings", () => {
  it("marks each posting with a short stable marker", () => {
    expect(marker("1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d")).toBe("W1a2b3c4d");
  });

  it("waits longer after each failure, at most six hours, and stops trying by itself after a few", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(retryDelayMinutes)).toEqual([1, 2, 4, 8, 16, 32, 64]);
    expect(retryDelayMinutes(20)).toBe(360);
    expect(MAX_AUTOMATIC_ATTEMPTS).toBe(8);
  });
});
