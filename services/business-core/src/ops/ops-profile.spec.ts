import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, DEFAULT_STAGES } from "../project-core/project-checks";
import { planRoute } from "./ops-configure";
import { ProfileError, validateProfile } from "./ops-profile";

const json = (path: string) => JSON.parse(readFileSync(resolve(__dirname, path), "utf8"));
const problems = (raw: unknown) => {
  try { validateProfile(raw); return []; } catch (error) { if (error instanceof ProfileError) return error.problems; throw error; }
};

describe("configuration profile", () => {
  it("accepts the Palm go-live profile and the sample profile", () => {
    const palm = validateProfile(json("../../../../docs/fixtures/palm-golive-config.json"));
    expect(palm.enquiryTypes).toEqual({ archive: ["concepts_early_ideas"] });
    expect(palm.vehicles).toHaveLength(9);
    expect(palm.factory?.productionSteps).toEqual([{ kind: "scheduled", label: "" }, { kind: "in_production", label: "" }, { kind: "quality_check", label: "" }, { kind: "ready", label: "" }]);
    expect(palm.factory?.permits).toEqual({ requiredForDeliveriesAndInstallations: true, furnitureDeliveriesNeedOne: true, missingAlertWorkingDays: 3, expiryReminderDays: 7 });
    expect(palm.quotations).toMatchObject({ validityDays: 7, qsReview: true, qsPrices: "rules", qsWorkPackages: ["Joinery", "Bespoke furniture"] });
    expect(palm.firstResponse).toEqual({ minutes: 60, workingCalendar: { days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "18:00" } });
    expect(palm.financeRequests?.inbox).toBe("accounts@palmlivingae.com");
    expect(palm.financeRequests?.paymentMethods?.map((method) => [method.name, method.refundDays])).toEqual([["Bank transfer / card", null], ["Stripe", null], ["Tabby", null]]);
    expect(palm.approvals?.payableRequest).toEqual({ firstApproverRole: "finance", secondApproverRole: null, thresholdAmount: null });
    expect(palm.design).toEqual({ renderInternalDays: 35, renderClientDays: 56, revisionsIncluded: 2 });
    expect(palm.clientUpdates).toEqual({ mode: "call", frequency: "weekly" });
    expect(validateProfile(json("fixtures/sample-profile.json")).orderPaths).toHaveLength(2);
  });

  it("only names real people's addresses Palm gave for the finance inbox", () => {
    const text = readFileSync(resolve(__dirname, "../../../../docs/fixtures/palm-golive-config.json"), "utf8");
    expect(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g)).toEqual(["accounts@palmlivingae.com"]);
  });

  it("leaves out what a profile leaves out", () => {
    expect(validateProfile({})).toEqual({});
    expect(validateProfile({ description: "x", quotations: { validityDays: 7 } })).toEqual({ quotations: { validityDays: 7 } });
  });

  it("lists every problem at once", () => {
    expect(problems({
      vehicle: [],
      factory: { productionSteps: ["Ready", "Scheduled"], permits: { missingAlertWorkingDays: 40 } },
      quotations: { validityDays: 0, qsPrices: "some" },
      firstResponse: { minutes: 60, warningMinutes: 60, workingCalendar: { days: ["mon", "funday"], start: "18:00", end: "09:00" } },
      financeRequests: { inbox: "not-an-email", paymentMethods: [{ name: "Card" }, { name: "card" }] },
      approvals: { payableRequest: { firstApproverRole: "finance", secondApproverRole: "owner" } },
      routes: [{ addStages: [{ name: "Permit", checks: ["confirm", "unknown_kind"] }] }],
      orderPaths: [{ enquiryType: "Furniture", path: "teleport", leadDays: { min: 5, max: 2 } }],
      clientUpdates: { mode: "letter", frequency: "weekly" },
    })).toEqual(expect.arrayContaining([
      expect.stringContaining("Unknown section \"vehicle\""),
      expect.stringContaining("factory.productionSteps: 2 to 4 steps"),
      expect.stringContaining("factory.permits.missingAlertWorkingDays is a whole number from 0 to 30"),
      expect.stringContaining("quotations.validityDays is a whole number from 1 to 365"),
      expect.stringContaining("quotations.qsPrices is one of all, rules"),
      expect.stringContaining("firstResponse.warningMinutes is less than minutes"),
      expect.stringContaining("firstResponse.workingCalendar.days"),
      expect.stringContaining("firstResponse.workingCalendar.end is after start"),
      expect.stringContaining("financeRequests.inbox is an email address"),
      expect.stringContaining("repeats \"card\""),
      expect.stringContaining("a second approver comes with its threshold amount"),
      expect.stringContaining("routes[0] names its route"),
      expect.stringContaining("goes \"before\" or \"after\""),
      expect.stringContaining("a confirm check is an object with its label"),
      expect.stringContaining("routes[0].addStages[0].checks[1] is one of"),
      expect.stringContaining("orderPaths[0].path is one of"),
      expect.stringContaining("orderPaths[0].leadDays.min is at most max"),
      expect.stringContaining("clientUpdates.mode is one of call, portal"),
    ]));
    expect(problems([])).toEqual(["The profile is a JSON object of sections."]);
  });
});

describe("route changes", () => {
  const template = { id: "t", name: "Standard", isDefault: true, version: 3, stages: DEFAULT_STAGES.filter((stage) => stage.key !== "permit") };
  const roles = DEFAULT_ROLES.map((role) => role.key);
  const change = { route: null, isDefault: true,
    addStages: [{ name: "Permit collection", key: "permit", ownerRole: "installation_lead", before: "Delivery and installation", checks: [{ kind: "permit_collected" as const }] }],
    addChecks: [{ stage: "Technical drawings", checks: [{ kind: "drawings_uploaded" as const }, { kind: "confirm" as const, label: "client approved the drawings" }] }] };

  it("adds a stage before the one named, and only the checks a stage lacks", () => {
    const plan = planRoute(template, change, roles);
    const keys = plan.stages.map((stage) => stage.key);
    expect(keys.indexOf("permit")).toBe(keys.indexOf("installation") - 1);
    expect(plan.stages.find((stage) => stage.key === "drawings")!.checks.map((check) => check.kind)).toEqual(["confirm", "drawings_uploaded"]);
    expect(plan.changes.map((entry) => entry.label)).toEqual(["Standard › Permit collection", "Standard › Permit collection: permit_collected", "Standard › Technical drawings: drawings_uploaded"]);
    expect(plan.same.map((entry) => entry.label)).toEqual(["Standard › Technical drawings: confirm \"client approved the drawings\""]);
    expect(template.stages.find((stage) => stage.key === "drawings")!.checks).toHaveLength(1);
  });

  it("changes nothing on a route that already has them", () => {
    const once = planRoute(template, change, roles);
    expect(planRoute({ ...template, stages: once.stages }, change, roles).changes).toEqual([]);
  });

  it("reports a stage it can't place", () => {
    const plan = planRoute(template, { ...change, addStages: [{ ...change.addStages[0], before: "Nowhere" }], addChecks: [{ stage: "Ghost", checks: [] }] }, roles);
    expect(plan.changes).toEqual([]);
    expect(plan.missing.map((entry) => entry.detail)).toEqual(["no stage \"Nowhere\" to put it before", "no stage with this name"]);
  });
});
