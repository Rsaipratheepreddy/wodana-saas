import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { APPROVAL_PERMISSIONS, ROLE_TEMPLATES, ROLE_TEMPLATE_CODES, parseRoleTemplateCodes, roleTemplatesFor } from "./role-templates";

/** Every permission code the migrations seed (the catalog is data, not a TypeScript constant). */
const migrationsDir = resolve(__dirname, "../../drizzle");
const seededPermissionCodes = new Set(
  readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .flatMap((file) => [...readFileSync(resolve(migrationsDir, file), "utf8").matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)].map((match) => match[1])),
);
const kitMigration = readFileSync(resolve(migrationsDir, "0130_firm_kit_role_templates.sql"), "utf8");
const teamMigration = readFileSync(resolve(migrationsDir, "0141_team_approvers.sql"), "utf8");
const FIRST_KIT = ["sales", "quantity_surveyor", "finance_reviewer", "operations_approver", "project_manager", "site_supervisor"];
const TEAM = ["finance", "finance_approver", "buyer", "purchasing_approver", "factory_lead", "qc_inspector", "storekeeper"];

describe("firm kit role templates", () => {
  it("gives a firm the people it employs, each with a permission set the catalog knows", () => {
    expect([...ROLE_TEMPLATE_CODES].sort()).toEqual([...FIRST_KIT, ...TEAM].sort());
    for (const template of ROLE_TEMPLATES) {
      expect(template.permissions.length).toBeGreaterThan(0);
      expect(new Set(template.permissions).size).toBe(template.permissions.length);
      for (const code of template.permissions) expect(seededPermissionCodes, `${template.code}: ${code}`).toContain(code);
    }
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

  it("is what the kit migrations hand every selectable kit", () => {
    for (const code of FIRST_KIT) expect(kitMigration).toContain(`'${code}'`);
    for (const code of TEAM) expect(teamMigration).toContain(`'${code}'`);
    expect(kitMigration).toMatch(/code = 'interior_studio'[\s\S]*NOT \(configuration \? 'roleTemplates'\)/);
    expect(kitMigration).not.toMatch(/interior_studio[^;]*site_supervisor/);
  });

  it("gives existing workspaces the same team roles the templates define (names and permissions in step)", () => {
    const rows = [...teamMigration.matchAll(/\('([a-z_]+)', '([^']+)', '(?:[^']|'')+',\s*ARRAY\[([^\]]+)\], (true|false)\)/g)];
    expect(rows.map((row) => row[1]).sort()).toEqual([...TEAM].sort());
    for (const [, code, name, permissions, studio] of rows) {
      const template = ROLE_TEMPLATES.find((item) => item.code === code);
      expect(template?.name, code).toBe(name);
      expect(permissions.split(",").map((part) => part.trim().replace(/'/g, "")).sort(), code).toEqual([...(template?.permissions ?? [])].sort());
      // A design studio gets the finance roles only; no factory, buying or stores.
      expect(studio === "true", code).toBe(code.startsWith("finance"));
    }
  });

  it("lets the named team act, not only the Owner", () => {
    const [sales, finance, financeApprover, buyer, purchasingApprover, factoryLead, qc, storekeeper] =
      roleTemplatesFor(["sales", "finance", "finance_approver", "buyer", "purchasing_approver", "factory_lead", "qc_inspector", "storekeeper"]);
    // Sales sends its own quotes: it names the client's decision-maker, without managing the portal.
    expect(sales.permissions).toContain("portal.contacts.manage");
    expect(sales.permissions).not.toContain("portal.manage");
    expect(finance.permissions).toEqual(expect.arrayContaining(["payables.manage", "receivables.manage", "accounting.manage", "commercial.finance.verify", "commercial.costs.view"]));
    expect(finance.permissions).not.toContain("payables.approve");
    expect(financeApprover.permissions).toContain("payables.approve");
    // Whoever raises an order never approves it by template: separate people.
    expect(buyer.permissions).toContain("purchasing.manage");
    expect(buyer.permissions).not.toContain("purchasing.approve");
    expect(purchasingApprover.permissions).toEqual(expect.arrayContaining(["purchasing.approve", "vendors.approve", "stock.adjust", "projects.funds_override"]));
    expect(factoryLead.permissions).toEqual(expect.arrayContaining(["factory.manage", "factory.approve"]));
    expect(qc.permissions).toEqual(expect.arrayContaining(["factory.approve", "stock.inspect"]));
    expect(storekeeper.permissions).not.toContain("stock.adjust");
  });

  it("hands every delivery and finance approval to a template, not only the Owner", () => {
    const granted = new Set(ROLE_TEMPLATES.flatMap((template) => template.permissions));
    for (const code of APPROVAL_PERMISSIONS) expect(seededPermissionCodes, code).toContain(code);
    for (const code of ["purchasing.approve", "factory.approve", "stock.adjust", "vendors.approve", "payables.approve", "projects.funds_override",
      "commercial.estimate", "commercial.finance.verify", "commercial.deal.approve"])
      expect(granted, code).toContain(code);
  });
});
