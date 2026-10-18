import { ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notifyUserInApp, queueUserEmail, seedDefaultNotificationTemplates } from "./default-templates";
import { NoticeChoicesService, type NoticeChoicesInput } from "./notice-choices.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back; the work runs as
// the app role (wodana_app, forced row level security) inside the workspace's tenant context.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type Seed = { workspaceId: string; otherWorkspaceId: string; userId: string; membershipId: string };

integration("each person chooses how they are told (notice choices)", () => {
  let pool: Pool;
  const service = new NoticeChoicesService({} as never);
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withWorkspaces(work: (client: PoolClient, seed: Seed) => Promise<void>) {
    const client = await pool.connect();
    const seed: Seed = { workspaceId: randomUUID(), otherWorkspaceId: randomUUID(), userId: randomUUID(), membershipId: randomUUID() };
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Site lead')", [seed.userId, `n-${seed.userId.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      for (const id of [seed.workspaceId, seed.otherWorkspaceId]) {
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'EUR','Europe/Lisbon',$3)", [id, `nc-${id.slice(0, 8)}`, seed.userId]);
      }
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [seed.membershipId, seed.workspaceId, seed.userId]);
      await seedDefaultNotificationTemplates(client, seed.workspaceId);
      await client.query("SET LOCAL ROLE wodana_app");
      await asTenant(client, seed.workspaceId, seed.userId);
      await work(client, seed);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const asTenant = (client: PoolClient, workspaceId: string, userId: string) =>
    client.query("SELECT set_config('app.current_workspace_id', $1, true), set_config('app.current_actor_id', $2, true)", [workspaceId, userId]);

  const input = (view: { version: number }, patch: Partial<NoticeChoicesInput> = {}): NoticeChoicesInput => ({
    choices: [], quietHours: null, digestEnabled: true, digestTime: null, timeZone: null, version: view.version, ...patch,
  });
  const lead = (key: string, critical = false) => ({ workspaceId: "", recipientUserId: "", code: "crm.lead_assigned", eventType: "crm.lead.assigned",
    variables: { reference: "E-0042", clientName: "A client", source: "Referral", deadline: "today" }, deepLink: "/workspace/crm/leads?lead=x", idempotencyKey: key, critical });

  it("saves a person's grid as rows, version-checked, audited, and the same save again changes nothing", async () => {
    await withWorkspaces(async (client, { workspaceId, userId, membershipId }) => {
      const first = await service.read(client, workspaceId, userId);
      expect(first.version).toBe(0);
      expect(first.channels).toEqual(["in_app", "email"]);
      expect(first.choices.every((cell) => cell.enabled)).toBe(true);
      const saved = await service.save(client, workspaceId, userId, input(first, { choices: [{ group: "sales", channel: "email", enabled: false }], quietHours: { start: "22:00", end: "07:00" } }));
      expect(saved.version).toBe(1);
      expect(saved.choices.find((cell) => cell.group === "sales" && cell.channel === "email")?.enabled).toBe(false);
      expect(saved.quietHours).toEqual({ start: "22:00", end: "07:00" });
      expect(saved.effectiveTimeZone).toBe("Europe/Lisbon");
      const rows = await client.query("SELECT notice_group, channel, enabled FROM notification_channel_choices WHERE workspace_id=$1 AND membership_id=$2", [workspaceId, membershipId]);
      expect(rows.rows).toEqual([{ notice_group: "sales", channel: "email", enabled: false }]);
      // A retry of the same save is a no-op; a stale version is refused.
      expect((await service.save(client, workspaceId, userId, input(first, { choices: [{ group: "sales", channel: "email", enabled: false }], quietHours: { start: "22:00", end: "07:00" } }))).version).toBe(1);
      await expect(service.save(client, workspaceId, userId, input(first, { choices: [{ group: "sales", channel: "in_app", enabled: false }] }))).rejects.toBeInstanceOf(ConflictException);
      const audit = await client.query("SELECT action FROM audit_events WHERE workspace_id=$1 AND entity_id=$2", [workspaceId, membershipId]);
      expect(audit.rows).toEqual([{ action: "notifications.choices_changed.v1" }]);
    });
  });

  it("doesn't use a channel the person switched off, but an alert still arrives in the app and by their fastest channel", async () => {
    await withWorkspaces(async (client, { workspaceId, userId }) => {
      const view = await service.read(client, workspaceId, userId);
      await service.save(client, workspaceId, userId, input(view, { choices: [{ group: "sales", channel: "email", enabled: false }, { group: "sales", channel: "in_app", enabled: false }] }));
      const send = (key: string, critical = false) => ({ ...lead(key, critical), workspaceId, recipientUserId: userId });
      expect(await queueUserEmail(client, send("mail:1"))).toEqual({ queued: false, reason: "recipient_preference" });
      expect(await notifyUserInApp(client, send("app:1"))).toEqual({ queued: false, reason: "recipient_preference" });
      expect(await queueUserEmail(client, send("mail:2", true))).toEqual({ queued: true });
      expect(await notifyUserInApp(client, send("app:2", true))).toEqual({ queued: true });
      const rows = await client.query("SELECT idempotency_key AS key, channel, status, critical FROM notifications WHERE workspace_id=$1 ORDER BY idempotency_key", [workspaceId]);
      // No phone: the alert's fastest channel is email.
      expect(rows.rows).toEqual([
        { key: "app:2", channel: "in_app", status: "delivered", critical: true },
        { key: "app:2:email", channel: "email", status: "pending", critical: true },
        { key: "mail:2", channel: "email", status: "pending", critical: true },
      ]);
      // Another group is untouched.
      expect(await queueUserEmail(client, { ...send("mail:3"), code: "crm.lead_assigned", eventType: "site.report_missing" })).toEqual({ queued: true });
    });
  });

  it("holds email through quiet hours and lands the in-app notice silently", async () => {
    await withWorkspaces(async (client, { workspaceId, userId }) => {
      const view = await service.read(client, workspaceId, userId);
      // Quiet hours around now in the person's zone (the workspace's: Europe/Lisbon).
      const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
      const pad = (value: number) => String((value + 24) % 24).padStart(2, "0");
      await service.save(client, workspaceId, userId, input(view, { quietHours: { start: `${pad(hour - 1)}:00`, end: `${pad(hour + 2)}:00` } }));
      const send = { ...lead("quiet:1"), workspaceId, recipientUserId: userId };
      expect(await queueUserEmail(client, send)).toEqual({ queued: true });
      expect(await notifyUserInApp(client, { ...send, idempotencyKey: "quiet:2" })).toEqual({ queued: true });
      const rows = await client.query("SELECT channel, status, silent, scheduled_for > now() + interval '30 minutes' AS held FROM notifications WHERE workspace_id=$1 ORDER BY channel", [workspaceId]);
      expect(rows.rows).toEqual([{ channel: "email", status: "scheduled", silent: false, held: true }, { channel: "in_app", status: "delivered", silent: true, held: false }]);
    });
  });

  it("keeps each workspace's choices to itself", async () => {
    await withWorkspaces(async (client, { workspaceId, otherWorkspaceId, userId, membershipId }) => {
      const view = await service.read(client, workspaceId, userId);
      await service.save(client, workspaceId, userId, input(view, { choices: [{ group: "people", channel: "email", enabled: false }] }));
      await asTenant(client, otherWorkspaceId, userId);
      expect((await client.query("SELECT count(*)::int AS count FROM notification_channel_choices")).rows[0].count).toBe(0);
      await client.query("SAVEPOINT cross_tenant");
      await expect(client.query("INSERT INTO notification_channel_choices (workspace_id, membership_id, notice_group, channel, enabled) VALUES ($1,$2,'sales','email',false)", [workspaceId, membershipId]))
        .rejects.toThrow(/row-level security/);
      await client.query("ROLLBACK TO SAVEPOINT cross_tenant");
      await asTenant(client, workspaceId, userId);
      expect((await client.query("SELECT count(*)::int AS count FROM notification_channel_choices")).rows[0].count).toBe(1);
    });
  });
});
