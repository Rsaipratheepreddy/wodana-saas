import { describe, expect, it } from "vitest";
import { decisionPolicySummary } from "./decision-requests";

describe("decision request policy", () => {
  it("explains active reminder channels and escalation in plain language", () => {
    expect(decisionPolicySummary({
      escalationMinutes: 1_440,
      notificationPolicy: { remindersEnabled: true, channels: ["in_app", "email"] },
    })).toBe("Reminders: Wodana, email · Escalates 1 day after the due date");
  });

  it("does not promise reminders or escalation when they are disabled", () => {
    expect(decisionPolicySummary({
      escalationMinutes: null,
      notificationPolicy: { remindersEnabled: false, channels: ["in_app"] },
    })).toBe("Reminders off · No automatic escalation");
  });
});
