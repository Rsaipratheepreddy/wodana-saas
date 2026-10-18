import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClientCallsService } from "../client-calls/client-calls.service";
import { processClientCalls, startClientCalls } from "../client-calls/client-calls.store";
import { winOpportunityOnAcceptance } from "../commercial/quote-acceptance";
import { starterFlow } from "../crm/flows/starter-flows";
import { OpportunityProposalsService } from "../crm/opportunities/opportunity-proposals.service";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { projectAreas } from "../project-core/project-areas";
import { ProjectCoreService } from "../project-core/project-core.service";
import { plusDays } from "./team-calendars.domain";
import { TeamCalendarsService } from "./team-calendars.service";
import { processTeamCalendarDeadlines } from "./team-calendars.store";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const DESIGN = ["pre_projects.view", "pre_projects.edit", "crm.settings.manage"];
const FACTORY = ["factory.view", "factory.manage", "projects.view"];

type People = { designer: string; visualiser: string; owner: string; manager: string; maker: string };
type World = { client: PoolClient; workspaceId: string; caseId: string; opportunityId: string; projectId: string; people: People; members: People; today: string };

/** PLM-090 (design calendar), PLM-091 (factory and logistics calendar), PLM-046 (client update calls), PLM-098 (areas after Won). */
integration("team calendars, client update calls and areas after Won", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(run: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), party = randomUUID(), opportunityId = randomUUID(), projectId = randomUUID();
    const people: People = { designer: randomUUID(), visualiser: randomUUID(), owner: randomUUID(), manager: randomUUID(), maker: randomUUID() };
    const members: People = { designer: randomUUID(), visualiser: randomUUID(), owner: randomUUID(), manager: randomUUID(), maker: randomUUID() };
    const names: People = { designer: "Dana Designer", visualiser: "Vic Visualiser", owner: "Amal Account", manager: "Omar Manager", maker: "Faris Factory" };
    try {
      await client.query("BEGIN");
      for (const key of Object.keys(people) as Array<keyof People>)
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [people[key], `${people[key].slice(0, 8)}@example.com`, names[key]]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,default_locale,created_by) VALUES($1,'Studio',$2,'AED','UTC','en',$3)", [workspaceId, `tc-${workspaceId.slice(0, 8)}`, people.manager]);
      for (const key of Object.keys(people) as Array<keyof People>)
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [members[key], workspaceId, people[key]]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, workspaceId, party, randomUUID(), randomUUID(), members.owner]);
      await client.query("INSERT INTO crm_opportunity_designer(workspace_id,opportunity_id,membership_id) VALUES($1,$2,$3)", [workspaceId, opportunityId, members.designer]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, people.manager]);
      await client.query("INSERT INTO delivery_projects(id,workspace_id,case_id,name,reference,quote_id,status,started_at,created_by) VALUES($1,$2,$3,'Villa 12','P-7',$5,'active',now(),$4)", [projectId, workspaceId, caseId, people.manager, randomUUID()]);
      await client.query("INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager,active,role_keys) VALUES($1,$2,$3,true,true,'{}')", [workspaceId, projectId, members.manager]);
      await client.query("INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager,active,role_keys) VALUES($1,$2,$3,false,true,ARRAY['factory_lead'])", [workspaceId, projectId, members.maker]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      const today = (await client.query<{ today: string }>("SELECT (now() AT TIME ZONE 'UTC')::date::text AS today")).rows[0].today;
      await run({ client, workspaceId, caseId, opportunityId, projectId, people, members, today });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  /** Permission checks as the person has them; each command in a savepoint, so a refused one leaves nothing behind. */
  const access = (w: World, userId: string, permissions: string[]) => {
    const run = async (_a: unknown, _w: string, code: string | string[], fn: (c: PoolClient, u: { userId: string }) => unknown) => {
      if (!(Array.isArray(code) ? code : [code]).some((item) => permissions.includes(item))) throw new Error("Not allowed");
      await w.client.query("SAVEPOINT command");
      try { const result = await fn(w.client, { userId }); await w.client.query("RELEASE SAVEPOINT command"); return result; }
      catch (error) { await w.client.query("ROLLBACK TO SAVEPOINT command"); throw error; }
    };
    return { withPermission: run, withAnyPermission: run, withPermissions: run, asMember: (a: unknown, ws: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => run(a, ws, permissions, fn),
      hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) } as never;
  };

  const told = async (w: World, event: string, channel = "in_app") => (await w.client.query<{ recipient: string; subject: string; body: string }>(
    `SELECT recipient_id AS recipient, subject, body FROM notifications WHERE workspace_id = $1 AND event_type = $2 AND channel = $3 ORDER BY recipient_id`,
    [w.workspaceId, event, channel])).rows;

  it("books render time for the Visualiser: the work item, the calendar entry, the days, the notice, and one overdue alert (PLM-090)", () => world(async (w) => {
    const calendars = new TeamCalendarsService(access(w, w.people.designer, DESIGN));
    // The firm's own default: 4 days for a render.
    const settings = await calendars.saveSettings(actor, w.workspaceId, "design", { connectionId: null, calendarId: null, version: 0, renderDays: 4 });
    expect(settings.renderDays).toBe(4);
    const options = await calendars.bookingOptions(actor, w.workspaceId);
    expect(options.cases.map((item) => item.id)).toContain(w.caseId);
    const commandId = randomUUID();
    const monday = (() => { let day = plusDays(w.today, 7); while (new Date(`${day}T00:00:00Z`).getUTCDay() !== 1) day = plusDays(day, 1); return day; })();
    const booked = await calendars.book(actor, w.workspaceId, { caseId: w.caseId, kind: "render", assigneeMembershipId: w.members.visualiser, startsOn: monday, commandId, note: "Living and kitchen" }) as Record<string, unknown>;
    expect(booked).toMatchObject({ kind: "render", days: 4, startsOn: monday, dueOn: plusDays(monday, 3), status: "booked" });
    // The same command again changes nothing.
    const again = await calendars.book(actor, w.workspaceId, { caseId: w.caseId, kind: "render", assigneeMembershipId: w.members.visualiser, startsOn: monday, commandId }) as Record<string, unknown>;
    expect(again.id).toBe(booked.id);
    expect((await w.client.query("SELECT 1 FROM design_work_bookings WHERE workspace_id = $1", [w.workspaceId])).rowCount).toBe(1);
    const task = (await w.client.query<{ owner: string; type: string; title: string }>(`SELECT owner_membership_id AS owner, type::text, title FROM crm_activities WHERE workspace_id = $1 AND id = $2`,
      [w.workspaceId, booked.activityId])).rows[0];
    expect(task).toEqual({ owner: w.members.visualiser, type: "task", title: "3D render · Maya Client" });
    expect((await told(w, "design.work_booked")).map((row) => row.recipient)).toEqual([w.people.visualiser]);

    const view = await calendars.entries(actor, w.workspaceId, "design", w.today, plusDays(w.today, 30));
    const entry = view.entries.find((item) => item.key === `booking:${booked.id}`)!;
    expect(entry).toMatchObject({ kind: "render", allDay: true, start: monday, end: plusDays(monday, 3), days: 4, ownerName: "Vic Visualiser", overdue: false, subject: "Maya Client" });
    expect(view.canBook).toBe(true);

    // Moved into the past: overdue, so the designer who booked it and the case owner hear once.
    const lastWeek = plusDays(w.today, -9);
    const moved = await calendars.changeBooking(actor, w.workspaceId, String(booked.id), "move", { version: Number(booked.version), startsOn: lastWeek, days: 2 }) as Record<string, unknown>;
    await processTeamCalendarDeadlines(w.client, w.workspaceId);
    await processTeamCalendarDeadlines(w.client, w.workspaceId);
    const alerts = await told(w, "design.work_overdue");
    expect(alerts.map((row) => row.recipient).sort()).toEqual([w.people.designer, w.people.owner].sort());
    expect(alerts[0].subject).toBe("3D render is overdue · Maya Client");
    expect((await told(w, "design.work_overdue", "email")).length).toBe(2);
    await expect(calendars.changeBooking(actor, w.workspaceId, String(booked.id), "complete", { version: Number(booked.version) })).rejects.toThrow("This booking changed");
    const done = await calendars.changeBooking(actor, w.workspaceId, String(booked.id), "complete", { version: Number(moved.version) }) as Record<string, unknown>;
    expect(done.status).toBe("done");
    expect((await w.client.query<{ status: string }>(`SELECT status::text FROM crm_activities WHERE workspace_id = $1 AND id = $2`, [w.workspaceId, booked.activityId])).rows[0].status).toBe("completed");
  }));

  it("books 2D design drawings for the job's designers, renders for a Visualiser and technical drawings for the technical team (PLM-177)", () => world(async (w) => {
    // The job's team: Dana leads the design and Faris is its Draftsman; Vic is in the firm's Visualiser team.
    await w.client.query("SET LOCAL session_replication_role = replica");
    await w.client.query(`INSERT INTO project_assignments(workspace_id,case_id,membership_id,is_manager,active,role_keys) VALUES($1,$2,$3,false,true,ARRAY['designer']),($1,$2,$4,false,true,ARRAY['draftsman'])`,
      [w.workspaceId, w.caseId, w.members.designer, w.members.maker]);
    const team = randomUUID();
    await w.client.query("INSERT INTO workspace_teams(id,workspace_id,business_unit_id,code,name) VALUES($1,$2,$3,'VISUALISER','Visualisers')", [team, w.workspaceId, randomUUID()]);
    await w.client.query("INSERT INTO workspace_team_members(workspace_id,team_id,membership_id) VALUES($1,$2,$3)", [w.workspaceId, team, w.members.visualiser]);
    await w.client.query("SET LOCAL session_replication_role = origin");
    const calendars = new TeamCalendarsService(access(w, w.people.designer, DESIGN));
    const settings = await calendars.saveSettings(actor, w.workspaceId, "design", { connectionId: null, calendarId: null, version: 0, designDrawingDays: 2 });
    expect(settings).toMatchObject({ designDrawingDays: 2, renderDays: 5, drawingDays: 3 });
    const options = await calendars.bookingOptions(actor, w.workspaceId);
    expect(options.cases.find((item) => item.id === w.caseId)!.people).toEqual({ design_2d: [w.members.designer], render: [w.members.visualiser], drawing: [w.members.maker] });
    expect(options.members.find((member) => member.id === w.members.visualiser)).toMatchObject({ visualiser: true, kinds: ["render"] });
    const monday = (() => { let day = plusDays(w.today, 7); while (new Date(`${day}T00:00:00Z`).getUTCDay() !== 1) day = plusDays(day, 1); return day; })();
    const book = (kind: string, assignee: string) => calendars.book(actor, w.workspaceId, { caseId: w.caseId, kind, assigneeMembershipId: assignee, startsOn: monday, commandId: randomUUID() }) as Promise<Record<string, unknown>>;

    // Each kind goes to its own people.
    await expect(book("design_2d", w.members.visualiser)).rejects.toThrow("Tag an Interior Designer on this job");
    await expect(book("render", w.members.designer)).rejects.toThrow("Tag a Visualiser");
    await expect(book("drawing", w.members.visualiser)).rejects.toThrow("Tag the technical team");
    const design = await book("design_2d", w.members.designer);
    expect(design).toMatchObject({ kind: "design_2d", days: 2, assigneeMembershipId: w.members.designer });
    const technical = await book("drawing", w.members.maker);
    expect(technical).toMatchObject({ kind: "drawing", days: 3 });
    const titles = (await w.client.query<{ title: string }>(`SELECT title FROM crm_activities WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY title`,
      [w.workspaceId, [design.activityId, technical.activityId]])).rows.map((row) => row.title);
    expect(titles).toEqual(["2D design drawings · Maya Client", "Technical drawings · Maya Client"]);
    // Dana booked her own 2D time, so only Faris hears of his.
    expect((await told(w, "design.work_booked")).map((row) => [row.recipient, row.subject])).toEqual([[w.people.maker, "Technical drawings booked · Maya Client"]]);
    const view = await calendars.entries(actor, w.workspaceId, "design", w.today, plusDays(w.today, 30));
    expect(view.entries.filter((entry) => entry.key.startsWith("booking:")).map((entry) => [entry.kind, entry.ownerName]).sort())
      .toEqual([["design_2d", "Dana Designer"], ["drawing", "Faris Factory"]]);

    // A job before its team is allocated: the 2D drawings go to its dedicated designer; with nobody in a role, anyone may be tagged.
    await w.client.query("UPDATE project_assignments SET active = false WHERE workspace_id = $1 AND case_id = $2", [w.workspaceId, w.caseId]);
    await w.client.query("DELETE FROM workspace_team_members WHERE workspace_id = $1 AND team_id = $2", [w.workspaceId, team]);
    expect((await calendars.bookingOptions(actor, w.workspaceId)).cases.find((item) => item.id === w.caseId)!.people).toEqual({ design_2d: [w.members.designer], render: [], drawing: [] });
    expect(await book("render", w.members.owner)).toMatchObject({ kind: "render" });
  }));

  it("shows production, delivery and installation, alerts once when they run late, and plans the Google push (PLM-091)", () => world(async (w) => {
    await w.client.query("SET LOCAL session_replication_role = replica");
    const order = randomUUID();
    await w.client.query(`INSERT INTO work_orders(id,workspace_id,number,project_id,boq_line_id,title,quantity,unit,status,planned_start,planned_end,created_by)
      VALUES($1,$2,12,$3,$4,'Wardrobe',1,'nos','planned',$5,$6,$7)`, [order, w.workspaceId, w.projectId, randomUUID(), plusDays(w.today, -5), plusDays(w.today, -2), w.people.manager]);
    await w.client.query("UPDATE delivery_projects SET delivery_on = $3, installation_on = $4 WHERE workspace_id = $1 AND id = $2", [w.workspaceId, w.projectId, plusDays(w.today, -1), plusDays(w.today, -1)]);
    const connection = randomUUID();
    await w.client.query(`INSERT INTO integration_connections(id,workspace_id,provider,display_name,status,connected_by) VALUES($1,$2,'google_workspace','Logistics','connected',$3)`,
      [connection, w.workspaceId, w.people.manager]);
    await w.client.query("SET LOCAL session_replication_role = origin");
    const calendars = new TeamCalendarsService(access(w, w.people.manager, FACTORY));
    const view = await calendars.entries(actor, w.workspaceId, "logistics", plusDays(w.today, -7), plusDays(w.today, 7));
    const byKind = Object.fromEntries(view.entries.map((entry) => [entry.kind, entry]));
    expect(byKind.production).toMatchObject({ key: `work-order:${order}`, detail: "WO-0012 Wardrobe", subject: "P-7 · Villa 12", overdue: true });
    // Goods not tracked as stock count as delivered once the day passed: the delivery isn't late; the installation is.
    expect(byKind.delivery).toMatchObject({ key: `delivery:${w.projectId}`, overdue: false, status: "delivered" });
    expect(byKind.installation).toMatchObject({ key: `installation:${w.projectId}`, overdue: true });
    await expect(calendars.entries(actor, w.workspaceId, "design", w.today, plusDays(w.today, 7))).rejects.toThrow("Not allowed");

    await processTeamCalendarDeadlines(w.client, w.workspaceId);
    await processTeamCalendarDeadlines(w.client, w.workspaceId);
    const late = await told(w, "logistics.overdue");
    // The work order: its project manager and factory lead; the installation: the project manager.
    expect(late.filter((row) => row.subject.startsWith("WO-0012")).map((row) => row.recipient).sort()).toEqual([w.people.manager, w.people.maker].sort());
    expect(late.filter((row) => row.subject.startsWith("Delivery"))).toEqual([]);
    expect(late.filter((row) => row.subject.startsWith("Installation")).map((row) => row.recipient)).toEqual([w.people.manager]);

    // The team's Google calendar is configuration; the push plan creates every entry once, then only what changed.
    await expect(calendars.pushPlan(actor, w.workspaceId, "logistics")).rejects.toThrow("Choose the Google calendar");
    await calendars.saveSettings(actor, w.workspaceId, "logistics", { connectionId: connection, calendarId: "logistics@example.com", version: 0 });
    const plan = await calendars.pushPlan(actor, w.workspaceId, "logistics");
    expect(plan.create.map((entry) => entry.key).sort()).toEqual([`delivery:${w.projectId}`, `installation:${w.projectId}`, `work-order:${order}`].sort());
    await calendars.recordPushes(actor, w.workspaceId, "logistics", { connectionId: connection, calendarId: "logistics@example.com",
      results: plan.create.map((entry) => ({ entryKey: entry.key, eventId: `e-${entry.recordId.slice(0, 8)}-${entry.kind}`, etag: "1", fingerprint: entry.fingerprint, startsOn: entry.start.slice(0, 10) })) });
    expect((await calendars.pushPlan(actor, w.workspaceId, "logistics")).create).toEqual([]);
    await w.client.query("SET LOCAL session_replication_role = replica");
    await w.client.query("UPDATE work_orders SET status = 'cancelled', closed_at = now(), close_reason = 'Client changed it' WHERE workspace_id = $1 AND id = $2", [w.workspaceId, order]);
    await w.client.query("UPDATE delivery_projects SET installation_on = $3 WHERE workspace_id = $1 AND id = $2", [w.workspaceId, w.projectId, plusDays(w.today, 3)]);
    await w.client.query("SET LOCAL session_replication_role = origin");
    const next = await calendars.pushPlan(actor, w.workspaceId, "logistics");
    expect(next.cancel.map((row) => row.entryKey)).toEqual([`work-order:${order}`]);
    expect(next.update.map((row) => row.key)).toEqual([`installation:${w.projectId}`]);
  }));

  it("books the Account Manager's weekly client update call, the next when one is done, and stops when declined (PLM-046)", () => world(async (w) => {
    const started = await startClientCalls(w.client, w.workspaceId, w.caseId, "design_approval", w.people.designer);
    expect(started).toMatchObject({ frequency: "weekly", ownerId: w.members.owner, startedFrom: "design_approval", callsBooked: 1 });
    expect(started!.nextOn! > w.today).toBe(true);
    expect([1, 2, 3, 4, 5]).toContain(new Date(`${started!.nextOn}T00:00:00Z`).getUTCDay());
    const call = (await w.client.query<{ type: string; owner: string; title: string; startsAt: Date }>(
      `SELECT activity.type::text, activity.owner_membership_id AS owner, activity.title, appointment.starts_at AS "startsAt" FROM crm_activities activity
         JOIN crm_appointments appointment ON appointment.workspace_id = activity.workspace_id AND appointment.activity_id = activity.id
        WHERE activity.workspace_id = $1 AND activity.id = $2`, [w.workspaceId, started!.nextActivityId])).rows[0];
    expect(call).toMatchObject({ type: "call", owner: w.members.owner, title: "Client update call · Maya Client" });
    expect((await told(w, "client_calls.booked")).map((row) => row.recipient)).toEqual([w.people.owner]);
    // Idempotent: starting again keeps the calls the job has.
    await startClientCalls(w.client, w.workspaceId, w.caseId, "estimate_accepted", null);
    expect((await w.client.query("SELECT 1 FROM crm_activities WHERE workspace_id = $1 AND type = 'call'", [w.workspaceId])).rowCount).toBe(1);

    // Nothing to do while the call is ahead; once it is done, the next is a week after its planned day.
    expect(await processClientCalls(w.client, w.workspaceId)).toEqual({ booked: 0 });
    await w.client.query("UPDATE crm_activities SET status = 'completed', completed_at = now() WHERE workspace_id = $1 AND id = $2", [w.workspaceId, started!.nextActivityId]);
    expect(await processClientCalls(w.client, w.workspaceId)).toEqual({ booked: 1 });
    const second = (await w.client.query<{ nextOn: string; callsBooked: number }>(`SELECT next_on::text AS "nextOn", calls_booked AS "callsBooked" FROM client_update_calls WHERE workspace_id = $1 AND case_id = $2`,
      [w.workspaceId, w.caseId])).rows[0];
    expect(second.callsBooked).toBe(2);
    expect(Date.parse(second.nextOn) - Date.parse(started!.nextOn!)).toBeGreaterThanOrEqual(7 * 86_400_000);

    // The client declines: off cancels the call ahead; monthly books again.
    const calls = new ClientCallsService(access(w, w.people.owner, DESIGN));
    const view = await calls.get(actor, w.workspaceId, w.caseId);
    expect(view).toMatchObject({ frequency: "weekly", ownerName: "Amal Account", started: true });
    const off = await calls.set(actor, w.workspaceId, w.caseId, { frequency: "off", version: view.version });
    expect(off).toMatchObject({ frequency: "off", next: null });
    expect((await w.client.query("SELECT 1 FROM crm_activities WHERE workspace_id = $1 AND type = 'call' AND status = 'pending'", [w.workspaceId])).rowCount).toBe(0);
    await expect(calls.set(actor, w.workspaceId, w.caseId, { frequency: "monthly", version: view.version })).rejects.toThrow("Someone changed the client calls");
    const monthly = await calls.set(actor, w.workspaceId, w.caseId, { frequency: "monthly", version: off.version });
    expect(monthly.frequency).toBe("monthly");
    expect(monthly.next).not.toBeNull();
    expect(await processClientCalls(w.client, w.workspaceId)).toEqual({ booked: 0 });
  }));

  it("makes the client updates portal updates: the call ahead is cancelled, the Account Manager is reminded on the day, the next follows on a working day (PLM-046)", () => world(async (w) => {
    const started = await startClientCalls(w.client, w.workspaceId, w.caseId, "design_approval", w.people.designer);
    const calls = new ClientCallsService(access(w, w.people.owner, DESIGN));
    const portal = await calls.set(actor, w.workspaceId, w.caseId, { frequency: "weekly", mode: "portal", version: started!.version });
    expect(portal).toMatchObject({ mode: "portal", frequency: "weekly", version: started!.version + 1 });
    const status = async (id: string) => (await w.client.query<{ status: string; outcome: string | null }>(
      `SELECT status::text, completion_outcome AS outcome FROM crm_activities WHERE workspace_id = $1 AND id = $2`, [w.workspaceId, id])).rows[0];
    expect((await status(started!.nextActivityId!)).status).toBe("cancelled");
    const task = (await w.client.query(`SELECT type::text, owner_membership_id AS owner, title, customer_visible AS "customerVisible", status::text FROM crm_activities WHERE workspace_id = $1 AND id = $2`,
      [w.workspaceId, portal.next!.activityId])).rows[0];
    expect(task).toEqual({ type: "task", owner: w.members.owner, title: "Post a progress update · Maya Client", customerVisible: false, status: "pending" });
    const first = portal.next!.on!;
    expect(first > w.today).toBe(true);
    expect([1, 2, 3, 4, 5]).toContain(new Date(`${first}T00:00:00Z`).getUTCDay());
    expect((await w.client.query(`SELECT source FROM audit_events WHERE workspace_id = $1 AND entity_id = $2 AND action = 'client_calls.mode_changed.v1'`, [w.workspaceId, w.caseId])).rows)
      .toEqual([{ source: "user" }]);

    // Nothing is said before the day; on the day the Account Manager hears it once, linked to the project's updates.
    expect(await processClientCalls(w.client, w.workspaceId)).toEqual({ booked: 0 });
    expect(await told(w, "client_calls.portal_update_due")).toEqual([]);
    await w.client.query("UPDATE client_update_calls SET next_on = $3 WHERE workspace_id = $1 AND case_id = $2", [w.workspaceId, w.caseId, w.today]);
    expect(await processClientCalls(w.client, w.workspaceId)).toEqual({ booked: 0 });
    await processClientCalls(w.client, w.workspaceId);
    expect(await told(w, "client_calls.portal_update_due")).toEqual([expect.objectContaining({ recipient: w.people.owner, subject: "Post a progress update · Maya Client" })]);
    expect((await told(w, "client_calls.portal_update_due", "email")).map((row) => row.recipient)).toEqual([w.people.owner]);
    expect((await w.client.query(`SELECT DISTINCT deep_link AS link FROM notifications WHERE workspace_id = $1 AND event_type = 'client_calls.portal_update_due'`, [w.workspaceId])).rows)
      .toEqual([{ link: `/workspace/projects/${w.projectId}/updates` }]);

    // An update shared with the client closes the reminder, and the next is a week on, on a working day.
    await w.client.query("UPDATE crm_activities SET created_at = now() - interval '1 hour' WHERE workspace_id = $1 AND id = $2", [w.workspaceId, portal.next!.activityId]);
    await w.client.query(`INSERT INTO project_status_updates (id, workspace_id, project_id, health, note, created_by, shared_at, shared_by) VALUES ($1, $2, $3, 'on_track', 'Cabinets fitted', $4, now(), $4)`,
      [randomUUID(), w.workspaceId, w.projectId, w.people.manager]);
    expect(await processClientCalls(w.client, w.workspaceId)).toEqual({ booked: 1 });
    expect(await status(portal.next!.activityId)).toEqual({ status: "completed", outcome: "Progress update shared" });
    const next = await calls.get(actor, w.workspaceId, w.caseId);
    expect(next.next!.activityId).not.toBe(portal.next!.activityId);
    expect(Date.parse(next.next!.on!) - Date.parse(w.today)).toBeGreaterThanOrEqual(7 * 86_400_000);
    expect([1, 2, 3, 4, 5]).toContain(new Date(`${next.next!.on}T00:00:00Z`).getUTCDay());
    expect(await processClientCalls(w.client, w.workspaceId)).toEqual({ booked: 0 });

    // Back to calls: the reminder is cancelled and a call is booked in the calendar.
    const back = await calls.set(actor, w.workspaceId, w.caseId, { frequency: "weekly", mode: "call", version: next.version });
    expect((await status(next.next!.activityId)).status).toBe("cancelled");
    expect(back.mode).toBe("call");
    expect((await w.client.query(`SELECT 1 FROM crm_activities activity JOIN crm_appointments appointment ON appointment.workspace_id = activity.workspace_id AND appointment.activity_id = activity.id
      WHERE activity.workspace_id = $1 AND activity.id = $2 AND activity.type = 'call' AND activity.status = 'pending'`, [w.workspaceId, back.next!.activityId])).rowCount).toBe(1);
  }));

  it("starts the client updates the firm set; in either mode a logged call or a shared portal update does each one, and no call is booked (PLM-179)", () => world(async (w) => {
    const projects = new ProjectCoreService(access(w, w.people.manager, ["workspace.settings.manage"]));
    const current = (await projects.settings(actor, w.workspaceId)).settings;
    expect(current).toMatchObject({ clientUpdateMode: "call", clientUpdateFrequency: "weekly" });
    await expect(projects.saveSettings(actor, w.workspaceId, { version: current.version, clientUpdateMode: "letter" })).rejects.toThrow("Choose a call, a portal update or either");
    const saved = await projects.saveSettings(actor, w.workspaceId, { version: current.version, clientUpdateMode: "either", clientUpdateFrequency: "weekly" });
    expect(saved.settings).toMatchObject({ clientUpdateMode: "either", clientUpdateFrequency: "weekly" });
    expect((await w.client.query(`SELECT 1 FROM audit_events WHERE workspace_id = $1 AND action = 'project.settings_changed'`, [w.workspaceId])).rowCount).toBe(1);

    // The design is approved: the job's updates start weekly, either way, with a reminder for the Account Manager and no call booked.
    const started = (await startClientCalls(w.client, w.workspaceId, w.caseId, "design_approval", w.people.designer))!;
    expect(started).toMatchObject({ mode: "either", frequency: "weekly", callsBooked: 0 });
    const reminder = (await w.client.query<{ type: string; title: string; owner: string }>(`SELECT type::text, title, owner_membership_id AS owner FROM crm_activities WHERE workspace_id = $1 AND id = $2`,
      [w.workspaceId, started.nextActivityId])).rows[0];
    expect(reminder).toEqual({ type: "task", title: "Update the client: call or portal update · Maya Client", owner: w.members.owner });
    expect((await w.client.query(`SELECT 1 FROM crm_appointments WHERE workspace_id = $1`, [w.workspaceId])).rowCount).toBe(0);
    expect(await told(w, "client_calls.booked")).toEqual([]);
    const calls = new ClientCallsService(access(w, w.people.owner, DESIGN));
    expect(await calls.get(actor, w.workspaceId, w.caseId)).toMatchObject({ mode: "either", frequency: "weekly", next: { activityId: started.nextActivityId, on: started.nextOn } });

    // On the day the Account Manager hears it once.
    await w.client.query("UPDATE client_update_calls SET next_on = $3 WHERE workspace_id = $1 AND case_id = $2", [w.workspaceId, w.caseId, w.today]);
    await processClientCalls(w.client, w.workspaceId);
    await processClientCalls(w.client, w.workspaceId);
    expect((await told(w, "client_calls.update_due")).map((row) => [row.recipient, row.subject])).toEqual([[w.people.owner, "Update Maya Client today"]]);

    // A call with the client, logged since, does this week's update; the next follows a week on.
    const status = async (id: string) => (await w.client.query<{ status: string; outcome: string | null }>(
      `SELECT status::text, completion_outcome AS outcome FROM crm_activities WHERE workspace_id = $1 AND id = $2`, [w.workspaceId, id])).rows[0];
    await w.client.query("UPDATE crm_activities SET created_at = now() - interval '1 hour' WHERE workspace_id = $1 AND id = $2", [w.workspaceId, started.nextActivityId]);
    await w.client.query(`INSERT INTO crm_activities (workspace_id, opportunity_id, type, interaction_direction, title, owner_membership_id, status, completed_at, created_by)
      VALUES ($1, $2, 'call', 'outbound', 'Weekly update', $3, 'completed', now(), $4)`, [w.workspaceId, w.opportunityId, w.members.owner, w.people.owner]);
    expect(await processClientCalls(w.client, w.workspaceId)).toEqual({ booked: 1 });
    expect(await status(started.nextActivityId!)).toEqual({ status: "completed", outcome: "Client called" });
    const second = (await calls.get(actor, w.workspaceId, w.caseId)).next!;
    expect(second.activityId).not.toBe(started.nextActivityId);
    expect(Date.parse(second.on!) - Date.parse(w.today)).toBeGreaterThanOrEqual(7 * 86_400_000);

    // A progress update shared in the portal does the next one just as well.
    await w.client.query("UPDATE crm_activities SET created_at = now() - interval '1 hour' WHERE workspace_id = $1 AND id = $2", [w.workspaceId, second.activityId]);
    await w.client.query(`INSERT INTO project_status_updates (id, workspace_id, project_id, health, note, created_by, shared_at, shared_by) VALUES ($1, $2, $3, 'on_track', 'Kitchen fitted', $4, now(), $4)`,
      [randomUUID(), w.workspaceId, w.projectId, w.people.manager]);
    expect(await processClientCalls(w.client, w.workspaceId)).toEqual({ booked: 1 });
    expect(await status(second.activityId)).toEqual({ status: "completed", outcome: "Progress update shared" });
    expect((await w.client.query(`SELECT 1 FROM crm_appointments WHERE workspace_id = $1`, [w.workspaceId])).rowCount).toBe(0);

    // The firm turns them off by default: a job whose updates start now has them off until someone turns them on.
    const off = await projects.saveSettings(actor, w.workspaceId, { version: saved.settings.version, clientUpdateFrequency: "off" });
    expect(off.settings.clientUpdateFrequency).toBe("off");
    await w.client.query("DELETE FROM client_update_calls WHERE workspace_id = $1 AND case_id = $2", [w.workspaceId, w.caseId]);
    expect(await startClientCalls(w.client, w.workspaceId, w.caseId, "design_approval", w.people.designer)).toMatchObject({ frequency: "off", mode: "either", nextActivityId: null });
  }));

  it("starts the calls from the accepted estimate on a job without design (PLM-046)", () => world(async (w) => {
    await winOpportunityOnAcceptance(w.client, { workspaceId: w.workspaceId, caseId: w.caseId, quoteNumber: 3, round: "main", actorUserId: w.people.owner, source: "user" });
    const row = (await w.client.query<{ startedFrom: string; frequency: string }>(`SELECT started_from AS "startedFrom", frequency FROM client_update_calls WHERE workspace_id = $1 AND case_id = $2`,
      [w.workspaceId, w.caseId])).rows[0];
    expect(row).toEqual({ startedFrom: "estimate_accepted", frequency: "weekly" });
  }));

  it("sets the areas each path uses after Won and never hides an area holding a record (PLM-098)", () => world(async (w) => {
    const flowId = randomUUID(), versionId = randomUUID();
    await w.client.query("INSERT INTO crm_flows(id,workspace_id,code,name) VALUES($1,$2,'furniture_only','Furniture only')", [flowId, w.workspaceId]);
    await w.client.query("INSERT INTO crm_flow_versions(id,workspace_id,flow_id,version,definition,checksum) VALUES($1,$2,$3,1,$4::jsonb,$5)",
      [versionId, w.workspaceId, flowId, JSON.stringify(starterFlow("basic").definition), "a".repeat(64)]);
    await w.client.query("SET LOCAL session_replication_role = replica");
    await w.client.query("UPDATE crm_opportunities SET flow_version_id = $3, furniture_path = 'take_home_now' WHERE workspace_id = $1 AND id = $2", [w.workspaceId, w.opportunityId, versionId]);
    await w.client.query("SET LOCAL session_replication_role = origin");
    // Nothing set: every area, exactly as before.
    expect(await projectAreas(w.client, w.workspaceId, w.projectId, w.caseId)).toEqual({ planning: true, production: true, supply: true, delivery: true, selection: true });
    const proposals = new OpportunityProposalsService(access(w, w.people.manager, ["crm.settings.manage"]));
    const before = await proposals.wonAreas(actor, w.workspaceId, flowId);
    expect(before.rules).toEqual([]);
    const saved = await proposals.saveWonAreas(actor, w.workspaceId, flowId, { rules: [{ furniturePath: null, areas: ["delivery"] }], versions: "" });
    expect(saved.rules).toEqual([{ furniturePath: null, areas: ["delivery"], version: 1 }]);
    await expect(proposals.saveWonAreas(actor, w.workspaceId, flowId, { rules: [], versions: "" })).rejects.toThrow("Someone changed the areas");
    expect(await projectAreas(w.client, w.workspaceId, w.projectId, w.caseId)).toEqual({ planning: false, production: false, supply: false, delivery: true, selection: false });
    // A factory slot already booked keeps Production showing.
    await w.client.query("SET LOCAL session_replication_role = replica");
    await w.client.query("UPDATE delivery_projects SET factory_slot_on = $3 WHERE workspace_id = $1 AND id = $2", [w.workspaceId, w.projectId, w.today]);
    await w.client.query("SET LOCAL session_replication_role = origin");
    expect((await projectAreas(w.client, w.workspaceId, w.projectId, w.caseId)).production).toBe(true);
    const audit = (await w.client.query("SELECT 1 FROM audit_events WHERE workspace_id = $1 AND action = 'crm.flow.won_areas_changed.v1'", [w.workspaceId])).rowCount;
    expect(audit).toBe(1);
  }));
});
