import { GoneException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PlatformAuthService } from "./platform-auth.service";

const userId = "10000000-0000-4000-8000-000000000001";
const changedAt = new Date("2026-09-17T09:00:00.000Z");

function fixture() {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM users WHERE id = $1 AND status")) {
      return { rowCount: 1, rows: [{ version: 2 }] };
    }
    if (sql.includes("FROM platform_operator_challenges challenge")) {
      return { rowCount: 1, rows: [{
        id: "challenge-id", userId, purpose: "login",
        passwordUnchanged: true,
        mfaSessionVersion: 2, currentMfaSessionVersion: 2,
        expiresAt: new Date(Date.now() + 60_000), consumedAt: null,
        failedAttempts: 0, maxAttempts: 5, ipAddress: null,
        email: "operator@wodana.test", displayName: "Operator",
        role: "domain_operator",
      }] };
    }
    if (sql.includes("FROM platform_operator_sessions session")) {
      return { rowCount: 1, rows: [{
        userId, email: "operator@wodana.test", displayName: "Operator",
        role: "domain_operator",
        expiresAt: new Date(Date.now() + 60_000),
      }] };
    }
    return { rowCount: 1, rows: [] };
  });
  const database = {
    query,
    transaction: vi.fn(async (work: (client: { query: typeof query }) => Promise<unknown>) => work({ query })),
  };
  const localAuth = { verifyPlatformCredentials: vi.fn().mockResolvedValue({
    id: userId, passwordChangedAt: changedAt,
  }) };
  const mfa = {
    platformMfaEnabled: vi.fn().mockResolvedValue(true),
    verifyPlatformFactor: vi.fn().mockResolvedValue({ ok: true, method: "totp" }),
  };
  const service = new PlatformAuthService(database as never, localAuth as never, mfa as never);
  return { database, localAuth, mfa, query, service };
}

describe("PlatformAuthService", () => {
  it("requires password then MFA without querying tenant branding or membership", async () => {
    const { service, query, localAuth } = fixture();
    const login = await service.login("operator@wodana.test", "password");
    expect(login.purpose).toBe("login");
    expect(login.challengeToken).toHaveLength(43);
    expect(localAuth.verifyPlatformCredentials).toHaveBeenCalledWith("operator@wodana.test", "password");
    expect(query.mock.calls.some(([sql]) => String(sql).includes("workspace_memberships"))).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("tenant_login_branding"))).toBe(false);
  });

  it("consumes a valid challenge and issues a separate operator session", async () => {
    const { service, query } = fixture();
    const verified = await service.verify("challenge-token-with-sufficient-length", "123456");
    expect(verified.state).toBe("verified");
    expect(verified.sessionToken).toHaveLength(43);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO platform_operator_sessions"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("auth_refresh_sessions"))).toBe(false);
  });

  it("rejects an expired or replayed challenge before checking the factor", async () => {
    const { service, query, mfa } = fixture();
    query.mockImplementation(async (sql: string) => sql.includes("FROM platform_operator_challenges challenge")
      ? { rowCount: 1, rows: [{
        id: "challenge-id", userId, purpose: "login",
        passwordUnchanged: true,
        mfaSessionVersion: 2, currentMfaSessionVersion: 2,
        expiresAt: new Date(Date.now() - 1000), consumedAt: null,
        failedAttempts: 0, maxAttempts: 5,
      }] }
      : { rowCount: 1, rows: [] });
    await expect(service.verify("challenge-token-with-sufficient-length", "123456"))
      .rejects.toBeInstanceOf(GoneException);
    expect(mfa.verifyPlatformFactor).not.toHaveBeenCalled();
  });

  it("does not accept a session when the backend's active-operator query rejects it", async () => {
    const { service, query } = fixture();
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(service.session("session-token-with-sufficient-length"))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("returns the current scoped role and only its permissions", async () => {
    const { service } = fixture();
    await expect(service.session("session-token-with-sufficient-length")).resolves.toMatchObject({
      role: "domain_operator",
      permissions: ["tenants.read", "domains.manage"],
    });
  });
});
