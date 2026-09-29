import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { offboardMember, offboardingPreview } from "./member-offboarding";

// Opt-in: PROJECT_REPOSITORY_TEST_DATABASE_URL must point at a local, migrated database with a
// superuser role. Every test runs in a transaction that is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type World = { workspaceId: string; leaver: { id: string; userId: string }; successor: { id: string; userId: string }; admin: string; projectId: string };

integration("offboarding a person (SP-4)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(work: (client: PoolClient, ids: World) => Promise<void>) {
    const client = await pool.connect();
    const ids: World = { workspaceId: randomUUID(), leaver: { id: randomUUID(), userId: randomUUID() }, successor: { id: randomUUID(), userId: randomUUID() }, admin: randomUUID(), projectId: randomUUID() };
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [ids.workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Firm',$2,'USD',$3)", [ids.workspaceId, `firm-${ids.workspaceId.slice(0, 8)}`, ids.admin]);
      for (const [person, name] of [[ids.leaver, "Ali Leaver"], [ids.successor, "Sara Successor"]] as const) {
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [person.userId, `${person.userId.slice(0, 8)}@example.com`, name]);
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [person.id, ids.workspaceId, person.userId]);
      }
      const party = randomUUID();
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name,owner_membership_id) VALUES($1,$2,'person','Aisha','aisha',$3)", [party, ids.workspaceId, ids.leaver.id]);
      await client.query(`INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id,status,owner_membership_id) VALUES
        (gen_random_uuid(),$1,gen_random_uuid(),$2,'new',$3), (gen_random_uuid(),$1,gen_random_uuid(),$2,'disqualified',$3)`,
        [ids.workspaceId, party, ids.leaver.id]);
      await client.query(`INSERT INTO crm_activities(id,workspace_id,party_id,type,title,status,owner_membership_id) VALUES
        ($1,$3,$4,'call','Call back','pending',$5), ($2,$3,$4,'call','Called','completed',$5)`, [randomUUID(), randomUUID(), ids.workspaceId, party, ids.leaver.id]);
      await client.query(`INSERT INTO project_assignments(id,workspace_id,project_id,membership_id,is_manager,active,role_keys) VALUES($1,$2,$3,$4,true,true,'{}')`,
        [randomUUID(), ids.workspaceId, ids.projectId, ids.leaver.id]);
      await client.query(`INSERT INTO device_endpoints(id,workspace_id,user_id,platform,token_hash,encrypted_token_reference,locale,timezone,installation_id,last_request_id,status)
        VALUES($1,$2,$3,'ios','hash','ref','en','UTC',$4,$5,'active')`, [randomUUID(), ids.workspaceId, ids.leaver.userId, randomUUID(), randomUUID()]);
      await seedDefaultNotificationTemplates(client, ids.workspaceId);
      await work(client, ids);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("counts what the person holds, then hands every open item to the successor, suspends them and tells the successor", async () => {
    await world(async (client, ids) => {
      const preview = await offboardingPreview(client, ids.workspaceId, ids.leaver.id);
      expect(preview.counts).toMatchObject({ enquiries: 1, followUps: 1, clients: 1, projects: 1, opportunities: 0 });
      expect(preview.successors).toEqual([{ id: ids.successor.id, name: "Sara Successor" }]);
      const result = await offboardMember(client, { workspaceId: ids.workspaceId, membershipId: ids.leaver.id, successorMembershipId: ids.successor.id,
        version: preview.member.version, actorUserId: ids.admin });
      expect(result.moved).toMatchObject({ enquiries: 1, followUps: 1, clients: 1, projects: 1 });
      expect(result.devices).toBe(1);
      expect((await client.query(`SELECT status::text FROM workspace_memberships WHERE id = $1`, [ids.leaver.id])).rows[0].status).toBe("suspended");
      // Closed work stays where it was; open work moved.
      expect((await client.query(`SELECT status::text, owner_membership_id = $2 AS moved FROM crm_leads WHERE workspace_id = $1 ORDER BY status`, [ids.workspaceId, ids.successor.id])).rows)
        .toEqual([{ status: "disqualified", moved: false }, { status: "new", moved: true }]);
      expect((await client.query(`SELECT reason FROM crm_assignment_history WHERE workspace_id = $1`, [ids.workspaceId])).rows).toEqual([{ reason: "Offboarding" }]);
      expect((await client.query(`SELECT membership_id AS id, active, is_manager AS manager FROM project_assignments WHERE project_id = $1 ORDER BY active`, [ids.projectId])).rows)
        .toEqual([{ id: ids.leaver.id, active: false, manager: true }, { id: ids.successor.id, active: true, manager: true }]);
      expect((await client.query(`SELECT action FROM audit_events WHERE workspace_id = $1 AND entity_id = $2`, [ids.workspaceId, ids.leaver.id])).rows).toEqual([{ action: "workspace.member_offboarded" }]);
      expect((await client.query(`SELECT recipient_id AS id, subject, body FROM notifications WHERE workspace_id = $1 AND event_type = 'workspace.work_handed_over'`, [ids.workspaceId])).rows)
        .toEqual([{ id: ids.successor.userId, subject: "Ali Leaver's work is yours", body: "1 enquiries, 1 follow-ups, 1 clients, 1 projects" }]);
    });
  });

  it("refuses a stale preview, handing over to themselves, or an inactive successor", async () => {
    await world(async (client, ids) => {
      const base = { workspaceId: ids.workspaceId, membershipId: ids.leaver.id, actorUserId: ids.admin };
      await expect(offboardMember(client, { ...base, successorMembershipId: ids.successor.id, version: 99 })).rejects.toThrow(/changed/);
      await expect(offboardMember(client, { ...base, successorMembershipId: ids.leaver.id, version: 1 })).rejects.toThrow(/someone else/);
      await client.query(`UPDATE workspace_memberships SET status = 'suspended' WHERE id = $1`, [ids.successor.id]);
      await expect(offboardMember(client, { ...base, successorMembershipId: ids.successor.id, version: 1 })).rejects.toThrow(/active member/);
    });
  });
});
