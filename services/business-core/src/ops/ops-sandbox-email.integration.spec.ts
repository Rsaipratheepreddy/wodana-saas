import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdentityService } from "../auth/identity.service";
import { LocalAuthService } from "../auth/local-auth.service";
import { CrmNotificationsService } from "../crm/notifications/crm-notifications.service";
import { DatabaseService } from "../database/database.service";
import { SANDBOX_EMAIL_CHANGED } from "./ops-sandbox-email";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Sandbox A (AE) and organization B (IN,
// --organization-of A) share A's twelve test members; --email-pattern then moves them to one inbox's plus-addresses. The
// CLI runs in a child process (the whole Nest application context, from source) as the app role wodana_app; sign-in and
// the email sender run here, on their own services, as the app role too.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const run = promisify(execFile);
const fixtures = resolve(__dirname, "fixtures");
const docs = resolve(__dirname, "../../../../docs/fixtures");
const PASSWORD = `Sandbox#${randomUUID().slice(0, 8)}A1`;
const ROLES = ["owner", "manager", "sales", "designer", "design-manager", "qs", "purchasing", "factory", "logistics", "site", "finance", "accountant"];

type Result = { code: number; output: string };
type Json = { counts: Record<string, number>; lines: Array<{ section: string; status: string; label: string; detail?: string }>;
  members: Array<{ key: string; email: string; userId: string | null }>; newUserIds?: string[] };
type Member = { userId: string; status: string; roles: string[]; teams: string[] };

integration("operator CLI sandbox --email-pattern: the test members sign in with a real inbox's addresses (real Postgres)", () => {
  let pool: Pool;
  const tag = randomUUID().slice(0, 8);
  const a = `sbxe-${tag}`, b = `sbxf-${tag}`, c = `sbxg-${tag}`, d = `sbxh-${tag}`, e = `sbxi-${tag}`;
  // The product owner's inbox, one plus-address per role (tagged, so a database used before holds none of them).
  const pattern = `wodanatechnology+{role}-${tag}@gmail.com`;
  const patternD = `wodanatechnology+{role}-d${tag}@gmail.com`;
  const at = (role: string, scheme = pattern) => scheme.replace("{role}", role);
  const old = (role: string, slug = a) => `${role}@${slug}.test`;
  const otherId = randomUUID(), otherOwner = randomUUID(), otherSlug = `other-${otherId.slice(0, 8)}`;
  const teams = ["--teams", resolve(docs, "palm-teams-access.json")];
  const makeA = ["sandbox", "--slug", a, "--name", "Sandbox A", "--region", "AE", ...teams, "--password-env", "SANDBOX_TEST_PASSWORD"];
  const plainA = ["sandbox", "--slug", a, "--name", "Sandbox A", "--region", "AE", ...teams];
  const switchA = [...plainA, "--email-pattern", pattern];
  const addB = ["sandbox", "--slug", b, "--name", "Sandbox B", "--region", "IN", "--organization-of", a, ...teams];
  const makeC = ["sandbox", "--slug", c, "--name", "Sandbox C", "--region", "AE", "--password-env", "SANDBOX_TEST_PASSWORD"];
  const switchC = ["sandbox", "--slug", c, "--name", "Sandbox C", "--region", "AE", "--email-pattern", `wodanatechnology+{role}-c${tag}@gmail.com`];
  const makeD = ["sandbox", "--slug", d, "--name", "Sandbox D", "--region", "AE", "--password-env", "SANDBOX_TEST_PASSWORD", "--email-pattern", patternD];
  const makeE = ["sandbox", "--slug", e, "--name", "Sandbox E", "--region", "AE", "--password-env", "SANDBOX_TEST_PASSWORD", "--email-pattern", pattern];

  let idA = "", idB = "", idC = "";
  let ids: Record<string, string> = {};
  const queued: Record<string, string> = {};
  let membersBefore: { a: Member[]; b: Member[] } = { a: [], b: [] };
  let credentialsBefore: Array<{ userId: string; hash: string }> = [];
  let expectedSkipped = -1, usersBefore = -1;
  let afterDry: { emails: string[]; pending: number } = { emails: [], pending: -1 };
  let dry: Result, first: Result, second: Result, plain: Result, plainB: Result, patternB: Result, refusedC: Result, newD: Result, againD: Result, takenE: Result;

  async function cli(runs: string[][]): Promise<Result[]> {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", "-c role=wodana_app");
    const { stdout } = await run(process.execPath, [resolve(fixtures, "run-ops-cli.cjs"), JSON.stringify(runs)], {
      env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test", AUTH_MODE: "development", REDIS_URL: "", SANDBOX_TEST_PASSWORD: PASSWORD,
        PORTAL_OTP_SECRET: "sandbox-integration-portal-secret-0123456789" },
      maxBuffer: 50 * 1024 * 1024, timeout: 900_000,
    });
    return JSON.parse(stdout.slice(stdout.lastIndexOf("@@RESULT@@") + "@@RESULT@@".length)) as Result[];
  }
  const appConfig = (extra: Record<string, string> = {}) => {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", "-c role=wodana_app");
    return new ConfigService({ DATABASE_URL: url.toString(), AUTH_MODE: "local", LOCAL_AUTH_JWT_SECRET: "sandbox-email-integration-secret-at-least-32-chars", ...extra });
  };
  const count = async (sql: string, values: unknown[] = []) => Number((await pool.query<{ count: string }>(sql, values)).rows[0].count);
  const json = (result: Result) => JSON.parse(result.output) as Json;
  const workspaceOf = async (slug: string) => (await pool.query<{ id: string }>(`SELECT workspace_id AS id FROM tenant_login_branding WHERE login_slug = $1`, [slug])).rows[0]?.id;
  const members = async (workspaceId: string) => (await pool.query<Member>(
    `SELECT person.id AS "userId", membership.status,
            ARRAY(SELECT role.code FROM member_roles link JOIN roles role ON role.id = link.role_id WHERE link.membership_id = membership.id ORDER BY role.code) AS roles,
            ARRAY(SELECT team.code FROM workspace_team_members link JOIN workspace_teams team ON team.id = link.team_id WHERE link.membership_id = membership.id ORDER BY team.code) AS teams
       FROM workspace_memberships membership JOIN users person ON person.id = membership.user_id WHERE membership.workspace_id = $1 ORDER BY person.id`, [workspaceId])).rows;
  const emailsOf = async (userIds: string[]) => (await pool.query<{ email: string }>(`SELECT primary_email::text AS email FROM users WHERE id = ANY($1::uuid[]) ORDER BY id`, [userIds])).rows.map((row) => row.email);
  const notify = async (workspaceId: string, recipientId: string, channel: string, status: string, label: string) => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO notifications (id, workspace_id, recipient_type, recipient_id, channel, status, scheduled_for, subject, body, idempotency_key, correlation_id, processing_started_at)
       VALUES ($1, $2, 'user', $3, $4, $5::notification_status, CASE WHEN $5 = 'scheduled' THEN now() + interval '1 hour' ELSE now() END, $6, 'Body', $7, $8,
               CASE WHEN $5 = 'processing' THEN now() - interval '10 minutes' END)`,
      [id, workspaceId, recipientId, channel, status, `${label} ${tag}`, `sandbox-email-test:${label}:${tag}`, randomUUID()]);
    queued[label] = id;
  };
  const statusOf = async (label: string) => (await pool.query<{ status: string; reason: string | null }>(
    `SELECT status::text, suppressed_reason AS reason FROM notifications WHERE id = $1`, [queued[label]])).rows[0];

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
    const [madeA, madeB, madeC] = await cli([[...makeA, "--apply"], [...addB, "--apply"], [...makeC, "--apply"]]);
    for (const made of [madeA, madeB, madeC]) expect(made.code, made.output).toBe(0);
    idA = (await workspaceOf(a))!; idB = (await workspaceOf(b))!; idC = (await workspaceOf(c))!;
    const people = (await pool.query<{ id: string; email: string }>(`SELECT id, primary_email::text AS email FROM users WHERE primary_email::text LIKE $1`, [`%@${a}.test`])).rows;
    ids = Object.fromEntries(people.map((person) => [person.email.replace(`@${a}.test`, ""), person.id]));
    membersBefore = { a: await members(idA), b: await members(idB) };
    credentialsBefore = (await pool.query(`SELECT user_id AS "userId", password_hash AS hash FROM local_auth_credentials WHERE user_id = ANY($1::uuid[]) ORDER BY user_id`,
      [Object.values(ids)])).rows;

    // Emails queued for the old addresses before the change (the seed queues hundreds like these), and what must stay.
    await notify(idA, ids.sales, "email", "pending", "before-pending");
    await notify(idA, ids.qs, "email", "scheduled", "before-scheduled");
    await notify(idA, ids.finance, "email", "processing", "before-processing");
    await notify(idB, ids.manager, "email", "pending", "before-in-b");
    await notify(idA, ids.site, "email", "failed", "before-failed");
    await notify(idA, ids.sales, "in_app", "pending", "before-in-app");
    // Someone who is not a test member, and a pending invitation to a test member's old address in B.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Other Owner')", [otherOwner, `owner-${otherOwner.slice(0, 8)}@example.test`]);
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [otherId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_locale,default_timezone,created_by) VALUES($1,'Other Studio',$2,'USD','en-US','UTC',$3)", [otherId, otherSlug, otherOwner]);
      await client.query("INSERT INTO tenant_login_branding(workspace_id,login_slug,display_name) VALUES($1,$2,'Other Studio')", [otherId, otherSlug]);
      await client.query("INSERT INTO workspace_memberships(workspace_id,user_id,status) VALUES($1,$2,'active')", [otherId, otherOwner]);
      // C's sales member also works in an organization the sandbox didn't make: C's addresses never change.
      const salesC = (await client.query<{ id: string }>(`SELECT id FROM users WHERE primary_email = $1`, [old("sales", c)])).rows[0].id;
      await client.query("INSERT INTO workspace_memberships(workspace_id,user_id,status) VALUES($1,$2,'active')", [otherId, salesC]);
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [idB]);
      const invitation = randomUUID();
      await client.query(`INSERT INTO workspace_invitations(id,workspace_id,email,token_hash,invited_by,expires_at) VALUES($1,$2,$3,$4,$5,now() + interval '7 days')`,
        [invitation, idB, old("logistics"), `sandbox-email-test-${tag}`.padEnd(64, "0"), ids.owner]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await notify(idA, otherOwner, "email", "pending", "not-a-member");
    usersBefore = await count(`SELECT count(*) FROM users`);
    expectedSkipped = await count(`SELECT count(*) FROM notifications WHERE workspace_id = ANY($1::uuid[]) AND recipient_type = 'user' AND recipient_id = ANY($2::uuid[])
      AND channel = 'email' AND status IN ('pending', 'scheduled', 'processing')`, [[idA, idB], Object.values(ids)]);

    [dry] = await cli([switchA]);
    afterDry = { emails: await emailsOf(Object.values(ids)), pending: await count(`SELECT count(*) FROM notifications WHERE id = $1 AND status = 'pending'`, [queued["before-pending"]]) };
    [first, second, plain, plainB, patternB, refusedC, newD, againD, takenE] = await cli([
      [...switchA, "--apply"],
      [...switchA, "--apply", "--json"],
      [...plainA, "--apply", "--json"],
      [...addB, "--apply", "--json"],
      [...addB, "--email-pattern", pattern, "--apply", "--json"],
      [...switchC, "--apply"],
      [...makeD, "--apply"],
      [...makeD, "--apply", "--json"],
      [...makeE, "--apply"],
    ]);
  }, 1_800_000);
  afterAll(() => pool?.end());

  it("previews each member's old and new address with their user id, and changes nothing", () => {
    expect(dry.code, dry.output).toBe(0);
    for (const role of ROLES) expect(dry.output).toContain(`${old(role)}: → ${at(role)} · ${role} · user ${ids[role]} (unchanged)`);
    expect(dry.output).toMatch(/\[email\] would change +address pattern: <role>@sbxe-[0-9a-f]+\.test → wodanatechnology\+\{role\}/);
    expect(dry.output).toContain(`${expectedSkipped} emails queued for the old addresses skipped`);
    expect(afterDry.emails.sort()).toEqual(ROLES.map((role) => old(role)).sort());
    expect(afterDry.pending).toBe(1);
  });

  it("moves all twelve people to the pattern's addresses: same ids, passwords, memberships, roles and teams in A and B", async () => {
    expect(first.code, first.output).toBe(0);
    const now = (await pool.query<{ id: string; email: string }>(`SELECT id, primary_email::text AS email FROM users WHERE id = ANY($1::uuid[])`, [Object.values(ids)])).rows;
    expect(Object.fromEntries(now.map((row) => [row.id, row.email]))).toEqual(Object.fromEntries(ROLES.map((role) => [ids[role], at(role)])));
    expect(await count(`SELECT count(*) FROM users WHERE primary_email::text LIKE $1`, [`%@${a}.test`])).toBe(0);
    // Sandbox D's members are the only new people of all these runs.
    expect(await count(`SELECT count(*) FROM users`)).toBe(usersBefore + 12);
    expect(await members(idA)).toEqual(membersBefore.a);
    expect(await members(idB)).toEqual(membersBefore.b);
    expect((await pool.query(`SELECT user_id AS "userId", password_hash AS hash FROM local_auth_credentials WHERE user_id = ANY($1::uuid[]) ORDER BY user_id`,
      [Object.values(ids)])).rows).toEqual(credentialsBefore);
    const identities = (await pool.query<{ userId: string; email: string }>(`SELECT user_id AS "userId", email_at_provider::text AS email FROM user_identities
      WHERE provider = 'local' AND user_id = ANY($1::uuid[])`, [Object.values(ids)])).rows;
    expect(identities).toHaveLength(12);
    for (const identity of identities) expect(identity.email).toBe(at(ROLES.find((role) => ids[role] === identity.userId)!));
    // The pending invitation to a member's old address follows them; the accepted ones stay records of what was sent.
    expect(await count(`SELECT count(*) FROM workspace_invitations WHERE workspace_id = $1 AND status = 'pending' AND email = $2`, [idB, at("logistics")])).toBe(1);
    expect(await count(`SELECT count(*) FROM workspace_invitations WHERE workspace_id = $1 AND status = 'accepted' AND email = $2`, [idA, old("owner")])).toBe(1);
    expect(first.output).toContain("No new people: the device-limit exemption needs no change.");
    expect(first.output).not.toContain(PASSWORD);
    expect((await pool.query(`SELECT email_pattern AS pattern, version FROM operator_sandbox_settings WHERE workspace_id = $1`, [idA])).rows).toEqual([{ pattern, version: 1 }]);
  });

  it("signs in by the new address as the same person; the old address finds nobody", async () => {
    const config = appConfig({ AUTH_DEVICE_LIMIT_EXEMPT_USER_IDS: Object.values(ids).join(",") });
    const database = new DatabaseService(config);
    try {
      const auth = new LocalAuthService(database, config, new IdentityService(database), {} as never, {
        beginPrimaryAuthentication: async () => ({ challengeRequired: false, assurance: { authenticationMethods: ["pwd"], mfaSessionVersion: 0 } }),
        status: async () => ({ enabled: false, required: false }),
      } as never);
      for (const [role, slug] of [["sales", a], ["designer", b]] as const) {
        const session = await auth.login(at(role).toUpperCase(), PASSWORD, slug) as { accessToken: string; selectedWorkspaceId: string };
        const claims = JSON.parse(Buffer.from(session.accessToken.split(".")[1], "base64url").toString()) as { sub: string; email: string };
        expect(claims).toMatchObject({ sub: `local:${ids[role]}`, email: at(role) });
        expect(session.selectedWorkspaceId).toBe(slug === a ? idA : idB);
        await expect(auth.login(old(role), PASSWORD, slug)).rejects.toBeInstanceOf(UnauthorizedException);
      }
      // Email-first sign-in finds both organizations for the one person.
      expect(await auth.login(at("manager"), PASSWORD, undefined)).toMatchObject({ workspaceSelectionRequired: true });
    } finally {
      await database.onModuleDestroy();
    }
  });

  it("skips the emails queued for the old addresses (never handed to the mailer), keeps in-app notices, and sends new ones to the new address", async () => {
    for (const label of ["before-pending", "before-scheduled", "before-processing", "before-in-b"]) {
      expect(await statusOf(label)).toEqual({ status: "suppressed", reason: SANDBOX_EMAIL_CHANGED });
    }
    expect(await statusOf("before-failed")).toEqual({ status: "failed", reason: null });
    expect(await statusOf("before-in-app")).toEqual({ status: "pending", reason: null });
    expect(await statusOf("not-a-member")).toEqual({ status: "pending", reason: null });
    expect(await count(`SELECT count(*) FROM notifications WHERE workspace_id = ANY($1::uuid[]) AND suppressed_reason = $2`, [[idA, idB], SANDBOX_EMAIL_CHANGED])).toBe(expectedSkipped);
    expect(first.output).toContain(`${expectedSkipped} emails queued for the old addresses skipped, never sent (${SANDBOX_EMAIL_CHANGED})`);

    // A notice queued after the change: the sender reads the address from the person, so it goes to the new inbox.
    await notify(idA, ids.sales, "email", "pending", "after-pending");
    const config = appConfig();
    const database = new DatabaseService(config);
    const sent: Array<{ to: string; subject: string }> = [];
    const mailer = { sendStaffNotice: async (input: { to: string; subject: string }) => {
      sent.push({ to: input.to, subject: input.subject });
      return { status: "sent", provider: "test", messageId: randomUUID() };
    } };
    try {
      const notifications = new CrmNotificationsService(database, undefined as never, undefined as never, undefined, undefined, mailer as never, config as never);
      for (const workspaceId of [idA, idB]) await notifications.dispatchStaffEmailsInternal({ workspaceId, limit: 100 });
    } finally {
      await database.onModuleDestroy();
    }
    expect(sent).toContainEqual({ to: at("sales"), subject: `after-pending ${tag}` });
    expect(sent.filter((mail) => mail.subject.startsWith("before-"))).toEqual([]);
    expect(sent.filter((mail) => ROLES.some((role) => mail.to === old(role)))).toEqual([]);
    expect(await statusOf("after-pending")).toEqual({ status: "delivered", reason: null });
  });

  it("audits each change in every organization the person belongs to, as the operator CLI", async () => {
    for (const workspaceId of [idA, idB]) {
      const rows = (await pool.query<{ userId: string; before: string; after: string; via: string; actor: string | null }>(
        `SELECT entity_id AS "userId", before->>'email' AS before, after->>'email' AS after, via, actor_user_id AS actor FROM audit_events
          WHERE workspace_id = $1 AND action = 'auth.primary_email_changed'`, [workspaceId])).rows;
      expect(rows).toHaveLength(12);
      for (const row of rows) {
        const role = ROLES.find((key) => ids[key] === row.userId)!;
        expect(row).toEqual({ userId: ids[role], before: old(role), after: at(role), via: "operator_cli", actor: null });
      }
    }
    expect((await pool.query(`SELECT before->>'emailPattern' AS before, after->>'emailPattern' AS after, via FROM audit_events
      WHERE workspace_id = $1 AND action = 'sandbox.email_pattern_set'`, [idA])).rows).toEqual([{ before: null, after: pattern, via: "operator_cli" }]);
  });

  it("changes nothing on a second run; later runs, with the pattern or without, in A or B, find the same people and make nobody new", async () => {
    for (const result of [second, plain, plainB, patternB]) {
      expect(result.code, result.output).toBe(0);
      const applied = json(result);
      expect(applied.counts.changed ?? 0).toBe(0);
      expect(applied.counts.failed ?? 0).toBe(0);
      expect(applied.newUserIds).toEqual([]);
      expect(Object.fromEntries(applied.members.map((member) => [member.key, { email: member.email, userId: member.userId }])))
        .toEqual(Object.fromEntries(ROLES.map((role) => [role, { email: at(role), userId: ids[role] }])));
    }
    expect(json(second).lines).toEqual(expect.arrayContaining([expect.objectContaining({ section: "email", status: "unchanged", label: at("sales") })]));
    expect(await count(`SELECT count(*) FROM users`)).toBe(usersBefore + 12);
    expect(await count(`SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND action = 'auth.primary_email_changed'`, [idA])).toBe(12);
  });

  it("refuses a person who also belongs to an organization the sandbox didn't make, and changes nobody's address", async () => {
    expect(refusedC.code).toBe(1);
    expect(refusedC.output).toContain(`${old("sales", c)} also belongs to ${otherSlug}`);
    expect(await count(`SELECT count(*) FROM users WHERE primary_email::text LIKE $1`, [`%@${c}.test`])).toBe(12);
    expect(await count(`SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND action IN ('auth.primary_email_changed', 'sandbox.email_pattern_set')`, [idC])).toBe(0);
    expect(await count(`SELECT count(*) FROM operator_sandbox_settings WHERE workspace_id = $1`, [idC])).toBe(0);
  });

  it("gives a new sandbox's members the pattern's addresses from the start, and refuses addresses someone else signs in with", async () => {
    expect(newD.code, newD.output).toBe(0);
    const idD = (await workspaceOf(d))!;
    const inD = (await pool.query<{ email: string; status: string }>(`SELECT person.primary_email::text AS email, membership.status FROM workspace_memberships membership
      JOIN users person ON person.id = membership.user_id WHERE membership.workspace_id = $1`, [idD])).rows;
    expect(inD.map((row) => row.email).sort()).toEqual(ROLES.map((role) => at(role, patternD)).sort());
    expect(inD.every((row) => row.status === "active")).toBe(true);
    expect(await count(`SELECT count(*) FROM users WHERE primary_email::text LIKE $1`, [`%@${d}.test`])).toBe(0);
    expect((await pool.query(`SELECT email_pattern AS pattern FROM operator_sandbox_settings WHERE workspace_id = $1`, [idD])).rows).toEqual([{ pattern: patternD }]);
    expect(againD.code, againD.output).toBe(0);
    expect(json(againD).counts.changed ?? 0).toBe(0);
    expect(json(againD).newUserIds).toEqual([]);
    expect(takenE.code).toBe(1);
    expect(takenE.output).toContain(`${at("owner")}`);
    expect(takenE.output).toContain("a new sandbox's test members are new people");
    expect(await workspaceOf(e)).toBeUndefined();
  });
});
