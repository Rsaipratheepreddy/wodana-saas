import { describe, expect, it } from "vitest";
import { allowedTenantModules } from "./module-access";

describe("allowedTenantModules", () => {
  it("reports effective role grants without inventing commercial entitlements", () => {
    expect(allowedTenantModules([
      "crm.leads.view", "hrms.self", "projects.report", "module.organization.read",
    ])).toEqual(["workspace", "crm", "projects", "hrms"]);
    expect(allowedTenantModules(["pre_projects.view", "commercial.approve"]))
      .toEqual(["workspace", "pre-project"]);
    expect(allowedTenantModules([])).toEqual(["workspace"]);
  });
});
