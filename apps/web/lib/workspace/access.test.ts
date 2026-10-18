import { describe, expect, it } from "vitest";
import { workspaceModules } from "@/components/workspace/workspace-navigation";
import { accessRuleForPath, canOpen, meetsRule } from "./access";
import { scopeWorkspaceNavigation } from "./module-rollout";

// The seeded roles as the business service reports them in /me.
const sales = ["catalog.view", "crm.activities.manage", "crm.activities.view", "crm.communications.send", "crm.communications.view", "crm.leads.assign", "crm.leads.manage", "crm.leads.view", "crm.notifications.view", "crm.opportunities.manage", "crm.opportunities.sensitive_values", "crm.opportunities.transition", "crm.opportunities.view", "crm.parties.manage", "crm.parties.view", "crm.reports.view", "hrms.self", "pre_projects.edit", "pre_projects.view"];
const quantitySurveyor = ["catalog.view", "commercial.costs.view", "commercial.estimate", "crm.opportunities.view", "hrms.self", "integrations.view", "legal_entities.view", "module.integrations.read", "module.members.read", "module.organization.read", "module.roles.read", "module.teams.read", "pre_projects.view", "projects.report", "projects.view"];

const ids = (permissions: string[], roles = ["member"]) => scopeWorkspaceNavigation(workspaceModules, permissions, roles).flatMap((module) => module.navigation.flatMap((section) => section.items.map((item) => item.id)));

describe("workspace access rules", () => {
  it("needs every group, any code within a group, and lets owners through", () => {
    expect(meetsRule([["a", "b"], ["c"]], { permissions: ["b", "c"] })).toBe(true);
    expect(meetsRule([["a", "b"], ["c"]], { permissions: ["b"] })).toBe(false);
    expect(meetsRule([["a"]], { permissions: [], roles: ["owner"] })).toBe(true);
    expect(meetsRule(undefined, { permissions: [] })).toBe(true);
  });

  it("offers Sales only the Sales tabs its role can use", () => {
    const visible = ids(sales);
    expect(visible).toEqual(expect.arrayContaining(["leads", "opportunities", "customers", "conversations", "crm-reports", "pre-projects", "profile", "security"]));
    for (const hidden of ["crm-campaigns", "crm-settings", "automations", "company", "integrations", "members", "roles", "purchasing-settings", "accounting-settings", "projects-overview", "global-finance", "pre-project-supplier-offers"]) {
      expect(visible, hidden).not.toContain(hidden);
    }
  });

  it("offers a quantity surveyor the pipeline but not enquiries, and no finance or supply settings", () => {
    const visible = ids(quantitySurveyor);
    expect(visible).toEqual(expect.arrayContaining(["opportunities", "projects-overview", "company", "members", "integrations"]));
    for (const hidden of ["leads", "crm-overview", "customers", "conversations", "global-finance", "global-purchasing", "inventory-settings", "factory-settings", "accounting-settings"]) {
      expect(visible, hidden).not.toContain(hidden);
    }
  });

  it("guards Finance and the operations areas by address", () => {
    expect(canOpen("global-finance", { permissions: ["receivables.view"] })).toBe(true);
    expect(meetsRule(accessRuleForPath("/workspace/finance/payments"), { permissions: ["commercial.finance.verify"] })).toBe(false);
    expect(meetsRule(accessRuleForPath("/workspace/finance"), { permissions: ["payables.view"] })).toBe(true);
    expect(accessRuleForPath("/workspace/crm/leads")).toBeUndefined();
  });
});
