import { describe, expect, it } from "vitest";
import { debitNote, invoiceable, orderUnitPrice, priceBillLine } from "./payables";

const line = { accepted: "10", credited: "0", creditValue: "0", billed: "0", approvedBilled: "0", currency: "AED" };

describe("payables arithmetic", () => {
  it("prices the order's unit after its discount, exactly", () => {
    expect(orderUnitPrice({ unitPrice: "33.3333", discountPercent: "10" }).toString()).toBe("29.99997");
    expect(orderUnitPrice({ unitPrice: "100", discountPercent: "0" }).toString()).toBe("100");
  });

  it("prices an invoice line in the currency's minor units, net + tax = total", () => {
    expect(priceBillLine({ quantity: "3", unitPrice: "10.005", taxRate: "5" }, "AED")).toEqual({ net: "30.02", tax: "1.50", total: "31.52" });
    expect(priceBillLine({ quantity: "2", unitPrice: "1000.4", taxRate: "10" }, "JPY")).toEqual({ net: "2001", tax: "200", total: "2201" });
    expect(priceBillLine({ quantity: "1", unitPrice: "10.0005", taxRate: "0" }, "KWD")).toEqual({ net: "10.001", tax: "0.000", total: "10.001" });
  });

  it("leaves to invoice what was accepted and credited, less what's billed", () => {
    expect(invoiceable({ ...line, billed: "4" }).toString()).toBe("6");
    expect(invoiceable({ ...line, accepted: "8", credited: "2", billed: "10" }).toString()).toBe("0");
    expect(invoiceable({ ...line, billed: "12" }).toString()).toBe("0");
  });

  it("raises a debit note only for credited goods that were invoiced", () => {
    // Returned before invoicing: the supplier invoiced what was kept, nothing to settle.
    expect(debitNote({ ...line, accepted: "8", credited: "2", creditValue: "210", approvedBilled: "8" }).amount.toString()).toBe("0");
    // Invoiced all ten, then two went back for credit: the whole credit settles the invoice.
    expect(debitNote({ ...line, accepted: "8", credited: "2", creditValue: "210", approvedBilled: "10" }).amount.toString()).toBe("210");
    // Invoiced nine of ten: only one credited unit had been invoiced.
    expect(debitNote({ ...line, accepted: "8", credited: "2", creditValue: "210", approvedBilled: "9" }).amount.toString()).toBe("105");
    // Thirds round to the currency; the parts still add up to the whole credit.
    expect(debitNote({ ...line, accepted: "0", credited: "3", creditValue: "100", approvedBilled: "1" }).amount.toString()).toBe("33.33");
    expect(debitNote({ ...line, accepted: "0", credited: "3", creditValue: "100", approvedBilled: "3" }).amount.toString()).toBe("100");
  });
});
