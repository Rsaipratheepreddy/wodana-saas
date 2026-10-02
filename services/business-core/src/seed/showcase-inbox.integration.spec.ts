import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CrmInboxService } from "../crm/conversations/crm-inbox.service";
import { seedShowcaseInbox } from "./showcase-inbox";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

const CLIENTS: Array<[string, string]> = [
  ["Hessa Al Suwaidi", "+971506000011"], ["Daniel Okafor", "+971506000012"], ["Mariam Haddad", "+971506000013"], ["Aisha Karim", "+971506000015"],
  ["Sofia Bennett", "+971565000005"], ["Omar and Layla Haddad", "+971553000003"], ["Faris Khoury", "+971524000004"], ["Nikolai Petrov", "+971506000016"],
];

integration("showcase inbox seed", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  it("seeds eight chats with history, templates, quick replies and auto replies as records only, once", async () => {
    const client: PoolClient = await pool.connect();
    const workspaceId = randomUUID(), owner = randomUUID(), ownerMember = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Owen Owner')", [owner, `${owner.slice(0, 8)}@example.com`]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Demo Interiors',$2,'USD','UTC',$3)", [workspaceId, `demo-${workspaceId.slice(0, 8)}`, owner]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id) VALUES($1,$2,$3)", [ownerMember, workspaceId, owner]);
      for (const [name, mobile] of CLIENTS) {
        const party = randomUUID();
        await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person',$3,$4)", [party, workspaceId, name, name.toLowerCase()]);
        await client.query("INSERT INTO crm_contact_points(workspace_id,party_id,type,raw_value,normalized_value,is_primary) VALUES($1,$2,'phone',$3,$4,true)", [workspaceId, party, mobile, mobile]);
      }
      await client.query("SET LOCAL session_replication_role = origin");
      // The seed runs as the app role, so forced RLS and the role's grants apply.
      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [workspaceId, owner]);
      const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: owner });
      const inbox = new CrmInboxService({} as never, { withPermission: run, hasPermission: async () => true } as never, { record: async () => randomUUID() } as never);
      const staff = { provider: "local", subject: owner, email: "owner@example.com", displayName: "Owen Owner", userId: owner, membershipId: ownerMember };
      const created: string[] = [], skipped: string[] = [];
      const context = {
        workspaceId, owner: staff, inbox, transaction: <T,>(work: (db: PoolClient) => Promise<T>) => work(client), staff: async () => staff,
        id: (key: string) => { const hex = createHash("sha1").update(`${workspaceId}:${key}`).digest("hex"); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`; },
        made: (label: string) => created.push(label), kept: () => undefined, skip: (stage: string, reason: string) => skipped.push(`${stage}: ${reason}`),
      };
      await seedShowcaseInbox(context);
      expect(skipped).toEqual([]);

      const chats = await client.query<{ name: string; status: string; unread: number; waiting: boolean; labels: string[] }>(
        `SELECT party.display_name AS name, chat.status, chat.unread_count AS unread, chat.waiting_since IS NOT NULL AS waiting,
                ARRAY(SELECT label.name FROM crm_conversation_label_links link JOIN crm_conversation_labels label ON label.id = link.label_id WHERE link.conversation_id = chat.id ORDER BY label.name) AS labels
           FROM crm_conversations chat JOIN crm_parties party ON party.id = chat.party_id ORDER BY party.display_name`);
      expect(chats.rows).toEqual([
        { name: "Aisha Karim", status: "open", unread: 0, waiting: false, labels: ["Site visit"] },
        { name: "Daniel Okafor", status: "open", unread: 2, waiting: true, labels: ["Quote request"] },
        { name: "Faris Khoury", status: "closed", unread: 0, waiting: false, labels: ["Site visit"] },
        { name: "Hessa Al Suwaidi", status: "open", unread: 2, waiting: true, labels: ["Quote request"] },
        { name: "Mariam Haddad", status: "snoozed", unread: 0, waiting: false, labels: [] },
        { name: "Nikolai Petrov", status: "closed", unread: 0, waiting: false, labels: [] },
        { name: "Omar and Layla Haddad", status: "open", unread: 1, waiting: true, labels: ["Payment"] },
        { name: "Sofia Bennett", status: "open", unread: 1, waiting: true, labels: ["Quote request", "Urgent"] },
      ]);
      const kinds = await client.query<{ kind: string; count: number }>(
        `SELECT CASE WHEN metadata->>'automatic' IS NOT NULL THEN metadata->>'automatic' WHEN metadata ? 'fileName' THEN 'file' ELSE direction::text END AS kind, count(*)::int AS count
           FROM crm_messages GROUP BY 1 ORDER BY 1`);
      expect(Object.fromEntries(kinds.rows.map((row) => [row.kind, row.count]))).toEqual({ auto_reply: 1, file: 2, inbound: 13, internal: 3, outbound: 12, "payments.reminder": 1,
        "crm.enquiry.quiet": 1, "crm.meeting.booked": 1, "crm.opportunity.won": 1 });
      // The automatic client messages read as the client got them, from the approved starter templates.
      const automatic = await client.query<{ code: string; body: string }>(`SELECT metadata->'template'->>'code' AS code, body_text AS body FROM crm_messages
        WHERE metadata->>'automatic' IN ('crm.enquiry.quiet', 'crm.meeting.booked', 'crm.opportunity.won') ORDER BY 1`);
      expect(automatic.rows).toEqual([
        { code: "wd_deal_won", body: "Hello Omar, thank you for choosing Demo Interiors! Our team will contact you shortly to plan the next steps of your project." },
        { code: "wd_enquiry_follow_up", body: expect.stringMatching(/^Hello Nikolai, we are following up on your enquiry .+\. Is there anything Demo Interiors can help you with\?/) },
        { code: "wd_visit_confirmed", body: expect.stringMatching(/^Hello Aisha, your appointment with Demo Interiors is confirmed for .+ 11:00 AM at Showroom, Building 7, Design District\./) },
      ]);
      const greeting = (await client.query<{ body: string }>(`SELECT body_text AS body FROM crm_messages WHERE metadata->>'automatic' = 'auto_reply'`)).rows[0];
      expect(greeting.body).toBe("Hi Hessa, thanks for contacting Demo Interiors. We have received your message and will reply shortly.");
      expect((await client.query(`SELECT 1 FROM crm_auto_replies`)).rowCount).toBe(1);
      // Records only: nothing is queued for delivery.
      expect((await client.query(`SELECT 1 FROM notifications WHERE channel IN ('whatsapp', 'email')`)).rowCount).toBe(0);
      expect((await client.query(`SELECT 1 FROM crm_messages WHERE status = 'queued'`)).rowCount).toBe(0);

      const templates = await client.query<{ code: string; state: string; reason: string | null }>(`SELECT code, provider_status AS state, provider_reason AS reason FROM notification_templates WHERE channel = 'whatsapp' ORDER BY code`);
      expect(templates.rows.map((row) => [row.code, row.state])).toEqual([
        ["handover_invitation", "pending"], ["payment_reminder_friendly", "approved"], ["quotation_ready", "approved"], ["seasonal_offer", "rejected"], ["site_visit_confirmed", "approved"],
        ...["wd_deal_won", "wd_enquiry_follow_up", "wd_handover_review", "wd_handover_thanks", "wd_quote_follow_up", "wd_visit_confirmed", "wd_visit_confirmed_time", "wd_visit_reminder", "wd_visit_reminder_time"]
          .map((code) => [code, "approved"]),
      ]);
      expect(templates.rows.find((row) => row.code === "seasonal_offer")?.reason).toMatch(/Marketing category/);
      expect((await client.query(`SELECT shortcut FROM crm_quick_replies ORDER BY shortcut`)).rows.map((row) => row.shortcut)).toEqual(DEFAULT_QUICK_REPLIES.map((reply) => reply.shortcut).sort());
      expect((await inbox.autoReplies({} as never, workspaceId)).workspace).toMatchObject({ greeting: { enabled: true }, away: { enabled: true }, version: 1 });

      // A second run finds everything and adds nothing.
      created.length = 0;
      await seedShowcaseInbox(context);
      expect(created).toEqual([]);
      expect((await client.query(`SELECT 1 FROM crm_conversations`)).rowCount).toBe(8);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
