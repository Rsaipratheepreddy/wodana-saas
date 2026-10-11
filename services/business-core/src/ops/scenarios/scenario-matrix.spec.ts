import { describe, expect, it } from "vitest";
import { expandMatrix, FIXED_SCENARIOS, moduleCounts, outcomes, planScenarios, RECIPES, type MatrixContext } from "./scenario-matrix";
import { probeSql } from "./scenario-probes";
import { fictitiousMobile, regionAmount, regionFixture, regionPerson } from "./scenario-regions";
import { storyCatalog } from "./scenario-stories";

const context: MatrixContext = {
  enquiryTypes: [{ code: "full_fit_out", label: "Full Fit-Out" }, { code: "furniture_only", label: "Furniture Only" }, { code: "not_sure", label: "Not Sure Yet" }],
  pipelineStages: [{ code: "qualified", label: "New Opportunity" }, { code: "won", label: "Won" }],
  routeStages: [{ key: "kickoff", label: "Kickoff" }, { key: "procurement", label: "Procurement" }, { key: "handover", label: "Handover" }],
  members: [{ key: "owner", displayName: "Olivia Owner" }, { key: "sales", displayName: "Sam Sales" }],
};

describe("demo scenario matrix", () => {
  it("adds the organization's own enquiry types (not 'not sure', which has its own scenario), pipeline stages, route stages and members", () => {
    const keys = expandMatrix(context).map((spec) => spec.key);
    expect(keys).toEqual(expect.arrayContaining(["sales.enquiry_type.full_fit_out", "sales.enquiry_type.furniture_only", "sales.enquiry.not_sure",
      "sales.opportunity.qualified", "sales.opportunity.won", "project.stage.kickoff", "project.stage.procurement", "project.stage.handover", "my_day.owner", "my_day.sales"]));
    expect(keys).not.toContain("sales.enquiry_type.not_sure");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers every main scenario the product owner listed", () => {
    const keys = new Set(expandMatrix(context).map((spec) => spec.key));
    for (const key of ["sales.enquiry.lost", "sales.follow_up.today", "sales.follow_up.overdue", "design.stage.internal_review", "design.stage.client_review", "quote.with_qs",
      "quote.discount_pending", "quote.declined", "quote.expired", "quote.revision", "deal.waiting_finance", "project.on_hold", "project.completed", "project.at_risk",
      "project.over_budget", "change.draft", "change.pricing", "change.with_qs", "change.waiting_approval", "change.with_client", "change.applied", "change.declined", "po.late",
      "bill.overdue", "invoice.overdue", "receipt.pending", "ledger.on", "ledger.posted"]) expect(keys.has(key)).toBe(true);
  });

  it("groups the scenarios by module and gives each a recipe", () => {
    const matrix = expandMatrix(context);
    const modules = matrix.map((spec) => spec.module);
    expect(modules).toEqual([...modules].sort((a, b) => ["sales", "design", "quotations", "deals", "projects", "changes", "purchasing", "factory", "site", "finance", "ledger",
      "approvals", "my_day", "portal"].indexOf(a) - ["sales", "design", "quotations", "deals", "projects", "changes", "purchasing", "factory", "site", "finance", "ledger",
      "approvals", "my_day", "portal"].indexOf(b)));
    for (const spec of matrix) expect(RECIPES).toContain(spec.recipe);
  });

  it("plans only the recipes of what is missing, in run order, each once; nothing when everything is there", () => {
    const matrix = expandMatrix(context).filter((spec) => spec.pass === 1);
    const all = new Map(matrix.map((spec) => [spec.key, `ref ${spec.key}`]));
    expect(planScenarios(matrix, all)).toMatchObject({ missing: [], recipes: [] });
    const some = new Map(all);
    some.delete("change.declined");
    some.delete("ledger.posted");
    some.delete("sales.enquiry.new");
    some.delete("change.draft");
    const plan = planScenarios(matrix, some);
    expect(plan.missing.map((spec) => spec.key).sort()).toEqual(["change.declined", "change.draft", "ledger.posted", "sales.enquiry.new"]);
    expect(plan.recipes).toEqual(["enquiries", "changes", "ledger"]);
    expect(plan.present).toHaveLength(matrix.length - 4);
  });

  it("reports each scenario: already there, created now, would create (dry run), or skipped with the reason", () => {
    const matrix = FIXED_SCENARIOS.filter((spec) => ["quote.draft", "quote.expired", "change.with_qs", "ledger.on"].includes(spec.key));
    const before = new Map([["quote.draft", "Q v1"]]);
    const after = new Map([["quote.draft", "Q v1"], ["ledger.on", "Studio · AE"]]);
    const rows = outcomes(matrix, before, after, { apply: true, reasons: new Map([["changes", "no running project"]]), notes: new Map([["quote.expired", "time"]]) });
    expect(rows.map((row) => [row.spec.key, row.status, row.reference, row.reason])).toEqual([
      ["quote.draft", "already there", "Q v1", undefined],
      ["quote.expired", "skipped", null, "time"],
      ["change.with_qs", "skipped", null, "no running project"],
      ["ledger.on", "created", "Studio · AE", undefined],
    ]);
    expect(outcomes(matrix, before, before, { apply: false, reasons: new Map() }).map((row) => row.status)).toEqual(["already there", "would create", "would create", "would create"]);
    expect(moduleCounts(rows)).toMatchObject({ quotations: { scenarios: 2, alreadyThere: 1, skipped: 1 }, ledger: { created: 1 } });
  });

  it("has a probe for every scenario of this pass, never naming a tenant", () => {
    for (const spec of expandMatrix(context).filter((row) => row.pass === 1)) {
      const sql = probeSql(spec);
      expect(sql, spec.key).toBeTruthy();
      expect(sql).toContain("$1");
      expect(sql!.toLowerCase()).not.toMatch(/palm|igolo|dubai|aed|inr/);
    }
  });
});

