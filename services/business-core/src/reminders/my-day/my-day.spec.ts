import { describe, expect, it } from "vitest";
import { variantOf, withoutDuplicates } from "./my-day";

describe("My day rows", () => {
  it("lists an overdue invoice once: the client payment stage it bills is left out", () => {
    const invoice = "/workspace/finance/client-invoices?invoice=b4d5";
    const rows = [
      { kind: "invoice.overdue" as const, href: invoice },
      { kind: "payment.due" as const, href: invoice },
      { kind: "payment.due" as const, href: "/workspace/pre-projects/cases/c1/payment-plan" },
      { kind: "payment.due" as const, href: "/workspace/finance/client-invoices?invoice=other" },
    ];
    expect(withoutDuplicates(rows)).toEqual([rows[0], rows[2], rows[3]]);
  });

  it("names an approval's own kind from its key", () => {
    expect(variantOf({ kind: "approval.waiting", sourceKey: "approval:receipt:p1:m1" })).toBe("receipt");
    expect(variantOf({ kind: "approval.waiting", sourceKey: "approval:site_report:r1:m1" })).toBe("site_report");
    expect(variantOf({ kind: "invoice.overdue", sourceKey: "invoice:i1" })).toBeNull();
  });
});
