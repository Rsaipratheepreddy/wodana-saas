import { describe, expect, it } from "vitest";
import { debitNote, invoiceable, orderUnitPrice, priceBillLine, retentionByProject } from "./payables";

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

  it("holds back retention per project, summed exactly across lines and rounded once to the currency", () => {
    const part = (projectId: string | null, net: string, retentionPercent: string) => ({ projectId, net, retentionPercent });
    // Three lines of a third each at 5%: 1.6665 + 1.6665 + 1.667 = 5 exactly, where rounding each line would make 5.01.
    expect(retentionByProject([part("p1", "33.33", "5"), part("p1", "33.33", "5"), part("p1", "33.34", "5")], "AED")).toEqual([{ projectId: "p1", amount: "5.00" }]);
    // Per project, each rounded on its own; lines without retention (a charge not on an order) hold nothing.
    expect(retentionByProject([part("p1", "100.10", "7.5"), part("p2", "40.00", "10"), part("p2", "12.00", "0"), part(null, "20.00", "5")], "AED"))
      .toEqual([{ projectId: "p1", amount: "7.51" }, { projectId: "p2", amount: "4.00" }, { projectId: null, amount: "1.00" }]);
    // Half a minor unit rounds away from zero; just under it rounds down, however many places it runs to.
    expect(retentionByProject([part("p1", "10.00", "0.05")], "AED")).toEqual([{ projectId: "p1", amount: "0.01" }]);
    expect(retentionByProject([part("p1", "9.99", "0.05")], "AED")).toEqual([]);
    expect(retentionByProject([part("p1", "9.9990", "0.05")], "AED")).toEqual([]);
    // Currencies without minor units, and with three.
    expect(retentionByProject([part("p1", "1250", "5"), part("p1", "1250", "5")], "JPY")).toEqual([{ projectId: "p1", amount: "125" }]);
    expect(retentionByProject([part("p1", "1049", "5")], "JPY")).toEqual([{ projectId: "p1", amount: "52" }]);
    expect(retentionByProject([part("p1", "10.001", "5")], "KWD")).toEqual([{ projectId: "p1", amount: "0.500" }]);
    expect(retentionByProject([], "AED")).toEqual([]);
  });
});
