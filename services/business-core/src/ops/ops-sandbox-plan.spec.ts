import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateProfile } from "./ops-profile";
import {
  parseCrmFile, parseTeamsFile, planMembers, SANDBOX_PERSONAS, sandboxEmail, sandboxLegalEntityCode, sandboxProfile, sandboxSeatLimit, scrubForSandbox, SandboxFileError,
} from "./ops-sandbox-plan";

const docs = resolve(__dirname, "../../../../docs/fixtures");
const json = (name: string) => JSON.parse(readFileSync(resolve(docs, name), "utf8")) as unknown;
const KIT_ROLES = new Set(["owner", "administrator", "member", "viewer", "sales", "quantity_surveyor", "finance_reviewer", "operations_approver", "project_manager",
  "site_supervisor", "buyer", "purchasing_approver", "storekeeper", "factory_lead", "qc_inspector", "finance", "finance_approver"]);

describe("sandbox members", () => {
  it("is one member per role at <role>@<slug>.test, each with a distinct name", () => {
    const keys = SANDBOX_PERSONAS.map((persona) => persona.key);
    expect(keys).toEqual(["owner", "manager", "sales", "designer", "design-manager", "qs", "purchasing", "factory", "logistics", "site", "finance", "accountant"]);
    expect(new Set(SANDBOX_PERSONAS.map((persona) => persona.displayName)).size).toBe(keys.length);
    expect(sandboxEmail("owner", "iglo")).toBe("owner@iglo.test");
    expect(SANDBOX_PERSONAS.find((persona) => persona.key === "sales")?.displayName).toBe("Sam Sales");
    expect(SANDBOX_PERSONAS[0].displayName).toBe("Olivia Owner");
  });

  it("maps each member to the kit's roles and to the team that holds their work's permission (Palm's teams file)", () => {
    const plan = planMembers("iglo", KIT_ROLES, parseTeamsFile(json("palm-teams-access.json")));
    const by = Object.fromEntries(plan.map((member) => [member.key, { roles: member.roleCodes, teams: member.teamCodes }]));
    expect(by).toEqual({
      owner: { roles: ["owner"], teams: [] },
      manager: { roles: ["administrator", "project_manager", "operations_approver"], teams: ["OPS_ADMIN", "PROJECT_MANAGERS"] },
      sales: { roles: ["sales"], teams: ["SALES"] },
      designer: { roles: [], teams: ["INTERIOR_DESIGN"] },
      "design-manager": { roles: [], teams: ["CREATIVE_DIRECTOR"] },
      qs: { roles: ["quantity_surveyor"], teams: ["QS"] },
      purchasing: { roles: ["buyer"], teams: ["PROCUREMENT"] },
      factory: { roles: ["factory_lead"], teams: ["PRODUCTION_LEAD"] },
      logistics: { roles: [], teams: ["PRODUCTION"] },
      site: { roles: ["site_supervisor"], teams: [] },
      finance: { roles: ["finance"], teams: ["FINANCE"] },
      accountant: { roles: ["finance_approver"], teams: ["FINANCE"] },
    });
    expect(plan.every((member) => member.missingRoles.length === 0)).toBe(true);
  });

  it("without teams, gives the kit's roles, and the member role to someone the kit has no role for", () => {
    const plan = planMembers("studio-2", new Set(["owner", "administrator", "member", "sales"]), []);
    expect(plan.find((member) => member.key === "designer")).toMatchObject({ roleCodes: ["member"], teamCodes: [], email: "designer@studio-2.test" });
    expect(plan.find((member) => member.key === "qs")).toMatchObject({ roleCodes: ["member"], missingRoles: ["quantity_surveyor"] });
    expect(plan.find((member) => member.key === "manager")).toMatchObject({ roleCodes: ["administrator"], missingRoles: ["project_manager", "operations_approver"] });
  });

  it("names the company after the slug and leaves seats to spare", () => {
    expect(sandboxLegalEntityCode("iglo")).toBe("IGLO");
    expect(sandboxLegalEntityCode("test-studio-2")).toBe("TEST-STUDIO-2");
    expect(sandboxLegalEntityCode("a".repeat(40))).toHaveLength(24);
    expect(sandboxSeatLimit(5)).toBe(SANDBOX_PERSONAS.length + 10);
    expect(sandboxSeatLimit(100)).toBe(100);
  });
});

