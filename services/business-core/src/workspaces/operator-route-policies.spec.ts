import { describe, expect, it } from "vitest";
import { PLATFORM_OPERATOR_PERMISSION_KEY } from "../auth/platform-operator-permission.guard";
import type { PlatformOperatorPermission } from "../auth/platform-operator-policy";
import { OperatorTenantDraftsController } from "./operator-tenant-drafts.controller";
import { OperatorTenantsController } from "./operator-tenants.controller";

function permission(target: object, method: string) {
  const handler = (target as Record<string, unknown>)[method];
  return Reflect.getMetadata(PLATFORM_OPERATOR_PERMISSION_KEY, handler as object) as PlatformOperatorPermission | undefined;
}

describe("operator route policies", () => {
  it("fails closed by declaring a permission on every tenant-management route", () => {
    const expected: Record<string, PlatformOperatorPermission> = {
      list: "tenants.read",
      entitlementCatalog: "tenants.read",
      updatePlatformCapability: "entitlements.manage",
      provision: "tenants.provision",
      get: "tenants.read",
      getManagement: "tenants.read",
      getStatus: "tenants.read",
      getAccess: "tenants.read",
      listDomains: "tenants.read",
      requestDomain: "domains.manage",
      verifyDomain: "domains.manage",
      rotateDomainChallenge: "domains.manage",
      recheckDomain: "domains.manage",
      removeDomain: "domains.manage",
      updateManagement: "lifecycle.manage",
      resendOwnerInvitation: "invitations.send",
      sendOwnerInvitation: "invitations.send",
      operationsOverview: "tenants.read",
      billingOverview: "tenants.read",
      updateAccountContract: "billing.manage",
      updateBillingAllocation: "billing.manage",
      recordBillingDocumentEvent: "billing.manage",
      updateCollectionState: "billing.manage",
      captureUsageSnapshot: "billing.manage",
      updateEntitlements: "entitlements.manage",
      updateDataPolicy: "data.manage",
      requestSupport: "support.request",
      decideSupport: "support.approve",
      planOperation: "data.manage",
      decideOperation: "data.manage",
      downloadExport: "data.manage",
    };
    for (const [method, required] of Object.entries(expected)) {
      expect(permission(OperatorTenantsController.prototype, method), method).toBe(required);
    }
  });

  it("separates draft reads from provisioning commands", () => {
    expect(permission(OperatorTenantDraftsController.prototype, "profiles")).toBe("tenants.read");
    expect(permission(OperatorTenantDraftsController.prototype, "get")).toBe("tenants.read");
    expect(permission(OperatorTenantDraftsController.prototype, "create")).toBe("tenants.provision");
    expect(permission(OperatorTenantDraftsController.prototype, "provision")).toBe("tenants.provision");
  });
});
