import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ROLE_TEMPLATES, ROLE_TEMPLATE_CODES, parseRoleTemplateCodes, roleTemplatesFor } from "./role-templates";

/** Every permission code the migrations seed (the catalog is data, not a TypeScript constant). */
const migrationsDir = resolve(__dirname, "../../drizzle");
const seededPermissionCodes = new Set(
  readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .flatMap((file) => [...readFileSync(resolve(migrationsDir, file), "utf8").matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)].map((match) => match[1])),
);
const kitMigration = readFileSync(resolve(migrationsDir, "0130_firm_kit_role_templates.sql"), "utf8");
const operationsMigration = readFileSync(resolve(migrationsDir, "0152_operations_v2.sql"), "utf8");
const DELIVERY_TEMPLATES = ["buyer", "purchasing_approver", "storekeeper", "factory_lead", "qc_inspector"];
const FINANCE_TEMPLATES = ["finance", "finance_approver"];

describe("firm kit role templates", () => {
  it("gives a firm the people it employs, each with a permission set the catalog knows", () => {
    expect(ROLE_TEMPLATE_CODES).toEqual(["sales", "quantity_surveyor", "finance_reviewer", "operations_approver", "project_manager", "site_supervisor",
      ...DELIVERY_TEMPLATES, ...FINANCE_TEMPLATES]);
    for (const template of ROLE_TEMPLATES) {
      expect(template.permissions.length).toBeGreaterThan(0);
      expect(new Set(template.permissions).size).toBe(template.permissions.length);
      for (const code of template.permissions) expect(seededPermissionCodes, `${template.code}: ${code}`).toContain(code);
    }
  });

  it("lets Sales send its own quotes: it names the client's decision-maker without managing the portal", () => {
    const sales = roleTemplatesFor(["sales"])[0];
    expect(sales.permissions).toContain("portal.contacts.manage");
    expect(sales.permissions).not.toContain("portal.manage");
    expect(readFileSync(resolve(migrationsDir, "0158_quote_to_deal_handoffs.sql"), "utf8")).toMatch(/role\.code = 'sales'[\s\S]*portal\.contacts\.manage/);
  });

  it("lets Sales run enquiries, the pipeline, planning cases and quotes without seeing costs", () => {
    const sales = roleTemplatesFor(["sales"])[0];
    expect(sales.permissions).toEqual(expect.arrayContaining([
      "crm.leads.view", "crm.leads.manage", "crm.opportunities.manage", "crm.opportunities.transition",
      "pre_projects.view", "pre_projects.create", "pre_projects.edit", "catalog.view",
    ]));
    expect(sales.permissions.filter((code) => code.startsWith("commercial.") || code === "crm.settings.manage" || code === "crm.privacy.erase")).toEqual([]);
  });

  it("keeps the estimator and finance reviewer as the seeded review roles", () => {
    expect(roleTemplatesFor(["quantity_surveyor"])[0].permissions).toEqual(["pre_projects.view", "crm.opportunities.view", "commercial.costs.view", "commercial.estimate"]);
    expect(roleTemplatesFor(["finance_reviewer"])[0].permissions).toEqual(["pre_projects.view", "crm.opportunities.view", "commercial.finance.verify", "payables.view", "receivables.view"]);
    expect(roleTemplatesFor(["project_manager"])[0].permissions).toEqual(expect.arrayContaining(["projects.manage", "projects.review", "projects.schedule.manage"]));
    expect(roleTemplatesFor(["site_supervisor"])[0].permissions).toEqual(expect.arrayContaining(["projects.report", "stock.receive", "hrms.team"]));
    expect(roleTemplatesFor(["site_supervisor"])[0].permissions).not.toContain("projects.manage");
  });

  it("reads the kit's list, defaults to every template and refuses unknown codes", () => {
    expect(parseRoleTemplateCodes(undefined)).toEqual([...ROLE_TEMPLATE_CODES]);
    expect(parseRoleTemplateCodes(null)).toEqual([...ROLE_TEMPLATE_CODES]);
    expect(parseRoleTemplateCodes(["sales", "sales", "project_manager"])).toEqual(["sales", "project_manager"]);
    expect(roleTemplatesFor(["project_manager", "sales"]).map((template) => template.code)).toEqual(["sales", "project_manager"]);
    expect(() => parseRoleTemplateCodes(["sales", "receptionist"])).toThrow(BadRequestException);
    expect(() => parseRoleTemplateCodes("sales")).toThrow(BadRequestException);
    expect(() => parseRoleTemplateCodes([1])).toThrow(BadRequestException);
  });

  it("gives delivery work to people other than the Owner: someone buys, someone else approves (D-1)", () => {
    const has = (code: string) => roleTemplatesFor([code])[0].permissions;
    expect(has("buyer")).toEqual(expect.arrayContaining(["purchasing.manage", "vendors.manage", "stock.receive"]));
    expect(has("buyer")).not.toContain("purchasing.approve");
    expect(has("purchasing_approver")).toEqual(expect.arrayContaining(["purchasing.approve", "vendors.approve"]));
    expect(has("purchasing_approver")).not.toContain("purchasing.manage");
    expect(has("storekeeper")).toEqual(expect.arrayContaining(["stock.manage", "stock.receive", "stock.adjust"]));
    expect(has("factory_lead")).toEqual(expect.arrayContaining(["factory.manage", "factory.approve", "factory.report"]));
    expect(has("qc_inspector")).toEqual(expect.arrayContaining(["factory.approve", "stock.inspect"]));
    expect(has("qc_inspector")).not.toContain("factory.report");
  });

  it("lets Finance do finance, and someone else approve it (D-2)", () => {
    const finance = roleTemplatesFor(["finance"])[0].permissions;
    expect(finance).toEqual(expect.arrayContaining(["payables.manage", "receivables.manage", "accounting.manage", "commercial.finance.verify", "commercial.costs.view"]));
    expect(finance).not.toContain("payables.approve");
    expect(roleTemplatesFor(["finance_approver"])[0].permissions).toContain("payables.approve");
    expect(roleTemplatesFor(["finance_reviewer"])[0].permissions.filter((code) => code.endsWith(".manage"))).toEqual([]);
  });

  it("seeds the new templates exactly as the code defines them, delivery ones only where a kit delivers projects", () => {
    for (const code of [...DELIVERY_TEMPLATES, ...FINANCE_TEMPLATES]) {
      const template = roleTemplatesFor([code])[0];
      const start = operationsMigration.indexOf(`('${code}', '${template.name}', '${template.description.replace(/'/g, "''")}', `);
      expect(start, code).toBeGreaterThan(-1);
      const row = operationsMigration.slice(start, operationsMigration.indexOf("])", start));
      expect(row.includes(", true,") || row.includes(", true\n"), code).toBe(DELIVERY_TEMPLATES.includes(code));
      expect([...row.slice(row.indexOf("ARRAY[")).matchAll(/'([a-z_.]+)'/g)].map((match) => match[1]), code).toEqual([...template.permissions]);
    }
  });

  it("is what the kit migration hands every selectable kit", () => {
    for (const code of ROLE_TEMPLATE_CODES) expect(`${kitMigration}\n${operationsMigration}`).toContain(`'${code}'`);
    expect(kitMigration).toMatch(/code = 'interior_studio'[\s\S]*NOT \(configuration \? 'roleTemplates'\)/);
    expect(kitMigration).not.toMatch(/interior_studio[^;]*site_supervisor/);
  });
});
