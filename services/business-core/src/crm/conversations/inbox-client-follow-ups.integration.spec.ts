import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { confirmAppointment, runClientFollowUps, thankForDeal, thankForHandover } from "./inbox/client-followups";
import { STARTER_PACK } from "./inbox/whatsapp-starter-pack";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const FOLLOW_UPS = new Set(["crm.meeting.booked", "crm.meeting.reminder", "crm.enquiry.quiet", "commercial.quote_follow_up", "crm.opportunity.won", "project.handover_thanks"]);

type World = { w: string; admin: string; noura: string; chat: string; lead: string; opportunity: string; project: string };

integration("automatic client messages: visits, quiet enquiries, won deals and handover", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withWorld(work: (client: PoolClient, world: World) => Promise<void>) {
    const client = await pool.connect();
    const [w, admin, noura, chat, lead, opportunity, caseId, project] = Array.from({ length: 8 }, () => randomUUID());
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers and reference checks
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Maya Admin')", [admin, `${admin.slice(0, 8)}@example.com`]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio One',$2,'USD','UTC',$3)", [w, `follow-${w.slice(0, 8)}`, admin]);
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [w]);
      await client.query(`INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES ($1,$2,'person','Noura Haddad','noura haddad')`, [noura, w]);
      await client.query(`INSERT INTO crm_consents(workspace_id,party_id,purpose,channel,status) VALUES ($1,$2,'service','whatsapp','granted')`, [w, noura]);
      await client.query(`INSERT INTO crm_contact_points(workspace_id,party_id,type,raw_value,normalized_value,is_primary) VALUES ($1,$2,'phone','+15550002222','+15550002222',true)`, [w, noura]);
      await client.query(`INSERT INTO crm_conversations(id,workspace_id,party_id,channel,subject,provider_thread_id) VALUES ($1,$2,$3,'whatsapp','Noura','15550002222')`, [chat, w, noura]);
      await client.query(`INSERT INTO integration_connections(workspace_id,provider,display_name,status,connected_by,external_account_id,configuration)
        VALUES($1,'whatsapp','WhatsApp','connected',$2,'waba-1','{"phoneNumberId":"pn-1","displayPhoneNumber":"+1 555 0100","isDefault":true}')`, [w, admin]);
      const enquiry = randomUUID();
      await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference) VALUES ($1,$2,gen_random_uuid(),$3,'Villa','website','form',now(),'E-0107')`, [enquiry, w, noura]);
      await client.query(`INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id,status) VALUES ($1,$2,$3,$4,'connected')`, [lead, w, enquiry, noura]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference,status) VALUES ($1,$2,$3,gen_random_uuid(),gen_random_uuid(),'Villa','O-1','won')`, [opportunity, w, noura]);
      await client.query(`INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES ($1,$2,$3,$4)`, [caseId, w, opportunity, admin]);
      await client.query(`INSERT INTO delivery_projects(id,workspace_id,case_id,name,created_by) VALUES ($1,$2,$3,'Villa renovation',$4)`, [project, w, caseId, admin]);
      // The follow-up starter templates, approved at Meta, with their variables mapped (as the starter pack leaves them).
      for (const starter of STARTER_PACK.filter((item) => FOLLOW_UPS.has(item.event))) {
        await client.query(`INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, body_template, variables, provider_status, approved_at)
          VALUES ($1, $2, 'whatsapp', 'en', 1, 'approved', $3, '[]', 'approved', now())`, [w, starter.name, starter.bodies.en]);
        for (const [index, source] of starter.sources.entries()) {
          await client.query(`INSERT INTO crm_template_variables (workspace_id, channel, template_code, position, source) VALUES ($1, 'whatsapp', $2, $3, $4)`, [w, starter.name, index + 1, source]);
        }
      }
      await client.query("SET LOCAL session_replication_role = origin");
      await work(client, { w, admin, noura, chat, lead, opportunity, project });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const automatic = (client: PoolClient, w: string) => client.query<{ event: string; code: string; body: string }>(
    `SELECT metadata->>'automatic' AS event, metadata->'template'->>'code' AS code, body_text AS body FROM crm_messages
      WHERE workspace_id = $1 AND metadata ? 'automatic' ORDER BY created_at, id`, [w]).then((result) => result.rows);
  const meeting = async (client: PoolClient, world: World, input: { startsIn: number; bookedAgo?: number; address?: string | null }) => {
    const activity = randomUUID();
    await client.query(`INSERT INTO crm_activities (id, workspace_id, party_id, lead_id, type, title, customer_visible) VALUES ($1, $2, $3, $4, 'meeting', 'Site visit', true)`, [activity, world.w, world.noura, world.lead]);
    const startsAt = new Date(Date.now() + input.startsIn * 3_600_000);
    await client.query(`INSERT INTO crm_appointments (workspace_id, activity_id, starts_at, ends_at, timezone, location, attendee_party_ids, created_at)
      VALUES ($1, $2, $3, $4, 'UTC', $5, $6, $7)`, [world.w, activity, startsAt, new Date(startsAt.getTime() + 3_600_000), input.address ? { mode: "in_person", address: input.address } : { mode: "in_person" },
      JSON.stringify([world.noura]), new Date(Date.now() - (input.bookedAgo ?? 0) * 3_600_000)]);
    return activity;
  };

  it("confirms a visit with its address, or with its time only, once for each time it is set for", async () => {
    await withWorld(async (client, world) => {
      const withAddress = await meeting(client, world, { startsIn: 48, address: "Villa 12, Garden Street" });
      expect(await confirmAppointment(client, world.w, withAddress)).toMatchObject({ sent: true, duplicate: false });
      expect(await confirmAppointment(client, world.w, withAddress)).toMatchObject({ sent: true, duplicate: true });
      const timeOnly = await meeting(client, world, { startsIn: 72 });
      await confirmAppointment(client, world.w, timeOnly);
      const sent = await automatic(client, world.w);
      expect(sent.map((row) => row.code).sort()).toEqual(["wd_visit_confirmed", "wd_visit_confirmed_time"]);
      expect(sent.find((row) => row.code === "wd_visit_confirmed")?.body).toMatch(/^Hello Noura, your appointment with Studio One is confirmed for .+ at Villa 12, Garden Street\./);
      // Queued for the worker like any client message (the allowlist and the number's rules apply there).
      expect((await client.query(`SELECT 1 FROM notifications WHERE workspace_id = $1 AND channel = 'whatsapp' AND status = 'pending'`, [world.w])).rowCount).toBe(2);
      // Never to a number marked as spam or blocked.
      await client.query(`UPDATE crm_parties SET spam_at = now() WHERE id = $1`, [world.noura]);
      expect(await confirmAppointment(client, world.w, await meeting(client, world, { startsIn: 96, address: "Elsewhere" }))).toMatchObject({ sent: false, reason: "blocked" });
    });
  });

  it("reminds the day before a visit booked a day ahead, once", async () => {
    await withWorld(async (client, world) => {
      await meeting(client, world, { startsIn: 20, bookedAgo: 72, address: "Villa 12, Garden Street" });
      await meeting(client, world, { startsIn: 20, bookedAgo: 1, address: "Booked today" });
      await meeting(client, world, { startsIn: 50, bookedAgo: 72, address: "Not tomorrow" });
      expect(await runClientFollowUps(client, world.w)).toEqual({ reminders: 1, quiet: 0 });
      expect(await runClientFollowUps(client, world.w)).toEqual({ reminders: 0, quiet: 0 });
      const sent = await automatic(client, world.w);
      expect(sent.map((row) => row.code)).toEqual(["wd_visit_reminder"]);
      expect(sent[0].body).toMatch(/tomorrow, .+, at Villa 12, Garden Street\./);
    });
  });

  it("nudges a quiet enquiry once (twice when the firm wants), and stops when the client replies", async () => {
    await withWorld(async (client, world) => {
      await client.query(`INSERT INTO crm_messages (workspace_id, conversation_id, direction, status, authorship, sender_type, sender_id, body_text, created_at)
        VALUES ($1, $2, 'outbound', 'read', 'human', 'user', $3, 'Here is our proposal', now() - interval '4 days')`, [world.w, world.chat, world.admin]);
      expect(await runClientFollowUps(client, world.w)).toEqual({ reminders: 0, quiet: 1 });
      // The pass is idempotent, and only one nudge goes unless the firm turned on a second one.
      expect(await runClientFollowUps(client, world.w)).toEqual({ reminders: 0, quiet: 0 });
      expect((await automatic(client, world.w)).map((row) => row.code)).toEqual(["wd_enquiry_follow_up"]);
      await client.query(`UPDATE crm_inbox_settings SET quiet_followup_second_days = 7 WHERE workspace_id = $1`, [world.w]);
      // The second gap counts from the first nudge (our last message).
      await client.query(`UPDATE crm_messages SET created_at = CASE WHEN metadata->>'automatic' = 'crm.enquiry.quiet' THEN now() - interval '8 days' ELSE now() - interval '12 days' END
        WHERE workspace_id = $1 AND direction = 'outbound'`, [world.w]);
      // A nudge takes the client's one reminder of the day: on the same day the second one is held.
      expect((await runClientFollowUps(client, world.w)).quiet).toBe(0);
      // Days later (the first nudge's claim is from another day), it goes.
      await client.query(`UPDATE reminder_client_days SET local_date = local_date - 8 WHERE workspace_id = $1`, [world.w]);
      expect((await runClientFollowUps(client, world.w)).quiet).toBe(1);
      // The client answered: no more nudges.
      await client.query(`UPDATE crm_inbox_settings SET quiet_followup_second_days = 20 WHERE workspace_id = $1`, [world.w]);
      await client.query(`INSERT INTO crm_messages (workspace_id, conversation_id, direction, status, authorship, sender_type, body_text) VALUES ($1, $2, 'inbound', 'delivered', 'provider', 'provider', 'Sorry, busy week')`, [world.w, world.chat]);
      expect((await runClientFollowUps(client, world.w)).quiet).toBe(0);
    });
  });

  it("thanks a won deal once, and after handover with the review link when the firm set one", async () => {
    await withWorld(async (client, world) => {
      expect(await thankForDeal(client, world.w, world.opportunity)).toMatchObject({ sent: true, duplicate: false });
      expect(await thankForDeal(client, world.w, world.opportunity)).toMatchObject({ duplicate: true });
      await client.query(`INSERT INTO crm_inbox_settings (workspace_id, review_url) VALUES ($1, 'https://reviews.example.com/studio-one')`, [world.w]);
      await thankForHandover(client, world.w, world.project);
      const sent = await automatic(client, world.w);
      expect(sent.map((row) => row.code).sort()).toEqual(["wd_deal_won", "wd_handover_review"]);
      expect(sent.find((row) => row.code === "wd_handover_review")?.body).toBe("Hello Noura, Villa renovation is complete. Thank you for choosing Studio One. We would love to hear how it went: https://reviews.example.com/studio-one Thank you.");
      await expect(client.query(`UPDATE crm_inbox_settings SET review_url = 'http://not-secure.example' WHERE workspace_id = $1`, [world.w])).rejects.toThrow(/review_url_check/);
    });
  });

  it("thanks after handover without a link when the firm has none", async () => {
    await withWorld(async (client, world) => {
      await thankForHandover(client, world.w, world.project);
      expect((await automatic(client, world.w)).map((row) => row.code)).toEqual(["wd_handover_thanks"]);
    });
  });
});
