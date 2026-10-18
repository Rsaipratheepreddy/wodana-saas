import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_NOTIFICATION_TEMPLATES } from "../../notifications/default-templates";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { queueMember } from "../conversations/inbox/inbox-assignment";
import { CrmEventsService } from "../shared/crm-events.service";
import { CrmLeadsService } from "./crm-leads.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each scenario is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

type World = {
  client: PoolClient; workspaceId: string; queueId: string; owner: string; ownerMember: string;
  people: Array<{ user: string; member: string }>;
  leads: CrmLeadsService;
  tenant: <T>(fn: (c: PoolClient) => Promise<T>) => Promise<T>;
  newLead: (name: string) => Promise<string>;
};

/** A workspace with an Owner and three salespeople answering one fallback queue, rolled back afterwards. */
async function withWorkspace(pool: Pool, queue: { mode: string; takeoverMinutes?: number | null }, work: (world: World) => Promise<void>) {
  const client = await pool.connect();
  const workspaceId = randomUUID(), queueId = randomUUID(), role = randomUUID(), ownerRole = randomUUID();
  const owner = randomUUID(), ownerMember = randomUUID();
  const people = [0, 1, 2].map(() => ({ user: randomUUID(), member: randomUUID() }));
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica"); // fixtures only
    for (const [index, person] of [{ user: owner, member: ownerMember }, ...people].entries()) {
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [person.user, `p${index}-${person.user.slice(0, 8)}@example.com`, index ? `Sales ${index}` : "Owner"]);
    }
    await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_locale,default_timezone,created_by) VALUES($1,'Routing',$2,'USD','en','UTC',$3)",
      [workspaceId, `routing-${workspaceId.slice(0, 8)}`, owner]);
    await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,'owner','Owner',true),($3,$2,'sales','Sales',true)", [ownerRole, workspaceId, role]);
    await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions", [workspaceId, ownerRole]);
    await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])",
      [workspaceId, role, ["crm.leads.view", "crm.leads.manage", "crm.activities.manage", "crm.communications.view"]]);
    await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [ownerMember, workspaceId, owner]);
    await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, ownerMember, ownerRole]);
    for (const person of people) {
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [person.member, workspaceId, person.user]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, person.member, role]);
    }
    await client.query(`INSERT INTO crm_queues(id,workspace_id,code,name,is_fallback,takeover_after_minutes,assignment_mode) VALUES($1,$2,'sales','Sales',true,$3,$4)`,
      [queueId, workspaceId, queue.takeoverMinutes ?? null, queue.mode]);
    for (const person of people) {
      await client.query("INSERT INTO crm_queue_members(workspace_id,queue_id,membership_id,capacity) VALUES($1,$2,$3,10)", [workspaceId, queueId, person.member]);
    }
    await client.query("SET LOCAL session_replication_role = origin");
    const tenant = async <T>(fn: (c: PoolClient) => Promise<T>) => {
      await client.query("SAVEPOINT tenant");
      try {
        await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [workspaceId, owner]);
        await client.query("SET LOCAL ROLE wodana_app");
        const result = await fn(client);
        await client.query("RESET ROLE");
        await client.query("RELEASE SAVEPOINT tenant");
        return result;
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT tenant");
        await client.query("RESET ROLE");
        throw error;
      }
    };
    const database = { tenantTransaction: (_ws: string, _actor: string, fn: (c: PoolClient) => Promise<unknown>) => tenant(fn) };
    const access = new WorkspaceAccessService(database as never, { resolveActor: async () => ({ userId: owner }) } as never);
    const leads = new CrmLeadsService(database as never, access, new CrmEventsService());
    let count = 0;
    const newLead = async (name: string) => {
      const party = randomUUID(), intake = randomUUID(), enquiry = randomUUID(), lead = randomUUID();
      count += 1;
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person',$3,$4)", [party, workspaceId, name, name.toLowerCase()]);
      await client.query(`INSERT INTO crm_intake_events(id,workspace_id,source,channel,intake_method,idempotency_key,payload_hash,original_payload,correlation_id,received_at)
        VALUES($1,$2,'website','form','form',$3,'h','{}',$1,now())`, [intake, workspaceId, `key-${intake}`]);
      await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference)
        VALUES($1,$2,$3,$4,'Villa','website','form',now(),$5)`, [enquiry, workspaceId, intake, party, `E-${count}`]);
      await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id,status) VALUES($1,$2,$3,$4,'new')", [lead, workspaceId, enquiry, party]);
      await client.query("SET LOCAL session_replication_role = origin");
      return lead;
    };
    await work({ client, workspaceId, queueId, owner, ownerMember, people, leads, tenant, newLead });
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

integration("lead routing on a real database", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  it("a round-robin queue gives each salesperson a turn in order, whatever their load, and chats share the same turns", async () => {
    await withWorkspace(pool, { mode: "round_robin" }, async ({ workspaceId, queueId, people, leads, tenant, newLead }) => {
      const order = [...people].map((person) => person.member).sort();
      // The first person in turn order already carries open enquiries: round-robin doesn't care.
      for (const name of ["Busy one", "Busy two"]) {
        const lead = await newLead(name);
        await tenant((c) => c.query("UPDATE crm_leads SET owner_membership_id = $3 WHERE workspace_id = $1 AND id = $2", [workspaceId, lead, order[0]]));
      }
      const owners: string[] = [];
      for (const name of ["A", "B", "C", "D"]) {
        const lead = await newLead(name);
        const routed = await tenant((c) => leads.autoAssignForAutomation(c, workspaceId, lead)) as { ownerMembershipId: string; assignment: { explanation: { mode: string } } };
        expect(routed.assignment.explanation.mode).toBe("round_robin");
        owners.push(routed.ownerMembershipId);
      }
      expect(owners).toEqual([order[0], order[1], order[2], order[0]]);
      // A chat takes the next turn in the same queue.
      expect(await tenant((c) => queueMember(c, workspaceId, queueId))).toBe(order[1]);
      // Someone away is passed over; their place in the order stays.
      await tenant((c) => c.query("UPDATE crm_queue_members SET is_available = false WHERE workspace_id = $1 AND membership_id = $2", [workspaceId, order[2]]));
      const next = await newLead("E");
      expect((await tenant((c) => leads.autoAssignForAutomation(c, workspaceId, next)) as { ownerMembershipId: string }).ownerMembershipId).toBe(order[0]);
      const queue = await leads.listQueues(actor, workspaceId) as Array<{ assignmentMode: string }>;
      expect(queue[0].assignmentMode).toBe("round_robin");
    });
  });

  it("a balanced queue still gives the lightest load first, and the mode is saved, version-checked and audited", async () => {
    await withWorkspace(pool, { mode: "balanced" }, async ({ client, workspaceId, queueId, people, leads, tenant, newLead }) => {
      const order = [...people].map((person) => person.member).sort();
      for (const member of [order[0], order[1]]) {
        const lead = await newLead(`Busy ${member}`);
        await tenant((c) => c.query("UPDATE crm_leads SET owner_membership_id = $3 WHERE workspace_id = $1 AND id = $2", [workspaceId, lead, member]));
      }
      const lead = await newLead("Light");
      expect((await tenant((c) => leads.autoAssignForAutomation(c, workspaceId, lead)) as { ownerMembershipId: string }).ownerMembershipId).toBe(order[2]);
      const [before] = await leads.listQueues(actor, workspaceId) as Array<{ version: number; assignmentMode: string }>;
      expect(before.assignmentMode).toBe("balanced");
      const saved = await leads.updateQueue(actor, workspaceId, queueId, { version: before.version, assignmentMode: "round_robin" }) as { assignmentMode: string; version: number };
      expect(saved.assignmentMode).toBe("round_robin");
      await expect(leads.updateQueue(actor, workspaceId, queueId, { version: before.version, assignmentMode: "balanced" })).rejects.toThrow("Queue changed");
      const audit = await client.query(`SELECT after->>'assignmentMode' AS mode FROM audit_events WHERE workspace_id = $1 AND action = 'crm.queue.updated.v1'`, [workspaceId]);
      expect(audit.rows.map((row) => row.mode)).toEqual(["round_robin"]);
      await expect(tenant((c) => c.query("UPDATE crm_queues SET assignment_mode = 'lightest' WHERE workspace_id = $1 AND id = $2", [workspaceId, queueId]))).rejects.toThrow(/assignment_mode_check/);
    });
  });

  it("PLM-180: hand-offs rotate past the cap, then a day later nobody having picked it up, the enquiry is unassigned and the Owners told", async () => {
    await withWorkspace(pool, { mode: "round_robin", takeoverMinutes: 60 }, async ({ client, workspaceId, people, owner, leads, tenant, newLead }) => {
      // The notices this workspace sends (new workspaces get them from the defaults; existing ones from the migrations).
      await client.query("SET LOCAL session_replication_role = replica");
      for (const template of DEFAULT_NOTIFICATION_TEMPLATES.filter((entry) => entry.code.startsWith("crm.lead"))) {
        await client.query(`INSERT INTO notification_templates(workspace_id,code,channel,locale,version_number,status,subject_template,body_template,variables,approved_at)
          VALUES($1,$2,$3,'en',1,'approved',$4,$5,$6::jsonb,now()) ON CONFLICT DO NOTHING`, [workspaceId, template.code, template.channel, template.subject, template.body, JSON.stringify(template.variables)]);
      }
      await client.query("SET LOCAL session_replication_role = origin");
      const order = [...people].map((person) => person.member).sort();
      // Off by default; the Owner turns it on in Sales settings (version-checked, audited). The cap no longer applies.
      expect((await leads.salesSettings(actor, workspaceId)).unassignAfterWorkingDay).toBe(false);
      await leads.updateSalesSettings(actor, workspaceId, { version: 0, takeoverCap: 0, unassignAfterWorkingDay: true });
      const settings = await leads.salesSettings(actor, workspaceId);
      expect(settings).toMatchObject({ unassignAfterWorkingDay: true, takeoverCap: 0 });
      await expect(leads.updateSalesSettings(actor, workspaceId, { version: 0, unassignAfterWorkingDay: false })).rejects.toThrow("Sales settings changed");

      const lead = await newLead("Layla");
      const routed = await tenant((c) => leads.autoAssignForAutomation(c, workspaceId, lead)) as { ownerMembershipId: string };
      expect(routed.ownerMembershipId).toBe(order[0]);
      const state = () => tenant(async (c) => (await c.query<{ owner: string | null; due: Date | null; escalationDue: Date | null; priority: string }>(
        `SELECT owner_membership_id AS owner, ownership_due_at AS due, escalation_due_at AS "escalationDue", priority FROM crm_leads WHERE workspace_id = $1 AND id = $2`, [workspaceId, lead])).rows[0]);
      // Time passes: the response window ran out two hours after it was given out.
      const shift = (hours: number) => tenant((c) => c.query(`UPDATE crm_assignment_history SET assigned_at = assigned_at - make_interval(hours => $3) WHERE workspace_id = $1 AND lead_id = $2`, [workspaceId, lead, hours]));
      const due = () => tenant((c) => c.query(`UPDATE crm_leads SET ownership_due_at = now() - interval '1 minute' WHERE workspace_id = $1 AND id = $2`, [workspaceId, lead]));
      await shift(2); await due();
      // With a cap of 0 the old rule would have told a manager; now it moves to the next person in turn.
      expect(await leads.processDueTakeoversInternal(workspaceId)).toMatchObject({ reassigned: [{ leadId: lead, ownerMembershipId: order[1] }], escalated: [], unassigned: [] });
      const firstGivenOut = Date.now() - 2 * 3_600_000;
      expect(new Date((await state()).due!).getTime()).toBeLessThanOrEqual(firstGivenOut + 24 * 3_600_000 + 60_000);

      // A day after it was first given out, nobody has picked it up.
      await shift(23); await due();
      expect(await leads.processDueTakeoversInternal(workspaceId)).toMatchObject({ reassigned: [], unassigned: [lead] });
      expect(await state()).toMatchObject({ owner: null, due: null, escalationDue: null, priority: "urgent" });
      const history = await client.query(`SELECT owner_membership_id AS owner, previous_owner_membership_id AS previous, explanation->>'reason' AS reason FROM crm_assignment_history
        WHERE workspace_id = $1 AND lead_id = $2 ORDER BY assigned_at DESC LIMIT 1`, [workspaceId, lead]);
      expect(history.rows[0]).toEqual({ owner: null, previous: order[1], reason: "unassigned_after_working_day" });
      const notices = await client.query(`SELECT recipient_id AS recipient, channel, subject, deep_link AS link FROM notifications
        WHERE workspace_id = $1 AND event_type = 'crm.lead_unassigned' ORDER BY channel`, [workspaceId]);
      expect(notices.rows).toEqual([
        { recipient: owner, channel: "email", subject: "E-1 is unassigned", link: `/workspace/crm/leads?lead=${lead}` },
        { recipient: owner, channel: "in_app", subject: "E-1 is unassigned", link: `/workspace/crm/leads?lead=${lead}` },
      ]);
      const audit = await client.query(`SELECT action FROM audit_events WHERE workspace_id = $1 AND entity_id = $2 AND action = 'crm.lead.unassigned_after_working_day.v1'`, [workspaceId, lead]);
      expect(audit.rowCount).toBe(1);
      // Nothing is due any more: a second pass changes nothing.
      expect(await leads.processDueTakeoversInternal(workspaceId)).toMatchObject({ reassigned: [], unassigned: [] });
    });
  });
});