describe("what never reaches a sandbox", () => {
  it("takes Palm's finance inbox out of its go-live profile, leaves the inbox empty, and keeps the rest valid", () => {
    const raw = json("palm-golive-config.json");
    const { profile, dropped } = sandboxProfile(raw);
    expect(dropped).toEqual([{ path: "financeRequests.inbox", reason: "an email address" }]);
    expect(JSON.stringify(profile)).not.toContain("@");
    const valid = validateProfile(profile);
    expect(valid.financeRequests?.inbox).toBeNull();
    expect(valid.financeRequests?.paymentMethods).toHaveLength(3);
    expect(valid.vehicles).toHaveLength(9);
    expect(valid.routes).toHaveLength(1);
  });

  it("drops integration settings, credentials, web addresses, phone numbers and bank accounts anywhere, and lists each", () => {
    const { value, dropped } = scrubForSandbox({
      description: "Mail ops@realfirm.com",
      _note: "call +971 4 123 4567",
      shopify: { store: "realfirm" },
      factory: { clientPaymentReminderDays: 7, webhookUrl: "https://hooks.example.org/x", apiKey: "k-123" },
      financeRequests: { inbox: "accounts@realfirm.ae", paymentMethods: [
        { name: "Bank transfer", guidance: "Pay to AE07 0331 2345 6789 0123 456" },
        { name: "Card", guidance: "Call +971501234567 for a link" },
        { name: "Stripe", guidance: "See www.realfirm.ae/pay" },
        { name: "Cash", guidance: "At the showroom" },
      ] },
      quotations: { qsWorkPackages: ["Joinery", "Ask sales@realfirm.ae"] },
      tests: { contact: "finance@iglo.test", other: "someone@example.com" },
      routes: [{ default: true, addStages: [{ name: "Permit collection", key: "permit", before: "Delivery and installation" }] }],
    });
    expect(dropped).toEqual([
      { path: "shopify", reason: "an integration or contact setting" },
      { path: "factory.webhookUrl", reason: "an integration or contact setting" },
      { path: "factory.apiKey", reason: "an integration or contact setting" },
      { path: "financeRequests.inbox", reason: "an email address" },
      { path: "financeRequests.paymentMethods[0].guidance", reason: "a bank account number" },
      { path: "financeRequests.paymentMethods[1].guidance", reason: "a phone number" },
      { path: "financeRequests.paymentMethods[2].guidance", reason: "a web address" },
      { path: "quotations.qsWorkPackages[1]", reason: "an email address" },
    ]);
    expect(value).toEqual({
      factory: { clientPaymentReminderDays: 7 },
      financeRequests: { paymentMethods: [{ name: "Bank transfer" }, { name: "Card" }, { name: "Stripe" }, { name: "Cash", guidance: "At the showroom" }] },
      quotations: { qsWorkPackages: ["Joinery"] },
      tests: { contact: "finance@iglo.test", other: "someone@example.com" },
      routes: [{ default: true, addStages: [{ name: "Permit collection", key: "permit", before: "Delivery and installation" }] }],
    });
  });

  it("reads a CRM intake profile's lead options as taxonomies, and nothing else from it", () => {
    const taxonomies = parseCrmFile(json("palm-crm-intake-profile.json"));
    const codes = taxonomies.map((taxonomy) => taxonomy.code);
    expect(codes[0]).toBe("lead_source");
    expect(codes).toEqual(expect.arrayContaining(["enquiry_type", "budget_range", "customer_type", "referral_partner", "lead_channel_self_generated"]));
    expect(codes).not.toContain("referral_broker"); // an empty list is left out
    expect(taxonomies.find((taxonomy) => taxonomy.code === "enquiry_type")?.options.map((option) => option.code))
      .toEqual(["renovation_fit_out", "full_fit_out", "interior_design", "interior_design_furniture", "furniture_only", "concepts_early_ideas", "architecture_odg", "not_sure"]);
    expect(taxonomies[0].options.find((option) => option.code === "self_generated")).toEqual({ code: "self_generated", label: "Self Generated", teams: ["SALES", "SALES_ADMIN", "OPS_ADMIN"] });
    expect(JSON.stringify(taxonomies)).not.toMatch(/Asia\/Dubai|not_connected|queue/);
    expect(() => parseCrmFile({ sources: [{ code: "Web Site", label: "" }], channels: { other: [] }, enquiryTypes: [], budgetRanges: "x" }))
      .toThrow(/sources\[0\]\.code[\s\S]*channels\.other is not one of the sources[\s\S]*budgetRanges is a list/);
  });

  it("reads a teams file and refuses a malformed one with every problem", () => {
    const teams = parseTeamsFile(json("palm-teams-access.json"));
    expect(teams.map((team) => team.code)).toContain("OPS_ADMIN");
    expect(teams.find((team) => team.code === "OPS_ADMIN")?.permissions).toEqual(["*"]);
    expect(() => parseTeamsFile([])).toThrow(SandboxFileError);
    expect(() => parseTeamsFile({ teams: [] })).toThrow("lists no teams");
    expect(() => parseTeamsFile({ teams: [{ code: "x", name: "A", permissions: ["Bad Code"] }, { code: "SALES", name: "Sales", permissions: [] }, { code: "sales", name: "Sales again", permissions: [] }] }))
      .toThrow(/teams\[0\]\.code[\s\S]*teams\[2\]\.code repeats SALES/);
  });
});
