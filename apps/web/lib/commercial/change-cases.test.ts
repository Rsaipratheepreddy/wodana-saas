import { describe, expect, it } from "vitest";
import { availableContractLines } from "./change-cases";
import type { CommercialData } from "./types";

describe("available contract scope", () => {
  it("subtracts accepted deductions and excludes fully removed items", () => {
    const data = { quotes: [
      { status: "accepted", direction: "addition", number: 1, lines: [
        { id: "a", title: "Wardrobe", room: "Bedroom", quantity: 3, unit: "nos" },
        { id: "b", title: "Desk", room: "Study", quantity: 1, unit: "nos" },
      ] },
      { status: "accepted", direction: "deduction", number: 2, lines: [
        { id: "credit-a", deductsLineId: "a", quantity: 1 },
        { id: "credit-b", deductsLineId: "b", quantity: 1 },
      ] },
      { status: "draft", direction: "deduction", number: 3, lines: [
        { id: "unapproved", deductsLineId: "a", quantity: 2 },
      ] },
    ] } as CommercialData;
    expect(availableContractLines(data)).toEqual([
      { id: "a", quoteNumber: 1, title: "Wardrobe", room: "Bedroom", remainingQuantity: 2, unit: "nos" },
    ]);
  });
});
