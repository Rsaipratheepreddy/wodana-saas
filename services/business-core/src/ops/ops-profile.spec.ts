import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, DEFAULT_STAGES } from "../project-core/project-checks";
import { planRoute, questionListText } from "./ops-configure";
import { packagesAgainstProfile, ProfileError, validatePackagesFile, validateProfile } from "./ops-profile";

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
    // PLM-150: two design inspections on joinery and bespoke furniture; the Creative Director inspects on its own package's projects.
    expect(palm.factory?.inspections).toEqual({ enabled: true, stages: [{ kind: "raw", label: "Inspection 1 (raw material)" }, { kind: "final", label: "Inspection 2 (finished)" }],
      trades: ["Joinery", "Bespoke furniture"], inspectorRole: "designer", directorRole: "creative_director", directorPackages: ["creative_director"], workingDays: undefined });
    expect(palm.quotations).toMatchObject({ validityDays: 7, qsReview: true, qsPrices: "rules", qsWorkPackages: ["Joinery", "Bespoke furniture"] });
    expect(palm.firstResponse).toEqual({ minutes: 60, workingCalendar: { days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "18:00" } });
    expect(palm.financeRequests?.inbox).toBe("accounts@palmlivingae.com");
    expect(palm.financeRequests?.paymentMethods?.map((method) => [method.name, method.refundDays])).toEqual([["Bank transfer / card", null], ["Stripe", null], ["Tabby", null]]);
    expect(palm.approvals?.payableRequest).toEqual({ firstApproverRole: "finance", secondApproverRole: null, thresholdAmount: null });
    expect(palm.design).toMatchObject({ renderInternalDays: 35, renderClientDays: 56, revisionsIncluded: 2 });
    // The design order of 13 Oct 2026 (PLM-140–144, PLM-151): the step days, the design team's roles and the team roles they need.
    expect(palm.design?.steps).toEqual({ allocationDays: 1, kickoffDays: 5, conceptDays: 7, siteMeasureDays: 3, developmentMinDays: 14, developmentMaxDays: 56, developmentDaysPerRoom: 7,
      sampleCollectionDays: 7, sampleMeetingDays: 7, conceptOptionsMax: 2 });
    expect(palm.design?.team).toMatchObject({ lead_designer: "designer", junior_designer: "junior_designer", technicalLeadRoleCode: "technical_lead" });
    expect(palm.design?.projectRoles?.map((role) => role.key)).toEqual(["designer", "junior_designer", "sales_admin", "visualiser", "draftsman", "material_coordinator", "creative_director"]);
    // PLM-146/148/156/157: the finishes schedule's categories (the client signs sanitary ware and whitegoods), the final-specification gate and the material column's editors.
    expect(palm.finishes).toMatchObject({ specificationGate: true, finishesToQsDays: 3, materialEditors: ["lead_designer", "junior_designer", "sales_admin"] });
    expect(palm.finishes?.categories?.filter((category) => category.clientSignature).map((category) => category.key)).toEqual(["whitegoods", "sanitary_ware"]);
    expect(palm.finishes?.priceBands?.map((band) => band.label)).toEqual(["Entry", "Mid range", "Premium", "Luxury"]);
    expect(palm.clientUpdates).toEqual({ mode: "call", frequency: "weekly" });
    // PLM-170: the client BOQ on, for fit-out, ID & furniture, renovation and bespoke joinery jobs.
    expect(palm.clientPortal).toEqual({ sections: { boq: true }, boqEnquiryTypes: ["full_fit_out", "interior_design_furniture", "renovation_fit_out", "bespoke"] });
    expect(problems({ clientPortal: { sections: { boq: "yes", nope: true }, boqEnquiryTypes: "full_fit_out" } })).toEqual([
      "clientPortal.sections has unknown keys: nope.", "clientPortal.sections.boq is true or false.", "clientPortal.boqEnquiryTypes is a list.",
    ]);
    expect(palm.catalogCategories).toEqual([{ catalog: "Palm Living Core Collection", merge: [{ from: "BED & MATTRESS", into: "Beds & Mattress" }], deleteEmpty: [],
      deleteEmptyDuplicates: true, rename: [{ from: "DINING CHAIRS", to: "Dining Chairs" }, { from: "LOUNGE CHAIRS", to: "Lounge Chairs" }],
      parent: [{ category: "Dining Chairs", parent: "Chairs" }, { category: "Lounge Chairs", parent: "Chairs" }] }]);
    expect(validateProfile(json("fixtures/sample-profile.json")).orderPaths).toHaveLength(2);
  });

  it("only names real people's addresses Palm gave for the finance inbox", () => {
    const text = readFileSync(resolve(__dirname, "../../../../docs/fixtures/palm-golive-config.json"), "utf8");
    expect(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g)).toEqual(["accounts@palmlivingae.com"]);
  });

  it("checks the design steps, the design team's roles and the team roles (PLM-140–144, PLM-151)", () => {
    expect(problems({ design: { steps: { kickoffDays: 0, developmentMinDays: 30, developmentMaxDays: 10, conceptOptionsMax: 20, other: 1 }, team: { lead_designer: null, junior_designer: "Junior Designer" },
      projectRoles: [{ key: "Lead", label: "Lead" }] } })).toEqual([
      "design.steps has unknown keys: other.", "design.steps.kickoffDays is a whole number from 1 to 365.", "design.steps.conceptOptionsMax is a whole number from 1 to 12.",
      "design.steps.developmentMaxDays is at least developmentMinDays.", "design.team.lead_designer names a role.", "design.team.junior_designer is a role key like junior_designer.",
      "design.projectRoles[0].key is a role key like junior_designer."]);
    expect(validateProfile({ design: { steps: { developmentDaysPerRoom: 0, conceptOptionsMax: null }, team: { sales_admin: null } } }).design)
      .toEqual({ steps: { developmentDaysPerRoom: 0, conceptOptionsMax: null }, team: { sales_admin: null } });
  });

  it("leaves out what a profile leaves out", () => {
    expect(validateProfile({})).toEqual({});
    expect(validateProfile({ description: "x", quotations: { validityDays: 7 } })).toEqual({ quotations: { validityDays: 7 } });
  });

  it("lists every problem at once", () => {
    expect(problems({
      vehicle: [],
      factory: { productionSteps: ["Ready", "Scheduled"], permits: { missingAlertWorkingDays: 40 }, inspections: { stages: [{ kind: "final" }, { kind: "raw" }], inspectorRole: "Lead Designer", workingDays: 0 } },
      quotations: { validityDays: 0, qsPrices: "some" },
      firstResponse: { minutes: 60, warningMinutes: 60, workingCalendar: { days: ["mon", "funday"], start: "18:00", end: "09:00" } },
      financeRequests: { inbox: "not-an-email", paymentMethods: [{ name: "Card" }, { name: "card" }] },
      approvals: { payableRequest: { firstApproverRole: "finance", secondApproverRole: "owner" } },
      routes: [{ addStages: [{ name: "Permit", checks: ["confirm", "unknown_kind"] }] }],
      orderPaths: [{ enquiryType: "Furniture", path: "teleport", leadDays: { min: 5, max: 2 } }],
      clientUpdates: { mode: "letter", frequency: "weekly" },
      catalogCategories: [{ catalog: "Core", merge: [{ from: "Beds", into: "beds" }], parent: [{ category: "Chairs", parent: "chairs" }], rename: [{ from: "X" }] }, { catalog: "Empty" }],
    })).toEqual(expect.arrayContaining([
      expect.stringContaining("Unknown section \"vehicle\""),
      expect.stringContaining("factory.productionSteps: 2 to 4 steps"),
      expect.stringContaining("factory.permits.missingAlertWorkingDays is a whole number from 0 to 30"),
      expect.stringContaining("factory.inspections.stages: one or two of raw"),
      expect.stringContaining("factory.inspections.inspectorRole is a project role key"),
      expect.stringContaining("factory.inspections.workingDays is a whole number from 1 to 30"),
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
      expect.stringContaining("catalogCategories[0].merge: Beds merges into another category"),
      expect.stringContaining("catalogCategories[0].parent[0]: a category can't sit under itself"),
      expect.stringContaining("catalogCategories[0].rename[0].to is non-empty text"),
      expect.stringContaining("catalogCategories[1] has nothing to do"),
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

  it("PLM-149: takes the site check off, puts the measure first and the design check before the client's approval", () => {
    const palm = { ...template, stages: template.stages.map((stage) => stage.key === "drawings"
      ? { ...stage, checks: [...stage.checks, { key: "u", kind: "drawings_uploaded" as const }, { key: "s", kind: "drawings_site_checked" as const },
        { key: "a", kind: "drawings_client_approved" as const }, { key: "f", kind: "factory_slot_booked" as const }] } : stage) };
    const swap = { route: null, isDefault: true, addStages: [],
      addChecks: [{ stage: "Technical drawings", checks: (["technical_measure_done", "drawings_uploaded", "drawings_design_checked", "drawings_client_approved", "factory_slot_booked"] as const)
        .map((kind) => ({ kind })) }],
      removeChecks: [{ stage: "Technical drawings", checks: [{ kind: "drawings_site_checked" as const }, { kind: "confirm" as const, label: "Client approved the drawings" }] }] };
    const plan = planRoute(palm, swap, roles);
    expect(plan.stages.find((stage) => stage.key === "drawings")!.checks.map((check) => check.kind))
      .toEqual(["technical_measure_done", "drawings_uploaded", "drawings_design_checked", "drawings_client_approved", "factory_slot_booked"]);
    expect(plan.changes.map((entry) => entry.detail)).toEqual(["check removed", "check removed", "check added", "check added"]);
    expect(planRoute({ ...palm, stages: plan.stages }, swap, roles).changes).toEqual([]);
    expect(validateProfile(json("../../../../docs/fixtures/palm-golive-config.json")).projects).toEqual({ drawingsClientRole: "designer", technicalMeasureDays: 5 });
    expect(problems({ projects: { drawingsClientRole: "Lead Designer", technicalMeasureDays: 0 } })).toEqual([
      "projects.drawingsClientRole is a project role key like designer, or null.", "projects.technicalMeasureDays is a whole number from 1 to 60."]);
  });

  it("refuses finishes it can't apply, in words (PLM-146/148/156/157)", () => {
    expect(problems({ finishes: { categories: [{ key: "Sanitary", label: "Sanitary" }, { key: "tiles", label: "Tiles", clientSignature: "yes" }, { key: "tiles", label: "Again" }],
      finishesToQsDays: 0, materialEditors: ["qs"], priceBands: [{ label: "Odd", minAmount: 100, maxAmount: "50" }, { label: "Wrong", minAmount: "300", maxAmount: "100" }], extra: 1 } })).toEqual([
      "finishes has unknown keys: extra.",
      "finishes.categories[0].key is a key like sanitary_ware.",
      "finishes.categories[1].clientSignature is true or false.",
      "finishes.categories[2].key tiles is in the list twice.",
      "finishes.finishesToQsDays is a whole number from 1 to 60.",
      "finishes.materialEditors names parts of the design team (lead_designer, junior_designer, sales_admin, visualiser, draftsman, material_coordinator).",
      "finishes.priceBands[0].minAmount is an amount as text, like \"250\" or \"99.50\".",
      "finishes.priceBands[1].maxAmount is at least minAmount.",
    ]);
    expect(validateProfile({ finishes: { specificationGate: false } }).finishes).toEqual({ specificationGate: false });
  });

  it("reads the inbox closing messages, the timeline teams and the enquiry requirements (PLM-137, PLM-155)", () => {
    const palm = validateProfile(json("../../../../docs/fixtures/palm-golive-config.json"));
    expect(palm.inbox?.closingAfterHours).toBe(3);
    expect(Object.keys(palm.inbox?.closingMessages ?? {})).toEqual(["received", "form", "closing"]);
    expect(palm.inbox?.closingMessages?.form).toContain("{{form_link}}");
    expect(palm.sales).toEqual({ timelineCheckTeams: ["INTERIOR_DESIGN", "PRODUCTION", "PRODUCTION_LEAD"], assignmentMode: "round_robin", unassignAfterWorkingDay: true });
    expect(palm.enquiryRequirements).toEqual([{ field: "area", requiredAt: "book_intro" }, { field: "targetCompletion", requiredAt: "book_intro" }]);
    expect(palm.rolePermissions).toContainEqual({ roles: ["team_sales_admin"], permissions: ["crm.inbox.team", "crm.inbox.close_chats"] });
    expect(validateProfile({ inbox: { closingMessages: { received: null } } })).toEqual({ inbox: { closingMessages: { received: null } } });
    expect(problems({ inbox: { closingMessages: { closing: "Hi {{client}}" }, closingFormUrl: "palm.example/form", closingAfterHours: 0 },
      sales: { timelineCheckTeams: ["Interior design"], assignmentMode: "lightest", unassignAfterWorkingDay: "yes" }, enquiryRequirements: [{ field: "area", requiredAt: "later" }] })).toEqual([
      "inbox.closingMessages.closing can fill {{name}} and {{form_link}} only.", "inbox.closingFormUrl is a full https:// link, or null.",
      "inbox.closingAfterHours is a whole number from 1 to 72.", "sales.timelineCheckTeams are team codes like INTERIOR_DESIGN.",
      "sales.assignmentMode is one of balanced, round_robin.", "sales.unassignAfterWorkingDay is true or false.", "enquiryRequirements[0].requiredAt is one of create, convert, book_intro."]);
  });

  it("reads Palm's design packages file (PLM-139, PLM-145): Concept per space, the Creative Director package priced from its rate and reviewed", () => {
    const file = validatePackagesFile(json("../../../../docs/fixtures/palm-design-packages.json"));
    expect(file.minimumDeposit).toEqual({ amount: "15000.00", currency: "AED" });
    expect(file.packages.map((entry) => entry.code)).toEqual(["concept", "bespoke", "creative_director"]);
    expect(file.packages[0]).toMatchObject({ pricingMethod: "per_space", rate: "10000.00", unitDefinition: "1 space = 1 room with a door" });
    expect(file.packages[2]).toMatchObject({ pricingMethod: "per_area", areaUnit: "sqft", rate: "100.00", rateFrom: true, reviewRoleCode: "creative_director" });
    // A field the file leaves out stays out (it takes the product's default when applied: the Creative Director package no longer requires its designer's role).
    expect("reviewRoleCode" in file.packages[0]).toBe(false);
    expect("requiredRoleCode" in file.packages[2]).toBe(false);
    expect(validatePackagesFile({ packages: [{ code: "Basic", name: "Basic", pricingMethod: "fixed", rate: "500" }] })).toEqual({ packages: [{ code: "basic", name: "Basic", pricingMethod: "fixed", rate: "500" }] });
    expect(validatePackagesFile({ minimumDeposit: null, packages: [{ code: "basic", name: "Basic", pricingMethod: "fixed", rate: "500" }] }).minimumDeposit).toBeNull();
  });

  it("reads Palm's design questions file: the same packages, 31 discovery questions under 6 sections, 14 joinery checklists and the release record", () => {
    const file = validatePackagesFile(json("../../../../docs/fixtures/palm-design-questions.json"));
    const packages = validatePackagesFile(json("../../../../docs/fixtures/palm-design-packages.json"));
    expect(file.packages).toEqual(packages.packages);
    expect(file.minimumDeposit).toEqual(packages.minimumDeposit);
    const questions = file.siteVisitQuestions!;
    expect(questions.length).toBe(181);
    expect(questions[0]).toEqual({ key: "core.01", question: "What type of property or space is this, and where is it located?", section: "Project overview" });
    expect(questions.find((entry) => entry.key === "core.31")).toEqual({ key: "core.31", question: "Agreed next step and owner", section: "Decisions and next steps" });
    expect(questions.find((entry) => entry.key === "kitchen.01")).toEqual({ key: "kitchen.01", scope: "Kitchens and islands", kind: "check",
      question: "Confirm cooking habits, users, storage priorities and seating count; list all required cabinets and island functions." });
    const checklists = new Map<string, number>();
    for (const entry of questions.filter((item) => item.kind === "check")) checklists.set(entry.scope!, (checklists.get(entry.scope!) ?? 0) + 1);
    expect(checklists.size).toBe(15);
    expect([...checklists.values()].every((count) => count === 10)).toBe(true);
    expect(file.siteVisitScopes!.find((entry) => entry.scope === "Wardrobes and walk in closets")?.match).toEqual(["wardrobe", "closet", "walk-in", "dressing"]);
    expect(file.siteVisitScopes!.filter((entry) => entry.everyJob).map((entry) => entry.scope)).toEqual(["Factory release"]);
    expect(questionListText(questions, file.siteVisitScopes!)).toBe("31 general questions in 6 sections, 150 checks, 15 checklists (1 for every job), 14 with match words");
  });

  it("lists every problem of a question list at once", () => {
    const base = { packages: [{ code: "basic", name: "Basic", pricingMethod: "fixed", rate: "500" }] };
    const problemsOf = (raw: unknown) => { try { validatePackagesFile(raw); return []; } catch (error) { if (error instanceof ProfileError) return error.problems; throw error; } };
    expect(problemsOf({ ...base, siteVisitQuestions: [] })).toEqual(["siteVisitQuestions is a list of 1 to 300 questions."]);
    expect(problemsOf({ ...base, siteVisitScopes: [] })).toEqual(["siteVisitScopes goes with the siteVisitQuestions it describes."]);
    expect(problemsOf({ ...base, siteVisitQuestions: [
      { key: "Core 1", question: "Q?" }, { key: "a.1", question: " ", kind: "yes" }, { key: "a.2", question: "Q?", colour: 1, section: "x".repeat(61) },
      { key: "a.3", question: "Q?", scope: "Kitchen" }, { key: "a.3", question: "Again" },
    ], siteVisitScopes: [{ scope: "Kitchen", match: ["kitchen", 4] }, { scope: "kitchen", match: [] }, { scope: "Garage" }, { scope: "Kitchen", everyJob: "yes", extra: 1 }] })).toEqual([
      "siteVisitQuestions[0].key is a key of lowercase letters, digits, \".\", \"_\" or \"-\" (at most 60), e.g. kitchen.01.",
      "siteVisitQuestions[1].question is the question's text (at most 500 characters).", "siteVisitQuestions[1].kind is answer or check.",
      "siteVisitQuestions[2] has unknown keys: colour.", "siteVisitQuestions[2].section is a name of at most 60 characters (or null).",
      "siteVisitQuestions[4].key repeats a.3.",
      "siteVisitScopes[0].match is a list of at most 20 words or phrases (40 characters each).",
      "siteVisitScopes[2].scope Garage is not the scope of any question.",
      "siteVisitScopes[3] has unknown keys: extra.", "siteVisitScopes[3].scope repeats Kitchen.", "siteVisitScopes[3].everyJob is true or false.",
    ]);
  });

  it("lists every problem of a design packages file at once, with the app's own package rules", () => {
    const problemsOf = (raw: unknown) => { try { validatePackagesFile(raw); return []; } catch (error) { if (error instanceof ProfileError) return error.problems; throw error; } };
    expect(problemsOf([])).toEqual(["It is a JSON object with a list of packages (\"packages\")."]);
    expect(problemsOf({ packages: [] })).toEqual(["packages is a list of 1 to 50 packages."]);
    expect(problemsOf({ extra: 1, minimumDeposit: { amount: 15000 }, packages: [
      { code: "concept", pricingMethod: "per_room", rate: 10000, colour: "red" },
      { code: "area", name: "Area", pricingMethod: "per_area", rate: "40", rateFrom: "yes", includedRevisions: 30 },
      { code: "area2", name: "Area", pricingMethod: "per_area", rate: "40" },
      { code: "fixed", name: "Fixed", pricingMethod: "fixed", rate: "1.5", currency: "aed" },
      { code: "fixed2", name: "Fixed", pricingMethod: "fixed", rate: "1" }, { code: "FIXED2", name: "Again", pricingMethod: "fixed", rate: "1" },
    ] })).toEqual([
      "Unknown keys: extra.", "minimumDeposit.amount is an amount as text, e.g. \"15000.00\".",
      "packages[0] has unknown keys: colour.", "packages[0].name is required.", "packages[0].pricingMethod is per_space, per_area or fixed.",
      "packages[0].rate is an amount as text, e.g. \"40.00\" (never a number).",
      "packages[1].rateFrom is true or false.", "packages[1].includedRevisions is a whole number from 0 to 20.",
      "packages[2] (area2): Choose square feet or square metres.",
      "packages[3].currency is a currency code, e.g. EUR.",
      "packages[5].code repeats fixed2.",
    ]);
    expect(() => validatePackagesFile({ packages: [{}] })).toThrow("The design packages file is not valid");
  });

  it("refuses a packages file and a profile that would undo each other on every run", () => {
    const file = validatePackagesFile({ packages: [{ code: "concept", name: "Concept", pricingMethod: "fixed", rate: "1", includedRevisions: 3 },
      { code: "other", name: "Other", pricingMethod: "fixed", rate: "1" }] });
    expect(packagesAgainstProfile(file, null)).toEqual([]);
    expect(packagesAgainstProfile(file, { design: { renderInternalDays: 20 } })).toEqual([]);
    expect(packagesAgainstProfile(file, { design: { revisionsIncluded: 3, packages: ["concept"] } })).toEqual([]);
    expect(packagesAgainstProfile(file, { design: { revisionsIncluded: 2, packages: ["other"] } })).toEqual([]);
    // A package left without its revisions has the product's 2.
    expect(packagesAgainstProfile(file, { design: { revisionsIncluded: 3 } })).toEqual([
      "design package other includes 2 revisions in the packages file but the profile's design.revisionsIncluded is 3; make them the same."]);
    expect(packagesAgainstProfile(file, { design: { revisionsIncluded: 2 } })).toEqual([
      "design package concept includes 3 revisions in the packages file but the profile's design.revisionsIncluded is 2; make them the same."]);
    // Palm's two files agree.
    expect(packagesAgainstProfile(validatePackagesFile(json("../../../../docs/fixtures/palm-design-packages.json")),
      validateProfile(json("../../../../docs/fixtures/palm-golive-config.json")))).toEqual([]);
  });

  it("reports a stage it can't place", () => {
    const plan = planRoute(template, { ...change, addStages: [{ ...change.addStages[0], before: "Nowhere" }], addChecks: [{ stage: "Ghost", checks: [] }] }, roles);
    expect(plan.changes).toEqual([]);
    expect(plan.missing.map((entry) => entry.detail)).toEqual(["no stage \"Nowhere\" to put it before", "no stage with this name"]);
  });
});
