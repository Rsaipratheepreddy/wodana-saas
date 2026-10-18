import { describe, expect, it } from "vitest";
import { confirmProblem, impactText, ledgerState, lineTotal, lockProblem, priceImpact, procurementProblem, versionProblem, type EntryState } from "./design-ledger.domain";

const entry = (id: string, current: EntryState["current"], locked: EntryState["locked"] = null, archived = false, archivedAfterLock = false): EntryState =>
  ({ id, title: `Item ${id}`, archived, archivedAfterLock, current, locked });

describe("materials and decisions ledger (PLM-054, E5-1/E5-2)", () => {
  const now = new Date("2026-10-06T10:00:00Z");
  const valid = { title: "Oak veneer", source: "showroom", saidAt: "2026-10-06T09:00:00Z" };

  it("validates a version: name, numbers as decimals, a source and when it was said", () => {
    expect(versionProblem(valid, now)).toBeNull();
    expect(versionProblem({ ...valid, title: " " }, now)).toBe("Name the material or choice");
    expect(versionProblem({ ...valid, quantity: "0" }, now)).toBe("Quantity must be a number above zero");
    expect(versionProblem({ ...valid, quantity: "1.23456" }, now)).toBe("Quantity must be a number above zero");
    expect(versionProblem({ ...valid, unitPrice: "12.345" }, now)).toBe("Price must be an amount with at most two decimals");
    expect(versionProblem({ ...valid, source: "rumour" }, now)).toBe("Say where the choice came from");
    expect(versionProblem({ ...valid, saidAt: "2026-10-07T09:00:00Z" }, now)).toBe("The choice can't be dated in the future");
    expect(versionProblem({ ...valid, timeImpactDays: 1.5 }, now)).toBe("Time impact is a whole number of days within a year");
  });

  it("works money out exactly, without floats", () => {
    expect(lineTotal("0.1", "0.2")?.toFixed(2)).toBe("0.02");
    expect(lineTotal("3", "19.99")?.toFixed(2)).toBe("59.97");
    expect(lineTotal(null, "10")).toBeNull();
    expect(priceImpact(null, { quantity: "12.5", unitPrice: "80" })).toBe("1000.00");
    expect(priceImpact({ quantity: "12.5", unitPrice: "80" }, { quantity: "12.5", unitPrice: "95.50" })).toBe("193.75");
    expect(priceImpact({ quantity: "2", unitPrice: "100" }, { quantity: null, unitPrice: null })).toBe("-200.00");
    expect(impactText("193.75", 3, "AED")).toBe("+193.75 AED · +3 days");
    expect(impactText("-200.00", 0, "INR")).toBe("-200.00 INR");
    expect(impactText("0", 0, null)).toBe("No price or time impact");
  });

  it("versions a choice and locks the list only when every current version is confirmed by the client", () => {
    expect(ledgerState([], false)).toBe("empty");
    const proposed = [entry("a", { id: "a1", number: 1, status: "confirmed" }), entry("b", { id: "b1", number: 1, status: "proposed" })];
    expect(ledgerState(proposed, false)).toBe("open");
    expect(lockProblem([])).toBe("Add the materials and choices first");
    expect(lockProblem(proposed)).toBe("Waiting for the client's confirmation: Item b");
    const many = ["c", "d", "e", "f"].map((id) => entry(id, { id: `${id}1`, number: 1, status: "proposed" }));
    expect(lockProblem(many)).toBe("Waiting for the client's confirmation: Item c, Item d, Item e and 1 more");
    // A declined choice holds the lock too: the client wants something else.
    expect(lockProblem([entry("a", { id: "a1", number: 1, status: "declined" })])).toMatch(/Item a/);
    // An archived entry doesn't count.
    expect(lockProblem([entry("a", { id: "a1", number: 1, status: "confirmed" }), entry("x", { id: "x1", number: 1, status: "proposed" }, null, true)])).toBeNull();
  });

  it("E5-1: a change after the lock is pending until approved; procurement keeps the locked version", () => {
    const locked = [entry("a", { id: "a1", number: 1, status: "confirmed" }, { id: "a1", number: 1 })];
    expect(ledgerState(locked, true)).toBe("locked");
    const changed = [entry("a", { id: "a2", number: 2, status: "proposed" }, { id: "a1", number: 1 })];
    expect(ledgerState(changed, true)).toBe("changes_pending");
    expect(ledgerState([...locked, entry("n", { id: "n1", number: 1, status: "proposed" })], true)).toBe("changes_pending");
    expect(ledgerState([entry("a", { id: "a1", number: 1, status: "confirmed" }, { id: "a1", number: 1 }, true, true)], true)).toBe("changes_pending");
  });

  it("refuses a decision on an old version (the client is shown the latest) and a second decision", () => {
    expect(confirmProblem({ number: 1, status: "superseded" }, 2)).toMatch(/latest/);
    expect(confirmProblem({ number: 2, status: "confirmed" }, 2)).toBe("This choice is already confirmed.");
    expect(confirmProblem({ number: 2, status: "declined" }, 2)).toBe("This choice was already decided.");
    expect(confirmProblem({ number: 2, status: "proposed" }, 2)).toBeNull();
  });

  it("blocks procurement until the list is locked, and only for cases that keep a ledger", () => {
    expect(procurementProblem(true, false, "P-12")).toBe("The client hasn't signed off P-12's material list yet. Ordering starts after the design sign-off.");
    expect(procurementProblem(true, true, "P-12")).toBeNull();
    expect(procurementProblem(false, false, "P-12")).toBeNull();
  });
});
