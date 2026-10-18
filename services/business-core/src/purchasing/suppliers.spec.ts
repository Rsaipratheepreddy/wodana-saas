import { describe, expect, it } from "vitest";
import { cleanCategories, readApproval, readDeal, readTerms } from "./suppliers";

describe("reading a supplier list", () => {
  it.each([
    ["Payment Upfront", { paymentTerms: "upfront", termsNote: "" }],
    ["Direct Payment", { paymentTerms: "upfront", termsNote: "" }],
    ["N/A - payment link upfront", { paymentTerms: "upfront", termsNote: "N/A - payment link upfront" }],
    ["50 / 50", { paymentTerms: "split", advancePercent: "50", termsNote: "" }],
    ["50 / 50 - for items \nslab upfront \n100% after completion depends on stocks availability", { paymentTerms: "split", advancePercent: "50", termsNote: "50 / 50 - for items slab upfront 100% after completion depends on stocks availability" }],
    ["SOA / End of Month for all delivered items", { paymentTerms: "statement", termsNote: "SOA / End of Month for all delivered items" }],
    ["Month End - SOA", { paymentTerms: "statement", termsNote: "" }],
    ["30 days after item received", { paymentTerms: "credit", creditDays: 30 }],
    ["Payment after Delivery", { paymentTerms: "on_delivery", termsNote: "" }],
  ])("reads the terms %j", (text, expected) => {
    expect(readTerms(text)).toMatchObject(expected);
  });

  it.each([
    ["N/A", { deal: "none", dealPercent: null }],
    ["0.1", { deal: "discount", dealPercent: "10", dealNote: "" }],
    ["12.5%", { deal: "discount", dealPercent: "12.5" }],
    ["15% discount reflected on issued Invoice", { deal: "discount", dealPercent: "15", dealNote: "15% discount reflected on issued Invoice" }],
    ["5% commission", { deal: "commission", dealPercent: "5" }],
    ["Discount as Requested / Approval", { deal: "on_request", dealPercent: null, dealNote: "Discount as Requested / Approval" }],
    ["discount/comm", { deal: "on_request" }],
    ["depends on the order", { deal: "on_request" }],
  ])("reads the deal %j", (text, expected) => {
    expect(readDeal(text)).toMatchObject(expected);
  });

  it.each([
    ["APPROVED MARBLE SUPPLIER ", "approved", false],
    ["NOMINATED PAINT SUPPLIER ", "approved", true],
    ["HARDWARE - (BLUM SUPPLIER)", "approved", false],
    ["NOT APPROVED", "not_approved", false],
    ["", "pending", false],
    ["N/A", "pending", false],
  ])("reads the approval %j", (text, approval, preferred) => {
    expect(readApproval(text)).toEqual({ approval, preferred });
  });

  it("keeps categories unique and in the spelling already used", () => {
    expect(cleanCategories(["marble", " Joinery ", "MARBLE", ""], ["Marble"])).toEqual(["Marble", "Joinery"]);
  });
});
