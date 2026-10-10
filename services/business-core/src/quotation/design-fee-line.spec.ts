import { describe, expect, it } from "vitest";
import { DESIGN_FEE_LABEL, designFeeLine, type OpportunityDesignFee } from "./design-fee-line";

const standard = { code: "standard", rate: "5" };
const signature = { name: "Signature design", inclusions: "Concepts, layouts and 3D renders" };
const fee = (value: Partial<OpportunityDesignFee>): OpportunityDesignFee => ({ proposal: null, priced: null, package: null, ...value });

describe("the first line of a new design-fee quote", () => {
  it("carries the fee the opportunity's design package priced, named and described by the firm's package", () => {
    expect(designFeeLine(fee({ priced: { amount: "12500.50", currency: "AED" }, package: signature }), "AED", standard)).toEqual({
      title: "Signature design", description: "Concepts, layouts and 3D renders", kind: "service", quantity: "1", unit: "",
      rate: "12500.5", taxCode: "standard", taxRate: "5", source: "discovery",
    });
  });

  it("prefers the Proposal 1 value Sales entered on the opportunity over the package's price", () => {
    const line = designFeeLine(fee({ proposal: { amount: "11000", currency: "AED" }, priced: { amount: "12500.50", currency: "AED" }, package: signature }), "AED", standard);
    expect(line).toMatchObject({ title: "Signature design", rate: "11000", source: "proposal" });
  });

  it("is named Design fee without a package, and leaves tax to the quote when the firm has no tax codes", () => {
    expect(designFeeLine(fee({ proposal: { amount: "9000", currency: "AED" } }), "AED", null)).toEqual({
      title: DESIGN_FEE_LABEL, description: "", kind: "service", quantity: "1", unit: "", rate: "9000", taxCode: null, taxRate: null, source: "proposal",
    });
    expect(DESIGN_FEE_LABEL).toBe("Design fee");
  });

  it("keeps the money exact: a decimal string, never a float", () => {
    const line = designFeeLine(fee({ priced: { amount: "1234567890123.4567", currency: "KWD" } }), "KWD", null);
    expect(line?.rate).toBe("1234567890123.4567");
    expect(typeof line?.rate).toBe("string");
  });

  it("uses the fee in the quote's currency and skips one in another currency", () => {
    const line = designFeeLine(fee({ proposal: { amount: "3000", currency: "USD" }, priced: { amount: "11000", currency: "AED" } }), "aed", standard);
    expect(line).toMatchObject({ rate: "11000", source: "discovery" });
  });

  it("starts empty when nothing was priced, the fee is zero or not a number, or no fee is in the quote's currency", () => {
    expect(designFeeLine(null, "AED", standard)).toBeNull();
    expect(designFeeLine(fee({}), "AED", standard)).toBeNull();
    expect(designFeeLine(fee({ priced: { amount: null, currency: null }, package: signature }), "AED", standard)).toBeNull();
    expect(designFeeLine(fee({ proposal: { amount: "0", currency: "AED" }, priced: { amount: "0.00", currency: "AED" } }), "AED", standard)).toBeNull();
    expect(designFeeLine(fee({ priced: { amount: "-50", currency: "AED" } }), "AED", standard)).toBeNull();
    expect(designFeeLine(fee({ priced: { amount: "1e5", currency: "AED" } }), "AED", standard)).toBeNull();
    expect(designFeeLine(fee({ priced: { amount: "12500", currency: "USD" } }), "AED", standard)).toBeNull();
    expect(designFeeLine(fee({ priced: { amount: "12500", currency: "AED" } }), null, standard)).toBeNull();
  });
});
