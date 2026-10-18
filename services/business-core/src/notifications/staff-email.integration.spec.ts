import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queueUserEmail, seedDefaultNotificationTemplates } from "./default-templates";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("staff email notifications (PLM-032)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withWorkspace(work: (client: PoolClient, ids: { workspaceId: string; userId: string }) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), userId = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Sara')", [userId, `s-${userId.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Mail',$2,'USD',$3)", [workspaceId, `m-${workspaceId.slice(0, 8)}`, userId]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      await work(client, { workspaceId, userId });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const variables = { reference: "E-0042", clientName: "Dr Maya Nair", source: "Referral" };

  it("queues the rendered email once and wakes the worker", async () => {
    await withWorkspace(async (client, { workspaceId, userId }) => {
      const input = { workspaceId, recipientUserId: userId, code: "crm.lead_assigned", eventType: "crm.lead.assigned", variables, deepLink: "/workspace/crm/leads?lead=x", idempotencyKey: "assign:1" };
      expect(await queueUserEmail(client, input)).toEqual({ queued: true });
      await queueUserEmail(client, input);
      const rows = await client.query("SELECT channel, status, subject, body FROM notifications WHERE workspace_id=$1", [workspaceId]);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toMatchObject({ channel: "email", status: "pending", subject: "New enquiry E-0042: Dr Maya Nair" });
      expect(rows.rows[0].body).toContain("Source: Referral");
      const events = await client.query("SELECT event_type, payload->>'eventId' = id::text AS matches FROM outbox_events WHERE workspace_id=$1", [workspaceId]);
      expect(events.rows).toEqual([{ event_type: "notification.delivery_requested.v1", matches: true }]);
    });
  });

  it("respects a person who switched the email off", async () => {
    await withWorkspace(async (client, { workspaceId, userId }) => {
      await client.query("INSERT INTO notification_preferences (workspace_id, recipient_type, recipient_id, channel, event_type, enabled) VALUES ($1,'user',$2,'email','crm.lead.assigned',false)", [workspaceId, userId]);
      expect(await queueUserEmail(client, { workspaceId, recipientUserId: userId, code: "crm.lead_assigned", eventType: "crm.lead.assigned", variables, idempotencyKey: "assign:2" })).toEqual({ queued: false, reason: "recipient_preference" });
    });
  });
});
