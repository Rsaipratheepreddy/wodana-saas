import { describe, expect, it } from "vitest";
import {
  controlledChangeCanRelease,
  deductionDraftLine,
  dispositionsCoverImpact,
  projectChangeImpact,
  remainingContractQuantity,
  sourceLinesForChange,
  validateControlledChangeSources,
} from "./change-control";
import type { CommercialData, Quote } from "./commercial.types";
import type { ProjectData } from "../projects/execution.types";

const baseQuote = {
  id: "base",
  number: 1,
  kind: "quotation",
  status: "accepted",
  direction: "addition",
  currency: "AED",
  requestIds: [],
  total: 1000,
  lines: [
    {
      id: "cabinetry",
      room: "Living room",
      title: "Cabinetry",
      quantity: 10,
      unit: "nos",
      rate: 100,
    },
  ],
} as Quote;

function commercial(overrides: Partial<CommercialData> = {}) {
  return {
    quotes: [baseQuote],
    requests: [],
    ...overrides,
  } as CommercialData;
}

describe("controlled change cases", () => {
  it("only permits remaining accepted scope to be removed or replaced", () => {
    const acceptedDeduction = {
      ...baseQuote,
      id: "accepted-credit",
      number: 2,
      kind: "variation",
      direction: "deduction",
      status: "accepted",
      requestIds: [],
      lines: [
        {
          ...baseQuote.lines[0],
          id: "credit-line",
          deductsLineId: "cabinetry",
          quantity: 4,
        },
      ],
    } as Quote;
    const data = commercial({ quotes: [baseQuote, acceptedDeduction] });

    expect(remainingContractQuantity(data, "cabinetry")).toBe(6);
    expect(() =>
      validateControlledChangeSources(data, "replacement", ["cabinetry"]),
    ).not.toThrow();
    const source = sourceLinesForChange(data, ["cabinetry"])[0];
    const line = deductionDraftLine(source.line, source.remainingQuantity);
    expect(line).toMatchObject({
      deductsLineId: "cabinetry",
      quantity: 6,
      rate: 100,
    });
    expect(line.id).not.toBe("cabinetry");
  });

  it("maps every live operational dependency into the impact record", () => {
    const project = {
      tasks: [
        {
          id: "task-1",
          title: "Fabricate cabinetry",
          scopeIds: ["cabinetry"],
          status: "in_progress",
          approved: 0,
        },
      ],
      reports: [
        {
          status: "submitted",
          entries: [{ taskId: "task-1" }],
        },
      ],
      workPackages: [
        {
          id: "package-1",
          title: "Cabinetry",
          scopeLineIds: ["cabinetry"],
          status: "in_progress",
        },
      ],
      orders: [
        { id: "order-1", title: "Factory order", taskId: "task-1", status: "acknowledged" },
      ],
      materials: [
        {
          id: "material-1",
          title: "Oak veneer",
          taskId: "task-1",
          movements: [{ id: "received" }],
        },
      ],
    } as ProjectData;

    const impact = projectChangeImpact(
      "project-1",
      project,
      ["cabinetry"],
      "2026-09-16T09:00:00.000Z",
      2,
    );

    expect(impact.targets.map((target) => target.kind)).toEqual([
      "work_package",
      "task",
      "order",
      "material",
      "booking",
    ]);
    expect(impact.targets.at(-1)).toMatchObject({
      id: "confirmed-bookings",
      title: "2 confirmed project bookings",
    });
    expect(impact.hasReportedOrCompletedWork).toBe(true);
    expect(
      dispositionsCoverImpact(impact, [
        ...impact.targets.map((target) => ({
          targetKind: target.kind,
          targetId: target.id,
          action: "hold_and_replan" as const,
          note: "Reviewed by the delivery lead.",
        })),
      ]),
    ).toBe(true);
  });

  it("does not release a replacement until both sides are accepted and fully dispositioned", () => {
    const impact = {
      assessedAt: "2026-09-16T09:00:00.000Z",
      projectId: "project-1",
      sourceLineIds: ["cabinetry"],
      bookingCount: 0,
      hasReportedOrCompletedWork: false,
      targets: [
        {
          kind: "work_package" as const,
          id: "package-1",
          title: "Cabinetry",
          status: "planning",
        },
      ],
    };
    const request = {
      id: "change-1",
      number: 5,
      status: "awaiting_decision",
      control: {
        kind: "replacement" as const,
        sourceLineIds: ["cabinetry"],
        quoteIds: ["remove", "add"],
        impact,
        dispositions: [
          {
            targetKind: "work_package" as const,
            targetId: "package-1",
            action: "hold_and_replan" as const,
            note: "Re-plan after the client accepts the replacement.",
          },
        ],
      },
    };
    const remove = {
      ...baseQuote,
      id: "remove",
      kind: "variation",
      direction: "deduction",
      status: "accepted",
      requestIds: ["change-1"],
    } as Quote;
    const add = {
      ...baseQuote,
      id: "add",
      kind: "variation",
      direction: "addition",
      status: "issued",
      requestIds: ["change-1"],
    } as Quote;
    const data = commercial({ quotes: [baseQuote, remove, add], requests: [request] });

    expect(controlledChangeCanRelease(data, "change-1")).toBe(false);
    add.status = "accepted";
    expect(controlledChangeCanRelease(data, "change-1")).toBe(true);
  });
});
