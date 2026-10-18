import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CrmNotificationsService } from "../crm/notifications/crm-notifications.service";
import { DatabaseService } from "../database/database.service";
import { EmailSendLimiter, type EmailSendRate } from "../email/email-send-limiter";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { runFallbacks } from "../reminders/delivery/fallback";
import { runHealthAlerts } from "../reminders/digest/health-alerts";
import { loadEngineContext } from "../reminders/engine/context";
import { createSourceRegistry, type DueItem, type ReminderSource } from "../reminders/engine/engine";
import { sweepWorkspace } from "../reminders/engine/sweep";
import { REMINDER_KIND_INFO } from "../reminders/reminders-contract";
import { seedDefaultNotificationTemplates } from "./default-templates";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). The incident of the first reminder
// sweep: a burst of critical emails at a provider that answers 429 above 5 a second. The staff email dispatcher runs
// as the app role (wodana_app, forced RLS) through the real mailer and its send limit; Mailgun is a fake (fetch).
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const SERVICE = "00000000-0000-0000-0000-000000000000";

/** A fake Mailgun: at most 5 accepted sends in any rolling second (less `slack` ms), else 429 with Retry-After 1. */
function fakeMailgun(options: { slack?: number; refuse?: (subject: string) => number | null } = {}) {
  const accepted: Array<{ at: number; subject: string }> = [];
  const throttled: string[] = [];
  const refused: string[] = [];
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const form = init.body as FormData;
    const subject = String(form.get("subject"));
    const status = options.refuse?.(subject);
    if (status) {
      refused.push(subject);
      return new Response(JSON.stringify({ message: "refused" }), { status });
    }
    const now = Date.now();
    if (accepted.filter((send) => send.at > now - 1_000 + (options.slack ?? 0)).length >= 5) {
      throttled.push(subject);
      return new Response(JSON.stringify({ message: "Too many requests" }), { status: 429, headers: { "Retry-After": "1" } });
    }
    accepted.push({ at: now, subject });
    return new Response(JSON.stringify({ id: `<${randomUUID()}@mg.test>`, message: "Queued" }), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { fetch, accepted, throttled, refused };
}

integration("email sending under provider rate limits (send limit, retries, alerts, the sweep's email cap)", { timeout: 180_000 }, () => {
  let pool: Pool;
  let database: DatabaseService;
  const run = randomUUID().slice(0, 8);
  const ws = randomUUID();
  const users = { owner: randomUUID(), finance: randomUUID(), sales: randomUUID() };
  const m = { owner: randomUUID(), finance: randomUUID(), sales: randomUUID() };
  const ownerRole = randomUUID();
  const mailgun = { MAILGUN_API_KEY: "test-key", MAILGUN_DOMAIN: "mg.test", MAILGUN_FROM: "Firm <hello@mg.test>" };

  async function tenant<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [ws, SERVICE]);
      await client.query("SET LOCAL ROLE wodana_app");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Queues `count` critical staff emails (the engine's kind of notice), due now. */
  async function queue(prefix: string, count: number) {
    const recipients = [users.owner, users.finance, users.sales];
    await tenant((client) => client.query(
      `INSERT INTO notifications (workspace_id, recipient_type, recipient_id, channel, event_type, status, scheduled_for, subject, body, idempotency_key, correlation_id, critical)
       SELECT $1, 'user', ($3::uuid[])[1 + (n % 3)], 'email', 'receivables.overdue', 'pending', now(), $2 || ' ' || n, 'An invoice is overdue', 'rem:' || $2 || ':' || n, gen_random_uuid(), true
         FROM generate_series(1, $4::int) n`, [ws, prefix, recipients, count]));
  }

  const notices = async (prefix: string) => (await pool.query<{ id: string; subject: string; status: string; attempts: string[]; codes: (string | null)[] }>(
    `SELECT notice.id, notice.subject, notice.status::text AS status,
            coalesce(array_agg(attempt.status ORDER BY attempt.attempt) FILTER (WHERE attempt.id IS NOT NULL), '{}') AS attempts,
            coalesce(array_agg(attempt.error_code ORDER BY attempt.attempt) FILTER (WHERE attempt.id IS NOT NULL), '{}') AS codes
       FROM notifications notice LEFT JOIN notification_delivery_attempts attempt ON attempt.workspace_id = notice.workspace_id AND attempt.notification_id = notice.id
      WHERE notice.workspace_id = $1 AND notice.idempotency_key LIKE $2 GROUP BY notice.id ORDER BY notice.subject`, [ws, `rem:${prefix}:%`])).rows;

  /** Time passes: what waits for a retry (or a slot) is due now, in the same order. */
  const timePasses = () => pool.query(`UPDATE notifications SET scheduled_for = scheduled_for - interval '2 hours' WHERE workspace_id = $1 AND status = 'scheduled'`, [ws]);

  const dispatcher = (rate: EmailSendRate) => {
    const config = new ConfigService(mailgun);
    const mailer = new TransactionalEmailService(config, database, undefined, new EmailSendLimiter(rate));
    return new CrmNotificationsService(database, undefined as never, undefined as never, undefined, undefined, mailer, config);
  };

  /** The worker's loop: dispatch until nothing is left to send (or `rounds` run out), letting time pass between calls. */
  async function drain(notifications: CrmNotificationsService, prefix: string, rounds = 12, onRetrying?: () => Promise<void>) {
    for (let round = 0; round < rounds; round++) {
      await notifications.dispatchStaffEmailsInternal({ workspaceId: ws, limit: 100 });
      const left = (await notices(prefix)).filter((notice) => ["pending", "scheduled", "processing"].includes(notice.status));
      if (!left.length) return round + 1;
      if (onRetrying && left.some((notice) => notice.attempts.includes("retry"))) await onRetrying();
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      await timePasses();
    }
    throw new Error("emails still waiting");
  }

  const sources = createSourceRegistry([]);
  const alertsAndFallbacks = () => tenant(async (client) => {
    const ctx = await loadEngineContext(client, ws, sources, new Date());
    return { health: await runHealthAlerts(client, ctx), fallback: await runFallbacks(client, ctx) };
  });
  const alertNotices = async () => (await pool.query<{ key: string }>(
    `SELECT idempotency_key AS key FROM notifications WHERE workspace_id = $1 AND (idempotency_key LIKE 'rem:health:%' OR idempotency_key LIKE 'rem:unreachable:%') ORDER BY 1`, [ws])).rows.map((row) => row.key);

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 6 });
    const app = new URL(url.toString());
    app.searchParams.set("options", "-c role=wodana_app");
    database = new DatabaseService(new ConfigService({ DATABASE_URL: app.toString() }));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [key, id] of Object.entries(users)) await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${key}-${run}@throttle.test`, key]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,status,created_by) VALUES($1,'Throttle firm',$2,'AED','Asia/Dubai','active',$3)", [ws, `thr-${run}`, users.owner]);
      for (const [key, membership] of Object.entries(m)) await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status,joined_at) VALUES($1,$2,$3,'active',now())", [membership, ws, users[key as keyof typeof users]]);
      await client.query("INSERT INTO roles(id,workspace_id,code,name,description,is_system) VALUES($1,$2,'owner','Owner','',true)", [ownerRole, ws]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [ws, m.owner, ownerRole]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await tenant((db) => seedDefaultNotificationTemplates(db, ws));
  }, 120_000);

  afterEach(() => { vi.unstubAllGlobals(); });

  afterAll(async () => {
    if (!pool) return;
    await database?.onModuleDestroy();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      for (const table of ["notification_delivery_attempts", "notifications", "reminder_steps", "reminder_digests", "reminder_subjects", "reminder_client_days", "notification_templates",
        "audit_events", "outbox_events", "member_roles", "roles", "workspace_memberships"]) {
        await client.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [ws]);
      }
      await client.query("DELETE FROM workspaces WHERE id = $1", [ws]);
      await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [Object.values(users)]);
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    await pool.end();
  }, 120_000);

  it("spreads a burst of 50 at the default limit (5 a second): every email sent once, none throttled, none failed", async () => {
    const provider = fakeMailgun({ slack: 25 });
    vi.stubGlobal("fetch", provider.fetch);
    await queue("burst", 50);
    const started = Date.now();
    await drain(dispatcher({ perSecond: 5, perMinute: 120 }), "burst");
    expect(provider.throttled).toEqual([]);
    expect(provider.accepted).toHaveLength(50);
    expect(new Set(provider.accepted.map((send) => send.subject)).size).toBe(50);
    // 5 a second: 50 take about nine seconds.
    expect(Date.now() - started).toBeGreaterThanOrEqual(8_500);
    const rows = await notices("burst");
    expect(rows.every((row) => row.status === "delivered" && row.attempts.join() === "delivered")).toBe(true);
    const checked = await alertsAndFallbacks();
    expect(checked.health).toEqual({ groups: 0, alerted: 0 });
    expect(checked.fallback.unreachable).toBe(0);
    expect(await alertNotices()).toEqual([]);
  });

  it("retries what a provider throttles (429 above 5 a second): all 50 delivered exactly once, nothing failed, no unreachable notice, no admin alert", async () => {
    const provider = fakeMailgun();
    vi.stubGlobal("fetch", provider.fetch);
    await queue("throttled", 50);
    // A limit set above what the provider takes, so the provider throttles and the retries carry the rest.
    let checkedWhileRetrying: Awaited<ReturnType<typeof alertsAndFallbacks>> | null = null;
    await drain(dispatcher({ perSecond: 25, perMinute: 1_000 }), "throttled", 12, async () => { checkedWhileRetrying ??= await alertsAndFallbacks(); });
    expect(provider.throttled.length).toBeGreaterThan(0);
    expect(provider.accepted).toHaveLength(50);
    const sentPerEmail = new Map<string, number>();
    for (const send of provider.accepted) sentPerEmail.set(send.subject, (sentPerEmail.get(send.subject) ?? 0) + 1);
    expect([...sentPerEmail.values()].every((count) => count === 1)).toBe(true);
    const rows = await notices("throttled");
    expect(rows.map((row) => row.status).every((status) => status === "delivered")).toBe(true);
    // Each throttled send is a 'retry' attempt with Mailgun's code, then delivered; nothing permanent.
    const retried = rows.filter((row) => row.attempts.includes("retry"));
    expect(retried.length).toBe(new Set(provider.throttled).size);
    expect(retried.every((row) => row.attempts.at(-1) === "delivered" && row.codes.filter(Boolean).every((code) => code === "MAILGUN_HTTP_429"))).toBe(true);
    expect(rows.some((row) => row.attempts.includes("permanent_failure"))).toBe(false);
    // While some waited for their retry, and after: no "delivery failing" alert, no fallback, no unreachable notice.
    expect(checkedWhileRetrying).toEqual({ health: { groups: 0, alerted: 0 }, fallback: { checked: 0, fellBack: 0, unreachable: 0, errors: [] } });
    expect(await alertsAndFallbacks()).toMatchObject({ health: { groups: 0, alerted: 0 } });
    expect(await alertNotices()).toEqual([]);
  });

  it("fails a permanent refusal (HTTP 400) once, never sends it again, and alerts the admins about it", async () => {
    const provider = fakeMailgun({ refuse: (subject) => (subject.startsWith("refused") ? 400 : null) });
    vi.stubGlobal("fetch", provider.fetch);
    await queue("refused", 1);
    const notifications = dispatcher({ perSecond: 5, perMinute: 120 });
    await notifications.dispatchStaffEmailsInternal({ workspaceId: ws, limit: 100 });
    await timePasses();
    await notifications.dispatchStaffEmailsInternal({ workspaceId: ws, limit: 100 });
    expect(provider.refused).toEqual(["refused 1"]);
    expect(await notices("refused")).toEqual([expect.objectContaining({ status: "failed", attempts: ["permanent_failure"], codes: ["MAILGUN_HTTP_400"] })]);
    // A final failure of a critical notice is what the admins hear about.
    expect((await alertsAndFallbacks()).health).toMatchObject({ groups: 1, alerted: 1 });
    expect((await alertNotices()).filter((key) => key.startsWith("rem:health:email:MAILGUN_HTTP_400:"))).toHaveLength(2);
    await pool.query(`DELETE FROM notifications WHERE workspace_id = $1 AND idempotency_key LIKE 'rem:health:%'`, [ws]);
  });

  describe("the sweep's email cap", () => {
    const items = new Map<string, DueItem>();
    const source: ReminderSource = {
      kind: "invoice.overdue", module: REMINDER_KIND_INFO["invoice.overdue"].module, audience: "staff", critical: true, notify: "engine", viewPermission: "receivables.view",
      template: { code: "reminders.invoice.overdue" },
      open: async () => [...items.values()],
      stillOpen: async (_db, _ws, keys) => new Set(keys.filter((key) => items.has(key))),
    };
    const registry = createSourceRegistry([source]);
    const sweep = (now: Date, emailCap?: number) => tenant((client) => sweepWorkspace(client, ws, { sources: registry, now, scan: true, digests: false, health: false, emailCap }));
    const reminderNotices = async () => (await pool.query<{ channel: string; status: string; scheduledFor: Date; key: string }>(
      `SELECT notice.channel, notice.status::text AS status, notice.scheduled_for AS "scheduledFor", notice.idempotency_key AS key FROM notifications notice
        JOIN reminder_steps step ON step.workspace_id = notice.workspace_id AND step.id = notice.reminder_step_id WHERE notice.workspace_id = $1`, [ws])).rows;

    it("hands at most the cap to delivery in one sweep and carries the rest, a minute at a time; in-app isn't capped, nothing is doubled", async () => {
      // Wednesday 9 January 2030, 10:00 in Dubai: 30 invoices went overdue ten days ago (the first sweep's catch-up).
      const now = new Date("2030-01-09T06:00:00Z");
      for (let index = 1; index <= 30; index++) {
        items.set(`inv-${index}`, { key: `inv-${index}`, sourceType: "test", sourceId: `inv-${index}`, jobSource: null, projectId: null, caseId: null, partyId: null,
          ownerMembershipId: m.finance, ccMembershipIds: [], dueAt: new Date(now.getTime() - 10 * 86_400_000), title: `Invoice ${index}`, context: "Villa 4", href: "/workspace/finance", variables: {} });
      }
      const first = await sweep(now, 20);
      expect(first.errors).toEqual([]);
      expect(first.pace).toEqual({ carried: 10 });
      const afterFirst = await reminderNotices();
      expect(afterFirst.filter((notice) => notice.channel === "in_app")).toHaveLength(30);
      expect(afterFirst.filter((notice) => notice.channel === "in_app").every((notice) => notice.status === "delivered")).toBe(true);
      const emails = afterFirst.filter((notice) => notice.channel === "email");
      expect(emails).toHaveLength(30);
      const dueNow = emails.filter((notice) => notice.scheduledFor.getTime() <= now.getTime());
      const carried = emails.filter((notice) => notice.scheduledFor.getTime() > now.getTime());
      expect(dueNow).toHaveLength(20);
      expect(dueNow.every((notice) => notice.status === "pending")).toBe(true);
      expect(carried).toHaveLength(10);
      expect(carried.every((notice) => notice.status === "scheduled" && notice.scheduledFor.getTime() === new Date("2030-01-09T06:01:00Z").getTime())).toBe(true);
      // Every step fired once (the cap holds emails, not reminders); the same sweep again writes nothing new.
      const states = await pool.query<{ state: string; count: number }>(`SELECT state, count(*)::int AS count FROM reminder_steps WHERE workspace_id = $1 GROUP BY state ORDER BY state`, [ws]);
      expect(states.rows.find((row) => row.state === "sent")?.count).toBe(30);
      await sweep(now, 20);
      expect(await reminderNotices()).toHaveLength(60);

      // The first twenty went out; a minute later the next sweep lets the other ten go.
      await pool.query(`UPDATE notifications SET status = 'delivered', delivered_at = now() WHERE workspace_id = $1 AND channel = 'email' AND status = 'pending'`, [ws]);
      const later = new Date("2030-01-09T06:01:05Z");
      const second = await sweep(later, 20);
      expect(second.pace).toEqual({ carried: 0 });
      const afterSecond = (await reminderNotices()).filter((notice) => notice.channel === "email");
      expect(afterSecond.filter((notice) => notice.status === "scheduled" && notice.scheduledFor.getTime() <= later.getTime())).toHaveLength(10);
      expect(new Set(afterSecond.map((notice) => notice.key)).size).toBe(30);
    });

    it("carries over across sweeps by the cap: 45 due with a cap of 20 leave in three minutes", async () => {
      await pool.query(`DELETE FROM notifications WHERE workspace_id = $1 AND reminder_step_id IS NOT NULL`, [ws]);
      await pool.query(`DELETE FROM reminder_steps WHERE workspace_id = $1`, [ws]);
      await pool.query(`DELETE FROM reminder_subjects WHERE workspace_id = $1`, [ws]);
      items.clear();
      const now = new Date("2030-01-16T06:00:00Z");
      for (let index = 1; index <= 45; index++) {
        items.set(`late-${index}`, { key: `late-${index}`, sourceType: "test", sourceId: `late-${index}`, jobSource: null, projectId: null, caseId: null, partyId: null,
          ownerMembershipId: m.sales, ccMembershipIds: [], dueAt: new Date(now.getTime() - 10 * 86_400_000), title: `Late ${index}`, context: "Villa 9", href: "/workspace/finance", variables: {} });
      }
      expect((await sweep(now, 20)).pace).toEqual({ carried: 25 });
      const slots = await pool.query<{ slot: Date; count: number }>(
        `SELECT date_trunc('minute', scheduled_for) AS slot, count(*)::int AS count FROM notifications WHERE workspace_id = $1 AND channel = 'email' AND reminder_step_id IS NOT NULL
          GROUP BY 1 ORDER BY 1`, [ws]);
      expect(slots.rows.map((row) => [row.slot.toISOString(), row.count])).toEqual([
        ["2030-01-16T06:00:00.000Z", 20], ["2030-01-16T06:01:00.000Z", 20], ["2030-01-16T06:02:00.000Z", 5],
      ]);
      items.clear();
    });
  });
});
