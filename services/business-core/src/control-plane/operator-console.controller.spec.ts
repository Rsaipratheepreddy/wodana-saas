import { describe, expect, it } from "vitest";
import { PLATFORM_OPERATOR_PERMISSION_KEY } from "../auth/platform-operator-permission.guard";
import type { PlatformOperatorPermission } from "../auth/platform-operator-policy";
import { OperatorAccountsController, OperatorAiCreditsController, OperatorOrganizationsController } from "./operator-console.controller";

function permission(target: object, method: string) {
  const handler = (target as Record<string, unknown>)[method];
  return Reflect.getMetadata(PLATFORM_OPERATOR_PERMISSION_KEY, handler as object) as PlatformOperatorPermission | undefined;
}

describe("operator console route policies", () => {
  it("declares a permission on every accounts route", () => {
    for (const method of ["list", "slugAvailability", "detail", "activity"]) {
      expect(permission(OperatorAccountsController.prototype, method), method).toBe("tenants.read");
    }
  });

  it("separates reading an organization from changing it, and opens tenant records only to support", () => {
    const expected: Record<string, PlatformOperatorPermission> = {
      lifecycleOverview: "tenants.read",
      transition: "lifecycle.manage",
      seats: "tenants.read",
      changeSeats: "billing.manage",
      supportSessions: "tenants.read",
      requestSupport: "support.request",
      approveSupport: "support.approve",
      rejectSupport: "support.approve",
      startSupport: "support.request",
      revokeSupport: "tenants.read",
      supportMembers: "support.request",
      supportActivity: "support.request",
      recordCertificate: "domains.manage",
      activateDomain: "domains.manage",
      completeDomainRollback: "domains.manage",
      aiCredits: "tenants.read",
      topUpAiCredits: "billing.manage",
      adjustAiCredits: "billing.manage",
      aiCreditThreshold: "billing.manage",
    };
    const declared = Object.getOwnPropertyNames(OperatorOrganizationsController.prototype)
      .filter((name) => name !== "constructor" && name !== "key");
    expect(declared.sort()).toEqual(Object.keys(expected).sort());
    for (const [method, required] of Object.entries(expected)) {
      expect(permission(OperatorOrganizationsController.prototype, method), method).toBe(required);
    }
  });

  it("lets anyone who reads organizations see AI credits, and only billing change rates", () => {
    expect(permission(OperatorAiCreditsController.prototype, "list")).toBe("tenants.read");
    expect(permission(OperatorAiCreditsController.prototype, "rates")).toBe("tenants.read");
    expect(permission(OperatorAiCreditsController.prototype, "setRate")).toBe("billing.manage");
  });
});
