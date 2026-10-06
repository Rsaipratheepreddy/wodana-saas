import { describe, expect, it } from "vitest";
import type { Milestone } from "../project-core/project-milestones";
import { owedBeforeInstallation, owedText } from "./installation-payments";

const milestone = (id: string, title: string, amount: string, state: Milestone["state"], flags: Partial<Pick<Milestone, "requiredForRelease" | "requiredForProduction">> = {}): Milestone => ({
  id, title, trigger: "", amount, currency: "AED", dueDate: null, quoteId: "q", requiredForProduction: false, requiredForRelease: false, state, reference: "",
  invoice: null, receipt: null, ...flags,
});

describe("owedBeforeInstallation (PLM-065)", () => {
  const schedule = [
    milestone("advance", "Advance", "25000.00", "verified", { requiredForRelease: true }),
    milestone("balance", "Balance before installation", "25000.00", "invoiced"),
    milestone("handover", "On handover", "5000.00", "to_invoice"),
  ];

  it("owes the stage a work order names as due when it's ready, until Finance verifies it", () => {
    const owed = owedBeforeInstallation(schedule, new Set(["balance"]));
    expect(owed.stages.map((stage) => stage.id)).toEqual(["balance"]);
    expect(owed.totals).toEqual([{ currency: "AED", amount: "25000.00" }]);
    expect(owedText(owed)).toBe("AED 25000.00 (Balance before installation)");
    expect(owedBeforeInstallation(schedule.map((row) => ({ ...row, state: "verified" as const })), new Set(["balance"])).stages).toEqual([]);
  });

  it("respects the release and production flags, and never reads the stage's words", () => {
    const flagged = [milestone("advance", "Advance", "10000.00", "reported", { requiredForRelease: true }), milestone("production", "Before production", "4000.50", "to_invoice", { requiredForProduction: true }),
      milestone("words", "Before installation", "9999.00", "to_invoice")];
    const owed = owedBeforeInstallation(flagged, new Set());
    expect(owed.stages.map((stage) => stage.id)).toEqual(["advance", "production"]);
    expect(owed.totals).toEqual([{ currency: "AED", amount: "14000.50" }]);
  });

  it("owes nothing when no stage is due before installation", () => {
    expect(owedBeforeInstallation([milestone("handover", "On handover", "5000.00", "to_invoice")], new Set())).toEqual({ stages: [], totals: [] });
  });
});
