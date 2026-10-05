import { ForbiddenException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CrmIntakeService } from "../crm/intake/crm-intake.service";
import { CrmLeadsService } from "../crm/leads/crm-leads.service";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { BookingTypesService } from "./booking-types.service";
import { BookingsService, reassignBookingsForLeave } from "./bookings.service";
import { addDays, wallClock, zonedInstant } from "./booking.domain";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Every service call runs as the
// app role (wodana_app, forced RLS) in its own committed transaction, so races and replays are real.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const ZONE = "Europe/London";

integration("booking pages (plan §6.5b) on a real database", { timeout: 30_000 }, () => {
  let pool: Pool;
  const workspaces: string[] = [];
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 12 });
  });
  afterAll(async () => {
    // Best effort: the throwaway database is dropped after the run.
    for (const id of workspaces) await pool.query("DELETE FROM workspaces WHERE id = $1", [id]).catch(() => undefined);
    await pool.end();
  });

  async function asApp<T>(workspaceId: string, actorId: string, work: (client: PoolClient) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id', $1, true), set_config('app.current_actor_id', $2, true)", [workspaceId, actorId]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
  const db = {
    tenantTransaction: asApp,
    transaction: <T>(work: (client: PoolClient) => Promise<T>) => asApp("", "", work),
    query: async (text: string, values?: unknown[]) => asApp("", "", (client) => client.query(text, values)),
  };

  async function seedWorkspace(options: { hosts?: number } = {}) {
    const workspaceId = randomUUID(), adminUser = randomUUID(), slug = `bk-${workspaceId.slice(0, 8)}`;
    const hosts: Array<{ membershipId: string; userId: string }> = [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO users(id, primary_email, display_name) VALUES ($1, $2, 'Admin')", [adminUser, `${adminUser}@example.com`]);
      await client.query("INSERT INTO workspaces(id, name, slug, default_currency, default_timezone, default_locale, created_by) VALUES ($1, 'Studio One', $2, 'GBP', $3, 'en-GB', $4)", [workspaceId, slug, ZONE, adminUser]);
      for (let index = 0; index < (options.hosts ?? 2); index += 1) {
        const userId = randomUUID(), membershipId = randomUUID();
        await client.query("INSERT INTO users(id, primary_email, display_name) VALUES ($1, $2, $3)", [userId, `${userId}@example.com`, `Host ${index + 1}`]);
        await client.query("INSERT INTO workspace_memberships(id, workspace_id, user_id, status) VALUES ($1, $2, $3, 'active')", [membershipId, workspaceId, userId]);
        hosts.push({ membershipId, userId });
      }
      await client.query("INSERT INTO crm_queues (workspace_id, code, name, is_fallback) VALUES ($1, 'sales', 'Sales', true)", [workspaceId]);
      await client.query("COMMIT");
    } finally { client.release(); }
    workspaces.push(workspaceId);
    return { workspaceId, slug, adminUser, hosts };
  }

  function services(adminUser: string, permissions = new Set(["crm.settings.manage", "crm.activities.view", "crm.activities.manage"])) {
    const access = {
      withPermission: (actor: unknown, workspaceId: string, permission: string, work: (client: PoolClient, user: { userId: string }) => Promise<unknown>) =>
        access.withPermissions(actor, workspaceId, [permission], work),
      withPermissions: async (_actor: unknown, workspaceId: string, required: string[], work: (client: PoolClient, user: { userId: string }) => Promise<unknown>) => {
        if (!required.every((permission) => permissions.has(permission))) throw new ForbiddenException(`Permissions required: ${required.join(", ")}`);
        return asApp(workspaceId, adminUser, (client) => work(client, { userId: adminUser }));
      },
      hasPermission: async () => true,
    } as never;
    const events = new CrmEventsService();
    const intake = new CrmIntakeService(db as never, access, events, new CrmLeadsService(db as never, access, events));
    const mailer = { origin: () => "https://app.example.test", brandName: async () => "Studio One", send: vi.fn(async () => null) };
    const config = { get: (key: string) => key === "BOOKING_LINK_SECRET" ? "booking-secret-for-tests-0123456789abcdef" : undefined };
    return { types: new BookingTypesService(access), bookings: new BookingsService(db as never, access, intake, mailer as never, config as never), mailer };
  }
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

  /** A weekday at least four days ahead, in London, and its 10:00 and 11:00 slots. */
  function slotDay(offset = 4) {
    let date = addDays(wallClock(Date.now(), ZONE).date, offset);
    while ([0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay())) date = addDays(date, 1);
    const at = (hour: number) => new Date(zonedInstant(date, hour * 60, ZONE)!).toISOString();
    return { date, at };
  }
  const visitor = (mobile: string, extra: Record<string, unknown> = {}) => ({
    requestId: randomUUID(), timeZone: "Asia/Dubai", serviceConsent: true, elapsedMs: 10_000, consents: { whatsapp: true, email: true },
    answers: { displayName: "Maya Client", mobile, email: "maya@example.com" }, link: { placement: "showroom-door", utm: { campaign: "autumn" } }, ...extra,
  });

  async function setup(typeInput: Record<string, unknown> = {}, hostCount = 1) {
    const ws = await seedWorkspace({ hosts: Math.max(2, hostCount) });
    const svc = services(ws.adminUser);
    const type = await svc.types.create(actor, ws.workspaceId, {
      name: "Design consultation", durationMinutes: 60, minimumNoticeMinutes: 60, cancelNoticeMinutes: 120, slotStepMinutes: 60,
      hosts: ws.hosts.slice(0, hostCount).map((host) => ({ membershipId: host.membershipId })), hostsMode: hostCount > 1 ? "round_robin" : "one", ...typeInput,
    });
    return { ...ws, ...svc, type };
  }

  it("books end to end: slot → contact and enquiry through intake → meeting on the host's calendar → notices; then reschedule and cancel", async () => {
    const env = await setup({ questions: [{ field: "summary", required: false }] });
    const day = slotDay();
    const info = await env.bookings.publicType(env.slug, env.type.slug);
    expect(info).toMatchObject({ timeZone: ZONE, defaultCountryCode: "GB", type: { name: "Design consultation", durationMinutes: 60 } });
    const slots = await env.bookings.publicSlots(env.slug, env.type.slug, { from: day.date, to: day.date });
    expect(slots.slots.map((slot) => slot.start)).toContain(day.at(10));
    expect(slots.slots[0].start).toBe(day.at(9));

    const booked = await env.bookings.create(env.slug, env.type.slug, { ...visitor("+447911123456"), start: day.at(10) } as never);
    expect(booked).toMatchObject({ status: "confirmed", start: day.at(10), idempotentReplay: false });
    expect(booked.managePath).toMatch(new RegExp(`^/book/${env.slug}/manage/[A-Za-z0-9_-]{43}$`));
    expect(env.mailer.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "confirmed", to: "maya@example.com", visitorTimeZone: "Asia/Dubai", firmTimeZone: ZONE }));

    const row = (await pool.query(`SELECT booking.*, enquiry.source, enquiry.channel, intake.original_payload->>'origin' AS origin, activity.owner_membership_id AS owner, activity.type AS "activityType",
        appointment.starts_at AS "appointmentStart", appointment.timezone AS "appointmentZone"
      FROM bookings booking JOIN crm_enquiries enquiry ON enquiry.id = booking.enquiry_id JOIN crm_intake_events intake ON intake.id = enquiry.intake_event_id
      JOIN crm_activities activity ON activity.id = booking.activity_id JOIN crm_appointments appointment ON appointment.activity_id = activity.id
      WHERE booking.id = $1`, [booked.bookingId])).rows[0];
    expect(row).toMatchObject({ status: "confirmed", source: "company", channel: "website", origin: "booking_page", owner: env.hosts[0].membershipId, activityType: "meeting", appointmentZone: ZONE, placement: "showroom-door" });
    expect(new Date(row.appointmentStart).toISOString()).toBe(day.at(10));
    const consents = (await pool.query(`SELECT channel, status FROM crm_consents WHERE party_id = $1 ORDER BY channel`, [row.party_id])).rows;
    expect(consents).toEqual([{ channel: "email", status: "granted" }, { channel: "sms", status: "denied" }, { channel: "whatsapp", status: "granted" }]);
    const notices = (await pool.query(`SELECT channel FROM notifications WHERE workspace_id = $1 AND recipient_id = $2 AND event_type = 'booking.created' ORDER BY channel`, [env.workspaceId, env.hosts[0].userId])).rows;
    expect(notices.map((notice) => notice.channel)).toEqual(["email", "in_app"]);
    const outbox = (await pool.query(`SELECT event_type FROM outbox_events WHERE workspace_id = $1 AND aggregate_id = $2`, [env.workspaceId, booked.bookingId])).rows.map((event) => event.event_type);
    expect(outbox).toContain("booking.created.v1");
    // The calendar reads activities: the booking is there as a meeting with its appointment.
    const calendar = (await pool.query(`SELECT count(*)::int AS count FROM crm_activities activity JOIN crm_appointments appointment ON appointment.activity_id = activity.id
      WHERE activity.workspace_id = $1 AND appointment.starts_at >= $2 AND appointment.starts_at < $3`, [env.workspaceId, day.at(0), day.at(23)])).rows[0];
    expect(calendar.count).toBe(1);
    // That hour is gone from the page now.
    expect((await env.bookings.publicSlots(env.slug, env.type.slug, { from: day.date, to: day.date })).slots.map((slot) => slot.start)).not.toContain(day.at(10));

    const token = booked.managePath!.split("/").at(-1)!;
    const view = await env.bookings.manageView(env.slug, token);
    expect(view.booking).toMatchObject({ status: "confirmed", canChange: true, version: 1 });
    expect(await env.bookings.manageIcs(env.slug, token)).toContain("BEGIN:VEVENT");

    const moved = await env.bookings.rescheduleByVisitor(env.slug, token, { version: 1, start: day.at(14) });
    expect(moved).toMatchObject({ start: day.at(14), version: 2 });
    const appointment = (await pool.query(`SELECT starts_at FROM crm_appointments WHERE activity_id = $1`, [row.activity_id])).rows[0];
    expect(new Date(appointment.starts_at).toISOString()).toBe(day.at(14));
    // Stale version: the client had the page open in two tabs.
    await expect(env.bookings.cancelByVisitor(env.slug, token, { version: 1 })).rejects.toThrow(/changed/);
    expect(await env.bookings.cancelByVisitor(env.slug, token, { version: 2, reason: "Travelling" })).toMatchObject({ status: "cancelled", version: 3 });
    const activity = (await pool.query(`SELECT status FROM crm_activities WHERE id = $1`, [row.activity_id])).rows[0];
    expect(activity.status).toBe("cancelled");
    await expect(env.bookings.cancelByVisitor(env.slug, token, { version: 3 })).rejects.toThrow(/can no longer be changed/);
  });

  it("replays the same request and refuses the same key with different details", async () => {
    const env = await setup();
    const day = slotDay();
    const request = { ...visitor("+447911123457"), start: day.at(11) };
    const first = await env.bookings.create(env.slug, env.type.slug, request as never);
    const again = await env.bookings.create(env.slug, env.type.slug, request as never);
    expect(again).toMatchObject({ bookingId: first.bookingId, idempotentReplay: true, managePath: first.managePath });
    expect(env.mailer.send).toHaveBeenCalledTimes(1);
    await expect(env.bookings.create(env.slug, env.type.slug, { ...request, start: day.at(12) } as never)).rejects.toThrow(/different details/);
    const count = (await pool.query(`SELECT count(*)::int AS count FROM bookings WHERE workspace_id = $1`, [env.workspaceId])).rows[0].count;
    expect(count).toBe(1);
  });

  it("lets one of two simultaneous visitors win the same slot; the other is offered the next times", async () => {
    const env = await setup();
    const day = slotDay(5);
    const results = await Promise.allSettled([
      env.bookings.create(env.slug, env.type.slug, { ...visitor("+447911123458"), start: day.at(10) } as never),
      env.bookings.create(env.slug, env.type.slug, { ...visitor("+447911123459", { answers: { displayName: "Omar Visitor", mobile: "+447911123459", email: "omar@example.com" } }), start: day.at(10) } as never),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason.getStatus()).toBe(409);
    expect(refused.reason.getResponse()).toMatchObject({ code: "slot_taken" });
    expect(refused.reason.getResponse().nextSlots[0].start).toBe(day.at(11));
    // The database refuses an overlap for the same host even if a caller skipped the checks.
    const live = (await pool.query(`SELECT * FROM bookings WHERE workspace_id = $1 AND status = 'confirmed'`, [env.workspaceId])).rows[0];
    await expect(pool.query(`INSERT INTO bookings (workspace_id, booking_type_id, host_membership_id, starts_at, ends_at, visitor_time_zone, visitor_name, source, channel, manage_nonce, manage_token_hash, idempotency_key, request_hash)
      VALUES ($1, $2, $3, $4, $5, 'UTC', 'X', 'company', 'website', repeat('a', 32), repeat('b', 64), 'k', repeat('c', 64))`,
      [env.workspaceId, live.booking_type_id, live.host_membership_id, new Date(Date.parse(day.at(10)) + 30 * 60_000), new Date(Date.parse(day.at(11)) + 30 * 60_000)])).rejects.toMatchObject({ code: "23P01" });
  });

  it("round-robin: the less busy host takes the next booking; leave moves it to a free colleague, else the Sales admin is told", async () => {
    const env = await setup({}, 2);
    const day = slotDay(6);
    const first = await env.bookings.create(env.slug, env.type.slug, { ...visitor("+447911123460"), start: day.at(10) } as never);
    const second = await env.bookings.create(env.slug, env.type.slug, { ...visitor("+447911123461", { answers: { displayName: "Second", mobile: "+447911123461", email: "second@example.com" } }), start: day.at(11) } as never);
    const hostOf = async (id: string) => (await pool.query(`SELECT host_membership_id AS host FROM bookings WHERE id = $1`, [id])).rows[0].host as string;
    const [a, b] = env.hosts.map((host) => host.membershipId);
    expect([await hostOf(first.bookingId!), await hostOf(second.bookingId!)]).toEqual([a, b]);
    const admin = randomUUID(), adminMember = randomUUID();
    const leave = async (membershipId: string) => {
      const id = randomUUID();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query(`INSERT INTO hrms_leave_requests (id, workspace_id, membership_id, leave_type_id, action_id, request_hash, start_date, end_date, day_part, units, calendar_snapshot, reason, status)
          VALUES ($1, $2, $3, $4, $5, repeat('a', 64), $6, $6, 'full', '[]', '{}', 'Sick', 'approved')`, [id, env.workspaceId, membershipId, randomUUID(), randomUUID(), day.date]);
        await client.query("COMMIT");
      } finally { client.release(); }
      return id;
    };
    // A is away that day; B is free at 10:00, so A's booking moves to B.
    expect(await asApp(env.workspaceId, env.adminUser, async (app) => reassignBookingsForLeave(app, env.workspaceId, await leave(a)))).toEqual({ moved: 1, flagged: 0 });
    expect(await hostOf(first.bookingId!)).toBe(b);
    // Then B is away too: nobody is free, nothing moves, and the Sales admin is told about both.
    await pool.query("INSERT INTO users(id, primary_email, display_name) VALUES ($1, $2, 'Sales admin')", [admin, `${admin}@example.com`]);
    await pool.query("INSERT INTO workspace_memberships(id, workspace_id, user_id, status) VALUES ($1, $2, $3, 'active')", [adminMember, env.workspaceId, admin]);
    await pool.query("INSERT INTO workspace_sales_settings (workspace_id, sales_admin_membership_id) VALUES ($1, $2)", [env.workspaceId, adminMember]);
    expect(await asApp(env.workspaceId, env.adminUser, async (app) => reassignBookingsForLeave(app, env.workspaceId, await leave(b)))).toEqual({ moved: 0, flagged: 2 });
    expect(await hostOf(first.bookingId!)).toBe(b);
    const told = (await pool.query(`SELECT count(*)::int AS count FROM notifications WHERE workspace_id = $1 AND recipient_id = $2 AND event_type = 'booking.host_away' AND channel = 'in_app'`, [env.workspaceId, admin])).rows[0].count;
    expect(told).toBe(2);
  });

  it("sends a likely-known contact through client confirmation, attaches a known one to the open job, and books nothing for spam", async () => {
    const env = await setup();
    const day = slotDay(7);
    const first = await env.bookings.create(env.slug, env.type.slug, { ...visitor("+447911123462"), start: day.at(9) } as never);
    // Same number, not yet verified: never merged silently; the new enquiry waits on "Confirm client" (E1-1).
    const second = await env.bookings.create(env.slug, env.type.slug, { ...visitor("+447911123462"), start: day.at(11) } as never);
    const [one, two] = (await pool.query(`SELECT id, lead_id, party_id, enquiry_id FROM bookings WHERE id = ANY($1::uuid[]) ORDER BY starts_at`, [[first.bookingId, second.bookingId]])).rows;
    expect(two.party_id).not.toBe(one.party_id);
    const candidates = (await pool.query(`SELECT candidate.candidate_party_id AS party, candidate.status FROM crm_identity_candidates candidate
      JOIN crm_enquiries enquiry ON enquiry.intake_event_id = candidate.intake_event_id WHERE enquiry.id = $1`, [two.enquiry_id])).rows;
    expect(candidates).toEqual([{ party: one.party_id, status: "pending" }]);
    // Once the number is verified, a booking from it is the same client: the meeting goes on the open job.
    await pool.query(`UPDATE crm_contact_points SET is_verified = true, verified_at = now() WHERE party_id = $1 AND normalized_value IS NOT NULL`, [one.party_id]);
    const third = await env.bookings.create(env.slug, env.type.slug, { ...visitor("+447911123462"), start: day.at(13) } as never);
    const attached = (await pool.query(`SELECT lead_id, party_id FROM bookings WHERE id = $1`, [third.bookingId])).rows[0];
    expect(attached).toEqual({ lead_id: one.lead_id, party_id: one.party_id });
    expect((await pool.query(`SELECT count(*)::int AS count FROM crm_leads WHERE workspace_id = $1 AND status = 'duplicate'`, [env.workspaceId])).rows[0].count).toBe(1);
    expect(await env.bookings.create(env.slug, env.type.slug, { ...visitor("+447911123463"), start: day.at(15), website: "spam.example" } as never)).toEqual({ received: true, status: "received" });
    expect(await env.bookings.create(env.slug, env.type.slug, { ...visitor("+447911123463"), start: day.at(15), elapsedMs: 200 } as never)).toEqual({ received: true, status: "received" });
    expect((await pool.query(`SELECT count(*)::int AS count FROM bookings WHERE workspace_id = $1`, [env.workspaceId])).rows[0].count).toBe(3);
  });

  it("denies staff without the permission, closes inactive types and disabled workspaces, and refuses late changes", async () => {
    const env = await setup({ minimumNoticeMinutes: 0, cancelNoticeMinutes: 24 * 60 });
    const denied = services(env.adminUser, new Set(["crm.activities.view"]));
    await expect(denied.types.create(actor, env.workspaceId, { name: "Showroom visit", hosts: [{ membershipId: env.hosts[0].membershipId }] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(denied.bookings.confirm(actor, env.workspaceId, randomUUID(), 1)).rejects.toBeInstanceOf(ForbiddenException);
    // Stale version on a type.
    await expect(env.types.update(actor, env.workspaceId, env.type.id, { version: env.type.version + 5, name: "x" })).rejects.toThrow(/changed/);

    // Cancellation inside the notice: a booking tomorrow morning with a 24-hour rule.
    const day = slotDay(1);
    const soon = await env.bookings.create(env.slug, env.type.slug, { ...visitor("+447911123464"), start: day.at(9) } as never);
    const token = soon.managePath!.split("/").at(-1)!;
    const view = await env.bookings.manageView(env.slug, token);
    if (Date.parse(day.at(9)) - Date.now() < 24 * 3_600_000) {
      expect(view.booking.canChange).toBe(false);
      await expect(env.bookings.cancelByVisitor(env.slug, token, { version: 1 })).rejects.toThrow(/too close/);
    }
    // Staff can still decline it.
    expect(await env.bookings.decline(actor, env.workspaceId, soon.bookingId!, 1, "Closed")).toMatchObject({ status: "cancelled", version: 2 });

    await env.types.update(actor, env.workspaceId, env.type.id, { version: env.type.version, active: false });
    await expect(env.bookings.publicType(env.slug, env.type.slug)).rejects.toThrow(/not available/);
    await pool.query(`UPDATE workspaces SET status = 'suspended' WHERE id = $1`, [env.workspaceId]);
    await expect(env.bookings.publicSlots(env.slug, env.type.slug, { from: day.date, to: day.date })).rejects.toThrow(/not available/);
  });

  it("keeps each workspace's bookings to itself", async () => {
    const a = await setup();
    const b = await setup();
    const day = slotDay(8);
    const booked = await a.bookings.create(a.slug, a.type.slug, { ...visitor("+447911123465"), start: day.at(10) } as never);
    const token = booked.managePath!.split("/").at(-1)!;
    // Workspace B's context sees none of A's rows, even by id.
    const seen = await asApp(b.workspaceId, b.adminUser, async (client) => (await client.query(`SELECT count(*)::int AS count FROM bookings WHERE id = $1`, [booked.bookingId])).rows[0].count);
    expect(seen).toBe(0);
    const written = await asApp(b.workspaceId, b.adminUser, async (client) => (await client.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [booked.bookingId])).rowCount);
    expect(written).toBe(0);
    // A's manage link under B's page finds nothing; B's staff cannot act on A's booking.
    await expect(b.bookings.manageView(b.slug, token)).rejects.toThrow(/not valid/);
    await expect(b.bookings.confirm(actor, b.workspaceId, booked.bookingId!, 1)).rejects.toThrow(/not found/);
    // A's type is not offered on B's page.
    await expect(b.bookings.publicType(b.slug, `${a.type.slug}-missing`)).rejects.toThrow(/not available/);
  });

  it("marks attendance only after the start, with the version", async () => {
    const env = await setup({ minimumNoticeMinutes: 0, confirmation: "approval" });
    const day = slotDay(3);
    const booked = await env.bookings.create(env.slug, env.type.slug, { ...visitor("+447911123466"), start: day.at(16) } as never);
    expect(booked.status).toBe("pending");
    expect(env.mailer.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "requested" }));
    await expect(env.bookings.confirm(actor, env.workspaceId, booked.bookingId!, 2)).rejects.toThrow(/changed/);
    expect(await env.bookings.confirm(actor, env.workspaceId, booked.bookingId!, 1)).toMatchObject({ status: "confirmed", version: 2 });
    await expect(env.bookings.noShow(actor, env.workspaceId, booked.bookingId!, 2)).rejects.toThrow(/once the meeting has started/);
    // Move it into the past (as if the day came) and mark it.
    await pool.query(`UPDATE bookings SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' WHERE id = $1`, [booked.bookingId]);
    expect(await env.bookings.noShow(actor, env.workspaceId, booked.bookingId!, 2)).toMatchObject({ status: "no_show", version: 3 });
    const listed = await env.bookings.list(actor, env.workspaceId, { from: new Date(Date.now() - 86_400_000).toISOString() });
    expect(listed.data.find((row: { id: string }) => row.id === booked.bookingId)).toMatchObject({ status: "no_show", typeName: "Design consultation" });
  });
});
