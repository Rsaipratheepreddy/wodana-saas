import { describe, expect, it, vi } from "vitest";
import * as jwt from "jsonwebtoken";
import { AuthGuard } from "./auth.guard";
import { LocalAuthService } from "./local-auth.service";
import { hashPassword } from "./local-password";

const secret = "a-production-password-secret-with-more-than-32-characters";
const issuer = "https://admin.example.com";
const audience = "wodana-web";
const configValues: Record<string, unknown> = {
  NODE_ENV: "production", AUTH_MODE: "password", LOCAL_AUTH_JWT_SECRET: secret,
  LOCAL_AUTH_ISSUER: issuer, LOCAL_AUTH_AUDIENCE: audience,
  EXPOSE_DEMO_AUTH_TOKENS: "true", // Defense in depth if startup validation was skipped.
};
function config(overrides: Record<string, unknown> = {}) {
  const values = { ...configValues, ...overrides };
  return { get: (key: string, fallback?: unknown) => values[key] ?? fallback, getOrThrow: (key: string) => values[key] };
}
function authRequest(headers: Record<string, string>, mode = "password") {
  const request = { headers, actor: undefined as unknown };
  const context = { getHandler: () => undefined, getClass: () => undefined, switchToHttp: () => ({ getRequest: () => request }) };
  const guard = new AuthGuard({ getAllAndOverride: () => false } as never, config({ AUTH_MODE: mode }) as never, { query: vi.fn().mockResolvedValue({ rowCount: 1 }) } as never);
  return { request, authenticate: () => guard.canActivate(context as never) };
}
function token(options: jwt.SignOptions = {}, signingSecret = secret) {
  return jwt.sign({ sid: "81000000-0000-4000-8000-000000000001", email: "owner@example.com", email_verified: true }, signingSecret, {
    subject: "local:user-1", issuer, audience, algorithm: "HS256", expiresIn: 60, ...options,
  });
}

describe("production password authentication", () => {
  it("accepts signed login tokens while rejecting development headers", async () => {
    const signed = authRequest({ authorization: `Bearer ${token()}` });
    await expect(signed.authenticate()).resolves.toBe(true);
    expect(signed.request.actor).toMatchObject({ provider: "local", subject: "local:user-1" });
    await expect(authRequest({ "x-wodana-user-email": "owner@example.com", "x-wodana-user-subject": "owner" }).authenticate()).rejects.toThrow("Bearer");
    await expect(authRequest({ authorization: `Bearer ${token()}` }, "local").authenticate()).rejects.toThrow("disabled in production");
    await expect(authRequest({ "x-wodana-user-email": "owner@example.com", "x-wodana-user-subject": "owner" }, "development").authenticate()).rejects.toThrow("disabled in production");
  });
  it("rejects expired, foreign-audience and forged tokens", async () => {
    for (const invalid of [token({ expiresIn: -1 }), token({ audience: "another-app" }), token({}, "a-different-signing-secret")]) {
      await expect(authRequest({ authorization: `Bearer ${invalid}` }).authenticate()).rejects.toThrow("invalid or expired");
    }
  });
  it("requires tenant membership even when the stored password matches", async () => {
    const password = "SecureExisting#2026";
    const encoded = await hashPassword(password);
    const database = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{ id: "user-1", status: "active", passwordHash: encoded.hash, passwordSalt: encoded.salt }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ workspaceId: "tenant-1" }], rowCount: 1 }),
      actorTransaction: vi.fn(async (_id, callback) => callback({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) })),
    };
    const identities = { resolveActor: vi.fn() };
    const service = new LocalAuthService(database as never, config() as never, identities as never, {} as never);
    await expect(service.login("owner@example.com", password, "other-tenant")).rejects.toThrow("Email, password, or tenant is incorrect");
    expect(identities.resolveActor).not.toHaveBeenCalled();
  });
  it("sends member recovery without exposing production reset tokens", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: "user-1" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ workspaceId: "tenant-1" }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 1 });
    const database = { query, actorTransaction: vi.fn(async (_id, callback) => callback({ query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [] }) })) };
    const email = { sendPasswordReset: vi.fn().mockResolvedValue({ status: "sent" }) };
    const service = new LocalAuthService(database as never, config() as never, {} as never, email as never);
    const response = await service.forgotPassword("Owner@example.com", "iglo-architects");
    expect(response).toMatchObject({ accepted: true });
    expect(response).not.toHaveProperty("developmentResetToken");
    expect(email.sendPasswordReset).toHaveBeenCalledWith(expect.objectContaining({ email: "owner@example.com", tenantSlug: "iglo-architects", resetToken: expect.any(String) }));
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    email.sendPasswordReset.mockClear();
    expect(await service.forgotPassword("absent@example.com", "iglo-architects")).toEqual(response);
    expect(email.sendPasswordReset).not.toHaveBeenCalled();
  });
});
