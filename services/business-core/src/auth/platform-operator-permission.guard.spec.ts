import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PlatformOperatorPermissionGuard } from "./platform-operator-permission.guard";

function context(permissions: string[]) {
  const request = { platformOperator: { permissions } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => "handler",
    getClass: () => "controller",
  };
}

describe("PlatformOperatorPermissionGuard", () => {
  it("permits only the declared capability", () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue("domains.manage") };
    const guard = new PlatformOperatorPermissionGuard(reflector as never);
    expect(guard.canActivate(context(["tenants.read", "domains.manage"]) as never)).toBe(true);
    expect(() => guard.canActivate(context(["tenants.read"]) as never)).toThrow(ForbiddenException);
  });

  it("fails closed when a route has no policy metadata", () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(undefined) };
    const guard = new PlatformOperatorPermissionGuard(reflector as never);
    expect(() => guard.canActivate(context(["tenants.read"]) as never)).toThrow(ForbiddenException);
  });
});
