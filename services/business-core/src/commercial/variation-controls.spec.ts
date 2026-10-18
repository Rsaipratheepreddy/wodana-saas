import { describe, it, expect } from "vitest";
import { sameOffer, validateDeduction } from "./variation-controls";
import type { Quote, CommercialData } from "./commercial.types";
const base = {
  id: "base",
  kind: "quotation",
  status: "accepted",
  currency: "AED",
  total: 100,
  lines: [{ id: "line", quantity: 10, unit: "nos", rate: 10 }],
} as Quote;
const deduction = {
  id: "d",
  kind: "variation",
  direction: "deduction",
  status: "draft",
  currency: "AED",
  total: 20,
  paymentTerms: [],
  lines: [
    {
      id: "creditline",
      deductsLineId: "line",
      quantity: 2,
      unit: "nos",
      rate: 10,
    },
  ],
} as Quote;
describe("variation families and deductions", () => {
  it("keeps separate variations independent while preserving revision families", () => {
    const a = { id: "a", kind: "variation", baselineId: "base" } as Quote,
      b = { id: "b", kind: "variation", baselineId: "base" } as Quote;
    expect(sameOffer(a, b)).toBe(false);
    expect(sameOffer(a, { ...b, familyId: "a" })).toBe(true);
    expect(sameOffer(base, { ...base, id: "v2" })).toBe(true);
    expect(sameOffer({ ...base, round: "design" }, { ...base, round: "main" })).toBe(false);
  });
  it("requires accepted scope references and prevents over-deducting quantity", () => {
    const d = { quotes: [base] } as CommercialData;
    expect(() => validateDeduction(d, deduction)).not.toThrow();
    expect(() =>
      validateDeduction(d, {
        ...deduction,
        lines: [{ ...deduction.lines[0], quantity: 11 }],
      }),
    ).toThrow(/remaining/);
    expect(() =>
      validateDeduction(d, {
        ...deduction,
        lines: [{ ...deduction.lines[0], deductsLineId: "foreign" }],
      }),
    ).toThrow(/accepted/);
  });
  it("counts accepted prior deductions and refuses credits above the contract or payment requests", () => {
    const d = {
      quotes: [
        base,
        {
          ...deduction,
          id: "previous",
          status: "accepted",
          total: 90,
          lines: [{ ...deduction.lines[0], quantity: 9 }],
        },
      ],
    } as CommercialData;
    expect(() => validateDeduction(d, deduction)).toThrow();
    expect(() =>
      validateDeduction({ quotes: [base] } as CommercialData, {
        ...deduction,
        total: 101,
      }),
    ).toThrow(/contract/);
    expect(() =>
      validateDeduction({ quotes: [base] } as CommercialData, {
        ...deduction,
        paymentTerms: [
          {
            id: "p",
            title: "Pay",
            percent: 100,
            trigger: "Accept",
            requiredForRelease: true,
          },
        ],
      }),
    ).toThrow(/client credit/);
  });
  it("treats only client-selected options as accepted contract scope", () => {
    const optionalBase = {
      ...base,
      lines: [...base.lines, { ...base.lines[0], id: "option", optional: true }],
      clientDecision: {
        decision: "accept" as const,
        quoteHash: "hash",
        selectedOptionLineIds: [],
        baseTotal: 100,
        optionsTotal: 0,
        acceptedTotal: 100,
        decidedAt: "2026-09-18",
        decidedBy: "Client",
      },
    };
    const optionDeduction = {
      ...deduction,
      lines: [{ ...deduction.lines[0], deductsLineId: "option" }],
    };
    expect(() => validateDeduction({ quotes: [optionalBase] } as CommercialData, optionDeduction)).toThrow(/accepted/);
    optionalBase.clientDecision.selectedOptionLineIds = ["option"];
    optionalBase.clientDecision.optionsTotal = 100;
    optionalBase.clientDecision.acceptedTotal = 200;
    expect(() => validateDeduction({ quotes: [optionalBase] } as CommercialData, optionDeduction)).not.toThrow();
  });
});
