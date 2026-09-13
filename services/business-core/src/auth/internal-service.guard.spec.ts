import { ConfigService } from "@nestjs/config";
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { InternalServiceGuard } from "./internal-service.guard";

function context(token?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) => name === "x-wodana-internal-token" ? token : undefined,
      }),
    }),
  } as unknown as ExecutionContext;
}

describe("InternalServiceGuard", () => {
  const expected = "a-long-random-internal-service-token";
  const guard = new InternalServiceGuard(new ConfigService({
    BUSINESS_CORE_INTERNAL_TOKEN: expected,
  }));

  it("allows an exact internal credential", () => {
    expect(guard.canActivate(context(expected))).toBe(true);
  });

  it("rejects absent, partial, or incorrect credentials", () => {
    for (const value of [undefined, expected.slice(0, -1), `${expected}x`]) {
      expect(() => guard.canActivate(context(value))).toThrow(UnauthorizedException);
    }
  });
});
