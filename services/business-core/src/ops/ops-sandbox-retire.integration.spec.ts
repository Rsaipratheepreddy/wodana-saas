import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { ConflictException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RequestActor } from "../auth/actor";
import { IdentityService } from "../auth/identity.service";
import { LocalAuthService } from "../auth/local-auth.service";
import { DatabaseService } from "../database/database.service";
import { TenantOperationsService } from "../workspaces/tenant-operations.service";
import { RETIRE_REASON, SANDBOX_RETIRED } from "./ops-sandbox-retire";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Sandbox A (AE) and organization A2 (IN,
// --organization-of A) are made for one inbox's plus-addresses and seeded a little; A is retired (A2 with it), then
// sandbox B (AE) and B2 (IN) are made with the SAME --email-pattern and adopt A's twelve people; finally A is restored.
// The CLI runs in a child process (the whole Nest application context, from source) as the app role wodana_app; sign-in,
// the profile and Wodana Control's billing commands run here, on their own services, as the app role too.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const run = promisify(execFile);
const fixtures = resolve(__dirname, "fixtures");
const docs = resolve(__dirname, "../../../../docs/fixtures");
const PASSWORD = `Sandbox#${randomUUID().slice(0, 8)}A1`;
const ROLES = ["owner", "manager", "sales", "designer", "design-manager", "qs", "purchasing", "factory", "logistics", "site", "finance", "accountant"];

type Result = { code: number; output: string };
type Line = { section: string; status: string; label: string; detail?: string };
type Json = { counts: Record<string, number>; lines: Line[]; members?: Array<{ key: string; email: string; userId: string | null }>; newUserIds?: string[] };
type Member = { userId: string; status: string; roles: string[]; teams: string[] };

integration("operator CLI sandbox --retire / --restore, and a new sandbox adopting the retired one's people (real Postgres)", () => {
  let pool: Pool;
  const tag = randomUUID().slice(0, 8);
  const a = `sbxr-${tag}`, a2 = `sbxs-${tag}`, b = `sbxt-${tag}`, b2 = `sbxu-${tag}`;
  const pattern = `wodanatechnology+{role}-r${tag}@gmail.com`;
  const at = (role: string) => pattern.replace("{role}", role);
  const otherId = randomUUID(), otherOwner = randomUUID(), otherSlug = `other-${otherId.slice(0, 8)}`;
  const teams = ["--teams", resolve(docs, "palm-teams-access.json")];
  const makeA = ["sandbox", "--slug", a, "--name", "Retire A", "--region", "AE", ...teams, "--password-env", "SANDBOX_TEST_PASSWORD", "--email-pattern", pattern];
  const addA2 = ["sandbox", "--slug", a2, "--name", "Retire A2", "--region", "IN", "--organization-of", a, ...teams];
  const retireA = ["sandbox", "--slug", a, "--retire"];
  const restoreA = ["sandbox", "--slug", a, "--restore"];
  // No --password-env: every member is adopted with their own password.
  const makeB = ["sandbox", "--slug", b, "--name", "Retire B", "--region", "AE", ...teams, "--email-pattern", pattern];
  const addB2 = ["sandbox", "--slug", b2, "--name", "Retire B2", "--region", "IN", "--organization-of", b, ...teams, "--email-pattern", pattern];

  let idA = "", idA2 = "", accountA = "", ids: Record<string, string> = {};
  const queued: Record<string, string> = {};
  let usersBefore = -1, usersAfterB = -1, outboxA = "", outboxLater = "";
  let afterRefusal: { users: number; provisioned: number } = { users: -1, provisioned: -1 };
  let credentialsBefore: Array<{ userId: string; hash: string }> = [];
  let kept: Record<string, number> = {};
  let subscriptionBefore = "";
  let enumeratedBefore: Record<string, string[]> = {};
  let afterDry: { statuses: string[]; pending: number; audits: number; account: string } = { statuses: [], pending: -1, audits: -1, account: "" };
  let dry: Result, addedOrg: Result, outsider: Result, retired: Result, retiredAgain: Result;
  let refusedB: Result, dryB: Result, madeB: Result, madeB2: Result, againB: Result, againB2: Result;
  let dryRestore: Result, restored: Result, restoredAgain: Result;
  let afterDryRestore = "";

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
  const appConfig = () => {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", "-c role=wodana_app");
    return new ConfigService({ DATABASE_URL: url.toString(), AUTH_MODE: "local", LOCAL_AUTH_JWT_SECRET: "sandbox-retire-integration-secret-at-least-32-chars",
      AUTH_DEVICE_LIMIT_EXEMPT_USER_IDS: Object.values(ids).join(",") });
  };
  /** Sign-in, the profile and Wodana Control's billing commands on their own services, as the app role. */
  async function services<T>(work: (tools: { auth: LocalAuthService; identities: IdentityService; operations: TenantOperationsService }) => Promise<T>) {
    const config = appConfig();
    const database = new DatabaseService(config);
    try {
      const identities = new IdentityService(database);
      const auth = new LocalAuthService(database, config, identities, {} as never, {
        beginPrimaryAuthentication: async () => ({ challengeRequired: false, assurance: { authenticationMethods: ["pwd"], mfaSessionVersion: 0 } }),
        status: async () => ({ enabled: false, required: false }),
      } as never);
      return await work({ auth, identities, operations: new TenantOperationsService(database) });
    } finally {
      await database.onModuleDestroy();
    }
  }
  const actorOf = (role: string): RequestActor => ({ subject: `operator-cli:${ids[role]}`, email: at(role), displayName: role, provider: "operator_cli", operator: { userId: ids[role] } });
  const count = async (sql: string, values: unknown[] = []) => Number((await pool.query<{ count: string }>(sql, values)).rows[0].count);
  const json = (result: Result) => JSON.parse(result.output) as Json;
  const workspaceOf = async (slug: string) => (await pool.query<{ id: string }>(`SELECT workspace_id AS id FROM tenant_login_branding WHERE login_slug = $1`, [slug])).rows[0]?.id;
  const statusOf = async (workspaceId: string) => (await pool.query<{ status: string }>(`SELECT status::text FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.status;
  const members = async (workspaceId: string) => (await pool.query<Member>(
    `SELECT membership.user_id AS "userId", membership.status::text AS status,
            ARRAY(SELECT role.code FROM member_roles link JOIN roles role ON role.id = link.role_id WHERE link.membership_id = membership.id ORDER BY role.code) AS roles,
            ARRAY(SELECT team.code FROM workspace_team_members link JOIN workspace_teams team ON team.id = link.team_id WHERE link.membership_id = membership.id ORDER BY team.code) AS teams
       FROM workspace_memberships membership WHERE membership.workspace_id = $1 ORDER BY membership.user_id`, [workspaceId])).rows;
  const notify = async (workspaceId: string, recipientId: string, channel: string, status: string, label: string) => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO notifications (id, workspace_id, recipient_type, recipient_id, channel, status, scheduled_for, subject, body, idempotency_key, correlation_id, processing_started_at)
       VALUES ($1, $2, 'user', $3, $4, $5::notification_status, CASE WHEN $5 = 'scheduled' THEN now() + interval '1 hour' ELSE now() END, $6, 'Body', $7, $8,
               CASE WHEN $5 = 'processing' THEN now() - interval '10 minutes' END)`,
      [id, workspaceId, recipientId, channel, status, `${label} ${tag}`, `sandbox-retire-test:${label}:${tag}`, randomUUID()]);
    queued[label] = id;
  };
  const notification = async (label: string) => (await pool.query<{ status: string; reason: string | null }>(
    `SELECT status::text, suppressed_reason AS reason FROM notifications WHERE id = $1`, [queued[label]])).rows[0];
  const outbox = async (workspaceId: string) => (await pool.query<{ id: string }>(
    `INSERT INTO outbox_events (workspace_id, aggregate_type, aggregate_id, event_type, payload, available_at)
     VALUES ($1, 'notification', $2, 'notification.delivery_requested.v1', '{}'::jsonb, timestamptz '2000-01-01') RETURNING id`, [workspaceId, randomUUID()])).rows[0].id;
  /** Each cross-tenant enumeration a scheduler or worker uses, as the app role. */
  async function enumerations(): Promise<Record<string, string[]>> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE wodana_app");
      const list = async (sql: string) => (await client.query<{ workspace_id: string }>(sql)).rows.map((row) => row.workspace_id);
      const result = {
        reminders: await list("SELECT workspace_id FROM list_reminder_engine_workspaces()"),
        crm: await list("SELECT workspace_id FROM list_crm_workspaces_with_due_work() UNION SELECT workspace_id FROM list_crm_workspaces_with_due_inbox_work()"),
        books: await list("SELECT workspace_id FROM list_books_workspaces()"),
        cleanup: await list("SELECT workspace_id FROM workspace_object_cleanup_workspaces()"),
        controlPlane: await list("SELECT workspace_id FROM list_control_plane_workspaces()"),
        // The outbox publisher's claim: rolled back below, so nothing is really claimed.
        outbox: (await client.query<{ id: string }>("SELECT id FROM claim_outbox_events(100, gen_random_uuid(), 60)")).rows.map((row) => row.id),
      };
      await client.query("ROLLBACK");
      return result;
    } finally {
      client.release();
    }
  }
  const keptCounts = async () => Object.fromEntries(await Promise.all([
    ["memberships", `SELECT count(*) FROM workspace_memberships WHERE workspace_id = ANY($1::uuid[])`],
    ["roles", `SELECT count(*) FROM roles WHERE workspace_id = ANY($1::uuid[])`],
    ["teams", `SELECT count(*) FROM workspace_teams WHERE workspace_id = ANY($1::uuid[])`],
    ["entities", `SELECT count(*) FROM legal_entities WHERE workspace_id = ANY($1::uuid[])`],
    ["notifications", `SELECT count(*) FROM notifications WHERE workspace_id = ANY($1::uuid[])`],
    ["outbox", `SELECT count(*) FROM outbox_events WHERE workspace_id = ANY($1::uuid[])`],
  ].map(async ([name, sql]) => [name, await count(sql, [[idA, idA2]])] as const)));

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
    const [madeA, madeA2] = await cli([[...makeA, "--apply"], [...addA2, "--apply"]]);
    for (const made of [madeA, madeA2]) expect(made.code, made.output).toBe(0);
    idA = (await workspaceOf(a))!; idA2 = (await workspaceOf(a2))!;
    accountA = (await pool.query<{ id: string }>(`SELECT account_id AS id FROM customer_account_organizations WHERE workspace_id = $1`, [idA])).rows[0].id;
    const people = (await pool.query<{ id: string; email: string }>(`SELECT id, primary_email::text AS email FROM users WHERE primary_email::text = ANY($1::text[])`,
      [ROLES.map(at)])).rows;
    ids = Object.fromEntries(ROLES.map((role) => [role, people.find((person) => person.email === at(role))!.id]));
    credentialsBefore = (await pool.query(`SELECT user_id AS "userId", password_hash AS hash FROM local_auth_credentials WHERE user_id = ANY($1::uuid[]) ORDER BY user_id`,
      [Object.values(ids)])).rows;

    // ---------- a little of everything a retired organization must not send, run or bill ----------
    await notify(idA, ids.sales, "email", "pending", "a-email");
    await notify(idA, ids.qs, "whatsapp", "scheduled", "a-whatsapp");
    await notify(idA, ids.finance, "push", "processing", "a-push");
    await notify(idA, ids.sales, "in_app", "pending", "a-in-app");
    await notify(idA, ids.site, "email", "failed", "a-failed");
    await notify(idA2, ids.manager, "email", "pending", "a2-email");
    outboxA = await outbox(idA);
    const entity = (await pool.query<{ id: string }>(`SELECT id FROM legal_entities WHERE workspace_id = $1`, [idA])).rows[0].id;
    await pool.query(`INSERT INTO books_settings (workspace_id, legal_entity_id, enabled, start_date, functional_currency) VALUES ($1, $2, true, current_date, 'AED')`, [idA, entity]);
    await pool.query(`INSERT INTO workspace_object_cleanup_queue (workspace_id, object_key, clear_run_id) VALUES ($1, $2, $3)`, [idA, `retire-test/${tag}`, randomUUID()]);
    // Wodana Control's billing for the account: a contract, A's allocation and a collection state.
    const contract = (await pool.query<{ id: string }>(
      `INSERT INTO account_contract_versions (account_id, version, status, plan_code, plan_version, currency, billing_cycle, recurring_amount, seat_limit, project_limit,
         term_starts_at, reason, created_by)
       VALUES ($1, 1, 'trial_uncontracted', 'starter', 1, 'AED', 'monthly', 0, 40, 50, now(), 'Retire test: the account contract.', $2) RETURNING id`, [accountA, ids.owner])).rows[0].id;
    await pool.query(`INSERT INTO organization_billing_allocation_versions (workspace_id, account_contract_version_id, version, status, allocated_amount, seat_limit, project_limit,
      effective_from, reason, created_by) VALUES ($1, $2, 1, 'active', 0, 30, 25, now() - interval '1 day', 'Retire test: the allocation of A.', $3)`, [idA, contract, ids.owner]);
    await pool.query(`INSERT INTO account_collection_state_versions (account_id, version, status, overdue_amount, currency, reason, created_by)
      VALUES ($1, 1, 'current', 0, 'AED', 'Retire test: the account is current.', $2)`, [accountA, ids.owner]);
    subscriptionBefore = (await pool.query<{ status: string }>(`SELECT status FROM workspace_subscriptions WHERE workspace_id = $1`, [idA])).rows[0].status;
    // An organization the sandbox command didn't make.
    await pool.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Other Owner')", [otherOwner, `owner-${otherOwner.slice(0, 8)}@example.test`]);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [otherId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_locale,default_timezone,created_by) VALUES($1,'Other Studio',$2,'USD','en-US','UTC',$3)", [otherId, otherSlug, otherOwner]);
      await client.query("INSERT INTO tenant_login_branding(workspace_id,login_slug,display_name) VALUES($1,$2,'Other Studio')", [otherId, otherSlug]);
      await client.query("INSERT INTO workspace_memberships(workspace_id,user_id,status) VALUES($1,$2,'active')", [otherId, otherOwner]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    enumeratedBefore = await enumerations();
    kept = await keptCounts();

    // ---------- retire A: a dry run, refusals, then for real (twice) ----------
    [dry, addedOrg, outsider] = await cli([retireA, ["sandbox", "--slug", a2, "--retire", "--apply"], ["sandbox", "--slug", otherSlug, "--retire", "--apply"]]);
    afterDry = {
      statuses: [await statusOf(idA), await statusOf(idA2)],
      pending: await count(`SELECT count(*) FROM notifications WHERE workspace_id = ANY($1::uuid[]) AND status IN ('pending', 'scheduled', 'processing')`, [[idA, idA2]]),
      audits: await count(`SELECT count(*) FROM audit_events WHERE workspace_id = ANY($1::uuid[]) AND action LIKE 'sandbox.%retired'`, [[idA, idA2]]),
      account: (await pool.query<{ status: string }>(`SELECT status FROM customer_accounts WHERE id = $1`, [accountA])).rows[0].status,
    };
    [retired, retiredAgain] = await cli([[...retireA, "--apply"], [...retireA, "--apply", "--json"]]);

    // ---------- B adopts A's people: refused while one of them is still active elsewhere ----------
    usersBefore = await count(`SELECT count(*) FROM users`);
    const membership = async (sql: string) => {
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        await connection.query("SELECT set_config('app.current_workspace_id',$1,true)", [otherId]);
        await connection.query(sql, [otherId, ids.site]);
        await connection.query("COMMIT");
      } finally {
        connection.release();
      }
    };
    await membership("INSERT INTO workspace_memberships(workspace_id,user_id,status) VALUES($1,$2,'active')");
    [refusedB] = await cli([[...makeB, "--apply"]]);
    afterRefusal = { users: await count(`SELECT count(*) FROM users`),
      provisioned: await count(`SELECT count(*) FROM tenant_provisioning_requests WHERE external_tenant_id = $1`, [`sandbox-${b}`]) };
    // No longer active there: now only a retired sandbox's person.
    await membership("UPDATE workspace_memberships SET status = 'suspended' WHERE workspace_id = $1 AND user_id = $2");
    [dryB, madeB, madeB2, againB, againB2] = await cli([makeB, [...makeB, "--apply"], [...addB2, "--apply"], [...makeB, "--apply", "--json"], [...addB2, "--apply", "--json"]]);
    usersAfterB = await count(`SELECT count(*) FROM users`);
  }, 2_400_000);
  afterAll(async () => {
    // A is active again: its test fixtures must not reach the workers other specs run (storage cleanup, Ledger, outbox).
    if (pool && idA) {
      await pool.query(`UPDATE workspace_object_cleanup_queue SET status = 'failed', last_error = 'retire test fixture' WHERE workspace_id = $1 AND status = 'pending'`, [idA]);
      await pool.query(`UPDATE books_settings SET enabled = false WHERE workspace_id = $1`, [idA]);
      await pool.query(`UPDATE notifications SET status = 'suppressed', suppressed_reason = 'retire test fixture' WHERE workspace_id = $1 AND status IN ('pending', 'scheduled', 'processing')`, [idA]);
      await pool.query(`UPDATE outbox_events SET status = 'published', published_at = now(), last_error = 'retire test fixture' WHERE workspace_id = $1 AND status IN ('pending', 'failed')`, [idA]);
    }
    await pool?.end();
  });

  it("previews the retirement and writes nothing", () => {
    expect(dry.code, dry.output).toBe(0);
    expect(dry.output).toMatch(new RegExp(`\\[organization\\] would change +${a}: active → archived`));
    expect(dry.output).toMatch(new RegExp(`\\[organization\\] would change +${a2}: active → archived`));
    expect(dry.output).toContain("1 email, 1 push, 1 whatsapp waiting: suppressed (sandbox_retired), never sent; in-app notices kept");
    expect(dry.output).toMatch(/\[billing\] would change +collection: current → closed/);
    expect(dry.output).toMatch(new RegExp(`\\[account\\] would change +sandbox-${a}: active → archived`));
    // Four messages for outside delivery and one in-app notice, still waiting.
    expect(afterDry).toEqual({ statuses: ["active", "active"], pending: 5, audits: 0, account: "active" });
  });

  it("refuses an organization added to a sandbox (its sandbox covers it) and an organization the command didn't make", async () => {
    expect(addedOrg.code).toBe(1);
    expect(addedOrg.output).toContain(`${a2} is an organization in the account of sandbox ${a}: sandbox --slug ${a} --retire covers every organization`);
    expect(outsider.code).toBe(1);
    expect(outsider.output).toContain(`${otherSlug} is not a sandbox this command made`);
    expect(await statusOf(otherId)).toBe("active");
  });

  it("archives A and A2 and the account, keeps every record, and a second run changes nothing", { timeout: 60_000 }, async () => {
    expect(retired.code, retired.output).toBe(0);
    expect([await statusOf(idA), await statusOf(idA2)]).toEqual(["archived", "archived"]);
    expect(await count(`SELECT count(*) FROM workspaces WHERE id = ANY($1::uuid[]) AND archived_at IS NOT NULL`, [[idA, idA2]])).toBe(2);
    expect((await pool.query(`SELECT status FROM customer_accounts WHERE id = $1`, [accountA])).rows[0].status).toBe("archived");
    expect(await keptCounts()).toEqual(kept);
    expect(await count(`SELECT count(*) FROM users WHERE id = ANY($1::uuid[]) AND status = 'active'`, [Object.values(ids)])).toBe(12);
    expect(retired.output).toContain("nothing deleted: every record, person, file and audit row stays");
    const again = json(retiredAgain);
    expect(retiredAgain.code, retiredAgain.output).toBe(0);
    expect(again.counts.changed ?? 0).toBe(0);
    expect(again.counts.failed ?? 0).toBe(0);
  });

  it("suppresses what was waiting to be sent (sandbox_retired) and the queued outbox events, and keeps in-app notices", async () => {
    for (const label of ["a-email", "a-whatsapp", "a-push", "a2-email"]) expect(await notification(label)).toEqual({ status: "suppressed", reason: SANDBOX_RETIRED });
    expect(await notification("a-in-app")).toEqual({ status: "pending", reason: null });
    expect(await notification("a-failed")).toEqual({ status: "failed", reason: null });
    expect((await pool.query(`SELECT status::text, last_error FROM outbox_events WHERE id = $1`, [outboxA])).rows[0])
      .toEqual({ status: "published", last_error: `suppressed: ${SANDBOX_RETIRED} (never published)` });
  });

  it("takes the account out of billing: collection closed, subscriptions cancelled, the allocation ended, nothing new recorded", { timeout: 60_000 }, async () => {
    expect((await pool.query(`SELECT version, status, reason FROM account_collection_state_versions WHERE account_id = $1 ORDER BY version`, [accountA])).rows.map((row) => [row.version, row.status]))
      .toEqual([[1, "current"], [2, "closed"]]);
    expect((await pool.query(`SELECT status FROM workspace_subscriptions WHERE workspace_id = ANY($1::uuid[])`, [[idA, idA2]])).rows.map((row) => row.status)).toEqual(["cancelled", "cancelled"]);
    expect((await pool.query(`SELECT version, status, reason FROM organization_billing_allocation_versions WHERE workspace_id = $1 ORDER BY version`, [idA])).rows)
      .toEqual([{ version: 1, status: "active", reason: "Retire test: the allocation of A." }, { version: 2, status: "ended", reason: RETIRE_REASON }]);
    await services(async ({ operations }) => {
      await expect(operations.captureUsageSnapshot(`sandbox-${a}`, { periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-10-01T00:00:00Z", source: "computed" } as never, ids.owner))
        .rejects.toThrow("This account is retired");
      await expect(operations.updateCollectionState(`sandbox-${a}`, { expectedVersion: 2, status: "current", overdueAmount: 0, currency: "AED",
        reason: "Back to current while it is retired." } as never, ids.owner)).rejects.toBeInstanceOf(ConflictException);
    });
    expect(await count(`SELECT count(*) FROM account_usage_snapshots WHERE account_id = $1`, [accountA])).toBe(0);
    expect(retired.output).toMatch(/\[billing\] changed +collection: current → closed/);
    expect(retired.output).toContain("nothing new is billed or measured while it is retired");
  });

  it("audits the retirement in each organization and in Wodana Control's trail, as the operator CLI", { timeout: 60_000 }, async () => {
    for (const workspaceId of [idA, idA2]) {
      const rows = (await pool.query(`SELECT before->>'status' AS before, after->>'status' AS after, after->>'reason' AS reason, via FROM audit_events
        WHERE workspace_id = $1 AND action = 'sandbox.retired'`, [workspaceId])).rows;
      expect(rows).toEqual([{ before: "active", after: "archived", reason: SANDBOX_RETIRED, via: "operator_cli" }]);
    }
    expect(await count(`SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND action IN ('sandbox.account_retired', 'account.collection_state_versioned')
      AND via = 'operator_cli'`, [idA])).toBe(2);
    expect(await count(`SELECT count(*) FROM platform_operator_audit WHERE action IN ('sandbox.retired', 'sandbox.account_retired') AND details->>'sandbox' = $1`, [a])).toBe(3);
  });

  it("closes sign-in, the login address and the switcher for the retired organizations", { timeout: 60_000 }, async () => {
    await services(async ({ auth, identities }) => {
      await expect(auth.login(at("sales"), PASSWORD, a)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(auth.login(at("sales"), PASSWORD, a2)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(auth.getTenantBranding(a)).rejects.toBeInstanceOf(NotFoundException);
      await expect(auth.resolveOrganization(a2)).rejects.toBeInstanceOf(NotFoundException);
      await expect(auth.getTenantBranding(b)).resolves.toMatchObject({ loginSlug: b });
      const profile = await identities.getProfile(actorOf("designer")) as { memberships: Array<{ workspaceId: string }>; unavailableOrganizations: unknown[] };
      expect(profile.memberships.map((membership) => membership.workspaceId).sort()).toEqual([await workspaceOf(b), await workspaceOf(b2)].sort());
      expect(profile.unavailableOrganizations).toEqual([]);
    });
  });

  it("is skipped by every scheduler and worker enumeration once archived", { timeout: 60_000 }, async () => {
    for (const name of ["reminders", "crm", "books", "cleanup", "controlPlane"]) expect(enumeratedBefore[name], name).toContain(idA);
    expect(enumeratedBefore.reminders).toContain(idA2);
    expect(enumeratedBefore.outbox).toContain(outboxA);
    // Written after the retirement: still never picked up.
    await notify(idA, ids.sales, "email", "pending", "a-later");
    outboxLater = await outbox(idA);
    const now = await enumerations();
    for (const name of ["reminders", "crm", "books", "cleanup", "controlPlane"]) {
      expect(now[name], name).not.toContain(idA);
      expect(now[name], name).not.toContain(idA2);
    }
    expect(now.outbox).not.toContain(outboxLater);
    // B, active, is enumerated as before.
    expect(now.reminders).toContain(await workspaceOf(b));
  });

  it("refuses to adopt someone with an active membership in an organization that isn't a retired sandbox's, and makes nothing", async () => {
    expect(refusedB.code).toBe(1);
    expect(refusedB.output).toContain(`${at("site")} (an active member of ${otherSlug})`);
    expect(refusedB.output).toContain("a new sandbox's test members are new people or people of a retired sandbox");
    expect(afterRefusal).toEqual({ users: usersBefore, provisioned: 0 });
  });

  it("makes B and B2 for the same people: adopted, no new users, passwords unchanged, same roles and teams", { timeout: 60_000 }, async () => {
    expect(dryB.code, dryB.output).toBe(0);
    expect(dryB.output).toContain(`${at("sales")}: adopted from retired sandbox ${a}: the same person (user ${ids.sales}), password unchanged`);
    expect(dryB.output).not.toContain("--apply needs --password-env");
    for (const result of [madeB, madeB2]) expect(result.code, result.output).toBe(0);
    expect(madeB.output).toContain("No new people: the device-limit exemption needs no change.");
    expect(usersAfterB).toBe(usersBefore);
    expect((await pool.query(`SELECT user_id AS "userId", password_hash AS hash FROM local_auth_credentials WHERE user_id = ANY($1::uuid[]) ORDER BY user_id`,
      [Object.values(ids)])).rows).toEqual(credentialsBefore);
    const idB = (await workspaceOf(b))!, idB2 = (await workspaceOf(b2))!;
    const shape = (rows: Member[]) => rows.map(({ userId, roles, teams: joined }) => ({ userId, roles, teams: joined }));
    const inA = await members(idA), inB = await members(idB), inB2 = await members(idB2);
    expect(inB.map((member) => member.userId).sort()).toEqual(Object.values(ids).sort());
    expect(inB.every((member) => member.status === "active") && inB2.every((member) => member.status === "active")).toBe(true);
    expect(shape(inB)).toEqual(shape(inA));
    expect(shape(inB2)).toEqual(shape(inB));
    expect(await count(`SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND action = 'auth.local_password_set'`, [idB])).toBe(0);
    for (const result of [againB, againB2]) {
      expect(result.code, result.output).toBe(0);
      expect(json(result).counts.changed ?? 0).toBe(0);
      expect(json(result).newUserIds).toEqual([]);
    }
  });

  it("signs an adopted person in to B with their old password, straight into B; B2 is a switch away", { timeout: 60_000 }, async () => {
    const idB = (await workspaceOf(b))!, idB2 = (await workspaceOf(b2))!;
    await services(async ({ auth }) => {
      const session = await auth.login(at("sales").toUpperCase(), PASSWORD, b) as { selectedWorkspaceId: string; accessToken: string };
      expect(session.selectedWorkspaceId).toBe(idB);
      const claims = JSON.parse(Buffer.from(session.accessToken.split(".")[1], "base64url").toString()) as { sub: string };
      expect(claims.sub).toBe(`local:${ids.sales}`);
      // Email-first sign-in offers the active organizations only.
      const choice = await auth.login(at("manager"), PASSWORD, undefined) as { workspaceSelectionRequired: boolean; workspaces: Array<{ workspaceId: string }> };
      expect(choice.workspaceSelectionRequired).toBe(true);
      expect(choice.workspaces.map((workspace) => workspace.workspaceId).sort()).toEqual([idB, idB2].sort());
      expect((await auth.login(at("manager"), PASSWORD, b2) as { selectedWorkspaceId: string }).selectedWorkspaceId).toBe(idB2);
    });
  });

  it("restores A: a dry run writes nothing, then A, A2, the account and billing are back as they were; a second run changes nothing", { timeout: 1_200_000 }, async () => {
    [dryRestore] = await cli([restoreA]);
    afterDryRestore = (await statusOf(idA))!;
    [restored, restoredAgain] = await cli([[...restoreA, "--apply"], [...restoreA, "--apply", "--json"]]);
    expect(dryRestore.code, dryRestore.output).toBe(0);
    expect(dryRestore.output).toMatch(new RegExp(`\\[organization\\] would change +${a}: archived → active`));
    expect(afterDryRestore).toBe("archived");
    expect(restored.code, restored.output).toBe(0);
    expect([await statusOf(idA), await statusOf(idA2)]).toEqual(["active", "active"]);
    expect(await count(`SELECT count(*) FROM workspaces WHERE id = ANY($1::uuid[]) AND archived_at IS NOT NULL`, [[idA, idA2]])).toBe(0);
    expect((await pool.query(`SELECT status FROM customer_accounts WHERE id = $1`, [accountA])).rows[0].status).toBe("active");
    expect((await pool.query(`SELECT version, status FROM account_collection_state_versions WHERE account_id = $1 ORDER BY version`, [accountA])).rows.map((row) => [row.version, row.status]))
      .toEqual([[1, "current"], [2, "closed"], [3, "current"]]);
    expect((await pool.query(`SELECT status FROM workspace_subscriptions WHERE workspace_id = ANY($1::uuid[])`, [[idA, idA2]])).rows.map((row) => row.status))
      .toEqual([subscriptionBefore, subscriptionBefore]);
    expect((await pool.query(`SELECT version, status FROM organization_billing_allocation_versions WHERE workspace_id = $1 ORDER BY version`, [idA])).rows.map((row) => [row.version, row.status]))
      .toEqual([[1, "active"], [2, "ended"], [3, "active"]]);
    expect(await count(`SELECT count(*) FROM audit_events WHERE workspace_id = ANY($1::uuid[]) AND action = 'sandbox.restored' AND via = 'operator_cli'`, [[idA, idA2]])).toBe(2);
    // What was suppressed stays suppressed.
    expect(await notification("a-email")).toEqual({ status: "suppressed", reason: SANDBOX_RETIRED });
    expect(json(restoredAgain).counts.changed ?? 0).toBe(0);
    await services(async ({ auth }) => {
      expect((await auth.login(at("sales"), PASSWORD, a) as { selectedWorkspaceId: string }).selectedWorkspaceId).toBe(idA);
      await expect(auth.getTenantBranding(a)).resolves.toMatchObject({ loginSlug: a });
    });
    expect((await enumerations()).reminders).toEqual(expect.arrayContaining([idA, idA2]));
  });

  it("keeps A's and B's records apart (tenant isolation as the app role)", { timeout: 60_000 }, async () => {
    const idB = (await workspaceOf(b))!;
    const client = await pool.connect();
    try {
      for (const [here, there] of [[idA, idB], [idB, idA]]) {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE wodana_app");
        await client.query("SELECT set_config('app.current_workspace_id', $1, true), set_config('app.current_actor_id', $2, true)", [here, ids.owner]);
        const seen = async (sql: string, values: unknown[] = []) => Number((await client.query<{ count: string }>(sql, values)).rows[0].count);
        expect(await seen(`SELECT count(*) FROM audit_events WHERE workspace_id = $1`, [there])).toBe(0);
        expect(await seen(`SELECT count(*) FROM notifications WHERE workspace_id = $1`, [there])).toBe(0);
        expect(await seen(`SELECT count(*) FROM workspace_subscriptions WHERE workspace_id = $1`, [there])).toBe(0);
        expect(await seen(`SELECT count(*) FROM legal_entities`)).toBe(1);
        await client.query("ROLLBACK");
      }
    } finally {
      client.release();
    }
  });
});
