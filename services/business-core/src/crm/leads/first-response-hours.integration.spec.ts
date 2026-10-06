import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { workspaceHours } from "../conversations/inbox/auto-replies";
import { CrmEventsService } from "../shared/crm-events.service";
import { CrmLeadsService } from "./crm-leads.service";
import { CrmSlaLifecycleService } from "./crm-sla-lifecycle.service";
import { SLA_DAY_KEYS } from "./sla-schedule";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each scenario is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

/**
 * Lead response (Palm, second round): one working hour on the workspace's working week, so an enquiry that arrives
 * after hours waits for the next working morning. The policy's hours come from the workspace's work calendar (its
 * HRMS calendar, else its region pack), the way Settings builds them; nothing here names a day.
 */
integration("first-response clock on the workspace's working hours (real Postgres)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function scenario(calendar: { timeZone: string; workingDays: number[]; start: string; end: string }, receivedAt: string) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), admin = randomUUID(), member = randomUUID(), role = randomUUID(), party = randomUUID();
    const intake = randomUUID(), enquiry = randomUUID(), lead = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Admin')", [admin, `admin-${admin.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_locale,default_timezone,created_by) VALUES($1,'Hours',$2,'USD','en',$3,$4)",
        [workspaceId, `hours-${workspaceId.slice(0, 8)}`, calendar.timeZone, admin]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [member, workspaceId, admin]);
      await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,'administrator','Administrator',true)", [role, workspaceId]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions", [workspaceId, role]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, member, role]);
      await client.query("INSERT INTO hrms_calendars(workspace_id,name,timezone,working_days,day_start,half_day,day_end) VALUES($1,'Office',$2,$3,$4,'13:00',$5)",
        [workspaceId, calendar.timeZone, calendar.workingDays, calendar.start, calendar.end]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Late Lead','late lead')", [party, workspaceId]);
      await client.query(`INSERT INTO crm_intake_events(id,workspace_id,source,channel,intake_method,idempotency_key,payload_hash,original_payload,correlation_id,received_at)
        VALUES($1,$2,'website','form','form',$3,'h','{}',$1,$4)`, [intake, workspaceId, `key-${intake}`, receivedAt]);
      await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference)
        VALUES($1,$2,$3,$4,'Evening enquiry','website','form',$5,'E-1')`, [enquiry, workspaceId, intake, party, receivedAt]);
      await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id,status,created_at) VALUES($1,$2,$3,$4,'new',$5)", [lead, workspaceId, enquiry, party, receivedAt]);
      await client.query("SET LOCAL session_replication_role = origin");
      const tenant = async <T>(fn: (c: PoolClient) => Promise<T>) => {
        await client.query("SAVEPOINT tenant");
        try {
          await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [workspaceId, admin]);
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
      const access = new WorkspaceAccessService(database as never, { resolveActor: async () => ({ userId: admin }) } as never);
      const leads = new CrmLeadsService(database as never, access, new CrmEventsService());
      // Settings › Sales builds the policy's business hours from the workspace's working week (lead-sla-policies.tsx).
      const hours = await tenant((c) => workspaceHours(c, workspaceId));
      const window = [{ start: hours.start, end: hours.end }];
      const schedule = { version: 1, mode: "business", timezone: hours.timeZone, holidays: hours.holidays, dateOverrides: {},
        weeklyHours: Object.fromEntries(hours.workingDays.map((day) => [SLA_DAY_KEYS[day], window])) };
      await leads.createSlaPolicy(actor, workspaceId, { name: "First response", eventType: "first_response", warningAfterMinutes: 45, breachAfterMinutes: 60, calculationMode: "business", schedule });
      const started = await tenant((c) => new CrmSlaLifecycleService().startFirstResponse(c, workspaceId, lead, { actorUserId: admin, ownerMembershipId: null, reason: "Lead arrived" }));
      const stored = await tenant(async (c) => (await c.query<{ due: Date; mode: string }>(
        `SELECT due_at AS due, calculation_mode AS mode FROM crm_sla_instances WHERE workspace_id = $1 AND lead_id = $2`, [workspaceId, lead])).rows[0]);
      return { hours, started, stored };
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("a lead at 18:05 on Friday, with 60 working minutes Mon–Fri 09:00–18:00, is due at 10:00 on Monday", async () => {
    const { hours, started, stored } = await scenario({ timeZone: "Asia/Dubai", workingDays: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" }, "2026-10-09T18:05:00+04:00");
    expect(hours).toMatchObject({ timeZone: "Asia/Dubai", workingDays: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" });
    expect(started?.dueAt.toISOString()).toBe(new Date("2026-10-12T10:00:00+04:00").toISOString());
    expect(started?.warningAt.toISOString()).toBe(new Date("2026-10-12T09:45:00+04:00").toISOString());
    expect(stored).toMatchObject({ mode: "business" });
    expect(new Date(stored.due).toISOString()).toBe(new Date("2026-10-12T10:00:00+04:00").toISOString());
  });

  it("follows the workspace's own week: Sunday–Thursday 08:00–17:00 moves a Thursday 17:30 lead to 09:00 on Sunday", async () => {
    const { started } = await scenario({ timeZone: "Asia/Riyadh", workingDays: [0, 1, 2, 3, 4], start: "08:00", end: "17:00" }, "2026-10-08T17:30:00+03:00");
    expect(started?.dueAt.toISOString()).toBe(new Date("2026-10-11T09:00:00+03:00").toISOString());
  });
});
