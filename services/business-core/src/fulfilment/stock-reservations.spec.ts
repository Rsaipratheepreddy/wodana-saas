import { describe, expect, it } from "vitest";
import { refundsWholeDeal } from "./deal-cancel";
import { shortOf } from "./stock-reservations";

describe("stock held for deals (PLM-125)", () => {
  it("says what a taken reservation was short of", () => {
    expect(shortOf({ status: "deducted", quantity: "3", deducted: "1" })).toBe("2");
    expect(shortOf({ status: "deducted", quantity: "3", deducted: "3" })).toBe("0");
    expect(shortOf({ status: "reserved", quantity: "3", deducted: "0" })).toBe("0");
  });

  it("cancels an order only for a refund of the whole deal, in its currency", () => {
    expect(refundsWholeDeal({ total: "4500.0000", currency: "AED" }, { amount: "4500", currency: "AED" })).toBe(true);
    expect(refundsWholeDeal({ total: "500.0000", currency: "AED" }, { amount: "4500", currency: "AED" })).toBe(false);
    expect(refundsWholeDeal({ total: "4500.0000", currency: "USD" }, { amount: "4500", currency: "AED" })).toBe(false);
    expect(refundsWholeDeal({ total: "4500.0000", currency: "AED" }, { amount: null, currency: "AED" })).toBe(false);
  });
});
