import { BadRequestException, ConflictException, HttpException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../database/database.service";
import { OperatorNotificationsService } from "../operator-notifications.service";
import { SalesContactFormService } from "./sales-contact-form.service";
import { SalesEnquiriesService } from "./sales-enquiries.service";
import { DEFAULT_SALES_FORM } from "./sales-enquiry.domain";

// Real PostgreSQL as the app role (forced RLS applies). Every row this suite creates is removed afterwards,
// including the form versions it saves, so the local form is left as it was.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("sales enquiries with PostgreSQL", () => {
  const run = randomUUID().slice(0, 8);
  const operatorA = randomUUID(), operatorB = randomUUID(), stranger = randomUUID();
  const emails = [`a-${run}@sales-enquiries.test`, `b-${run}@sales-enquiries.test`, `s-${run}@sales-enquiries.test`];
  const requestIds: string[] = [];
  const sent: Array<{ to: string; subject: string; body: string; consolePath?: string | null }> = [];
  let owner: Pool;
  let db: DatabaseService;
  let forms: SalesContactFormService;
  let enquiries: SalesEnquiriesService;
  let notifications: OperatorNotificationsService;
  let startVersion = 0;

  const submission = (overrides: Record<string, unknown> = {}) => {
    const requestId = randomUUID();
    requestIds.push(requestId);
    return {
      requestId, name: "Lena Fischer", email: `lena-${run}@studio-nord.test`, company: `Studio Nord ${run}`, countryCode: "DE",
      phone: "030 901820", phoneCountry: "DE", teamSize: "11-50", message: "Thirty fit-out jobs a year.", consent: true,
      elapsedMs: 9_000, source: "landing", pagePath: "/", utm: { source: "newsletter", campaign: "autumn" }, ...overrides,
    };
  };
  const idOf = async (requestId: string) =>
    (await owner.query<{ id: string }>(`SELECT id FROM sales_enquiries WHERE request_key = $1`, [requestId])).rows[0]?.id;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    owner = new Pool({ connectionString: url.toString() });
    const role = await owner.query("SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app'");
    if (role.rowCount) url.searchParams.set("options", "-c role=wodana_app");
    const config = new ConfigService({ DATABASE_URL: url.toString(), WEB_ORIGIN: "http://localhost:3108", BUSINESS_CORE_INTERNAL_TOKEN: "internal-token" });
    db = new DatabaseService(config);
    forms = new SalesContactFormService(db);
    const email = {
      sendOperatorNotice: async (message: { to: string; subject: string; body: string; consolePath?: string | null }) => {
        sent.push(message);
        return { status: "not_configured" as const, provider: null, messageId: null };
      },
    };
    notifications = new OperatorNotificationsService(db);
    enquiries = new SalesEnquiriesService(db, forms, email as never, config, notifications);
    await owner.query(`INSERT INTO users (id, primary_email, display_name) VALUES ($1, $2, 'Operator A'), ($3, $4, 'Operator B'), ($5, $6, 'Not an operator')`,
      [operatorA, emails[0], operatorB, emails[1], stranger, emails[2]]);
    await owner.query(`INSERT INTO platform_administrators (user_id, role) VALUES ($1, 'administrator'), ($2, 'account_billing_operator')`,
      [operatorA, operatorB]);
    startVersion = (await owner.query<{ version: number }>(`SELECT max(version)::int AS version FROM sales_contact_form_versions`)).rows[0].version;
  });

  afterAll(async () => {
    await db?.onModuleDestroy();
    if (!owner) return;
    try {
      const ids = (await owner.query<{ id: string }>(`SELECT id FROM sales_enquiries WHERE request_key = ANY($1::text[])`, [requestIds])).rows.map((row) => row.id);
      await owner.query(`DELETE FROM platform_operator_audit WHERE target_id = ANY($1::text[]) OR actor_user_id = ANY($2::uuid[])`,
        [ids, [operatorA, operatorB, stranger]]);
      await owner.query(`DELETE FROM platform_operator_notifications WHERE source_id = ANY($1::uuid[])`, [ids]);
      await owner.query(`DELETE FROM sales_enquiries WHERE id = ANY($1::uuid[])`, [ids]);
      await owner.query(`DELETE FROM sales_contact_form_versions WHERE version > $1`, [startVersion]);
      await owner.query(`DELETE FROM platform_administrators WHERE user_id = ANY($1::uuid[])`, [[operatorA, operatorB]]);
      await owner.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[operatorA, operatorB, stranger]]);
    } finally {
      await owner.end();
    }
  });

  it("saves a new form version once per request key, checks the version, and keeps recipients off the public form", async () => {
    const current = await forms.settings(operatorA);
    expect(current.version).toBe(startVersion);
    const configuration = { ...DEFAULT_SALES_FORM, recipients: ["sales@wodana.test"], thankYouTitle: `Thanks ${run}` };
    const key = `form-${run}-save`;
    const saved = await forms.save(operatorA, { expectedVersion: startVersion, configuration }, key);
    expect(saved.version).toBe(startVersion + 1);
    const replay = await forms.save(operatorA, { expectedVersion: startVersion, configuration }, key);
    expect(replay.version).toBe(startVersion + 1);
    await expect(forms.save(operatorB, { expectedVersion: startVersion, configuration }, `form-${run}-stale`)).rejects.toBeInstanceOf(ConflictException);
    await expect(forms.save(stranger, { expectedVersion: startVersion + 1, configuration }, `form-${run}-stranger`)).rejects.toThrow();
    const view = await forms.publicForm();
    expect(view).toMatchObject({ version: startVersion + 1, thankYouTitle: `Thanks ${run}` });
    expect(view).not.toHaveProperty("recipients");
    const audit = await owner.query(`SELECT 1 FROM platform_operator_audit WHERE action = 'sales_contact_form.saved' AND actor_user_id = $1`, [operatorA]);
    expect(audit.rowCount).toBe(1);
  });

  it("receives an enquiry once, tells the recipients, and shows the configured thank-you", async () => {
    const input = submission();
    const result = await enquiries.submit(input as never, `198.51.100.${run.length}`);
    expect(result).toMatchObject({ received: true, thankYouTitle: `Thanks ${run}` });
    await enquiries.submit(input as never, `198.51.100.${run.length}`);
    const rows = await owner.query(`SELECT status, email::text, phone, requester_hash FROM sales_enquiries WHERE request_key = $1`, [input.requestId]);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toMatchObject({ status: "new", email: `lena-${run}@studio-nord.test`, phone: "+4930901820" });
    expect(rows.rows[0].requester_hash).toMatch(/^[0-9a-f]{64}$/);
    const id = await idOf(input.requestId);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const notice = await owner.query<{ status: string }>(`SELECT status FROM sales_enquiry_notices WHERE enquiry_id = $1`, [id]);
      if (notice.rows[0]?.status !== "pending") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const notices = await owner.query(`SELECT recipient_email::text AS recipient, status, attempts FROM sales_enquiry_notices WHERE enquiry_id = $1`, [id]);
    expect(notices.rows).toEqual([{ recipient: "sales@wodana.test", status: "not_configured", attempts: 1 }]);
    const email = sent.find((message) => message.consolePath?.includes(id));
    expect(email?.to).toBe("sales@wodana.test");
    expect(email?.body).toContain("Thirty fit-out jobs a year.");

    // In Wodana Control: every operator who can read enquiries has a notice; someone else has none.
    const inApp = await owner.query<{ recipient: string }>(
      `SELECT recipient_user_id AS recipient FROM platform_operator_notifications WHERE source_id = $1 AND event_type = 'sales_enquiry.received'`, [id]);
    expect(inApp.rows.map((row) => row.recipient)).toEqual(expect.arrayContaining([operatorA, operatorB]));
    expect(inApp.rows.map((row) => row.recipient)).not.toContain(stranger);
    const mine = await notifications.list(operatorB);
    const notice = mine.notifications.find((item) => item.sourceId === id);
    expect(notice).toMatchObject({ title: expect.stringContaining(`Studio Nord ${run}`), link: `/internal/sales-enquiries?enquiry=${id}`, readAt: null });
    // Operators see only their own notices, and a stranger none.
    expect((await notifications.list(stranger)).notifications).toEqual([]);
    const unreadBefore = mine.unread;
    const read = await notifications.markRead(operatorB, { ids: [notice!.id] });
    expect(read.unread).toBe(unreadBefore - 1);
    // Opening the enquiry reads operator A's notice about it.
    await enquiries.detail(operatorA, id);
    expect((await notifications.list(operatorA)).notifications.find((item) => item.sourceId === id)?.readAt).not.toBeNull();
  });

  it("stores nothing for a filled honeypot, refuses a form sent too fast, and limits one connection", async () => {
    const trap = submission({ website: "https://spam.example" });
    await expect(enquiries.submit(trap as never, "203.0.113.9")).resolves.toMatchObject({ received: true });
    expect(await idOf(trap.requestId)).toBeUndefined();
    await expect(enquiries.submit(submission({ elapsedMs: 400 }) as never, "203.0.113.9")).rejects.toBeInstanceOf(BadRequestException);
    await expect(enquiries.submit(submission({ countryCode: "ZZ" }) as never, "203.0.113.9")).rejects.toBeInstanceOf(BadRequestException);
    const address = `192.0.2.${run}`;
    for (let index = 0; index < 5; index += 1) await enquiries.submit(submission() as never, address);
    const blocked = await enquiries.submit(submission() as never, address).catch((error: unknown) => error);
    expect(blocked).toBeInstanceOf(HttpException);
    expect((blocked as HttpException).getStatus()).toBe(429);
  });

  it("trusts the forwarded address only with the internal token", () => {
    expect(enquiries.requesterAddress({ requester: "198.51.100.7", internalToken: "internal-token", remote: "10.0.0.1" })).toBe("198.51.100.7");
    expect(enquiries.requesterAddress({ requester: "198.51.100.7", internalToken: "wrong-token!!", remote: "10.0.0.1" })).toBe("10.0.0.1");
  });

  it("keeps enquiries away from anyone who is not an active operator", async () => {
    const anonymous = await db.transaction((client) => client.query(`SELECT count(*)::int AS count FROM sales_enquiries`));
    expect(anonymous.rows[0].count).toBe(0);
    const outsider = await enquiries.list(stranger, {});
    expect(outsider.enquiries).toEqual([]);
    const id = await idOf(requestIds[0]);
    await expect(enquiries.detail(stranger, id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(db.transaction(async (client) => {
      const forged = randomUUID();
      await client.query("SELECT set_config('app.current_sales_enquiry_id', $1, true)", [forged]);
      await client.query(`INSERT INTO sales_enquiries (id, request_key, form_version, name, email, consent_text, consented_at, status, closed_at)
        VALUES ($1, $2, 1, 'Forged', 'forged@example.test', 'x', now(), 'won', now())`, [forged, `forged-${run}`]);
    })).rejects.toThrow(/row-level security/);
  });

  it("moves an enquiry through its workflow with version checks, assignees, notes, history and export", async () => {
    const id = await idOf(requestIds[0]);
    const list = await enquiries.list(operatorA, { search: `studio nord ${run}` });
    expect(list.enquiries.map((row) => row.id)).toContain(id);
    const before = await enquiries.detail(operatorA, id);
    expect(before).toMatchObject({ status: "new", nextStatuses: ["contacted", "lost"], utm: { source: "newsletter", campaign: "autumn" } });

    const contacted = await enquiries.changeStatus(operatorA, id, { expectedVersion: before.version, status: "contacted" });
    expect(contacted).toMatchObject({ status: "contacted", version: before.version + 1 });
    expect(contacted.contactedAt).toBeTruthy();
    const replay = await enquiries.changeStatus(operatorA, id, { expectedVersion: before.version, status: "contacted" });
    expect(replay.version).toBe(before.version + 1);
    await expect(enquiries.changeStatus(operatorB, id, { expectedVersion: before.version, status: "qualified" })).rejects.toBeInstanceOf(ConflictException);
    await expect(enquiries.changeStatus(operatorA, id, { expectedVersion: contacted.version, status: "won" })).rejects.toBeInstanceOf(ConflictException);

    const assigned = await enquiries.assign(operatorA, id, { expectedVersion: contacted.version, assigneeUserId: operatorB });
    expect(assigned.assignee).toEqual({ userId: operatorB, name: "Operator B" });
    await expect(enquiries.assign(operatorA, id, { expectedVersion: assigned.version, assigneeUserId: stranger })).rejects.toBeInstanceOf(BadRequestException);

    const noteId = randomUUID();
    await enquiries.addNote(operatorB, id, { noteId, body: "Called, demo booked for Tuesday." });
    const noted = await enquiries.addNote(operatorB, id, { noteId, body: "Called, demo booked for Tuesday." });
    expect(noted.notes).toHaveLength(1);
    await expect(enquiries.addNote(operatorA, id, { noteId, body: "Someone else" })).rejects.toBeInstanceOf(ConflictException);

    const qualified = await enquiries.changeStatus(operatorB, id, { expectedVersion: assigned.version, status: "qualified" });
    const lost = await enquiries.changeStatus(operatorB, id, { expectedVersion: qualified.version, status: "lost", reason: "Chose to wait a year" });
    expect(lost.closedAt).toBeTruthy();
    const reopened = await enquiries.changeStatus(operatorB, id, { expectedVersion: lost.version, status: "contacted" });
    expect(reopened.closedAt).toBeNull();
    expect(reopened.history.map((event) => event.action)).toEqual(
      ["status_changed", "status_changed", "status_changed", "note_added", "assigned", "status_changed", "received"]);

    const { csv, fileName } = await enquiries.exportCsv(operatorA, { search: `studio nord ${run}` });
    expect(fileName).toMatch(/^sales-enquiries-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.split("\r\n")[0]).toContain(`"Reference","Received","Status"`);
    expect(csv).toContain(`Studio Nord ${run}`);
    const assignees = await enquiries.assignees(operatorA);
    expect(assignees.assignees.map((row) => row.userId)).toEqual(expect.arrayContaining([operatorA, operatorB]));
  });
});
