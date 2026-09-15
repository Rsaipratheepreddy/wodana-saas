import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { LocalAuthService } from "./local-auth.service";
import type { RequestActor } from "./actor";

const actor: RequestActor = {
  subject: "local:10000000-0000-4000-8000-000000000001",
  provider: "local",
  email: "admin@igloarchitects.com",
  displayName: "Iglo Administrator",
};
const userId = "10000000-0000-4000-8000-000000000001";
const workspaceId = "00000000-0000-4000-8000-000000000002";
const currentFamilyId = "81000000-0000-4000-8000-000000000001";

function serviceFixture() {
  const actorQuery = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: "membership" }] });
  const auditQuery = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
  const query = vi.fn();
  const database = {
    query,
    transaction: vi.fn(async (work) => work({ query: async (sql: string, values: unknown[]) => sql.startsWith("SELECT id FROM users") ? { rowCount: 1, rows: [] } : query(sql, values) })),
    actorTransaction: vi.fn(async (_id: string, work: (client: { query: typeof actorQuery }) => Promise<unknown>) => work({ query: actorQuery })),
    tenantTransaction: vi.fn(async (_workspace: string, _user: string, work: (client: { query: typeof auditQuery }) => Promise<unknown>) => work({ query: auditQuery })),
  };
  const config = { get: vi.fn((key: string, fallback: unknown) => key === "AUTH_MODE" ? "local" : fallback) };
  const identities = { resolveActor: vi.fn().mockResolvedValue({ ...actor, userId }) };
  const mfa = { status: vi.fn().mockResolvedValue({ enabled: false, required: false }) };
  const service = new LocalAuthService(
    database as never,
    config as never,
    identities as never,
    {} as never,
    mfa as never,
  );
  return { actorQuery, auditQuery, database, service };
}

describe("LocalAuthService security sessions", () => {
  it("returns enforced policy and marks the current session family", async () => {
    const { database, service } = serviceFixture();
    const now = new Date("2026-09-06T06:00:00.000Z");
    database.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ familyId: currentFamilyId }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        familyId: currentFamilyId,
        createdAt: now,
        lastActiveAt: now,
        expiresAt: new Date("2026-10-06T06:00:00.000Z"),
        userAgent: "Chrome",
        ipAddress: "127.0.0.1",
        current: true,
      }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ passwordChangedAt: now }] });

    const result = await service.securityOverview(actor, "a-refresh-token-long-enough", workspaceId);

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].current).toBe(true);
    expect(result.policy).toMatchObject({ accessTokenMinutes: 15, refreshSessionDays: 30, maxFailedAttempts: 5, lockMinutes: 15 });
  });

  it("does not revoke the session currently making the request", async () => {
    const { database, service } = serviceFixture();
    database.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ familyId: currentFamilyId }] });

    await expect(service.revokeSession(
      actor,
      currentFamilyId,
      "a-refresh-token-long-enough",
      workspaceId,
    )).rejects.toBeInstanceOf(ConflictException);
  });

  it("revokes all other active families and records one audit event", async () => {
    const { auditQuery, database, service } = serviceFixture();
    database.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ familyId: currentFamilyId }] })
      .mockResolvedValueOnce({ rowCount: 3, rows: [
        { familyId: "81000000-0000-4000-8000-000000000002" },
        { familyId: "81000000-0000-4000-8000-000000000002" },
        { familyId: "81000000-0000-4000-8000-000000000003" },
      ] });

    await expect(service.revokeOtherSessions(
      actor,
      "a-refresh-token-long-enough",
      workspaceId,
    )).resolves.toEqual({ revoked: 2 });
    expect(auditQuery).toHaveBeenCalledOnce();
    expect(String(auditQuery.mock.calls[0][0])).toContain("INSERT INTO audit_events");
  });
});
