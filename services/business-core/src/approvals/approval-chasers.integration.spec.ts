import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { chaseApprovals, chaseSettings } from "./approval-chasers";

// Opt-in: PROJECT_REPOSITORY_TEST_DATABASE_URL must point at a local, migrated database with a
// superuser role. Every test runs in a transaction that is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

describe("approval reminder settings", () => {
  it("is on with 24 and 48 hours until a workspace saves its own; escalation never comes before the reminder", () => {
    expect(chaseSettings(undefined)).toEqual({ enabled: true, remindAfterHours: 24, escalateAfterHours: 48, email: false });
    expect(chaseSettings({ status: "paused", conditions: {}, channels: ["in_app"] }).enabled).toBe(false);
    expect(chaseSettings({ status: "active", conditions: { remindAfterHours: 72, escalateAfterHours: 24 }, channels: ["in_app", "email"] }))
      .toEqual({ enabled: true, remindAfterHours: 72, escalateAfterHours: 72, email: true });
  });
});

integration("approvals that wait get chased (AU-3)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(hoursWaiting: number, work: (client: PoolClient, ids: { workspaceId: string; approver: string; owner: string }) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), approver = randomUUID(), owner = randomUUID(), buyer = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Firm',$2,'USD',$3)", [workspaceId, `firm-${workspaceId.slice(0, 8)}`, owner]);
      const approverRole = randomUUID(), ownerRole = randomUUID();
      await client.query(`INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$3,'purchasing_approver','Purchasing approver',false),($2,$3,'owner','Owner',true)`, [approverRole, ownerRole, workspaceId]);
      await client.query(`INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = 'purchasing.approve'`, [workspaceId, approverRole]);
      for (const [userId, role, name] of [[approver, approverRole, "Pat Approver"], [owner, ownerRole, "Olivia Owner"]] as const) {
        const membership = randomUUID();
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [userId, `${userId.slice(0, 8)}@example.com`, name]);
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, workspaceId, userId]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, membership, role]);
      }
      const vendor = randomUUID();
      await client.query("INSERT INTO workspace_vendors(workspace_id,id,code,display_name,created_by,updated_by) VALUES($1,$2,'V1','Al Noor Timber',$3,$3)", [workspaceId, vendor, buyer]);
      await client.query(`INSERT INTO purchase_orders(id,workspace_id,number,legal_entity_id,vendor_id,currency,payment_terms,created_by,submitted_by,status,total,updated_at)
        VALUES($1,$2,'PO-0042',$3,$4,'USD','on_delivery',$5,$5,'pending_approval',1234.5,now() - make_interval(hours => $6::int))`, [randomUUID(), workspaceId, randomUUID(), vendor, buyer, hoursWaiting]);
      await seedDefaultNotificationTemplates(client, workspaceId);
      await client.query("SET LOCAL session_replication_role = origin");
      await work(client, { workspaceId, approver, owner });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const told = async (client: PoolClient, workspaceId: string, event: string) =>
    (await client.query(`SELECT recipient_id AS recipient, subject FROM notifications WHERE workspace_id = $1 AND event_type = $2 AND channel = 'in_app'`, [workspaceId, event])).rows;

  it("reminds the approver after a day, once, and leaves the owners alone until two", async () => {
    await world(30, async (client, ids) => {
      await expect(chaseApprovals(client, ids.workspaceId)).resolves.toEqual({ reminded: 1, escalated: 0 });
      expect(await told(client, ids.workspaceId, "approvals.reminder")).toEqual([{ recipient: ids.approver, subject: "Still waiting for you · PO-0042" }]);
      await expect(chaseApprovals(client, ids.workspaceId)).resolves.toEqual({ reminded: 0, escalated: 0 });
    });
  });

  it("tells the owners after two days, naming who it waits with", async () => {
    await world(50, async (client, ids) => {
      await expect(chaseApprovals(client, ids.workspaceId)).resolves.toEqual({ reminded: 1, escalated: 1 });
      const escalated = (await client.query(`SELECT recipient_id AS recipient, body FROM notifications WHERE workspace_id = $1 AND event_type = 'approvals.escalated'`, [ids.workspaceId])).rows;
      expect(escalated).toEqual([{ recipient: ids.owner, body: "Still with Pat Approver." }]);
    });
  });

  it("does nothing when the workspace turned the rule off", async () => {
    await world(50, async (client, ids) => {
      await client.query(`INSERT INTO notification_policies(workspace_id,event_type,name,channels,conditions,status) VALUES($1,'approvals.reminder','Approval reminders','["in_app"]','{}','paused')`, [ids.workspaceId]);
      await expect(chaseApprovals(client, ids.workspaceId)).resolves.toEqual({ reminded: 0, escalated: 0 });
    });
  });
});
