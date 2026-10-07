import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as shared from "../../../../packages/contracts/src/books";
import * as local from "./books-contract";

const migration = readFileSync(resolve(__dirname, "../../drizzle/0282_books_core.sql"), "utf8");
const checkList = (column: string) => {
  const match = new RegExp(String.raw`${column} IN \(([^)]*)\)`).exec(migration);
  return match ? [...match[1].matchAll(/'([a-z_]+)'/g)].map((value) => value[1]) : [];
};

describe("Ledger contract", () => {
  it("is the same in business-core as in packages/contracts", () => {
    expect(local.ACCOUNT_ROLES).toEqual(shared.ACCOUNT_ROLES);
    expect(local.ACCOUNT_TYPES).toEqual(shared.ACCOUNT_TYPES);
    expect(local.TAX_TREATMENTS).toEqual(shared.TAX_TREATMENTS);
    expect(local.TAX_DIRECTIONS).toEqual(shared.TAX_DIRECTIONS);
    expect(local.PAYMENT_DIRECTIONS).toEqual(shared.PAYMENT_DIRECTIONS);
    expect(local.PAYMENT_METHODS).toEqual(shared.PAYMENT_METHODS);
    expect(local.JOURNAL_KINDS).toEqual(shared.JOURNAL_KINDS);
    expect(local.PARTY_TYPES).toEqual(shared.PARTY_TYPES);
    expect(local.BOOKS_SOURCE_EVENTS).toEqual(shared.BOOKS_SOURCE_EVENTS);
    expect(local.POSTING_ISSUE_CODES).toEqual(shared.POSTING_ISSUE_CODES);
    expect(local.BOOKS_PERMISSIONS).toEqual(shared.BOOKS_PERMISSIONS);
  });

  it("lists the 26 posting roles and every rule's source event", () => {
    expect(shared.ACCOUNT_ROLES).toHaveLength(26);
    expect(Object.keys(shared.POSTING_RULES)).toEqual(Array.from({ length: 15 }, (_, index) => `P${index + 1}`));
    for (const [rule, { sourceType, event }] of Object.entries(shared.POSTING_RULES)) {
      expect(shared.BOOKS_SOURCE_EVENTS[sourceType] as readonly string[], rule).toContain(event);
    }
  });

  it("matches the database's lists", () => {
    expect(checkList("role")).toEqual([...shared.ACCOUNT_ROLES]);
    expect(checkList("treatment")).toEqual([...shared.TAX_TREATMENTS]);
    expect(checkList("code")).toEqual([...shared.POSTING_ISSUE_CODES]);
    expect(checkList("kind")).toEqual([...shared.JOURNAL_KINDS]);
    expect(checkList("method")).toEqual([...shared.PAYMENT_METHODS]);
    expect(checkList("party_type")).toEqual([...shared.PARTY_TYPES]);
    expect(checkList("status")).toEqual([...shared.MANUAL_JOURNAL_STATUSES]);
  });

  it("links reports to accounts and journals", () => {
    expect(shared.ledgerHref.report("trial-balance", { legalEntityId: "e1", from: "2026-10-01", to: "2026-10-31" }))
      .toBe("/workspace/ledger/reports/trial-balance?entity=e1&from=2026-10-01&to=2026-10-31");
    expect(shared.ledgerHref.account("a1")).toBe("/workspace/ledger/accounts/a1");
    expect(shared.ledgerHref.journal("j1")).toBe("/workspace/ledger/journals/j1");
  });
});
