import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import { LocalAuthService } from "./local-auth.service";
import { AuthGuard } from "./auth.guard";
import { hashOpaqueToken, hashPassword } from "./local-password";
import type { RequestActor } from "./actor";

// Opt-in PostgreSQL tests, isolated in a disposable schema. Never use a remote database.
const databaseUrl = process.env.DEVICE_LIMIT_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
integration("two-device authentication with PostgreSQL", () => {
  const userId = randomUUID(), otherUserId = randomUUID(), workspaceId = randomUUID();
  const schema = `device_limit_${randomUUID().replaceAll("-", "")}`;
  const password = "DeviceLimitTest#2026";
  const actor: RequestActor = { subject: `local:${userId}`, provider: "local", email: "device-test@example.com", displayName: "Device test" };
  let owner: Pool, db: DatabaseService, service: LocalAuthService, guard: AuthGuard, config: ConfigService;
  const login = (metadata: Parameters<LocalAuthService["login"]>[3] = {}) => service.login(actor.email, password, "device-test", metadata);
  const activeCount = async () => Number((await db.query("SELECT count(DISTINCT family_id) AS count FROM auth_refresh_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()", [userId])).rows[0].count);
  const authenticate = (token: string) => guard.canActivate({
    getHandler: () => undefined, getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }),
  } as never);
  const family = (token: string) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sid as string;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    owner = new Pool({ connectionString: url.toString() });
    await owner.query(`CREATE SCHEMA ${schema}`);
    // LIKE preserves the real column types and indexes without sharing any live rows or foreign keys.
    for (const table of ["users", "local_auth_credentials", "user_identities", "auth_refresh_sessions", "workspaces", "workspace_memberships", "tenant_login_branding", "audit_events", "password_reset_tokens"]) {
      await owner.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING INDEXES)`);
    }
    url.searchParams.set("options", `-c search_path=${schema},public`);
    config = new ConfigService({ DATABASE_URL: url.toString(), AUTH_MODE: "local", LOCAL_AUTH_JWT_SECRET: "isolated-device-test-secret-at-least-32-characters" });
    db = new DatabaseService(config);
    service = new LocalAuthService(db, config, {
      resolveActor: async () => ({ ...actor, userId }), getProfile: async () => ({ nextAction: "enter_workspace" }),
    } as never, {} as never, {
      beginPrimaryAuthentication: async () => ({
        challengeRequired: false,
        assurance: { authenticationMethods: ["pwd"], mfaSessionVersion: 0 },
      }),
      status: async () => ({ enabled: false, required: false }),
    } as never);
    guard = new AuthGuard({ getAllAndOverride: () => false } as never, config, db);
    const encoded = await hashPassword(password);
    await db.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Device test'),($3,'other@example.com','Other user')", [userId, actor.email, otherUserId]);
    await db.query("INSERT INTO local_auth_credentials(user_id,password_hash,password_salt) VALUES($1,$2,$3)", [userId, encoded.hash, encoded.salt]);
    await db.query("INSERT INTO user_identities(user_id,provider,provider_subject,email_at_provider) VALUES($1,'local',$2,$3)", [userId, actor.subject, actor.email]);
    await db.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Device test','device-test','AED',$2)", [workspaceId, userId]);
    await db.query("INSERT INTO workspace_memberships(workspace_id,user_id,status) VALUES($1,$2,'active')", [workspaceId, userId]);
    await db.query("INSERT INTO tenant_login_branding(workspace_id,login_slug,display_name) VALUES($1,'device-test','Device test')", [workspaceId]);
  });
  beforeEach(async () => { config.set("AUTH_DEVICE_LIMIT_EXEMPT_USER_IDS", ""); await db.query("TRUNCATE auth_refresh_sessions, audit_events, password_reset_tokens"); });
  afterAll(async () => {
    await db?.onModuleDestroy();
    if (owner) { await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await owner.end(); }
  });

  it("admits only two of six simultaneous logins and returns a device list without credentials", async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => login({ userAgent: `Browser ${i}`, ipAddress: "127.0.0.1" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await activeCount()).toBe(2);
    for (const result of results) if (result.status === "rejected") {
      expect(result.reason.getStatus()).toBe(409);
      const response = result.reason.getResponse();
      expect(response).toMatchObject({ code: "DEVICE_LIMIT_REACHED", maxActiveDevices: 2 });
      expect(response.sessions).toHaveLength(2);
      expect(JSON.stringify(response)).not.toMatch(/tokenHash|refreshToken|accessToken/);
    }
  });

  it("allows multiple devices for an explicit test account while preserving refresh, logout and revocation", async () => {
    config.set("AUTH_DEVICE_LIMIT_EXEMPT_USER_IDS", userId);
    const sessions = await Promise.all(Array.from({ length: 6 }, (_, i) => login({ userAgent: `Test browser ${i}` })));
    expect(await activeCount()).toBe(6);
    for (const session of sessions) await expect(authenticate(session.accessToken)).resolves.toBe(true);
    expect((await service.securityOverview(actor, sessions[0].refreshToken, workspaceId)).policy.maxActiveDevices).toBeNull();
    const rotated = await service.refresh(sessions[0].refreshToken);
    await expect(authenticate(rotated.accessToken)).resolves.toBe(true);
    expect(await activeCount()).toBe(6);
    await service.logout(rotated.refreshToken);
    await expect(authenticate(rotated.accessToken)).rejects.toThrow();
    await expect(service.refresh(rotated.refreshToken)).rejects.toThrow();
    await service.revokeSession(actor, family(sessions[1].accessToken), sessions[2].refreshToken, workspaceId);
    await expect(authenticate(sessions[1].accessToken)).rejects.toThrow();
    await expect(authenticate(sessions[2].accessToken)).resolves.toBe(true);
    config.set("AUTH_DEVICE_LIMIT_EXEMPT_USER_IDS", "");
    await expect(authenticate(sessions[2].accessToken)).rejects.toThrow();
    await expect(service.refresh(sessions[2].refreshToken)).rejects.toThrow("Device limit");
    await expect(login()).rejects.toMatchObject({ status: 409 });
  });

  it("does not exempt a different account or bypass credentials and tenant checks", async () => {
    config.set("AUTH_DEVICE_LIMIT_EXEMPT_USER_IDS", otherUserId);
    await login(); await login();
    await expect(login()).rejects.toMatchObject({ status: 409 });
    config.set("AUTH_DEVICE_LIMIT_EXEMPT_USER_IDS", userId);
    await expect(service.login(actor.email, "WrongPassword#2026", "device-test")).rejects.toThrow("incorrect");
    await expect(service.login(actor.email, password, "unrelated-tenant")).rejects.toThrow("incorrect");
    expect(await activeCount()).toBe(2);
  });
  it("replaces a selected device and immediately rejects its access and refresh tokens", async () => {
    const first = await login({ userAgent: "Chrome" });
    const second = await login({ userAgent: "Safari" });
    const third = await login({ revokeFamilyId: family(first.accessToken) });
    expect(await activeCount()).toBe(2);
    await expect(authenticate(first.accessToken)).rejects.toThrow("logged out");
    await expect(service.refresh(first.refreshToken)).rejects.toThrow();
    await expect(authenticate(second.accessToken)).resolves.toBe(true);
    await expect(authenticate(third.accessToken)).resolves.toBe(true);
    expect((await db.query("SELECT action FROM audit_events")).rows).toEqual([{ action: "security.session_revoked" }]);
  });
  it("does not trust user-agent identity and lets a proven browser sign in again at capacity", async () => {
    const first = await login({ userAgent: "Same browser" });
    await login({ userAgent: "Same browser" });
    await expect(login({ userAgent: "Same browser" })).rejects.toMatchObject({ status: 409 });
    const again = await login({ currentRefreshToken: first.refreshToken });
    expect(await activeCount()).toBe(2);
    await expect(authenticate(first.accessToken)).rejects.toThrow();
    await expect(authenticate(again.accessToken)).resolves.toBe(true);
  });
  it("does not expose devices or revoke sessions for invalid credentials or another user", async () => {
    await login(); await login();
    const foreignFamily = randomUUID();
    await db.query("INSERT INTO auth_refresh_sessions(user_id,family_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 day')", [otherUserId, foreignFamily, hashOpaqueToken("other-refresh")]);
    await expect(service.login(actor.email, "incorrect", "device-test", { revokeFamilyId: foreignFamily })).rejects.toMatchObject({ status: 401 });
    await expect(login({ revokeFamilyId: foreignFamily })).rejects.toMatchObject({ status: 409 });
    expect((await db.query("SELECT revoked_at FROM auth_refresh_sessions WHERE family_id=$1", [foreignFamily])).rows[0].revoked_at).toBeNull();
  });
  it("counts refreshed families once and logs out the whole family using an older token", async () => {
    const first = await login();
    const rotated = await service.refresh(first.refreshToken);
    await login();
    expect(await activeCount()).toBe(2);
    await service.logout(first.refreshToken);
    expect(await activeCount()).toBe(1);
    await expect(authenticate(rotated.accessToken)).rejects.toThrow();
    await expect(service.refresh(rotated.refreshToken)).rejects.toThrow();
  });
  it("prevents refresh from resurrecting a device during concurrent revocation", async () => {
    const first = await login(); const second = await login();
    const results = await Promise.allSettled([
      service.refresh(first.refreshToken),
      service.revokeSession(actor, family(first.accessToken), second.refreshToken, workspaceId),
    ]);
    expect(results[1].status).toBe("fulfilled");
    expect(await activeCount()).toBe(1);
    await expect(authenticate(first.accessToken)).rejects.toThrow();
    if (results[0].status === "fulfilled") {
      await expect(authenticate(results[0].value.accessToken)).rejects.toThrow();
      await expect(service.refresh(results[0].value.refreshToken)).rejects.toThrow();
    }
  });
  it("commits each selected logout while an existing over-limit account frees enough slots", async () => {
    const first = await login(); await login();
    for (let i = 0; i < 2; i++) await db.query("INSERT INTO auth_refresh_sessions(user_id,family_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 day')", [userId, randomUUID(), hashOpaqueToken(`legacy-${i}`)]);
    await expect(authenticate(first.accessToken)).rejects.toThrow();
    await expect(service.refresh(first.refreshToken)).rejects.toThrow("Device limit");
    await expect(login({ revokeFamilyId: family(first.accessToken) })).rejects.toMatchObject({ status: 409 });
    expect(await activeCount()).toBe(3);
    const remaining = (await db.query("SELECT family_id FROM auth_refresh_sessions WHERE user_id=$1 AND revoked_at IS NULL", [userId])).rows;
    await expect(login({ revokeFamilyId: remaining[0].family_id })).rejects.toMatchObject({ status: 409 });
    const admitted = await login({ revokeFamilyId: remaining[1].family_id });
    expect(await activeCount()).toBe(2);
    await expect(authenticate(admitted.accessToken)).resolves.toBe(true);
  });
  it("ignores expired devices and invalidates access after password reset", async () => {
    const first = await login(); await login();
    await db.query("UPDATE auth_refresh_sessions SET expires_at=now()-interval '1 second' WHERE family_id=$1", [family(first.accessToken)]);
    const replacement = await login();
    const resetToken = randomUUID();
    await db.query("INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')", [userId, hashOpaqueToken(resetToken)]);
    await service.resetPassword(resetToken, password);
    expect(await activeCount()).toBe(0);
    await expect(authenticate(replacement.accessToken)).rejects.toThrow();
  });
});
