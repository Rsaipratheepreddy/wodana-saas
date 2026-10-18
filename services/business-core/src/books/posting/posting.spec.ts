import { describe, expect, it } from "vitest";
import { BOOKS_SOURCE_EVENTS } from "../books-contract";
import { adapterFor, POSTING_ADAPTERS } from "./rules";
import { inverted, Lines, role } from "./support";

describe("posting rules", () => {
  it("builds lines from signed amounts, rounded to the currency, without empty lines", () => {
    const lines = new Lines("AED").debit(role("ar_control"), "105000").credit(role("revenue_project"), "100000.004").credit(role("vat_output"), "4999.996")
      .debit(role("client_advances"), "0").debit(role("cost_price_variance"), "-50");
    expect(lines.lines.map((line) => [line.side, line.amount])).toEqual([
      ["debit", "105000.0000"], ["credit", "100000.0000"], ["credit", "5000.0000"], ["credit", "50.0000"]]);
    expect(lines.balance().toFixed(2)).toBe("-50.00");
    expect(new Lines("KWD").debit(role("inventory"), "1.23456").lines[0].amount).toBe("1.2350");
  });

  it("turns a rebuilt original around for an undo", () => {
    const draft = { legalEntityId: "e", eventDate: "2026-09-25", currency: "AED", source: { type: "supplier_payment", id: "p", event: "paid" },
      lines: new Lines("AED").debit(role("ap_control"), "300").credit(role("general_expense"), "300").lines };
    const undone = inverted(draft, { eventDate: "2026-10-03", source: { type: "supplier_payment", id: "p", event: "reversed" } });
    expect(undone).toMatchObject({ kind: "auto", reversesJournalId: null, eventDate: "2026-10-03", source: { event: "reversed" } });
    expect(undone.lines.map((line) => line.side)).toEqual(["credit", "debit"]);
  });

  it("has a rule for every source event the sweep posts (manual journals post on approval)", () => {
    for (const [type, events] of Object.entries(BOOKS_SOURCE_EVENTS)) {
      for (const event of events) expect(Boolean(adapterFor(type, event)), `${type}.${event}`).toBe(type !== "manual_journal");
    }
    expect(POSTING_ADAPTERS.map((adapter) => adapter.rule)).toEqual(["P3", "P1", "P2", "P4", "P5", "P9", "P11", "P6", "P7", "P8", "P10", "P12", "P13", "P14"]);
  });
});
