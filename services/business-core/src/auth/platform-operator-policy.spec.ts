import { describe, expect, it } from "vitest";
import { platformOperatorCan, platformOperatorPermissions } from "./platform-operator-policy";

describe("platform operator policy", () => {
  it("keeps the compatibility administrator fully scoped", () => {
    expect(platformOperatorPermissions("administrator")).toContain("operators.manage");
    expect(platformOperatorCan("administrator", "domains.manage")).toBe(true);
  });

  it("separates provisioning, billing, domain, and support duties", () => {
    expect(platformOperatorCan("provisioning_operator", "tenants.provision")).toBe(true);
    expect(platformOperatorCan("provisioning_operator", "billing.manage")).toBe(false);
    expect(platformOperatorCan("account_billing_operator", "entitlements.manage")).toBe(true);
    expect(platformOperatorCan("account_billing_operator", "domains.manage")).toBe(false);
    expect(platformOperatorCan("account_billing_operator", "lifecycle.manage")).toBe(false);
    expect(platformOperatorCan("platform_security_owner", "lifecycle.manage")).toBe(true);
    expect(platformOperatorCan("domain_operator", "domains.manage")).toBe(true);
    expect(platformOperatorCan("domain_operator", "tenants.provision")).toBe(false);
    expect(platformOperatorCan("support_observer", "support.request")).toBe(true);
    expect(platformOperatorCan("support_observer", "support.approve")).toBe(false);
    expect(platformOperatorCan("support_observer", "data.manage")).toBe(false);
  });
});
