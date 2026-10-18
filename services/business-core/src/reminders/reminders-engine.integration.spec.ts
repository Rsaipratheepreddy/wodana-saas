import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { readDeliveryMessages } from "../notifications/delivery-messages";
import { deliverClientDefault } from "./delivery/client-router";
import { runHealthAlerts } from "./digest/health-alerts";
import { loadEngineContext } from "./engine/context";
import { createSourceRegistry, type ClientDelivery, type ClientDeliveryResult, type DueItem, type ReminderSource } from "./engine/engine";
import { RemindersEngineService } from "./engine/reminders-engine.service";
import { sweepWorkspace } from "./engine/sweep";
import { MyDayService } from "./my-day/my-day.service";
import { REMINDER_KIND_INFO, type ReminderKind } from "./reminders-contract";
import { ReminderSettingsService } from "./settings/settings.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). The sweep, My day and the settings
// run as the app role inside each workspace's tenant transaction, under forced RLS, with a fake clock. Sources are
// test adapters (their records are lists in memory); the client router and the notices are the real ones.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const SERVICE = "00000000-0000-0000-0000-000000000000";

integration("reminder engine on real Postgres (sweep, delivery, escalation, client cap, digest, My day, settings)", { timeout: 120_000 }, () => {
  let pool: Pool;
  const run = randomUUID().slice(0, 8);
  const ws = randomUUID(), otherWs = randomUUID();
  const users = { owner: randomUUID(), lead: randomUUID(), planner: randomUUID(), finance: randomUUID(), other: randomUUID() };
  const m = { owner: randomUUID(), lead: randomUUID(), planner: randomUUID(), finance: randomUUID(), other: randomUUID() };
  const roles = { owner: randomUUID(), finance: randomUUID() };
  const team = randomUUID();
  const parties = { aisha: randomUUID(), omar: randomUUID(), noor: randomUUID() };
  const cases = { aisha: randomUUID(), omar: randomUUID(), noor: randomUUID() };
  const grant = randomUUID();
  const job = randomUUID(), jobLead = randomUUID(), opportunity = randomUUID();

  // ---- Test sources: records are in memory, per workspace and kind ----
  const stores = new Map<string, DueItem>();
  const storeKey = (workspaceId: string, kind: ReminderKind, key: string) => `${workspaceId}|${kind}|${key}`;
  const put = (workspaceId: string, kind: ReminderKind, item: Pick<DueItem, "key" | "dueAt"> & Partial<DueItem>) => stores.set(storeKey(workspaceId, kind, item.key), {
    sourceType: "test", sourceId: item.key, jobSource: null, projectId: null, caseId: null, partyId: null, ownerMembershipId: null, ccMembershipIds: [],
    title: `Item ${item.key}`, context: "Villa 4", href: "/workspace/projects", variables: {}, ...item });
  const drop = (workspaceId: string, kind: ReminderKind, key: string) => stores.delete(storeKey(workspaceId, kind, key));
  const clientCalls: Array<{ kind: ReminderKind; partyId: string | null; channels: string[]; fallbackOf: string | null }> = [];
  const clientAnswers = new Map<string, ClientDeliveryResult>();
  const completed: string[] = [];

  /** A WhatsApp that "went": the notice sendClientEvent writes, tagged with the step (so the fallback pass can find it). */
  async function whatsappSent(db: Pick<PoolClient, "query">, workspaceId: string, delivery: ClientDelivery): Promise<ClientDeliveryResult> {
    const id = (await db.query<{ id: string }>(
      `INSERT INTO notifications (workspace_id, recipient_type, recipient_id, channel, event_type, status, scheduled_for, body, idempotency_key, correlation_id, reminder_step_id)
       VALUES ($1, 'party', $2, 'whatsapp', 'portal.decision_waiting', 'pending', now(), 'Your design waits', $3, gen_random_uuid(), $4) RETURNING id`,
      [workspaceId, delivery.subject.partyId, `message:${randomUUID()}`, delivery.stepId])).rows[0].id;
    return { status: "queued", channel: "whatsapp", notificationIds: [id], reason: null };
  }

  function fake(kind: ReminderKind, extra: Partial<ReminderSource> = {}): ReminderSource {
    const info = REMINDER_KIND_INFO[kind];
    return {
      kind, module: info.module, audience: info.audience, critical: info.critical, notify: info.notify, viewPermission: "projects.view", template: { code: `reminders.${kind}` },
      open: async (_db, workspaceId) => [...stores.entries()].filter(([key]) => key.startsWith(`${workspaceId}|${kind}|`)).map(([, item]) => item),
      stillOpen: async (_db, workspaceId, keys) => new Set(keys.filter((key) => stores.has(storeKey(workspaceId, kind, key)))),
      ...extra,
    };
  }
  const recordClient = (kind: ReminderKind) => async (_db: unknown, _ws: string, delivery: ClientDelivery): Promise<ClientDeliveryResult> => {
    clientCalls.push({ kind, partyId: delivery.subject.partyId, channels: delivery.channels, fallbackOf: delivery.fallbackOf ?? null });
    return clientAnswers.get(delivery.subject.partyId ?? "") ?? { status: "queued", channel: "email", notificationIds: [], reason: null };
  };
  const sources = createSourceRegistry([
    fake("work.due", {
      poolPermission: "projects.manage",
      complete: { label: "Mark done", permission: "projects.view", run: async ({ workspaceId, subject }) => { completed.push(subject.sourceKey); drop(workspaceId, "work.due", subject.sourceKey); } },
      reassign: { permission: "projects.manage", run: async () => undefined },
    }),
    fake("invoice.overdue"),
    fake("payment.due", { deliverClient: recordClient("payment.due") }),
    fake("client.quote_decision", { deliverClient: recordClient("client.quote_decision") }),
    // The real client router; its WhatsApp is simulated (the firm has no WhatsApp number here), its emails are real.
    fake("client.design_decision", {
      deliverClient: (db, workspaceId, delivery) => delivery.channels.includes("whatsapp") && delivery.subject.partyId === parties.noor && !delivery.fallbackOf
        ? whatsappSent(db, workspaceId, delivery)
        : deliverClientDefault(db, workspaceId, delivery, { whatsappEvent: "portal.decision_waiting", section: "decisions", approversOnly: true }),
    }),
  ]);

  // ---- Helpers ----
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
  const sweep = (workspaceId: string, now: string, options: { digests?: boolean } = {}) =>
    tenant(workspaceId, SERVICE, (client) => sweepWorkspace(client, workspaceId, { sources, now: new Date(now), scan: true, digests: options.digests ?? false, health: false }));
  const steps = async (kind: ReminderKind, key: string, workspaceId = ws) => (await pool.query<{ stepKey: string; revision: number; state: string; skip: string | null; hold: string | null;
    heldUntil: Date | null; recipients: string[]; channels: string[] }>(
    `SELECT step.step_key AS "stepKey", step.due_revision AS revision, step.state, step.skip_reason AS skip, step.hold_reason AS hold, step.held_until AS "heldUntil",
            step.recipient_membership_ids AS recipients, step.channels
       FROM reminder_steps step JOIN reminder_subjects subject ON subject.id = step.subject_id
      WHERE subject.workspace_id = $1 AND subject.kind = $2 AND subject.source_key = $3 ORDER BY step.due_revision, step.fire_at, step.step_key`, [workspaceId, kind, key])).rows;
  const notices = async (kind: ReminderKind, key: string, workspaceId = ws) => (await pool.query<{ stepKey: string; channel: string; recipient: string; status: string; scheduledFor: Date;
    critical: boolean; subject: string | null; eventType: string; recipientType: string; fallbackOf: string | null; deepLink: string | null; key: string }>(
    `SELECT step.step_key AS "stepKey", notice.channel, notice.recipient_id AS recipient, notice.status::text AS status, notice.scheduled_for AS "scheduledFor", notice.critical,
            notice.subject, notice.event_type AS "eventType", notice.recipient_type AS "recipientType", notice.fallback_of AS "fallbackOf", notice.deep_link AS "deepLink",
            notice.idempotency_key AS key
       FROM notifications notice JOIN reminder_steps step ON step.id = notice.reminder_step_id JOIN reminder_subjects subject ON subject.id = step.subject_id
      WHERE subject.workspace_id = $1 AND subject.kind = $2 AND subject.source_key = $3 ORDER BY step.fire_at, notice.channel, notice.recipient_id`, [workspaceId, kind, key])).rows;
  const subjectOf = async (kind: ReminderKind, key: string, workspaceId = ws) => (await pool.query<{ id: string; status: string; revision: number; sent: number; level: number; doneReason: string | null; version: number }>(
    `SELECT id, status, due_revision AS revision, reminders_sent AS sent, escalation_level AS level, done_reason AS "doneReason", version FROM reminder_subjects
      WHERE workspace_id = $1 AND kind = $2 AND source_key = $3`, [workspaceId, kind, key])).rows[0];
  /** A fixture change that skips triggers (a calendar's holidays normally come from its named holidays). */
  async function fixture(sql: string, params: unknown[]) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(sql, params);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  }
  const who = (id: string) => (Object.entries(m).find(([, value]) => value === id) ?? Object.entries(users).find(([, value]) => value === id))?.[0] ?? id;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 8 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [key, id] of Object.entries(users)) await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${key}-${run}@engine.test`, key[0].toUpperCase() + key.slice(1)]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: no provisioning triggers or foreign-key checks
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,status,created_by) VALUES($1,'Engine firm',$2,'AED','Asia/Dubai','active',$3),($4,'Other firm',$5,'INR','Asia/Kolkata','active',$3)",
        [ws, `eng-${run}`, users.owner, otherWs, `eng-o-${run}`]);
      for (const [key, membership] of Object.entries(m)) {
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status,joined_at) VALUES($1,$2,$3,'active',now())", [membership, key === "other" ? otherWs : ws, users[key as keyof typeof users]]);
      }
      await client.query("INSERT INTO hrms_calendars(workspace_id,name,timezone,working_days,day_start,day_end) VALUES($1,'Office','Asia/Dubai','{1,2,3,4,5}','09:00','18:00')", [ws]);
      await client.query("INSERT INTO roles(id,workspace_id,code,name,description,is_system) VALUES($1,$2,'owner','Owner','',true),($3,$2,'finance','Finance','',false)", [roles.owner, ws, roles.finance]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3),($1,$4,$5)", [ws, m.owner, roles.owner, m.finance, roles.finance]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code='receivables.manage'", [ws, roles.finance]);
      await client.query("INSERT INTO workspace_teams(id,workspace_id,business_unit_id,code,name) VALUES($1,$2,gen_random_uuid(),'site','Site team')", [team, ws]);
      await client.query("INSERT INTO workspace_team_members(workspace_id,team_id,membership_id,is_lead) VALUES($1,$2,$3,false),($1,$2,$4,true)", [ws, team, m.planner, m.lead]);
      // The planner is in Kolkata (quiet 22:00 to 07:00) with a phone; the lead in New York.
      await client.query("INSERT INTO notification_person_settings(workspace_id,membership_id,quiet_start,quiet_end,time_zone) VALUES($1,$2,'22:00','07:00','Asia/Kolkata'),($1,$3,NULL,NULL,'America/New_York')",
        [ws, m.planner, m.lead]);
      await client.query("INSERT INTO notification_preferences(workspace_id,recipient_type,recipient_id,event_type,channel,enabled) VALUES($1,'user',$2,'*','push',true)", [ws, users.planner]);
      await client.query(`INSERT INTO device_endpoints(workspace_id,user_id,platform,token_hash,encrypted_token_reference,locale,timezone,installation_id,last_request_id,status,token_type)
        VALUES($1,$2,'ios',$3,'ref','en','Asia/Kolkata',gen_random_uuid(),gen_random_uuid(),'active','expo')`, [ws, users.planner, `hash-${run}`]);
      // Clients: Aisha has a decision-maker with an email, Omar has no contact, Noor gets WhatsApp (simulated) and email.
      for (const [name, party] of Object.entries(parties)) {
        await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person',$3,$4)", [party, ws, name, name]);
        const deal = randomUUID();
        await client.query("INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference) VALUES($1,$2,$3,gen_random_uuid(),gen_random_uuid(),$4,$5)", [deal, ws, party, `Villa of ${name}`, `O-${name}`]);
        await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by,owner_membership_id) VALUES($1,$2,$3,$4,$5)", [cases[name as keyof typeof cases], ws, deal, users.owner, m.planner]);
      }
      await client.query("INSERT INTO client_portal_grants(id,workspace_id,case_id,name,phone,role,email) VALUES($1,$2,$3,'Aisha','+10000000001','approver',$4),(gen_random_uuid(),$2,$5,'Noor','+10000000002','approver',$6)",
        [grant, ws, cases.aisha, `aisha-${run}@client.test`, cases.noor, `noor-${run}@client.test`]);
      await client.query("INSERT INTO client_portal_settings(workspace_id,slug,enabled) VALUES($1,$2,true)", [ws, `eng-${run}`]);
      // A job: the lead record and the deal it became.
      await client.query("INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference) VALUES($1,$2,$3,gen_random_uuid(),gen_random_uuid(),'Palm villa fit-out','O-PALM')", [opportunity, ws, parties.aisha]);
      await client.query("INSERT INTO job_identities(id,workspace_id,reference,root_type,root_id) VALUES($1,$2,$3,'opportunity',$4)", [job, ws, `J-${String(Date.now()).slice(-7)}`, opportunity]);
      await client.query("INSERT INTO job_identity_links(workspace_id,job_id,record_type,record_id) VALUES($1,$2,'lead',$3)", [ws, job, jobLead]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    for (const workspaceId of [ws, otherWs]) await tenant(workspaceId, users.owner, (db) => seedDefaultNotificationTemplates(db, workspaceId));
  }, 120_000);

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      const all = [ws, otherWs];
      for (const table of ["notification_delivery_attempts", "notifications", "reminder_steps", "reminder_digests", "reminder_subjects", "reminder_client_days", "reminder_rules", "reminder_settings",
        "notification_person_settings", "notification_preferences", "device_endpoints", "notification_templates", "audit_events", "outbox_events", "job_identity_links", "job_identities",
        "client_portal_settings", "client_portal_grants", "crm_messages", "crm_conversation_participants", "crm_conversations", "pre_project_cases", "crm_opportunities", "crm_parties",
        "workspace_team_members", "workspace_teams", "role_permissions", "member_roles", "roles", "hrms_calendars", "workspace_memberships"]) {
        await client.query(`DELETE FROM ${table} WHERE workspace_id = ANY($1::uuid[])`, [all]);
      }
      await client.query("DELETE FROM workspaces WHERE id = ANY($1::uuid[])", [all]);
      await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [Object.values(users)]);
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    await pool.end();
  }, 120_000);

  // Wednesday 9 January 2030; the firm works Monday to Friday, 09:00 to 18:00 in Dubai.
  const dueThursday = new Date("2030-01-10T05:00:00Z");

  it("plans each item's reminders once and sends one notice per channel, however often (or concurrently) the sweep runs", async () => {
    put(ws, "work.due", { key: "w1", dueAt: dueThursday, ownerMembershipId: m.planner, title: "#1 Fit wardrobe" });
    await sweep(ws, "2030-01-09T06:00:00Z");
    await sweep(ws, "2030-01-09T06:00:00Z");
    await sweep(ws, "2030-01-09T06:00:00Z");
    const both = await Promise.all([sweep(ws, "2030-01-09T06:00:00Z"), sweep(ws, "2030-01-09T06:00:00Z")]);
    expect(both.every((result) => result.errors.length === 0)).toBe(true);
    expect((await steps("work.due", "w1")).map((step) => [step.stepKey, step.state])).toEqual([["r:-1", "sent"], ["r:0", "planned"], ["r:1", "planned"], ["r:3", "planned"]]);
    const sent = await notices("work.due", "w1");
    expect(sent.map((notice) => [notice.stepKey, notice.channel, who(notice.recipient), notice.status])).toEqual([
      ["r:-1", "email", "planner", "pending"], ["r:-1", "in_app", "planner", "delivered"], ["r:-1", "push", "planner", "pending"],
    ]);
    expect(sent[1]).toMatchObject({ subject: "#1 Fit wardrobe · due tomorrow", eventType: "work.due", critical: false, deepLink: "/workspace/projects" });
    expect(sent.every((notice) => notice.key.startsWith("rem:"))).toBe(true);
    expect((await subjectOf("work.due", "w1"))).toMatchObject({ status: "open", revision: 1, sent: 1 });
  });

  it("reminds on the day and after, escalates to the team lead once then the owner once, and stops when the item is done", async () => {
    await sweep(ws, "2030-01-10T06:00:00Z"); // r:0, then e:1 is planned
    await sweep(ws, "2030-01-10T06:00:00Z"); // e:1 fires
    await sweep(ws, "2030-01-11T06:00:00Z"); // r:1, then e:2
    await sweep(ws, "2030-01-11T06:00:00Z"); // e:2 fires
    await sweep(ws, "2030-01-11T06:30:00Z");
    expect((await steps("work.due", "w1")).map((step) => [step.stepKey, step.state, step.recipients.map(who).join(",")])).toEqual([
      ["r:-1", "sent", "planner"], ["r:0", "sent", "planner"], ["e:1", "sent", "lead"], ["r:1", "sent", "planner"], ["e:2", "sent", "owner"], ["r:3", "planned", ""],
    ]);
    const escalations = (await notices("work.due", "w1")).filter((notice) => notice.stepKey.startsWith("e:"));
    expect(escalations.filter((notice) => notice.channel === "in_app").map((notice) => [notice.stepKey, who(notice.recipient), notice.subject])).toEqual([
      ["e:1", "lead", "Escalated · #1 Fit wardrobe · due today"], ["e:2", "owner", "Escalated · #1 Fit wardrobe · 1 day overdue"],
    ]);
    expect(await subjectOf("work.due", "w1")).toMatchObject({ sent: 3, level: 2 });
    const audits = await pool.query<{ action: string }>(`SELECT action FROM audit_events WHERE workspace_id = $1 AND entity_id = $2 ORDER BY occurred_at`, [ws, (await subjectOf("work.due", "w1")).id]);
    expect(audits.rows.map((row) => row.action)).toEqual(["reminders.escalated.v1", "reminders.escalated.v1"]);
    // Done before +3: closed through the done predicate, the rest skipped, nothing more sent.
    drop(ws, "work.due", "w1");
    await sweep(ws, "2030-01-13T06:00:00Z");
    expect(await subjectOf("work.due", "w1")).toMatchObject({ status: "done", doneReason: "record" });
    expect((await steps("work.due", "w1")).at(-1)).toMatchObject({ stepKey: "r:3", state: "skipped", skip: "done" });
    expect((await notices("work.due", "w1")).filter((notice) => notice.stepKey === "r:3")).toEqual([]);
  });

  it("escalates straight to the owner when the owner of the item has no team lead or project manager", async () => {
    put(ws, "work.due", { key: "w2", dueAt: new Date("2030-01-09T05:00:00Z"), ownerMembershipId: m.finance, title: "#2 Snag" });
    await sweep(ws, "2030-01-09T06:00:00Z"); // r:0 (r:-1 was yesterday)
    await sweep(ws, "2030-01-10T06:00:00Z"); // r:1, e:1 planned
    await sweep(ws, "2030-01-10T06:00:00Z");
    expect((await steps("work.due", "w2")).filter((step) => step.stepKey.startsWith("e:")).map((step) => [step.stepKey, step.recipients.map(who).join(",")])).toEqual([["e:1", "owner"]]);
    drop(ws, "work.due", "w2");
  });

  it("gives a moved due date a new revision: what was planned is cancelled, nothing is sent twice", async () => {
    put(ws, "work.due", { key: "w3", dueAt: dueThursday, ownerMembershipId: m.planner });
    await sweep(ws, "2030-01-09T06:00:00Z");
    put(ws, "work.due", { key: "w3", dueAt: new Date("2030-01-15T05:00:00Z"), ownerMembershipId: m.planner });
    await sweep(ws, "2030-01-09T07:00:00Z");
    await sweep(ws, "2030-01-09T07:00:00Z");
    const all = await steps("work.due", "w3");
    expect(all.filter((step) => step.revision === 1).map((step) => [step.stepKey, step.state])).toEqual([["r:-1", "sent"], ["r:0", "cancelled"], ["r:1", "cancelled"], ["r:3", "cancelled"]]);
    expect(all.filter((step) => step.revision === 2).map((step) => [step.stepKey, step.state])).toEqual([["r:-1", "planned"], ["r:0", "planned"], ["r:1", "planned"], ["r:3", "planned"]]);
    expect((await subjectOf("work.due", "w3")).revision).toBe(2);
    expect((await notices("work.due", "w3")).length).toBe(3);
    drop(ws, "work.due", "w3");
  });

  it("holds pushes and emails until each person's quiet hours end in their zone, writes in-app at once, and lets critical items through when the firm says so", async () => {
    // 17:00 UTC: 22:30 in Kolkata (quiet), 12:00 in New York.
    put(ws, "work.due", { key: "w4", dueAt: new Date("2030-01-09T05:00:00Z"), ownerMembershipId: m.planner, ccMembershipIds: [m.lead] });
    await sweep(ws, "2030-01-09T17:00:00Z");
    const plain = await notices("work.due", "w4");
    expect(plain.map((notice) => [who(notice.recipient), notice.channel, notice.status, notice.scheduledFor.toISOString()].join(" ")).sort()).toEqual([
      "lead email pending 2030-01-09T17:00:00.000Z", "planner email scheduled 2030-01-10T01:30:00.000Z",
      "lead in_app delivered 2030-01-09T17:00:00.000Z", "planner in_app delivered 2030-01-09T17:00:00.000Z",
      "planner push scheduled 2030-01-10T01:30:00.000Z",
    ].sort());
    put(ws, "invoice.overdue", { key: "i1", dueAt: new Date("2030-01-08T05:00:00Z"), ownerMembershipId: m.planner, title: "INV-0001" });
    await sweep(ws, "2030-01-09T17:00:00Z");
    expect((await notices("invoice.overdue", "i1")).find((notice) => notice.channel === "push")).toMatchObject({ status: "scheduled", critical: true });
    await tenant(ws, users.owner, (db) => db.query("INSERT INTO reminder_settings(workspace_id,critical_breaks_quiet) VALUES($1,true)", [ws]));
    put(ws, "invoice.overdue", { key: "i2", dueAt: new Date("2030-01-08T05:00:00Z"), ownerMembershipId: m.planner, title: "INV-0002" });
    await sweep(ws, "2030-01-09T17:00:00Z");
    expect((await notices("invoice.overdue", "i2")).find((notice) => notice.channel === "push")).toMatchObject({ status: "pending", critical: true });
    await tenant(ws, users.owner, (db) => db.query("DELETE FROM reminder_settings WHERE workspace_id = $1", [ws]));
    for (const [kind, key] of [["work.due", "w4"], ["invoice.overdue", "i1"], ["invoice.overdue", "i2"]] as const) drop(ws, kind, key);
  });

  it("folds a held push and email into the digest when the person's digest goes first, keeping the in-app notice", async () => {
    // The planner's digest is at 06:30 in Kolkata, before their quiet hours end at 07:00: the reminder waits in it.
    await tenant(ws, users.owner, (db) => db.query("UPDATE notification_person_settings SET digest_time = '06:30' WHERE workspace_id = $1 AND membership_id = $2", [ws, m.planner]));
    put(ws, "work.due", { key: "w9", dueAt: new Date("2030-01-09T05:00:00Z"), ownerMembershipId: m.planner, ccMembershipIds: [m.lead] });
    await sweep(ws, "2030-01-09T17:00:00Z");
    expect((await notices("work.due", "w9")).map((notice) => [who(notice.recipient), notice.channel, notice.status].join(" ")).sort()).toEqual([
      "lead email pending", "lead in_app delivered", "planner in_app delivered",
    ].sort());
    expect((await steps("work.due", "w9")).find((step) => step.stepKey === "r:0")).toMatchObject({ state: "sent" });
    await tenant(ws, users.owner, (db) => db.query("UPDATE notification_person_settings SET digest_time = NULL WHERE workspace_id = $1 AND membership_id = $2", [ws, m.planner]));
    drop(ws, "work.due", "w9");
  });

  it("sends a client one reminder a day: the payment wins over a decision the same day, which waits for the next working day's window", async () => {
    clientCalls.length = 0;
    put(ws, "payment.due", { key: "p1", dueAt: new Date("2030-01-14T05:00:00Z"), ownerMembershipId: m.planner, partyId: parties.aisha, caseId: cases.aisha }); // −3 days = Friday 11th? no: offsets −3 → Friday
    put(ws, "client.quote_decision", { key: "q1", dueAt: new Date("2030-01-09T05:00:00Z"), ownerMembershipId: m.planner, partyId: parties.aisha, caseId: cases.aisha }); // +2 → Friday 11th
    await sweep(ws, "2030-01-11T06:00:00Z");
    expect(clientCalls.map((call) => call.kind)).toEqual(["payment.due"]);
    expect((await steps("payment.due", "p1")).find((step) => step.stepKey === "r:-3")).toMatchObject({ state: "sent", channels: ["email"] });
    const held = (await steps("client.quote_decision", "q1")).find((step) => step.stepKey === "r:2")!;
    expect(held).toMatchObject({ state: "held", hold: "client_cap" });
    expect(held.heldUntil?.toISOString()).toBe("2030-01-14T05:00:00.000Z"); // Monday 09:00 Dubai (the weekend is skipped)
    // Monday: the payment's own day (0) is due too, and wins again; the decision waits once more.
    await sweep(ws, "2030-01-14T06:00:00Z");
    expect(clientCalls.map((call) => call.kind)).toEqual(["payment.due", "payment.due"]);
    drop(ws, "payment.due", "p1");
    await sweep(ws, "2030-01-15T06:00:00Z");
    expect(clientCalls.map((call) => call.kind)).toEqual(["payment.due", "payment.due", "client.quote_decision"]);
    expect((await steps("client.quote_decision", "q1")).find((step) => step.stepKey === "r:2")).toMatchObject({ state: "sent" });
    drop(ws, "client.quote_decision", "q1");
  });

  it("messages clients only inside the client window on working days", async () => {
    clientCalls.length = 0;
    put(ws, "client.quote_decision", { key: "q2", dueAt: new Date("2030-01-14T05:00:00Z"), ownerMembershipId: m.planner, partyId: parties.omar, caseId: cases.omar });
    await sweep(ws, "2030-01-16T15:00:00Z"); // 19:00 in Dubai
    const step = (await steps("client.quote_decision", "q2")).find((item) => item.stepKey === "r:2")!;
    expect(step).toMatchObject({ state: "held", hold: "client_window" });
    expect(step.heldUntil?.toISOString()).toBe("2030-01-17T05:00:00.000Z");
    expect(clientCalls).toEqual([]);
    drop(ws, "client.quote_decision", "q2");
  });

  it("emails the client's decision-makers when WhatsApp can't go, tells the owner once when nobody is reachable, and falls back to email from a failed WhatsApp", async () => {
    put(ws, "client.design_decision", { key: "d1", dueAt: new Date("2030-01-07T05:00:00Z"), ownerMembershipId: m.planner, partyId: parties.aisha, caseId: cases.aisha, title: "Kitchen R2" });
    put(ws, "client.design_decision", { key: "d2", dueAt: new Date("2030-01-07T05:00:00Z"), ownerMembershipId: m.planner, partyId: parties.omar, caseId: cases.omar, title: "Bath R1",
      variables: { client: "Omar" } });
    put(ws, "client.design_decision", { key: "d3", dueAt: new Date("2030-01-07T05:00:00Z"), ownerMembershipId: m.planner, partyId: parties.noor, caseId: cases.noor, title: "Hall R1" });
    await sweep(ws, "2030-01-09T06:00:00Z");
    await sweep(ws, "2030-01-09T06:30:00Z");
    // Aisha: no WhatsApp number, so the branded email to her decision-maker, opening the portal.
    const aisha = await notices("client.design_decision", "d1");
    expect(aisha.map((notice) => [notice.recipientType, notice.channel, notice.recipient, notice.status])).toEqual([["portal_contact", "email", grant, "pending"]]);
    expect(aisha[0].subject).toBe("Your design Kitchen R2 is waiting for you");
    expect(aisha[0].deepLink).toContain("open=decisions");
    // Omar: nobody to reach. His owner hears it once (two sweeps), the step is unreachable.
    expect((await steps("client.design_decision", "d2")).find((step) => step.stepKey === "r:2")).toMatchObject({ state: "skipped", skip: "unreachable" });
    const told = await pool.query<{ channel: string; subject: string }>(`SELECT channel, subject FROM notifications WHERE workspace_id = $1 AND idempotency_key LIKE 'rem:unreachable:%' AND recipient_id = $2 ORDER BY channel`,
      [ws, users.planner]);
    expect(told.rows).toEqual([{ channel: "email", subject: "Couldn't reach Omar · Bath R1" }, { channel: "in_app", subject: "Couldn't reach Omar · Bath R1" }]);
    // Noor: WhatsApp went; when it fails, the email goes, recorded as its fallback.
    const [whatsapp] = await notices("client.design_decision", "d3");
    expect(whatsapp).toMatchObject({ channel: "whatsapp", recipientType: "party" });
    await pool.query(`UPDATE notifications SET status = 'failed', updated_at = '2030-01-09T06:40:00Z' WHERE idempotency_key = $1`, [whatsapp.key]);
    await sweep(ws, "2030-01-09T07:00:00Z");
    await sweep(ws, "2030-01-09T07:05:00Z");
    const after = await notices("client.design_decision", "d3");
    expect(after.filter((notice) => notice.channel === "email").map((notice) => [notice.recipientType, notice.fallbackOf])).toEqual([["portal_contact", (await pool.query<{ id: string }>(
      "SELECT id FROM notifications WHERE idempotency_key = $1", [whatsapp.key])).rows[0].id]]);
    expect((await steps("client.design_decision", "d3")).find((step) => step.stepKey === "r:2")?.channels.sort()).toEqual(["email", "whatsapp"]);
    for (const key of ["d1", "d2", "d3"]) drop(ws, "client.design_decision", key);
  });

  it("stops a muted module's reminders, while critical ones still arrive (R13)", async () => {
    await pool.query(`INSERT INTO notification_preferences(workspace_id,recipient_type,recipient_id,event_type,channel,enabled)
      VALUES($1,'user',$2,'work.*','in_app',false),($1,'user',$2,'work.*','email',false),($1,'user',$2,'work.*','push',false),
            ($1,'user',$2,'receivables.*','in_app',false),($1,'user',$2,'receivables.*','email',false)`, [ws, users.finance]);
    put(ws, "work.due", { key: "w5", dueAt: new Date("2030-01-09T05:00:00Z"), ownerMembershipId: m.finance });
    put(ws, "invoice.overdue", { key: "i3", dueAt: new Date("2030-01-08T05:00:00Z"), ownerMembershipId: m.finance });
    await sweep(ws, "2030-01-09T06:00:00Z");
    expect((await steps("work.due", "w5")).find((step) => step.stepKey === "r:0")).toMatchObject({ state: "skipped", skip: "muted" });
    expect(await notices("work.due", "w5")).toEqual([]);
    expect((await notices("invoice.overdue", "i3")).map((notice) => [notice.channel, notice.critical])).toEqual([["email", true], ["in_app", true]]);
    drop(ws, "work.due", "w5");
    drop(ws, "invoice.overdue", "i3");
  });

  it("puts digest-only reminders in one digest per person and day, at their digest time on working days, with My day's counts", async () => {
    await tenant(ws, users.owner, (db) => db.query(`INSERT INTO reminder_rules(workspace_id,kind,offsets,channels,escalate_after,chain,digest) VALUES($1,'work.due','{-1,0,1,3}','{in_app,push,email}',NULL,'{}',true)`, [ws]));
    put(ws, "work.due", { key: "w6", dueAt: new Date("2030-01-16T05:00:00Z"), ownerMembershipId: m.planner, jobSource: { type: "lead", id: jobLead }, title: "#6 Paint" });
    await sweep(ws, "2030-01-16T06:00:00Z");
    expect((await steps("work.due", "w6")).find((step) => step.stepKey === "r:0")).toMatchObject({ state: "digested", recipients: [m.planner] });
    expect(await notices("work.due", "w6")).toEqual([]);
    // 08:00 in Kolkata is 02:30 UTC.
    await sweep(ws, "2030-01-17T02:20:00Z", { digests: true });
    expect((await pool.query("SELECT 1 FROM reminder_digests WHERE workspace_id = $1 AND membership_id = $2 AND digest_date = '2030-01-17'", [ws, m.planner])).rowCount).toBe(0);
    await sweep(ws, "2030-01-17T02:40:00Z", { digests: true });
    await sweep(ws, "2030-01-17T03:40:00Z", { digests: true });
    const digests = await pool.query<{ id: string; overdue: number; today: number; items: number }>(
      `SELECT id, overdue_count AS overdue, today_count AS today, item_count AS items FROM reminder_digests WHERE workspace_id = $1 AND membership_id = $2 AND digest_date = '2030-01-17'`, [ws, m.planner]);
    expect(digests.rows).toHaveLength(1);
    expect(digests.rows[0]).toMatchObject({ overdue: 1 });
    const sent = await pool.query<{ channel: string; subject: string; body: string }>(
      `SELECT channel, subject, body FROM notifications WHERE workspace_id = $1 AND recipient_id = $2 AND idempotency_key LIKE 'rem:digest:%:2030-01-17:%' ORDER BY channel`, [ws, users.planner]);
    expect(sent.rows.map((row) => row.channel)).toEqual(["email", "in_app"]);
    expect(sent.rows[1].subject).toMatch(/^Your day · \d+ to do$/);
    expect(sent.rows[0].body).toContain("#6 Paint (1 day overdue)");
    expect((await pool.query("SELECT digest_id FROM reminder_steps step JOIN reminder_subjects subject ON subject.id = step.subject_id WHERE subject.source_key = 'w6' AND step.state = 'digested'")).rows[0].digest_id)
      .toBe(digests.rows[0].id);
    // A holiday has no digest.
    await fixture("UPDATE hrms_calendars SET holidays = '{2030-01-18}' WHERE workspace_id = $1", [ws]);
    await sweep(ws, "2030-01-18T03:00:00Z", { digests: true });
    expect((await pool.query("SELECT 1 FROM reminder_digests WHERE workspace_id = $1 AND digest_date = '2030-01-18'", [ws])).rowCount).toBe(0);
    await fixture("UPDATE hrms_calendars SET holidays = '{}' WHERE workspace_id = $1", [ws]);
    await tenant(ws, users.owner, (db) => db.query("DELETE FROM reminder_rules WHERE workspace_id = $1", [ws]));
    drop(ws, "work.due", "w6");
  });

  it("sweeps each workspace in its own tenant transaction (listed through the SECURITY DEFINER function): nothing crosses workspaces", async () => {
    put(ws, "work.due", { key: "x1", dueAt: new Date("2030-02-06T05:00:00Z"), ownerMembershipId: m.planner });
    put(otherWs, "work.due", { key: "x1", dueAt: new Date("2030-02-06T05:00:00Z"), ownerMembershipId: m.other });
    const asApp = { query: async (sql: string) => {
      const client = await pool.connect();
      try { await client.query("BEGIN"); await client.query("SET LOCAL ROLE wodana_app"); const result = await client.query(sql); await client.query("COMMIT"); return result; }
      finally { client.release(); }
    }, tenantTransaction: <T>(workspaceId: string, actor: string, work: (client: PoolClient) => Promise<T>) => tenant(workspaceId, actor, work) };
    const engine = new RemindersEngineService(asApp as never, { get: () => "false" } as never, { registry: () => sources } as never);
    const totals = await engine.sweepAll(new Date("2030-02-05T06:00:00Z"));
    expect(totals.failed).toBe(0);
    expect(totals.workspaces).toBeGreaterThanOrEqual(2);
    for (const [workspaceId, owner] of [[ws, m.planner], [otherWs, m.other]] as const) {
      const rows = await tenant(workspaceId, SERVICE, (db) => db.query<{ workspaceId: string; owner: string }>(
        "SELECT workspace_id AS \"workspaceId\", owner_membership_id AS owner FROM reminder_subjects WHERE source_key = 'x1'"));
      expect(rows.rows).toEqual([{ workspaceId, owner }]);
      expect((await steps("work.due", "x1", workspaceId)).find((step) => step.stepKey === "r:-1")?.state).toBe("sent");
    }
    // The other workspace's member never hears this one's reminder.
    expect((await notices("work.due", "x1", ws)).every((notice) => notice.recipient === users.planner)).toBe(true);
    expect((await notices("work.due", "x1", otherWs)).every((notice) => notice.recipient === users.other)).toBe(true);
    drop(ws, "work.due", "x1");
    drop(otherWs, "work.due", "x1");
  });

  // ---- Commands: My day and the settings, through their services, as the app role ----
  const actor = { subject: "s", email: "e", displayName: "d", provider: "test" };
  const granted = new Map<string, Set<string>>([[users.planner, new Set(["projects.view"])], [users.owner, new Set(["projects.view", "projects.manage", "reminders.team", "reminders.manage"])]]);
  let as = users.planner;
  const access = {
    asMember: (_actor: unknown, workspaceId: string, work: (client: PoolClient, user: { userId: string }) => Promise<unknown>) => tenant(workspaceId, as, (client) => work(client, { userId: as })),
    withPermission: async (_actor: unknown, workspaceId: string, permission: string, work: (client: PoolClient, user: { userId: string }) => Promise<unknown>) => {
      if (!granted.get(as)?.has(permission)) throw new Error(`Permissions required: ${permission}`);
      return tenant(workspaceId, as, (client) => work(client, { userId: as }));
    },
    grantedPermissions: async (_client: unknown, _ws: string, userId: string, codes: string[]) => new Set(codes.filter((code) => granted.get(userId)?.has(code))),
  };

  it("My day lists the person's items grouped by job, re-checks what is done, and runs its commands with checks", async () => {
    const myDay = new MyDayService({} as never, access as never, { registry: () => sources } as never);
    const today = new Date(); // My day reads at the real time
    const yesterday = new Date(today.getTime() - 86_400_000);
    put(ws, "work.due", { key: "md1", dueAt: yesterday, ownerMembershipId: m.planner, jobSource: { type: "lead", id: jobLead }, title: "#7 Order tiles" });
    put(ws, "invoice.overdue", { key: "md2", dueAt: yesterday, ownerMembershipId: m.planner, title: "INV-0007" });
    put(ws, "work.due", { key: "md3", dueAt: yesterday, ownerMembershipId: m.lead, title: "#8 Someone else's" });
    await tenant(ws, SERVICE, (client) => sweepWorkspace(client, ws, { sources, now: today, scan: true, digests: false, health: false }));
    as = users.planner;
    const list = await myDay.myDay(actor, ws, { scope: "me" }) as Awaited<ReturnType<MyDayService["myDay"]>>;
    const mine = list.groups.flatMap((group) => group.items.map((item) => [group.jobId ? "job" : "none", item.title]));
    expect(mine).toEqual(expect.arrayContaining([["job", "#7 Order tiles"], ["none", "INV-0007"]]));
    expect(mine.map((row) => row[1])).not.toContain("#8 Someone else's");
    expect(list.groups.find((group) => group.jobId === job)?.title).toBe("Palm villa fit-out");
    expect(list.counts.overdue).toBeGreaterThanOrEqual(2);
    await expect(myDay.myDay(actor, ws, { scope: "team" })).rejects.toThrow(/reminders.team/);
    const tiles = list.groups.flatMap((group) => group.items).find((item) => item.title === "#7 Order tiles")!;
    expect(tiles.actions).toEqual(["open", "snooze", "complete"]);
    // Snoozing needs a reason, fits in 14 days, and is version-checked; a critical item only to the next working day.
    const until = new Date(today.getTime() + 2 * 86_400_000).toISOString();
    await expect(myDay.snooze(actor, ws, tiles.id, { until, reason: " ", version: tiles.version })).rejects.toThrow(/why/);
    await expect(myDay.snooze(actor, ws, tiles.id, { until: new Date(today.getTime() + 15 * 86_400_000).toISOString(), reason: "Waiting for tiles", version: tiles.version })).rejects.toThrow(/14 days/);
    await expect(myDay.snooze(actor, ws, tiles.id, { until, reason: "Waiting for tiles", version: tiles.version + 5 })).rejects.toThrow(/changed/);
    const snoozed = await myDay.snooze(actor, ws, tiles.id, { until, reason: "Waiting for tiles", version: tiles.version });
    expect(snoozed.item).toMatchObject({ urgency: "snoozed", snoozed: { reason: "Waiting for tiles" } });
    const invoice = list.groups.flatMap((group) => group.items).find((item) => item.title === "INV-0007")!;
    await expect(myDay.snooze(actor, ws, invoice.id, { until: new Date(today.getTime() + 6 * 86_400_000).toISOString(), reason: "Client travelling", version: invoice.version }))
      .rejects.toThrow(/next working day/);
    // Undo, then "Mark done" runs the module's command and the item closes through the done predicate.
    const back = await myDay.unsnooze(actor, ws, tiles.id, { version: snoozed.item!.version });
    expect(back.item?.urgency).toBe("overdue");
    expect((await myDay.complete(actor, ws, tiles.id, { version: back.item!.version })).item).toBeNull();
    expect(completed).toContain("md1");
    expect((await subjectOf("work.due", "md1")).status).toBe("done");
    // Reassigning needs the source's permission.
    await expect(myDay.reassign(actor, ws, invoice.id, { membershipId: m.lead, version: invoice.version })).rejects.toThrow(/reassign/);
    // A done item that My day still lists is closed when it is read.
    drop(ws, "invoice.overdue", "md2");
    const again = await myDay.myDay(actor, ws, { scope: "me" }) as Awaited<ReturnType<MyDayService["myDay"]>>;
    expect(again.groups.flatMap((group) => group.items).map((item) => item.title)).not.toContain("INV-0007");
    const audits = await pool.query<{ action: string }>(`SELECT action FROM audit_events WHERE workspace_id = $1 AND entity_id = $2 ORDER BY occurred_at`, [ws, tiles.id]);
    expect(audits.rows.map((row) => row.action)).toEqual(["reminders.subject_snoozed.v1", "reminders.subject_unsnoozed.v1", "reminders.subject_closed.v1"]);
    // The owner's team view shows everyone's.
    as = users.owner;
    const teamView = await myDay.myDay(actor, ws, { scope: "team" }) as Awaited<ReturnType<MyDayService["myDay"]>>;
    expect(teamView.groups.flatMap((group) => group.items).map((item) => item.title)).toContain("#8 Someone else's");
    drop(ws, "work.due", "md3");
  });

  it("settings commands are checked, version-checked, idempotent and audited; a person's own settings likewise", async () => {
    const settings = new ReminderSettingsService(access as never);
    as = users.planner;
    await expect(settings.settings(actor, ws)).rejects.toThrow(/reminders.manage/);
    as = users.owner;
    const before = await settings.settings(actor, ws) as Awaited<ReturnType<ReminderSettingsService["settings"]>>;
    expect(before.rules.find((rule) => rule.kind === "work.due")).toMatchObject({ isDefault: true, version: 0, offsets: [-1, 0, 1, 3] });
    const rule = { enabled: true, offsets: [0, 2], unit: "day" as const, workingDays: true, escalateAfter: 1, chain: ["manager" as const], channels: ["in_app" as const, "email" as const],
      digest: false, quietHours: null, version: 0 };
    const saved = await settings.saveRule(actor, ws, "work.due", rule) as Awaited<ReturnType<ReminderSettingsService["saveRule"]>>;
    expect(saved).toMatchObject({ isDefault: false, version: 1, offsets: [0, 2], workingDays: true });
    expect((await settings.saveRule(actor, ws, "work.due", { ...rule, version: 1 }) as { version: number }).version).toBe(1); // the same values: no change
    await expect(settings.saveRule(actor, ws, "work.due", { ...rule, offsets: [0], version: 0 })).rejects.toThrow(/changed/);
    await expect(settings.saveRule(actor, ws, "invoice.overdue", { ...rule, enabled: false, version: 0 })).rejects.toThrow(/always on/);
    const firm = await settings.saveSettings(actor, ws, { quietStart: "21:00", quietEnd: "07:30", digestTime: "08:30", clientWindow: { start: "10:00", end: "17:00" }, criticalBreaksQuiet: false, version: 0 }) as Awaited<ReturnType<ReminderSettingsService["saveSettings"]>>;
    expect(firm.settings).toMatchObject({ quietStart: "21:00", clientWindow: { start: "10:00", end: "17:00" }, version: 1 });
    expect((await settings.resetRule(actor, ws, "work.due", 1) as { isDefault: boolean }).isDefault).toBe(true);
    const audits = await pool.query<{ action: string }>(`SELECT action FROM audit_events WHERE workspace_id = $1 AND action LIKE 'reminders.%' AND entity_type = 'workspace' ORDER BY occurred_at`, [ws]);
    expect(audits.rows.map((row) => row.action)).toEqual(["reminders.rule_changed.v1", "reminders.settings_changed.v1", "reminders.rule_reset.v1"]);
    as = users.lead;
    const mine = await settings.personSettings(actor, ws) as Awaited<ReturnType<ReminderSettingsService["personSettings"]>>;
    expect(mine).toMatchObject({ timeZone: "America/New_York", effectiveTimeZone: "America/New_York", workspaceTimeZone: "Asia/Dubai", firm: { digestTime: "08:30" } });
    expect(mine.criticalEventTypes).toContain("receivables.overdue");
    const changed = await settings.savePersonSettings(actor, ws, { digestEnabled: false, digestTime: "07:15", quietHours: { start: "23:00", end: "06:00" }, timeZone: "Europe/London", version: mine.version }) as typeof mine;
    expect(changed).toMatchObject({ digestEnabled: false, digestTime: "07:15", timeZone: "Europe/London", version: mine.version + 1 });
    await expect(settings.savePersonSettings(actor, ws, { digestEnabled: true, digestTime: null, quietHours: null, timeZone: null, version: mine.version })).rejects.toThrow(/changed/);
    await tenant(ws, users.owner, (db) => db.query("DELETE FROM reminder_settings WHERE workspace_id = $1", [ws]));
  });

  it("delivery health lists each message with its state and reason, and alerts admins once per channel, error and day", async () => {
    const failed = randomUUID();
    await pool.query(`INSERT INTO notifications(id,workspace_id,recipient_type,recipient_id,channel,event_type,status,scheduled_for,body,idempotency_key,correlation_id,critical,updated_at)
      VALUES ($1,$2,'party',$3,'whatsapp','receivables.payment_due','failed',now(),'Pay',$4,gen_random_uuid(),true,now()),
             (gen_random_uuid(),$2,'user',$5,'email','work.due','scheduled',now() + interval '3 hours','Later',$6,gen_random_uuid(),false,now() + interval '1 second')`,
      [failed, ws, parties.aisha, `health-f-${run}`, users.planner, `health-h-${run}`]);
    await pool.query(`INSERT INTO notification_delivery_attempts(workspace_id,notification_id,attempt,provider,status,error_code) VALUES($1,$2,1,'meta','permanent_failure','WA_131026')`, [ws, failed]);
    const page = await tenant(ws, users.owner, (db) => readDeliveryMessages(db, ws, { limit: 200 }));
    expect(page.items.find((item) => item.id === failed)).toMatchObject({ status: "failed", reason: "WA_131026", attempts: 1, critical: true, recipient: { label: "aisha" } });
    expect(page.items.find((item) => item.status === "held")?.reason).toBe("scheduled");
    const onlyFailed = await tenant(ws, users.owner, (db) => readDeliveryMessages(db, ws, { status: "failed", channel: "whatsapp" }));
    expect(onlyFailed.items.every((item) => item.status === "failed" && item.channel === "whatsapp")).toBe(true);
    const first = await tenant(ws, users.owner, (db) => readDeliveryMessages(db, ws, { limit: 1 }));
    const second = await tenant(ws, users.owner, (db) => readDeliveryMessages(db, ws, { limit: 1, cursor: first.nextCursor! }));
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    const alert = async () => tenant(ws, SERVICE, async (db) => runHealthAlerts(db, await loadEngineContext(db, ws, sources, new Date())));
    await alert();
    await alert();
    const alerts = await pool.query<{ channel: string; subject: string }>(
      `SELECT channel, subject FROM notifications WHERE workspace_id = $1 AND idempotency_key LIKE 'rem:health:whatsapp:WA_131026:%' ORDER BY channel`, [ws]);
    expect(alerts.rows).toEqual([{ channel: "email", subject: "WhatsApp messages are failing" }, { channel: "in_app", subject: "WhatsApp messages are failing" }]);
  });
});
