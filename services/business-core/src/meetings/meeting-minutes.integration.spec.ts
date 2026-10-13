import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readView } from "../client-portal/portal-read";
import { minutesComment } from "../client-portal/portal-meetings";
import { readPortalSettings } from "../client-portal/portal-settings";
import type { DecisionContext } from "../client-portal/portal-decisions";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { minutesDueSource } from "../reminders/sources/meetings";
import { MeetingMinutesService } from "./meeting-minutes.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const VIEW = ["crm.activities.view"];
const PDF = (text: string) => ({ buffer: Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`), originalname: `${text}.pdf`, mimetype: "application/pdf", size: 40 });
const HOUR = 3_600_000;
const NO_DEFINITIONS = { portalData: async () => null } as never;

type Person = { user: string; membership: string };
type World = {
  client: PoolClient; workspaceId: string; caseId: string; opportunityId: string; partyId: string; designer: Person; manager: Person; outsider: Person;
  grantId: string; minutes: (userId: string, permissions: string[]) => MeetingMinutesService;
  meeting: (input: { hoursAgo: number; status?: string; type?: string; opportunity?: string | null }) => Promise<string>;
  notices: (code: string, channel?: string) => Promise<Array<{ recipientType: string; recipient: string; subject: string; body: string }>>;
  portal: () => DecisionContext;
};

integration("PLM-153: minutes of client meetings through the client portal", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(run: (world: World) => Promise<void>, options: { contact?: boolean } = {}) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), partyId = randomUUID(), opportunityId = randomUUID(), grantId = randomUUID();
    const person = (): Person => ({ user: randomUUID(), membership: randomUUID() });
    const designer = person(), manager = person(), outsider = person();
    try {
      await client.query("BEGIN");
      const names: Array<[Person, string]> = [[designer, "Lina Designer"], [manager, "Adam Account"], [outsider, "Olga Outsider"]];
      for (const [who, name] of names) await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [who.user, `${who.user.slice(0, 8)}@example.com`, name]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','UTC',$3)", [workspaceId, `mm-${workspaceId.slice(0, 8)}`, designer.user]);
      for (const [who] of names) await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [who.membership, workspaceId, who.user]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [partyId, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, workspaceId, partyId, randomUUID(), randomUUID(), manager.membership]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, designer.user]);
      await client.query("INSERT INTO client_portal_settings(workspace_id,slug,enabled) VALUES($1,$2,true)", [workspaceId, `mm-${workspaceId.slice(0, 8)}`]);
      if (options.contact !== false)
        await client.query("INSERT INTO client_portal_grants(id,workspace_id,case_id,name,phone,role,email) VALUES($1,$2,$3,'Maya Client','+971500000001','approver','maya@example.com')",
          [grantId, workspaceId, caseId]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      const member = (userId: string) => (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const storage = new Map<string, Buffer>();
      const files = { put: async (key: string, body: Buffer) => { storage.set(key, body); }, read: async (key: string) => ({ body: storage.get(key)! }) } as never;
      await run_({
        client, workspaceId, caseId, opportunityId, partyId, designer, manager, outsider, grantId,
        minutes: (userId, permissions) => new MeetingMinutesService({ asMember: member(userId),
          hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) } as never, files),
        meeting: async ({ hoursAgo, status = "pending", type = "meeting", opportunity = opportunityId }) => {
          const id = randomUUID();
          const start = new Date(Date.now() - hoursAgo * HOUR);
          await client.query(`INSERT INTO crm_activities (id, workspace_id, party_id, opportunity_id, type, status, title, owner_membership_id, due_at, customer_visible)
            VALUES ($1, $2, $3, $4, $5::crm_activity_type, $6::crm_activity_status, 'Kick-off meeting', $7, $8, true)`,
            [id, workspaceId, opportunity ? null : partyId, opportunity, type, status, designer.membership, start]);
          await client.query(`INSERT INTO crm_appointments (workspace_id, activity_id, starts_at, ends_at, timezone, attendee_party_ids, attendee_membership_ids)
            VALUES ($1, $2, $3, $4, 'UTC', $5, $6)`, [workspaceId, id, start, new Date(start.getTime() + HOUR), JSON.stringify([partyId]), JSON.stringify([designer.membership, manager.membership])]);
          return id;
        },
        notices: async (code, channel = "in_app") => (await client.query<{ recipientType: string; recipient: string; subject: string; body: string }>(
          `SELECT recipient_type AS "recipientType", recipient_id AS recipient, subject, body FROM notifications WHERE workspace_id = $1 AND event_type = $2 AND channel = $3 ORDER BY created_at`,
          [workspaceId, code, channel])).rows,
        portal: () => ({ db: client, workspaceId, contact: { sessionId: "s", phone: "+971500000001", name: "Maya Client", nameConfirmed: true,
          grants: [{ id: grantId, caseId, name: "Maya Client", role: "approver", email: "maya@example.com", confirmed: true, demo: false }] },
          settings: undefined as never, today: new Date().toISOString().slice(0, 10), commercial: undefined as never, definitions: undefined as never, verify: async () => true }) as unknown as DecisionContext,
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    async function run_(value: World) { await run(value); }
  }

  const body = (minutesId: string, version: number, over: Record<string, unknown> = {}) =>
    ({ minutesId, version, title: "Kick-off", body: "Render sign-off agreed for 20 Oct. Client to send the kitchen appliance list.", fileIds: [], shared: false, ...over });

  it("the designer writes the minutes, shares them (the client is emailed once), edits keep their history, and the portal shows the latest", async () => {
    await world(async (w) => {
      const activityId = await w.meeting({ hoursAgo: 3 });
      const designer = w.minutes(w.designer.user, []);
      let state = await designer.read(actor, w.workspaceId, activityId);
      expect(state).toMatchObject({ problem: null, canWrite: true, minutes: null, portal: { caseId: w.caseId, enabled: true, shown: true, contacts: 1 } });

      // Kept internal first: nothing goes to the client.
      const minutesId = randomUUID();
      const file = await designer.upload(actor, w.workspaceId, activityId, randomUUID(), PDF("whiteboard"));
      state = await designer.save(actor, w.workspaceId, activityId, body(minutesId, 0, { fileIds: [file.id] }));
      expect(state.minutes).toMatchObject({ id: minutesId, revision: 1, sharedAt: null, authorName: "Lina Designer", fileIds: [file.id] });
      expect(await w.notices("portal.minutes_shared", "email")).toEqual([]);

      // Shared: the client's contact gets the branded email once.
      state = await designer.save(actor, w.workspaceId, activityId, body(minutesId, state.minutes!.version, { fileIds: [file.id], shared: true }));
      expect(state.told).toMatchObject({ queued: 1 });
      expect(await w.notices("portal.minutes_shared", "email")).toEqual([expect.objectContaining({ recipientType: "portal_contact", recipient: w.grantId,
        subject: expect.stringContaining("Notes from your meeting") })]);

      // Edited after sharing: a new revision, the earlier ones kept, no second email; the portal says it was updated.
      await expect(designer.save(actor, w.workspaceId, activityId, body(minutesId, 1, { shared: true }))).rejects.toThrow("Someone else changed these minutes");
      state = await designer.save(actor, w.workspaceId, activityId, body(minutesId, state.minutes!.version, { fileIds: [file.id], shared: true,
        body: "Render sign-off agreed for 21 Oct. Client to send the kitchen appliance list." }));
      expect(state.revisions.map((revision) => `${revision.revision}:${revision.shared}`)).toEqual(["3:true", "2:true", "1:false"]);
      expect(state.revisions[2].body).toContain("20 Oct");
      expect(await w.notices("portal.minutes_shared", "email")).toHaveLength(1);
      const view = await readView(w.client, w.workspaceId, w.portal().contact, await readPortalSettings(w.client, w.workspaceId), NO_DEFINITIONS);
      const project = view.projects[0];
      expect(project.sections.meetings).toBe(true);
      expect(project.meetings!.meetings).toEqual([expect.objectContaining({ id: minutesId, title: "Kick-off", text: expect.stringContaining("21 Oct"), updatedAt: expect.any(String),
        files: [expect.objectContaining({ id: file.id, name: "whiteboard.pdf" })], comments: [] })]);
      expect(project.feed.some((card) => card.kind === "minutes" && card.id === minutesId)).toBe(true);

      // The client comments; the author hears it in the app and by email. The team replies; the client is emailed.
      const ctx = { ...w.portal(), settings: await readPortalSettings(w.client, w.workspaceId) };
      await expect(minutesComment(ctx, { caseId: w.caseId, minutesId: randomUUID(), commentId: randomUUID(), text: "Hi" })).rejects.toThrow("aren't shared with you");
      await minutesComment(ctx, { caseId: w.caseId, minutesId, commentId: randomUUID(), text: "Can we move the sign-off to 22 Oct?" });
      expect(await w.notices("meeting.minutes_comment")).toEqual([expect.objectContaining({ recipient: w.designer.user, body: "Can we move the sign-off to 22 Oct?" })]);
      expect(await w.notices("meeting.minutes_comment", "email")).toHaveLength(1);
      state = await w.minutes(w.manager.user, []).reply(actor, w.workspaceId, activityId, { commentId: randomUUID(), text: "Yes, 22 Oct works." });
      expect(state.comments.map((comment) => [comment.fromClient, comment.author, comment.text])).toEqual([
        [true, "Maya Client", "Can we move the sign-off to 22 Oct?"], [false, "Adam Account", "Yes, 22 Oct works."]]);
      expect((await w.notices("portal.team_replied", "email")).map((row) => row.recipient)).toEqual([w.grantId]);
      const after = await readView(w.client, w.workspaceId, w.portal().contact, await readPortalSettings(w.client, w.workspaceId), NO_DEFINITIONS);
      // The client reads the team as one team, never a person.
      expect(after.projects[0].meetings!.meetings[0].comments.map((comment) => comment.author)).toEqual(["Maya Client", null]);
    });
  });

  it("refuses minutes on a cancelled meeting or one not started yet, and to people outside the meeting without access", async () => {
    await world(async (w) => {
      const cancelled = await w.meeting({ hoursAgo: 5, status: "cancelled" });
      const future = await w.meeting({ hoursAgo: -24 });
      const designer = w.minutes(w.designer.user, []);
      expect((await designer.read(actor, w.workspaceId, cancelled)).problem).toBe("This meeting was cancelled.");
      await expect(designer.save(actor, w.workspaceId, cancelled, body(randomUUID(), 0))).rejects.toThrow("This meeting was cancelled.");
      await expect(designer.save(actor, w.workspaceId, future, body(randomUUID(), 0))).rejects.toThrow("once the meeting has started");
      await expect(w.minutes(w.outsider.user, []).read(actor, w.workspaceId, future)).rejects.toThrow("Meeting not found.");
      // Someone who only sees activities reads them but doesn't write them.
      const viewer = await w.minutes(w.outsider.user, VIEW).read(actor, w.workspaceId, future);
      expect(viewer.canWrite).toBe(false);
      await expect(w.minutes(w.outsider.user, VIEW).save(actor, w.workspaceId, future, body(randomUUID(), 0))).rejects.toThrow("Only the people in the meeting");
    });
  });

  it("shares minutes with a client who has no portal access yet: nobody is emailed, and they are there once the client is invited", async () => {
    await world(async (w) => {
      const activityId = await w.meeting({ hoursAgo: 2 });
      const designer = w.minutes(w.designer.user, []);
      const state = await designer.save(actor, w.workspaceId, activityId, body(randomUUID(), 0, { shared: true }));
      expect(state.portal).toMatchObject({ contacts: 0 });
      expect(state.told).toMatchObject({ queued: 0, reason: "no_contact" });
      await w.client.query("INSERT INTO client_portal_grants(id,workspace_id,case_id,name,phone,role) VALUES($1,$2,$3,'Maya Client','+971500000001','approver')", [w.grantId, w.workspaceId, w.caseId]);
      const view = await readView(w.client, w.workspaceId, w.portal().contact, await readPortalSettings(w.client, w.workspaceId), NO_DEFINITIONS);
      expect(view.projects[0].meetings!.meetings).toHaveLength(1);
    }, { contact: false });
  });

  it("reminds the meeting's owner when a meeting ended without minutes, until they are written", async () => {
    await world(async (w) => {
      const ended = await w.meeting({ hoursAgo: 4 });
      const cancelled = await w.meeting({ hoursAgo: 4, status: "cancelled" });
      const old = await w.meeting({ hoursAgo: 24 * 10 });
      const call = await w.meeting({ hoursAgo: 4, type: "call" });
      const due = await minutesDueSource.open(w.client, w.workspaceId, { clock: {} as never, now: new Date(), limit: 50 });
      expect(due.map((item) => item.sourceId)).toEqual([ended]);
      expect(due[0]).toMatchObject({ ownerMembershipId: w.designer.membership, context: "Maya Client", href: `/workspace/crm/follow-ups?record=${ended}`,
        jobSource: { type: "opportunity", id: w.opportunityId } });
      expect([cancelled, old, call].some((id) => due.some((item) => item.sourceId === id))).toBe(false);
      const at = { now: new Date(), today: new Date().toISOString().slice(0, 10) };
      expect(await minutesDueSource.stillOpen(w.client, w.workspaceId, [`minutes:${ended}`], at)).toEqual(new Set([`minutes:${ended}`]));
      // Written (even kept internal): done.
      await w.minutes(w.designer.user, []).save(actor, w.workspaceId, ended, body(randomUUID(), 0));
      expect(await minutesDueSource.stillOpen(w.client, w.workspaceId, [`minutes:${ended}`], at)).toEqual(new Set());
    });
  });
});
