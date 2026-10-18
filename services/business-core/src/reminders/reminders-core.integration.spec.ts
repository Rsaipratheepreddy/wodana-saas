import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notifyUserInApp, queueUserEmail, seedDefaultNotificationTemplates } from "../notifications/default-templates";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Fixtures are committed in their own
// workspaces; every reminder table is used as the app role under forced RLS, as the API and the sweep do.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

const NEW_TABLES = ["reminder_rules", "reminder_settings", "notification_person_settings", "reminder_subjects", "reminder_steps", "reminder_digests"];
const drizzle = resolve(__dirname, "../../drizzle");
const statements = (file: string) => readFileSync(resolve(drizzle, file), "utf8").split("--> statement-breakpoint").map((sql) => sql.trim()).filter(Boolean);

integration("reminder engine core on real Postgres (0289/0290: tenancy, keys, seed)", () => {
  let pool: Pool;
  const run = randomUUID().slice(0, 8);
  const ws = randomUUID(), otherWs = randomUUID(), archivedWs = randomUUID();
  const people = { owner: randomUUID(), planner: randomUUID(), other: randomUUID() };
  const membership = { owner: randomUUID(), planner: randomUUID(), other: randomUUID() };
  const party = randomUUID();
  const roles = { pm: randomUUID(), designer: randomUUID(), owner: randomUUID() };

  async function tenant<T>(workspaceId: string, userId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [workspaceId, userId]);
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
  /** Runs as the superuser in a transaction that is always rolled back. */
  async function rolledBack<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      return await work(client);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const code = (promise: Promise<unknown>) => promise.then(() => "ok", (error: { code?: string }) => error.code ?? String(error));
  const subject = (client: PoolClient, workspaceId: string, patch: Record<string, unknown> = {}) => client.query<{ id: string }>(
    `INSERT INTO reminder_subjects (workspace_id, kind, source_key, source_type, source_id, audience, critical, owner_membership_id, party_id, title, context, href, due_at, status)
     VALUES ($1, $2, $3, 'work_item', $4, $5, $6, $7, $8, 'Fit wardrobe', 'Villa 4', '/workspace/projects/p/work', now(), 'open') RETURNING id`,
    [workspaceId, patch.kind ?? "work.due", patch.sourceKey ?? `work:${randomUUID()}`, patch.sourceId ?? randomUUID(), patch.audience ?? "staff",
      patch.critical ?? false, patch.owner ?? (workspaceId === ws ? membership.owner : membership.other), patch.party ?? null]);

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 6 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [key, id] of Object.entries(people)) {
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${key}-${run}@reminders.test`, key]);
      }
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      for (const [workspace, status] of [[ws, "active"], [otherWs, "active"], [archivedWs, "archived"]] as const) {
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,status,created_by) VALUES($1,'Reminder firm',$2,'AED',$3,$4)",
          [workspace, `rem-${workspace.slice(0, 8)}`, status, people.owner]);
      }
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status,joined_at) VALUES($1,$2,$3,'active',now()),($4,$2,$5,'active',now()),($6,$7,$8,'active',now())",
        [membership.owner, ws, people.owner, membership.planner, people.planner, membership.other, otherWs, people.other]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Aisha','aisha')", [party, ws]);
      await client.query("INSERT INTO roles(id,workspace_id,code,name,description,is_system) VALUES($1,$3,'project_manager','Project manager','',false),($2,$3,'designer','Designer','',false),($4,$3,'owner','Owner','',true)",
        [roles.pm, roles.designer, ws, roles.owner]);
      await client.query(`INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code='projects.manage'`, [ws, roles.pm]);
      // The firm's settings 0290 copies.
      await client.query("INSERT INTO workspace_quotation_settings(workspace_id,decision_reminder_days,expiry_warning_days) VALUES($1,'{7,2,5,10}',4)", [ws]);
      await client.query("INSERT INTO crm_inbox_settings(workspace_id,quote_followup_days) VALUES($1,3)", [ws]);
      await client.query("INSERT INTO crm_client_message_rules(workspace_id,event,enabled,offsets) VALUES($1,'payments.reminder',false,'{14,-7,-3,0,1,3,7,30}')", [ws]);
      await client.query(`INSERT INTO notification_policies(workspace_id,event_type,name,channels,conditions,status)
        VALUES($1,'approvals.reminder','Approval reminders','["in_app","email"]','{"remindAfterHours":12,"escalateAfterHours":36}','active')`, [ws]);
      await client.query(`INSERT INTO notification_preferences(workspace_id,recipient_type,recipient_id,event_type,channel,enabled,quiet_hours)
        VALUES($1,'user',$2,'*','push',true,'{"start":"22:00","end":"07:00","timezone":"Asia/Kolkata"}')`, [ws, people.planner]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await tenant(ws, people.owner, (client) => seedDefaultNotificationTemplates(client, ws));
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      const all = [ws, otherWs, archivedWs];
      for (const table of ["notification_delivery_attempts", "notifications", "outbox_events", ...[...NEW_TABLES].reverse(), "notification_templates", "notification_preferences",
        "notification_policies", "crm_client_message_rules", "crm_inbox_settings", "workspace_quotation_settings", "role_permissions", "roles", "crm_parties", "workspace_memberships"]) {
        await client.query(`DELETE FROM ${table} WHERE workspace_id = ANY($1::uuid[])`, [all]);
      }
      await client.query("DELETE FROM workspaces WHERE id = ANY($1::uuid[])", [all]);
      await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [Object.values(people)]);
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    await pool.end();
  });

  it("forces row security on every new table and on notifications, each with tenant_isolation", async () => {
    const forced = await pool.query<{ name: string }>(
      `SELECT relname AS name FROM pg_class WHERE relname = ANY($1::text[]) AND relrowsecurity AND relforcerowsecurity ORDER BY relname`, [[...NEW_TABLES, "notifications"]]);
    expect(forced.rows.map((row) => row.name)).toEqual([...NEW_TABLES, "notifications"].sort());
    const policies = await pool.query<{ name: string }>(`SELECT tablename AS name FROM pg_policies WHERE policyname = 'tenant_isolation' AND tablename = ANY($1::text[])`, [NEW_TABLES]);
    expect(policies.rows.map((row) => row.name).sort()).toEqual([...NEW_TABLES].sort());
    const classified = await pool.query<{ table_name: string; disposition: string }>(
      `SELECT table_name, disposition FROM workspace_record_classification WHERE table_name = ANY($1::text[]) ORDER BY table_name`, [NEW_TABLES]);
    expect(Object.fromEntries(classified.rows.map((row) => [row.table_name, row.disposition]))).toEqual({
      notification_person_settings: "keep", reminder_rules: "keep", reminder_settings: "keep", reminder_digests: "clear", reminder_steps: "clear", reminder_subjects: "clear",
    });
  });

  it("keeps every reminder table and notifications inside its workspace", async () => {
    const ids = await tenant(ws, people.owner, async (client) => {
      await client.query("INSERT INTO reminder_rules(workspace_id,kind,offsets,channels) VALUES($1,'work.due','{-1,0}','{in_app}')", [ws]);
      await client.query("INSERT INTO reminder_settings(workspace_id) VALUES($1)", [ws]);
      await client.query("INSERT INTO notification_person_settings(workspace_id,membership_id,time_zone) VALUES($1,$2,'Asia/Kolkata')", [ws, membership.owner]);
      const subjectId = (await subject(client, ws)).rows[0].id;
      const digestId = (await client.query<{ id: string }>("INSERT INTO reminder_digests(workspace_id,membership_id,digest_date) VALUES($1,$2,'2026-10-14') RETURNING id", [ws, membership.owner])).rows[0].id;
      const stepId = (await client.query<{ id: string }>(
        "INSERT INTO reminder_steps(workspace_id,subject_id,due_revision,step_key,kind,fire_at) VALUES($1,$2,1,'r:-1','remind',now()) RETURNING id", [ws, subjectId])).rows[0].id;
      await client.query(`INSERT INTO notifications(workspace_id,recipient_type,recipient_id,channel,event_type,status,body,idempotency_key,correlation_id,reminder_step_id,critical)
        VALUES($1,'user',$2,'in_app','work.due','delivered','Due',$3,gen_random_uuid(),$4,true)`, [ws, people.owner, `rem:${stepId}:${people.owner}:in_app`, stepId]);
      return { subjectId, digestId, stepId };
    });
    // Another workspace sees none of it, and can't write into it.
    await tenant(otherWs, people.other, async (client) => {
      for (const table of [...NEW_TABLES, "notifications"]) {
        expect((await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE workspace_id = $1`, [ws])).rows[0].count, table).toBe(0);
      }
      expect((await client.query("UPDATE reminder_subjects SET title = 'x' WHERE id = $1", [ids.subjectId])).rowCount).toBe(0);
      expect((await client.query("UPDATE notifications SET body = 'x' WHERE reminder_step_id = $1", [ids.stepId])).rowCount).toBe(0);
    });
    for (const sql of [
      ["INSERT INTO reminder_rules(workspace_id,kind,offsets,channels) VALUES($1,'crm.follow_up','{0}','{in_app}')", [ws]],
      ["INSERT INTO reminder_settings(workspace_id) VALUES($1)", [ws]],
      ["INSERT INTO notification_person_settings(workspace_id,membership_id) VALUES($1,$2)", [ws, membership.planner]],
      ["INSERT INTO reminder_digests(workspace_id,membership_id,digest_date) VALUES($1,$2,'2026-10-15')", [ws, membership.owner]],
      ["INSERT INTO reminder_steps(workspace_id,subject_id,due_revision,step_key,kind,fire_at) VALUES($1,$2,1,'r:0','remind',now())", [ws, ids.subjectId]],
      [`INSERT INTO notifications(workspace_id,recipient_type,recipient_id,channel,event_type,status,body,idempotency_key,correlation_id)
        VALUES($1,'user',$2,'in_app','work.due','delivered','x',$3,gen_random_uuid())`, [ws, people.owner, `x:${run}`]],
    ] as const) {
      expect(await code(tenant(otherWs, people.other, (client) => client.query(sql[0], [...sql[1]]))), sql[0]).toBe("42501");
    }
    expect(await code(tenant(otherWs, people.other, (client) => subject(client, ws)))).toBe("42501");
    // Without a workspace the app role sees nothing.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE wodana_app");
      for (const table of [...NEW_TABLES, "notifications"]) expect((await client.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count, table).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("keeps one subject per source key, one step per revision and key, one digest per person and day", async () => {
    const sourceKey = `work:${randomUUID()}`;
    const subjectId = await tenant(ws, people.owner, async (client) => (await subject(client, ws, { sourceKey })).rows[0].id);
    expect(await code(tenant(ws, people.owner, (client) => subject(client, ws, { sourceKey })))).toBe("23505");
    // The same key under another kind is another subject.
    expect(await code(tenant(ws, people.owner, (client) => subject(client, ws, { sourceKey, kind: "design.stage_due" })))).toBe("ok");
    const step = (key: string, revision = 1, kind = "remind", level = 0) => tenant(ws, people.owner, (client) => client.query(
      "INSERT INTO reminder_steps(workspace_id,subject_id,due_revision,step_key,kind,level,fire_at) VALUES($1,$2,$3,$4,$5,$6,now())", [ws, subjectId, revision, key, kind, level]));
    expect(await code(step("r:-2"))).toBe("ok");
    expect(await code(step("r:-2"))).toBe("23505");
    expect(await code(step("r:-2", 2))).toBe("ok");
    expect(await code(step("e:1", 1, "escalate", 1))).toBe("ok");
    expect(await code(step("e:1", 1, "escalate", 1))).toBe("23505");
    // Keys, levels and states are what the contract says.
    expect(await code(step("x:1"))).toBe("23514");
    expect(await code(step("e:2", 1, "escalate", 1))).toBe("23514");
    expect(await code(step("r:1", 1, "escalate", 1))).toBe("23514");
    expect(await code(tenant(ws, people.owner, (client) => client.query(
      "INSERT INTO reminder_steps(workspace_id,subject_id,due_revision,step_key,kind,fire_at,state) VALUES($1,$2,1,'r:9','remind',now(),'skipped')", [ws, subjectId])))).toBe("23514");
    const digest = () => tenant(ws, people.owner, (client) => client.query("INSERT INTO reminder_digests(workspace_id,membership_id,digest_date) VALUES($1,$2,'2026-10-20')", [ws, membership.planner]));
    expect(await code(digest())).toBe("ok");
    expect(await code(digest())).toBe("23505");
  });

  it("checks rules, subjects and settings against the contract", async () => {
    const rule = (offsets: string, extra: { unit?: string; chain?: string; channels?: string; kind?: string } = {}) => tenant(ws, people.owner, (client) => client.query(
      "INSERT INTO reminder_rules(workspace_id,kind,offsets,unit,chain,channels) VALUES($1,$2,$3,$4,$5,$6)",
      [ws, extra.kind ?? "invoice.overdue", offsets, extra.unit ?? "day", extra.chain ?? "{finance,owner}", extra.channels ?? "{in_app,push,email}"]));
    expect(await code(rule("{3,1}"))).toBe("23514");
    expect(await code(rule("{1,1}"))).toBe("23514");
    expect(await code(rule("{1,2,3,4,5,6,7}"))).toBe("23514");
    expect(await code(rule("{91}"))).toBe("23514");
    expect(await code(rule("{1}", { chain: "{owner,owner}" }))).toBe("23514");
    expect(await code(rule("{1}", { chain: "{manager,finance,purchasing,owner}" }))).toBe("23514");
    expect(await code(rule("{1}", { channels: "{sms}" }))).toBe("23514");
    expect(await code(rule("{1}", { kind: "crm.unowned" }))).toBe("23514");
    expect(await code(rule("{24,720}", { unit: "hour" }))).toBe("ok");
    expect(await code(tenant(ws, people.owner, (client) => subject(client, ws, { kind: "work.overdue" })))).toBe("23514");
    expect(await code(tenant(ws, people.owner, (client) => subject(client, ws, { kind: "payment.due", audience: "client", critical: true, party })))).toBe("ok");
    expect(await code(tenant(ws, people.owner, (client) => client.query(
      "UPDATE reminder_subjects SET status='snoozed' WHERE workspace_id=$1 AND kind='payment.due'", [ws])))).toBe("23514");
    expect(await code(tenant(ws, people.owner, (client) => client.query(
      "UPDATE reminder_subjects SET status='done', done_at=now(), done_reason='record' WHERE workspace_id=$1 AND kind='payment.due'", [ws])))).toBe("ok");
    expect(await code(tenant(otherWs, people.other, (client) => client.query(
      "INSERT INTO reminder_settings(workspace_id,client_window_start) VALUES($1,'09:00')", [otherWs])))).toBe("23514");
    // A subject can't point at another workspace's member.
    expect(await code(tenant(ws, people.owner, (client) => subject(client, ws, { owner: membership.other })))).toBe("23503");
  });

  it("lists the active workspaces for the sweep, and the CRM worker still finds due notifications", async () => {
    await tenant(otherWs, people.other, (client) => client.query(`INSERT INTO notifications(workspace_id,recipient_type,recipient_id,channel,event_type,status,body,idempotency_key,correlation_id,scheduled_for)
      VALUES($1,'user',$2,'email','work.due','pending','Due',$3,gen_random_uuid(),now() - interval '1 minute')`, [otherWs, people.other, `due:${run}`]));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE wodana_app");
      const engine = (await client.query<{ workspace_id: string }>("SELECT workspace_id FROM list_reminder_engine_workspaces()")).rows.map((row) => row.workspace_id);
      expect(engine).toEqual(expect.arrayContaining([ws, otherWs]));
      expect(engine).not.toContain(archivedWs);
      const crm = (await client.query<{ workspace_id: string }>("SELECT workspace_id FROM list_crm_workspaces_with_due_work()")).rows.map((row) => row.workspace_id);
      expect(crm).toContain(otherWs);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("marks critical notices and sends them past a mute (R13); other notices stay muted", async () => {
    await tenant(ws, people.owner, (client) => client.query(`INSERT INTO notification_preferences(workspace_id,recipient_type,recipient_id,event_type,channel,enabled)
      VALUES($1,'user',$2,'receivables.*','email',false),($1,'user',$2,'receivables.*','in_app',false)`, [ws, people.planner]));
    const message = (key: string, critical?: boolean) => ({ workspaceId: ws, recipientUserId: people.planner, code: "reminders.invoice.overdue", eventType: "receivables.overdue",
      variables: { title: "INV-0004", context: "Villa 4", due: "7 days overdue" }, idempotencyKey: `${key}:${run}`, ...(critical === undefined ? {} : { critical }) });
    const results = await tenant(ws, people.owner, async (client) => [
      await queueUserEmail(client, message("plain-email")), await queueUserEmail(client, message("critical-email", true)),
      await notifyUserInApp(client, message("plain-app")), await notifyUserInApp(client, message("critical-app", true)),
    ]);
    expect(results).toEqual([{ queued: false, reason: "recipient_preference" }, { queued: true }, { queued: false, reason: "recipient_preference" }, { queued: true }]);
    const rows = await tenant(ws, people.owner, (client) => client.query<{ channel: string; critical: boolean; subject: string; body: string }>(
      "SELECT channel, critical, subject, body FROM notifications WHERE workspace_id=$1 AND idempotency_key LIKE $2 ORDER BY channel", [ws, `%:${run}`]));
    expect(rows.rows).toEqual([
      { channel: "email", critical: true, subject: "INV-0004 · 7 days overdue", body: "INV-0004 is 7 days overdue.\n\nVilla 4. Chase the payment, or record it if it came in." },
      { channel: "in_app", critical: true, subject: "INV-0004 · 7 days overdue", body: "Villa 4. Chase the payment, or record it if it came in." },
    ]);
    // Notices written without the flag are not critical.
    expect((await pool.query("SELECT critical FROM notifications WHERE workspace_id = $1 AND idempotency_key = $2", [otherWs, `due:${run}`])).rows).toEqual([{ critical: false }]);
  });

  it("0290 copies each firm's settings into its rules and person settings, once", async () => {
    await rolledBack(async (client) => {
      for (const sql of statements("0290_reminders_seed.sql")) await client.query(sql);
      for (const sql of statements("0290_reminders_seed.sql")) await client.query(sql); // idempotent
      const rules = await client.query<{ kind: string; enabled: boolean; offsets: number[]; unit: string; escalate_after: number | null; chain: string[]; channels: string[] }>(
        "SELECT kind, enabled, offsets, unit, escalate_after, chain, channels FROM reminder_rules WHERE workspace_id = $1 AND kind NOT IN ('work.due', 'invoice.overdue') ORDER BY kind", [ws]);
      expect(rules.rows).toEqual([
        { kind: "approval.waiting", enabled: true, offsets: [12, 36], unit: "hour", escalate_after: 2, chain: ["owner"], channels: ["in_app", "push", "email"] },
        // {7,2,5,10} ∪ {3}: ascending, at most four.
        { kind: "client.design_decision", enabled: true, offsets: [2, 3, 5, 7], unit: "day", escalate_after: 2, chain: [], channels: ["whatsapp", "email"] },
        { kind: "client.quote_decision", enabled: true, offsets: [2, 3, 5, 7], unit: "day", escalate_after: 2, chain: [], channels: ["whatsapp", "email"] },
        // Switched off by the firm; at most six offsets.
        { kind: "payment.due", enabled: false, offsets: [-7, -3, 0, 1, 3, 7], unit: "day", escalate_after: null, chain: [], channels: ["whatsapp", "email"] },
        { kind: "quote.expiring", enabled: true, offsets: [-4, 0], unit: "day", escalate_after: null, chain: [], channels: ["in_app", "push", "email"] },
      ]);
      const person = await client.query("SELECT membership_id, quiet_start::text, quiet_end::text, time_zone FROM notification_person_settings WHERE workspace_id = $1 AND membership_id = $2", [ws, membership.planner]);
      expect(person.rows).toEqual([{ membership_id: membership.planner, quiet_start: "22:00:00", quiet_end: "07:00:00", time_zone: "Asia/Kolkata" }]);
      // A firm with none of the old settings keeps the contract defaults (no rows), and gets the templates.
      expect((await client.query("SELECT count(*)::int AS count FROM reminder_rules WHERE workspace_id = $1", [otherWs])).rows[0].count).toBe(0);
      expect((await client.query("SELECT count(*)::int AS count FROM notification_templates WHERE workspace_id = $1 AND code LIKE 'reminders.%'", [otherWs])).rows[0].count).toBeGreaterThan(40);
    });
  });

  it("0289 gives team scope to roles that run projects or assign enquiries, and both permissions to owners", async () => {
    await rolledBack(async (client) => {
      for (const sql of statements("0289_reminders_core.sql").filter((sql) => sql.startsWith("INSERT INTO role_permissions"))) await client.query(sql);
      const held = await client.query<{ role: string; code: string }>(
        `SELECT role.code AS role, permission.code FROM role_permissions granted JOIN roles role ON role.id = granted.role_id JOIN permissions permission ON permission.id = granted.permission_id
          WHERE role.workspace_id = $1 AND permission.code LIKE 'reminders.%' ORDER BY 1, 2`, [ws]);
      expect(held.rows).toEqual([
        { role: "owner", code: "reminders.manage" }, { role: "owner", code: "reminders.team" }, { role: "project_manager", code: "reminders.team" },
      ]);
    });
  });
});