describe("demo scenario regions", () => {
  it("gives each region its own people and places, fictional addresses and numbers in the region's numbering plan", () => {
    const india = regionPerson(regionFixture("IN"), 7, "IN");
    expect(india.email).toMatch(/@example\.com$/);
    expect(india.mobile.startsWith("+91")).toBe(true);
    expect(["Maharashtra", "Karnataka", "Telangana", "Tamil Nadu", "Haryana", "Delhi", "West Bengal", "Gujarat"]).toContain(india.place.region);
    const uae = regionPerson(regionFixture("ae"), 7, "AE");
    expect(uae.mobile.startsWith("+971")).toBe(true);
    expect(regionFixture("SG").code).toBe("*");
    expect(fictitiousMobile("AE", 3)).not.toBe(fictitiousMobile("AE", 4));
    const people = new Set(Array.from({ length: 60 }, (_, n) => regionPerson(regionFixture("IN"), n, "IN").email));
    expect(people.size).toBe(60);
  });

  it("scales money exactly into the region's currency", () => {
    expect(regionAmount(regionFixture("IN"), "14500")).toBe("290000.00");
    expect(regionAmount(regionFixture("AE"), "14500")).toBe("14500.00");
    expect(regionAmount(regionFixture("IN"), "0.35")).toBe("7.00");
  });

  it("tells one story per route stage, each with its own client", () => {
    const stories = storyCatalog({ fixture: regionFixture("IN"), country: "IN", regionId: () => "maharashtra", routeStages: ["kickoff", "procurement", "handover"] });
    expect([...stories.keys()]).toEqual(expect.arrayContaining(["stage-kickoff", "stage-procurement", "stage-handover", "project-completed", "quote-qs", "deal-finance"]));
    const clients = [...stories.values()].map((story) => story.client.mobile);
    expect(new Set(clients).size).toBe(clients.length);
    expect([...stories.values()].every((story) => story.lines.every((line) => !line.rate.includes("e")))).toBe(true);
  });
});
