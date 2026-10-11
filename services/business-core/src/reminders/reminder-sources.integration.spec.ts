import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readClock } from "./engine/context";
import type { ReminderSource } from "./engine/engine";
import { BUILTIN_REMINDER_SOURCES } from "./sources/index";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). The built-in sources' own queries,
// as the app role under forced RLS: every source runs on the real schema, and the ones the module specs don't reach
// (finance requests, the inbox, the Ledger's posting issues, enquiries nobody owns) list and close what they should.
// Module specs cover the rest with their own records: work.due (project-core), approval.waiting (approval-chasers),
// client.quote_decision (client-decisions), quote.expiring (quote-expiry), payment.due (client-portal),
// invoice.overdue, payables.due and purchase.order_late (project-core), design.stage_due (design-journey),
// permit.expiry (logistics), crm.follow_up (home-summary).
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("built-in reminder sources on real Postgres", { timeout: 120_000 }, () => {
  let pool: Pool;
  const run = randomUUID().slice(0, 8);
  const ws = randomUUID(), owner = randomUUID(), membership = randomUUID(), finance = randomUUID(), financeMembership = randomUUID(), role = randomUUID();
  const party = randomUUID(), lead = randomUUID(), enquiry = randomUUID(), chat = randomUUID(), request = randomUUID();
  const source = (kind: string) => BUILTIN_REMINDER_SOURCES.find((item) => item.kind === kind)!;

  async function tenant<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [ws, owner]);
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
  async function fixture(sql: string, params: unknown[]) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(sql, params);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  const listed = (kind: string) => tenant(async (client) => {
    const now = new Date();
    return source(kind).open(client, ws, { clock: await readClock(client, ws, now), now, limit: 50 });
  });
  const open = (kind: string, keys: string[]) => tenant(async (client) => {
    const now = new Date();
    return source(kind).stillOpen(client, ws, keys, { now, today: (await readClock(client, ws, now)).today });
  });

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 4 });
    await pool.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Sales Admin'),($3,$4,'Fatima Finance')", [owner, `sources-${run}@sources.test`, finance, `fin-${run}@sources.test`]);
    await fixture("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,status,created_by) VALUES($1,'Sources firm',$2,'AED','Asia/Dubai','active',$3)", [ws, `src-${run}`, owner]);
    await fixture("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active')", [membership, ws, owner, financeMembership, finance]);
    await fixture("INSERT INTO roles(id,workspace_id,code,name,description,is_system) VALUES($1,$2,'finance','Finance','',false)", [role, ws]);
    await fixture("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code='finance_requests.manage'", [ws, role]);
    await fixture("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [ws, financeMembership, role]);
    await fixture("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Huda Client','huda client')", [party, ws]);
  }, 120_000);

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      for (const table of ["finance_requests", "books_posting_issues", "crm_messages", "crm_conversations", "crm_leads", "crm_enquiries", "crm_parties", "member_roles", "role_permissions",
        "roles", "workspace_memberships"]) await client.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [ws]);
      await client.query("DELETE FROM workspaces WHERE id = $1", [ws]);
      await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[owner, finance]]);
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    await pool.end();
  }, 120_000);

  it("every built-in source lists and checks on the real schema, as the app role", async () => {
    const sample = ["work", "activity", "sla", "lead", "conversation", "invoice", "bill", "po", "finance_request", "work_order", "posting_issue", "design", "drawings"]
      .map((prefix) => `${prefix}:${randomUUID()}`)
      .concat([`approval:order:${randomUUID()}:${membership}`, `quote:${randomUUID()}:q1`, `payment:${randomUUID()}:p1`, `design_stage:${randomUUID()}:concepts`,
        `site_report:${randomUUID()}:2030-01-09`, `permit:project:${randomUUID()}:delivery:2099-01-01`, `permit_renewal:${randomUUID()}`]);
    for (const item of BUILTIN_REMINDER_SOURCES as readonly ReminderSource[]) {
      await expect(listed(item.kind), item.kind).resolves.toEqual(expect.any(Array));
      await expect(open(item.kind, sample), item.kind).resolves.toEqual(new Set());
    }
  });

  it("finance_request.waiting: a new request waits on Finance until its status changes", async () => {
    await fixture(`INSERT INTO finance_requests(id,workspace_id,number,kind,status,requested_by,party_id,currency,total_amount,reason,created_at)
      VALUES($1,$2,7,'refund','new',$3,$4,'AED',1250.5,'Overpaid deposit',now() - interval '2 days')`, [request, ws, owner, party]);
    const [item] = await listed("finance_request.waiting");
    expect(item).toMatchObject({ key: `finance_request:${request}`, title: "Refund request 7", context: "Huda Client · AED 1,250.50", ownerMembershipId: null,
      ccMembershipIds: [financeMembership], href: `/workspace/finance/requests?request=${request}` });
    expect(await open("finance_request.waiting", [item.key])).toEqual(new Set([item.key]));
    await fixture("UPDATE finance_requests SET status = 'in_progress' WHERE id = $1", [request]);
    expect(await open("finance_request.waiting", [item.key])).toEqual(new Set());
  });

  it("crm.unowned and crm.reply_waiting: an enquiry nobody owns, and a client's message nobody answered", async () => {
    await fixture("INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference) VALUES($1,$2,gen_random_uuid(),$3,'Kitchen refit','website','web',now(),'E-0001')",
      [enquiry, ws, party]);
    await fixture("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id,status) VALUES($1,$2,$3,$4,'new')", [lead, ws, enquiry, party]);
    const [unowned] = await listed("crm.unowned");
    expect(unowned).toMatchObject({ key: `lead:${lead}`, title: "Huda Client", context: "Kitchen refit", ownerMembershipId: null, jobSource: { type: "lead", id: lead } });
    await fixture("UPDATE crm_leads SET owner_membership_id = $2 WHERE id = $1", [lead, membership]);
    expect(await open("crm.unowned", [unowned.key])).toEqual(new Set());

    await fixture(`INSERT INTO crm_conversations(id,workspace_id,party_id,channel,status,owner_membership_id,subject,last_inbound_at) VALUES($1,$2,$3,'whatsapp','open',$4,'WhatsApp conversation',now() - interval '1 hour')`,
      [chat, ws, party, membership]);
    const [reply] = await listed("crm.reply_waiting");
    expect(reply).toMatchObject({ key: `conversation:${chat}`, ownerMembershipId: membership, title: "Huda Client" });
    await fixture(`INSERT INTO crm_messages(workspace_id,conversation_id,direction,status,authorship,sender_type,sender_id,body_text) VALUES($1,$2,'outbound','sent','human','user',$3,'On it')`,
      [ws, chat, owner]);
    expect(await open("crm.reply_waiting", [reply.key])).toEqual(new Set());
  });

  it("books.posting_issue: an event that couldn't post waits on the Ledger's managers until it is resolved", async () => {
    const issue = randomUUID();
    await fixture(`INSERT INTO books_posting_issues(id,workspace_id,source_type,source_id,source_event,source_label,code,detail) VALUES($1,$2,'client_invoice',$3,'issued','INV-0042','missing_account','No revenue account')`,
      [issue, ws, randomUUID()]);
    const [item] = await listed("books.posting_issue");
    expect(item).toMatchObject({ key: `posting_issue:${issue}`, title: "INV-0042", context: "No revenue account", ownerMembershipId: null, href: "/workspace/ledger/attention" });
    expect(source("books.posting_issue").poolPermission).toBe("books.manage");
    await fixture("UPDATE books_posting_issues SET resolved_at = now() WHERE id = $1", [issue]);
    expect(await open("books.posting_issue", [item.key])).toEqual(new Set());
  });
});
