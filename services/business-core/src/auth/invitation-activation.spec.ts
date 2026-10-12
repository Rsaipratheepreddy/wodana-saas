import { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { LocalAuthService } from "./local-auth.service";
import { hashPassword, verifyPassword } from "./local-password";

// An invitation link is visible to whoever sent it. Activating it must never replace the password of an account that
// already exists, or any workspace admin could invite someone's email and take over their account everywhere.
const USER_ID = "8d3f8c48-6a9d-4d3e-9a39-2d2f0c1c7a11";
const WORKSPACE_ID = "0f1d9a5e-2b8f-4f6c-8f0e-6f7a3b9c1d22";
const INVITATION_ID = "5a6b7c8d-1e2f-4a3b-9c8d-7e6f5a4b3c33";

async function setup(existing: { password: string; lockedUntil?: Date } | null) {
  const stored = existing ? await hashPassword(existing.password) : null;
  const sql: Array<{ text: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (raw: string, params: unknown[] = []) => {
      const text = raw.replace(/\s+/g, " ");
      sql.push({ text, params });
      const rows = (list: unknown[]) => ({ rows: list, rowCount: list.length });
      if (text.includes("FROM workspace_invitations invitation") && text.includes("JOIN users")) {
        return rows([{ id: INVITATION_ID, workspaceId: WORKSPACE_ID, email: "owner@example.com", status: "pending",
          expiresAt: new Date(Date.now() + 86_400_000), userId: USER_ID, displayName: "Owner" }]);
      }
      if (text.includes("FROM workspace_invitations WHERE id = $1 FOR UPDATE")) {
        return rows([{ status: "pending", expiresAt: new Date(Date.now() + 86_400_000), invitedBy: null }]);
      }
      if (text.includes("FROM local_auth_credentials WHERE user_id = $1 FOR UPDATE")) {
        return rows(stored ? [{ passwordHash: stored.hash, passwordSalt: stored.salt,
          lockedUntil: existing?.lockedUntil ?? null, passwordChangedAt: new Date("2026-01-01T00:00:00Z") }] : []);
      }
      if (text.includes("INSERT INTO local_auth_credentials")) {
        return rows([{ passwordChangedAt: new Date() }]);
      }
      if (text.includes("FROM workspaces workspace") && text.includes("FOR UPDATE OF workspace")) {
        return rows([{ id: WORKSPACE_ID, name: "Studio" }]);
      }
      if (text.includes("workspace_seat_capacity")) return rows([{ seatLimit: 10, reservedSeats: 1 }]);
      if (text.includes("INSERT INTO workspace_memberships")) return rows([{ id: "membership-1" }]);
      return rows([]);
    }),
  };
  const database = {
    transaction: vi.fn(async (work: (c: typeof client) => Promise<unknown>) => work(client)),
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  };
  const service = new LocalAuthService(
    database as never,
    new ConfigService({ AUTH_MODE: "password" }),
    {} as never,
    {} as never,
    {} as never,
  );
  const completed = vi.spyOn(service as unknown as { completePrimaryAuthentication: () => Promise<unknown> },
    "completePrimaryAuthentication").mockResolvedValue({ accessToken: "session" });
  return { service, sql, database, completed };
}

const wroteCredential = (sql: Array<{ text: string }>) =>
  sql.some(({ text }) => text.includes("INSERT INTO local_auth_credentials") || /SET password_hash/.test(text));

describe("invitation activation never overwrites an existing password", () => {
  it("refuses a different password for an existing account and counts the failed attempt", async () => {
    const { service, sql, database, completed } = await setup({ password: "Owner#Original2026" });
    await expect(service.activateInvitation("invite-token", "Attacker#Chosen2026"))
      .rejects.toMatchObject({ status: 401, message: expect.stringContaining("already have a Wodana account") });
    expect(wroteCredential(sql)).toBe(false);
    expect(sql.some(({ text }) => text.includes("INSERT INTO workspace_memberships"))).toBe(false);
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining("failed_attempts = failed_attempts + 1"),
      [USER_ID, 5, 15]);
    expect(completed).not.toHaveBeenCalled();
  });

  it("refuses while the account is locked", async () => {
    const { service, sql } = await setup({ password: "Owner#Original2026", lockedUntil: new Date(Date.now() + 60_000) });
    await expect(service.activateInvitation("invite-token", "Owner#Original2026")).rejects.toMatchObject({ status: 429 });
    expect(wroteCredential(sql)).toBe(false);
  });

  it("accepts with the existing password and keeps it", async () => {
    const { service, sql, completed } = await setup({ password: "Owner#Original2026" });
    await expect(service.activateInvitation("invite-token", "Owner#Original2026")).resolves.toEqual({ accessToken: "session" });
    expect(wroteCredential(sql)).toBe(false);
    expect(sql.some(({ text }) => text.includes("INSERT INTO workspace_memberships"))).toBe(true);
    expect(completed).toHaveBeenCalledWith(expect.anything(), USER_ID, WORKSPACE_ID,
      new Date("2026-01-01T00:00:00Z"), expect.anything());
  });

  it("sets the first password for a person without one", async () => {
    const { service, sql, completed } = await setup(null);
    await service.activateInvitation("invite-token", "First#Password2026");
    const insert = sql.find(({ text }) => text.includes("INSERT INTO local_auth_credentials"));
    expect(insert?.text).not.toContain("ON CONFLICT");
    const [, hash, salt] = insert?.params as [string, string, string];
    await expect(verifyPassword("First#Password2026", salt, hash)).resolves.toBe(true);
    expect(completed).toHaveBeenCalled();
  });
});

describe("password reset emails are capped per person", () => {
  async function forgot(recentResets: number) {
    const database = {
      query: vi.fn(async (raw: string) => {
        const text = raw.replace(/\s+/g, " ");
        if (text.includes("FROM users app_user JOIN local_auth_credentials")) return { rows: [{ id: USER_ID }], rowCount: 1 };
        if (text.includes("FROM tenant_login_branding")) return { rows: [{ workspaceId: WORKSPACE_ID }], rowCount: 1 };
        if (text.includes("FROM password_reset_tokens")) return { rows: [{ count: recentResets }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
      actorTransaction: vi.fn(async () => ({ rows: [{ id: "membership-1" }], rowCount: 1 })),
    };
    const email = { sendPasswordReset: vi.fn(async () => undefined) };
    const service = new LocalAuthService(database as never, new ConfigService({ AUTH_MODE: "password" }), {} as never,
      email as never, {} as never);
    const result = await service.forgotPassword("owner@example.com", "studio");
    return { result, email, database };
  }

  it("sends while under three in the last hour", async () => {
    const { result, email } = await forgot(2);
    expect(email.sendPasswordReset).toHaveBeenCalledTimes(1);
    expect(result.accepted).toBe(true);
  });

  it("answers the same but sends nothing at the cap", async () => {
    const { result, email, database } = await forgot(3);
    expect(email.sendPasswordReset).not.toHaveBeenCalled();
    expect(database.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO password_reset_tokens"))).toBe(false);
    expect(result).toEqual({ accepted: true, message: "If the account exists, password reset instructions have been issued." });
  });
});
