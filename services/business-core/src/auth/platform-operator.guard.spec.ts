import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PlatformOperatorGuard } from "./platform-operator.guard";

function context(token?: string) {
  const request = {
    header: vi.fn((name: string) => name === "x-wodana-operator-session" ? token : undefined),
  };
  return { request, execution: { switchToHttp: () => ({ getRequest: () => request }) } };
}

describe("PlatformOperatorGuard", () => {
  it("rejects a service-only request with no operator assertion", async () => {
    const auth = { session: vi.fn() };
    const guard = new PlatformOperatorGuard(auth as never);
    await expect(guard.canActivate(context().execution as never))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.session).not.toHaveBeenCalled();
  });

  it("binds only a verified active operator to the request", async () => {
    const auth = { session: vi.fn().mockResolvedValue({
      userId: "operator-id", email: "operator@wodana.test", displayName: "Operator",
      role: "support_observer", permissions: ["tenants.read", "support.request"],
    }) };
    const guard = new PlatformOperatorGuard(auth as never);
    const { request, execution } = context("operator-session");
    await expect(guard.canActivate(execution as never)).resolves.toBe(true);
    expect(auth.session).toHaveBeenCalledWith("operator-session");
    expect(request).toHaveProperty("platformOperator", {
      userId: "operator-id", email: "operator@wodana.test", displayName: "Operator",
      role: "support_observer", permissions: ["tenants.read", "support.request"],
    });
  });
});
