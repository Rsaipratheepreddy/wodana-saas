import { describe, expect, it } from "vitest";
import { budgetOf, idleSince, overBudgetBy, roundChargeable, startProblem, veLead, veStep } from "./value-engineering.domain";

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
});
