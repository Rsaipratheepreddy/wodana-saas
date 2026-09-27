import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { LocalAuthService } from "./local-auth.service";
import { hashPassword } from "./local-password";
import { PLATFORM_OPERATOR_ROLES } from "./platform-operator-policy";

const userId = "10000000-0000-4000-8000-000000000009";

async function fixture(operatorRole: string | null) {
  const { hash, salt } = await hashPassword("Operator-Password-1!");
  const query = vi.fn(async (sql: string, values: unknown[]) => {
    if (sql.includes("FROM users app_user")) {
      return { rowCount: 1, rows: [{
        id: userId, primaryEmail: "ops@wodana.test", displayName: "Ops", status: "active",
        passwordHash: hash, passwordSalt: salt, failedAttempts: 0, lockedUntil: null, passwordChangedAt: new Date(),
      }] };
    }
    if (sql.includes("FROM platform_administrators")) {
      const roles = values[1] as string[];
      return operatorRole && roles.includes(operatorRole) ? { rowCount: 1, rows: [{}] } : { rowCount: 0, rows: [] };
    }
    return { rowCount: 1, rows: [] };
  });
  const config = { get: vi.fn((key: string, fallback: unknown) => key === "AUTH_MODE" ? "password" : fallback) };
  const service = new LocalAuthService({ query } as never, config as never, {} as never, {} as never, {} as never);
  return { service, query };
}

describe("Wodana Control sign-in", () => {
  // The bootstrap script provisions scoped roles; every one of them must be able to sign in.
  it.each(PLATFORM_OPERATOR_ROLES)("accepts an active %s operator", async (role) => {
    const { service } = await fixture(role);
    await expect(service.verifyPlatformCredentials("ops@wodana.test", "Operator-Password-1!"))
      .resolves.toMatchObject({ id: userId });
  });

  it("refuses a tenant user who is not an operator", async () => {
    const { service } = await fixture(null);
    await expect(service.verifyPlatformCredentials("ops@wodana.test", "Operator-Password-1!"))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
});
