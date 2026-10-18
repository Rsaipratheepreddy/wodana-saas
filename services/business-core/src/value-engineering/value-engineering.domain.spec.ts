import { describe, expect, it } from "vitest";
import { describeAction } from "../history/history-actions";
import { historySubject } from "../history/history-items";
import { budgetOf, idleSince, keptPriceStands, overBudgetBy, roundChargeable, startProblem, veLead, veStep } from "./value-engineering.domain";

describe("value engineering (PLM-147)", () => {
  it("reads the client's budget from the brief only when it is a positive amount in a currency", () => {
    expect(budgetOf("300000", "AED")).toEqual({ amount: "300000", currency: "AED" });
    expect(budgetOf(" 1250.50 ", "INR")).toEqual({ amount: "1250.5", currency: "INR" });
    for (const [amount, currency] of [["", "AED"], ["0", "AED"], ["abc", "AED"], ["100", ""], [null, "AED"], ["100", "aed"]]) expect(budgetOf(amount, currency)).toBeNull();
  });

  it("is over budget only above a budget in the estimate's own currency", () => {
    const budget = { amount: "300000", currency: "AED" };
    expect(overBudgetBy("340000.50", "AED", budget)).toBe("40000.5");
    expect(overBudgetBy("300000", "AED", budget)).toBeNull();
    expect(overBudgetBy("250000", "AED", budget)).toBeNull();
    // No budget recorded, or recorded in another currency: nothing to compare with (only the manual start applies).
    expect(overBudgetBy("340000", "AED", null)).toBeNull();
    expect(overBudgetBy("340000", "USD", budget)).toBeNull();
  });

  it("a price the client chose to keep doesn't reopen value engineering; a changed price still may", () => {
    const kept = { outcome: "kept_price" as const, quoteId: "q1", familyId: "f", currency: "AED", quotedTotal: "340000.0000" };
    const quote = { id: "q1", familyId: "f", currency: "AED", total: "340000" };
    expect(keptPriceStands([kept], quote)).toBe(true);
    // The same amount on a later version of the same estimate is still the kept price; another amount (even re-priced on the
    // same draft version), another estimate or another currency isn't.
    expect(keptPriceStands([kept], { ...quote, id: "q2" })).toBe(true);
    expect(keptPriceStands([kept], { ...quote, total: "350000" })).toBe(false);
    expect(keptPriceStands([kept], { ...quote, id: "q2", total: "350000" })).toBe(false);
    expect(keptPriceStands([kept], { ...quote, id: "q2", familyId: "other" })).toBe(false);
    expect(keptPriceStands([kept], { ...quote, id: "q2", currency: "USD" })).toBe(false);
    // Only a kept-price decision counts: a withdrawn round, a new version sent or a round still open don't.
    for (const outcome of ["withdrawn", "new_version", null] as const) expect(keptPriceStands([{ ...kept, outcome }], quote)).toBe(false);
    expect(keptPriceStands([], quote)).toBe(false);
  });

  it("has no round limit by default; past the firm's free rounds a round is chargeable", () => {
    expect(roundChargeable(9, null)).toBe(false);
    expect(roundChargeable(2, 2)).toBe(false);
    expect(roundChargeable(3, 2)).toBe(true);
    expect(roundChargeable(1, 0)).toBe(true);
  });

  it("is led by the lead designer; the Account Manager only on a design job without one; nobody on a furniture-only job without a designer", () => {
    expect(veLead({ designer: "d", accountManager: "am", designWork: true })).toEqual({ membershipId: "d", fallback: false });
    expect(veLead({ designer: "d", accountManager: "am", designWork: false })).toEqual({ membershipId: "d", fallback: false });
    expect(veLead({ designer: null, accountManager: "am", designWork: true })).toEqual({ membershipId: "am", fallback: true });
    expect(veLead({ designer: null, accountManager: "am", designWork: false })).toBeNull();
    expect(veLead({ designer: null, accountManager: null, designWork: true })).toBeNull();
  });

  it("starts on the latest version of the estimate only", () => {
    const lead = { membershipId: "d" };
    const quote = { kind: "quotation", round: "main", status: "draft", latest: true };
    expect(startProblem(quote, lead, true)).toBeNull();
    expect(startProblem({ ...quote, status: "issued" }, lead, true)).toBeNull();
    expect(startProblem({ ...quote, kind: "variation" }, lead, true)).toMatch(/not a variation/);
    expect(startProblem({ ...quote, round: "design" }, lead, true)).toMatch(/Design Fee/);
    expect(startProblem({ ...quote, status: "accepted" }, lead, true)).toMatch(/already accepted/);
    expect(startProblem({ ...quote, latest: false }, lead, true)).toMatch(/latest version/);
    expect(startProblem(quote, null, false)).toMatch(/no designer/);
    expect(startProblem(quote, null, true)).toMatch(/Allocate the lead designer/);
  });

  it("agrees the savings, presents the options at the meeting, then waits for the client", () => {
    const now = new Date("2026-10-13T10:00:00Z");
    expect(veStep({ status: "open", optionsAgreedAt: null, meetingStartsAt: null }, now)).toBe("agree_options");
    expect(veStep({ status: "open", optionsAgreedAt: now, meetingStartsAt: null }, now)).toBe("present_options");
    expect(veStep({ status: "open", optionsAgreedAt: now, meetingStartsAt: "2026-10-14T10:00:00Z" }, now)).toBe("present_options");
    expect(veStep({ status: "open", optionsAgreedAt: now, meetingStartsAt: "2026-10-13T09:00:00Z" }, now)).toBe("client_decision");
    expect(veStep({ status: "closed", optionsAgreedAt: null, meetingStartsAt: null }, now)).toBe("closed");
  });

  it("counts idle time from the last move, or from the end of the meeting", () => {
    const moved = new Date("2026-10-10T08:00:00Z");
    expect(idleSince(moved, null)).toBe(moved);
    expect(idleSince(moved, new Date("2026-10-12T12:00:00Z")).toISOString()).toBe("2026-10-12T12:00:00.000Z");
    expect(idleSince(moved, new Date("2026-10-09T12:00:00Z"))).toBe(moved);
  });

  it("reads each step in the job's history as a business event about value engineering", () => {
    const line = (action: string) => [describeAction(action).verb, historySubject("pre_project_case", action, {})];
    expect(line("quotation.value_engineering_started.v1")).toEqual(["started", "value_engineering"]);
    expect(line("quotation.value_engineering_options_confirmed.v1")).toEqual(["confirmed", "value_engineering"]);
    expect(line("quotation.value_engineering_meeting_booked.v1")).toEqual(["scheduled", "value_engineering"]);
    expect(line("quotation.value_engineering_decided.v1")).toEqual(["decided", "value_engineering"]);
    expect(line("quotation.value_engineering_closed.v1")).toEqual(["closed", "value_engineering"]);
    expect(line("quotation.value_engineering_withdrawn.v1")).toEqual(["cancelled", "value_engineering"]);
    expect(line("quotation.value_engineering_reassigned.v1")).toEqual(["reassigned", "value_engineering"]);
    expect(line("quotation.value_engineering_budget_changed.v1")).toEqual(["updated", "value_engineering"]);
    // The QS's own steps stay on the quotation.
    expect(line("quotation.qs_confirmed.v1")).toEqual(["approved", "quotation"]);
  });
});
