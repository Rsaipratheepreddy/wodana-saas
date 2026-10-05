import {
  BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { confirmAppointment } from "../crm/conversations/inbox/client-followups";
import { CreateIntakeEventDto } from "../crm/intake/dto/intake.dto";
import { CrmIntakeService } from "../crm/intake/crm-intake.service";
import { resolveFormLink } from "../crm/intake/form-link";
import { countryFromLocale, normalizeIntakePartyPhones } from "../crm/intake/intake-phone";
import { blockedContact, looksAutomated } from "../crm/intake/lead-forms.service";
import { loadLeadOptions, REGION_OTHER, UNRESOLVED_ENQUIRY_TYPE } from "../crm/leads/lead-options";
import { canonicalHash } from "../crm/shared/crm-types";
import { DatabaseService } from "../database/database.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { bookingIcs, changeAllowed, describeSlot, MANAGE_TOKEN, manageToken, parseDateRange, tokenHash, validTimeZone, wallClock, type Slot } from "./booking.domain";
import { BookingMailer, type BookingMail } from "./booking-mailer";
import { firmCalendar, hostsFor, loadTypeById, loadTypeBySlug, nextSlots, noticeMember, recheckSlot, slotsFor, type BookingTypeRow } from "./booking-store";

const SERVICE_ACTOR = "00000000-0000-0000-0000-000000000000";
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const CONSENT_STATEMENT = "I agree to be contacted about this booking.";

export type PublicBookingInput = {
  requestId: string; start: string; timeZone: string; enquiryType?: string;
  answers: { displayName?: string; mobile?: string; mobileCountryCode?: string; email?: string; emirate?: string; area?: string; serviceType?: string; budgetRange?: string; summary?: string; address?: string };
  consents?: { whatsapp?: boolean; email?: boolean; sms?: boolean };
  serviceConsent: boolean;
  link?: { source?: string; channel?: string; placement?: string; utm?: Record<string, string> };
  website?: string; elapsedMs?: number;
};

type BookingRow = {
  id: string; typeId: string; hostMembershipId: string; startsAt: Date; endsAt: Date; visitorTimeZone: string; status: string; version: number;
  partyId: string | null; leadId: string | null; enquiryId: string | null; activityId: string | null; visitorName: string; visitorEmail: string | null;
  answers: Record<string, string>; manageNonce: string; requestHash: string; source: string; channel: string;
};
const BOOKING_COLUMNS = `booking.id, booking.booking_type_id AS "typeId", booking.host_membership_id AS "hostMembershipId", booking.starts_at AS "startsAt",
  booking.ends_at AS "endsAt", booking.visitor_time_zone AS "visitorTimeZone", booking.status, booking.version, booking.party_id AS "partyId",
  booking.lead_id AS "leadId", booking.enquiry_id AS "enquiryId", booking.activity_id AS "activityId", booking.visitor_name AS "visitorName",
  booking.visitor_email AS "visitorEmail", booking.answers, booking.manage_nonce AS "manageNonce", booking.request_hash AS "requestHash", booking.source, booking.channel`;

/** A refused slot: someone else just took it. The visitor gets the next free times to pick from. */
function slotTaken(next: Slot[]) {
  return new HttpException({ statusCode: 409, code: "slot_taken", message: "That time was just taken. Choose another time", nextSlots: next.map(({ start, end }) => ({ start, end })) }, 409);
}

/**
 * Booking pages (plan §6.5b). A public booking is one command in one tenant transaction: the slot is
 * re-checked, the booking row claims the host's time (the exclusion constraint makes a race lose cleanly),
 * the contact and enquiry come through the same intake path as every form, the meeting and its appointment
 * go on the host's calendar, and the host is told. The visitor's email (with the .ics) goes after commit.
 */
@Injectable()
export class BookingsService {
  constructor(
    private readonly db: DatabaseService, private readonly access: WorkspaceAccessService, private readonly intake: CrmIntakeService,
    private readonly mailer: BookingMailer, private readonly config: ConfigService,
  ) {}

  /* ── Public ──────────────────────────────────────────────────────────────────────────────────── */

  async publicType(slug: string, typeSlug: string) {
    const workspaceId = await this.workspace(slug);
    return this.db.tenantTransaction(workspaceId, SERVICE_ACTOR, async (client) => {
      const type = await this.activeType(client, workspaceId, typeSlug);
      const facts = (await client.query<{ locale: string; displayName: string | null; loginSlug: string | null; primaryColor: string | null; secondaryColor: string | null; hasLogo: boolean; name: string }>(
        `SELECT workspace.default_locale AS locale, workspace.name, branding.display_name AS "displayName", branding.login_slug AS "loginSlug",
                branding.primary_color AS "primaryColor", branding.secondary_color AS "secondaryColor", branding.logo_asset_id IS NOT NULL AS "hasLogo"
           FROM workspaces workspace LEFT JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id WHERE workspace.id = $1`, [workspaceId])).rows[0];
      const choices = await loadLeadOptions(client, workspaceId);
      const calendar = await firmCalendar(client, workspaceId);
      const asksType = type.hostsMode === "enquiry_type" || (!type.enquiryType && type.questions.some((question) => question.field === "serviceType"));
      return {
        type: {
          name: type.name, slug: type.slug, durationMinutes: type.durationMinutes, color: type.color, locationKind: type.locationKind,
          // A video link is sent with the confirmation, never shown on the open page.
          locationDetail: type.locationKind === "our_location" ? type.locationDetail : null,
          questions: type.questions.filter((question) => question.field !== "serviceType" || asksType), asksEnquiryType: asksType,
          confirmation: type.confirmation, windowDays: type.windowDays, cancelNoticeMinutes: type.cancelNoticeMinutes,
        },
        timeZone: calendar.timeZone, locale: facts?.locale ?? "en", defaultCountryCode: countryFromLocale(facts?.locale) ?? null,
        branding: { displayName: facts?.displayName ?? facts?.name ?? "", primaryColor: facts?.primaryColor ?? null, secondaryColor: facts?.secondaryColor ?? null,
          logoUrl: facts?.hasLogo && facts.loginSlug ? `/api/auth/tenant-logo/${facts.loginSlug}` : null },
        options: { enquiryTypes: asksType ? choices.enquiryTypes.filter((option) => type.hostsMode !== "enquiry_type" || type.hosts.some((host) => !host.enquiryType || host.enquiryType === option.id)) : [],
          regions: choices.emirates, areas: choices.areas, budgetRanges: choices.budgetRanges },
        consentLabel: CONSENT_STATEMENT,
      };
    });
  }

  async publicSlots(slug: string, typeSlug: string, query: { from?: string; to?: string; enquiryType?: string }) {
    const range = parseDateRange(query.from, query.to);
    if (!range) throw new BadRequestException("Choose a date range of up to two months");
    const workspaceId = await this.workspace(slug);
    return this.db.tenantTransaction(workspaceId, SERVICE_ACTOR, async (client) => {
      const type = await this.activeType(client, workspaceId, typeSlug);
      const { calendar, slots } = await slotsFor(client, workspaceId, type, { ...range, enquiryType: query.enquiryType || type.enquiryType });
      return { timeZone: calendar.timeZone, from: range.from, to: range.to, slots: slots.map(({ start, end }) => ({ start, end })) };
    });
  }

  async create(slug: string, typeSlug: string, input: PublicBookingInput) {
    const workspaceId = await this.workspace(slug);
    // Junk (S-13): a bot learns nothing; nothing is booked.
    if (looksAutomated(input)) return { received: true, status: "received" as const };
    if (input.serviceConsent !== true) throw new BadRequestException("Consent is required before booking");
    const start = new Date(input.start);
    if (Number.isNaN(start.getTime())) throw new BadRequestException("Choose a time");
    const visitorTimeZone = validTimeZone(input.timeZone);
    if (!visitorTimeZone) throw new BadRequestException("Choose a valid time zone");
    const secret = this.secret();
    const outcome = await this.db.tenantTransaction(workspaceId, SERVICE_ACTOR, async (client) => {
      const type = await this.activeType(client, workspaceId, typeSlug);
      const key = `booking:${type.id}:${input.requestId}`;
      // The same request twice (a double tap, a retry) waits for the first and gets its booking back.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${workspaceId}:${key}`]);
      const requestHash = canonicalHash({ start: start.toISOString(), answers: input.answers, consents: input.consents ?? {}, enquiryType: input.enquiryType ?? null, link: input.link ?? null });
      const prior = (await client.query<BookingRow>(`SELECT ${BOOKING_COLUMNS} FROM bookings booking WHERE booking.workspace_id = $1 AND booking.idempotency_key = $2`, [workspaceId, key])).rows[0];
      if (prior) {
        if (prior.requestHash !== requestHash) throw new ConflictException("This booking was already made with different details");
        return { replay: true as const, booking: prior, type, token: manageToken(secret, workspaceId, prior.id, prior.manageNonce) };
      }

      const choices = await loadLeadOptions(client, workspaceId);
      const answers = this.answers(type, input, choices);
      const workspace = (await client.query<{ locale: string }>(`SELECT default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
      const party = normalizeIntakePartyPhones({ displayName: answers.displayName, email: answers.email, mobile: answers.mobile,
        mobileCountryCode: input.answers.mobileCountryCode?.trim().toUpperCase() || countryFromLocale(workspace?.locale), ...(answers.address ? { address: answers.address } : {}) });
      const fingerprint = party.mobile!.replace(/\D/g, "");
      const rate = (await client.query<{ total: number; contact: number }>(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE regexp_replace(answers->>'mobile', '[^0-9]', '', 'g') = $3)::int AS contact
           FROM bookings WHERE workspace_id = $1 AND booking_type_id = $2 AND created_at > now() - interval '10 minutes'`, [workspaceId, type.id, fingerprint])).rows[0];
      if (rate.total >= 100 || rate.contact >= 3) throw new HttpException("Too many bookings. Please try again later", 429);
      if (await blockedContact(client, workspaceId, fingerprint)) return { blocked: true as const };

      // Re-checked now: the host's calendar may have filled since the page loaded.
      const enquiryType = type.enquiryType ?? answers.serviceType ?? null;
      const { calendar, slot } = await recheckSlot(client, workspaceId, type, start, { enquiryType });
      if (!slot) throw slotTaken(await nextSlots(client, workspaceId, type, start, enquiryType));
      const bookingId = randomUUID();
      const nonce = randomBytes(16).toString("hex");
      const token = manageToken(secret, workspaceId, bookingId, nonce);
      const status = type.confirmation === "approval" ? "pending" : "confirmed";
      const link = resolveFormLink(choices, input.link);
      const source = link?.source ?? type.source, channel = link?.channel ?? type.channel;
      const utm = this.utm(input.link?.utm);
      const consents = { service: true, whatsapp: input.consents?.whatsapp === true, email: input.consents?.email === true, sms: input.consents?.sms === true, statement: CONSENT_STATEMENT, capturedAt: new Date().toISOString() };
      let hostId: string | null = null;
      for (const candidate of await this.orderHosts(client, workspaceId, type, slot.hostIds)) {
        await client.query("SAVEPOINT booking_claim");
        try {
          await client.query(
            `INSERT INTO bookings (id, workspace_id, booking_type_id, host_membership_id, starts_at, ends_at, visitor_time_zone, status, visitor_name, visitor_email,
               answers, consents, source, channel, placement, utm, manage_nonce, manage_token_hash, idempotency_key, request_hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
            [bookingId, workspaceId, type.id, candidate, slot.start, slot.end, visitorTimeZone, status, answers.displayName, answers.email ?? null,
              { ...answers, mobile: party.mobile }, consents, source, channel, link?.placement ?? null, utm, nonce, tokenHash(token), key, requestHash]);
          await client.query("RELEASE SAVEPOINT booking_claim");
          hostId = candidate;
          break;
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT booking_claim");
          // Another visitor took this host's time a moment ago: try the next free host.
          if ((error as { code?: string }).code === "23P01") continue;
          throw error;
        }
      }
      if (!hostId) throw slotTaken(await nextSlots(client, workspaceId, type, start, enquiryType));

      const capturedAt = consents.capturedAt;
      const evidence = { method: "booking_page", bookingTypeId: type.id, bookingId, statement: CONSENT_STATEMENT, capturedAt };
      const intake = await this.intake.createFormIntake(client, workspaceId, key, {
        source, channel, intakeMethod: "form", title: "", party,
        serviceType: enquiryType ?? choices.enquiryTypes.find((option) => option.id === UNRESOLVED_ENQUIRY_TYPE)?.id ?? choices.enquiryTypes[0]?.id,
        summary: answers.summary,
        details: { emirate: answers.emirate || REGION_OTHER, area: answers.area, budgetRange: answers.budgetRange, ...(link?.placement ? { campaign: link.placement } : {}) },
        assignment: { mode: "automatic" },
        consents: (["whatsapp", "email", "sms"] as const).map((channelName) => ({ purpose: "service", channel: channelName, status: consents[channelName] ? "granted" : "denied", evidence })),
        ...(Object.keys(utm).length ? { attribution: [{ source: utm.source ?? source, medium: utm.medium, campaign: utm.campaign, content: utm.content, term: utm.term }] } : {}),
        originalPayload: { origin: "booking_page", bookingId, bookingTypeId: type.id, bookingTypeName: type.name, startsAt: slot.start, ...(link ? { link } : {}), consent: evidence },
      } as unknown as CreateIntakeEventDto) as { partyId: string; enquiryId: string; leadId: string };

      // A duplicate of an open enquiry: the meeting goes on the open job, not on the duplicate record.
      const lead = (await client.query<{ id: string; status: string; duplicateOf: string | null }>(
        `SELECT id, status, duplicate_of_lead_id AS "duplicateOf" FROM crm_leads WHERE workspace_id = $1 AND id = $2`, [workspaceId, intake.leadId])).rows[0];
      const jobLeadId = lead?.status === "duplicate" && lead.duplicateOf ? lead.duplicateOf : intake.leadId;
      const opportunity = (await client.query<{ id: string }>(`SELECT id FROM crm_opportunities WHERE workspace_id = $1 AND lead_id = $2 AND status = 'open' ORDER BY created_at DESC LIMIT 1`, [workspaceId, jobLeadId])).rows[0];
      const activity = (await client.query<{ id: string }>(
        `INSERT INTO crm_activities (workspace_id, party_id, lead_id, opportunity_id, type, title, description, owner_membership_id, priority, due_at, is_next_action, customer_visible)
         VALUES ($1, $2, $3, $4, 'meeting'::crm_activity_type, $5, $6, $7, 'normal', $8, false, true) RETURNING id`,
        [workspaceId, intake.partyId, jobLeadId, opportunity?.id ?? null, `${type.name} · ${answers.displayName}`, answers.summary ?? null, hostId, slot.start])).rows[0];
      await client.query(
        `INSERT INTO crm_appointments (workspace_id, activity_id, starts_at, ends_at, timezone, location, attendee_party_ids, attendee_membership_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [workspaceId, activity.id, slot.start, slot.end, calendar.timeZone, this.location(type, answers, party.mobile!), JSON.stringify([intake.partyId]), JSON.stringify([hostId])]);
      await client.query(`UPDATE bookings SET party_id = $3, lead_id = $4, enquiry_id = $5, activity_id = $6 WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, bookingId, intake.partyId, jobLeadId, intake.enquiryId, activity.id]);
      await recordAudit(client, { workspaceId, actorUserId: null, source: "internal", action: "booking.created.v1", entityType: "booking", entityId: bookingId,
        after: { bookingTypeId: type.id, hostMembershipId: hostId, startsAt: slot.start, endsAt: slot.end, status, enquiryId: intake.enquiryId, leadId: jobLeadId, activityId: activity.id, source, channel, placement: link?.placement ?? null } });
      await this.requestCalendarPush(client, workspaceId, bookingId, hostId, "create");
      if (status === "confirmed") await confirmAppointment(client, workspaceId, activity.id);
      await noticeMember(client, workspaceId, hostId, status === "pending" ? "booking.requested" : "booking.created",
        { clientName: answers.displayName, typeName: type.name, when: describeSlot(slot.start, slot.end, calendar.timeZone, workspace?.locale ?? "en") }, `booking:${bookingId}:created`);
      const booking = (await client.query<BookingRow>(`SELECT ${BOOKING_COLUMNS} FROM bookings booking WHERE booking.workspace_id = $1 AND booking.id = $2`, [workspaceId, bookingId])).rows[0];
      return { replay: false as const, booking, type, token, calendar, locale: workspace?.locale ?? "en" };
    });
    if ("blocked" in outcome) return { received: true, status: "received" as const };
    const { booking, type, token } = outcome;
    const managePath = `/book/${slug}/manage/${token}`;
    if (!outcome.replay) {
      await this.mailer.send(this.mail(workspaceId, booking, type, booking.status === "pending" ? "requested" : "confirmed", outcome.calendar.timeZone, outcome.locale, managePath));
    }
    return {
      received: true, status: booking.status, bookingId: booking.id, start: new Date(booking.startsAt).toISOString(), end: new Date(booking.endsAt).toISOString(),
      manageToken: token, managePath, idempotentReplay: outcome.replay,
    };
  }

  async manageView(slug: string, token: string) {
    const workspaceId = await this.workspace(slug);
    return this.db.tenantTransaction(workspaceId, SERVICE_ACTOR, async (client) => {
      const booking = await this.byToken(client, workspaceId, token, false);
      const type = (await loadTypeById(client, workspaceId, booking.typeId))!;
      const calendar = await firmCalendar(client, workspaceId);
      const change = changeAllowed(booking, type.cancelNoticeMinutes);
      const brand = (await client.query<{ displayName: string | null; name: string; loginSlug: string | null; primaryColor: string | null; hasLogo: boolean; locale: string }>(
        `SELECT branding.display_name AS "displayName", workspace.name, branding.login_slug AS "loginSlug", branding.primary_color AS "primaryColor",
                branding.logo_asset_id IS NOT NULL AS "hasLogo", workspace.default_locale AS locale
           FROM workspaces workspace LEFT JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id WHERE workspace.id = $1`, [workspaceId])).rows[0];
      return {
        booking: { status: booking.status, version: booking.version, start: new Date(booking.startsAt).toISOString(), end: new Date(booking.endsAt).toISOString(),
          visitorTimeZone: booking.visitorTimeZone, visitorName: booking.visitorName, canChange: change.allowed, reason: change.allowed ? null : change.reason },
        type: { name: type.name, slug: type.slug, durationMinutes: type.durationMinutes, locationKind: type.locationKind, locationDetail: this.locationText(type, booking.answers), windowDays: type.windowDays },
        timeZone: calendar.timeZone, locale: brand?.locale ?? "en",
        branding: { displayName: brand?.displayName ?? brand?.name ?? "", primaryColor: brand?.primaryColor ?? null, logoUrl: brand?.hasLogo && brand.loginSlug ? `/api/auth/tenant-logo/${brand.loginSlug}` : null },
      };
    });
  }

  async manageIcs(slug: string, token: string) {
    const workspaceId = await this.workspace(slug);
    const found = await this.db.tenantTransaction(workspaceId, SERVICE_ACTOR, async (client) => {
      const booking = await this.byToken(client, workspaceId, token, false);
      return { booking, type: (await loadTypeById(client, workspaceId, booking.typeId))! };
    });
    const brand = await this.mailer.brandName(workspaceId);
    return bookingIcs({ uid: `${found.booking.id}@wodana`, sequence: found.booking.version, method: ["cancelled"].includes(found.booking.status) ? "CANCEL" : "REQUEST",
      start: found.booking.startsAt, end: found.booking.endsAt, summary: `${found.type.name} · ${brand}`, location: this.locationText(found.type, found.booking.answers),
      organizer: { name: brand }, attendee: { name: found.booking.visitorName, email: found.booking.visitorEmail }, url: `${this.mailer.origin()}/book/${slug}/manage/${token}` });
  }

  async cancelByVisitor(slug: string, token: string, input: { version: number; reason?: string }) {
    const workspaceId = await this.workspace(slug);
    const done = await this.db.tenantTransaction(workspaceId, SERVICE_ACTOR, async (client) => {
      const booking = await this.byToken(client, workspaceId, token, true);
      if (booking.version !== input.version) throw new ConflictException("This booking changed. Reload and try again");
      const type = (await loadTypeById(client, workspaceId, booking.typeId))!;
      const change = changeAllowed(booking, type.cancelNoticeMinutes);
      if (!change.allowed) throw new UnprocessableEntityException(change.reason);
      return this.cancel(client, workspaceId, booking, type, { by: "visitor", reason: input.reason, actorUserId: null });
    });
    await this.mailer.send(done.mail);
    return done.view;
  }

  async rescheduleByVisitor(slug: string, token: string, input: { version: number; start: string; timeZone?: string }) {
    const workspaceId = await this.workspace(slug);
    const start = new Date(input.start);
    if (Number.isNaN(start.getTime())) throw new BadRequestException("Choose a time");
    const done = await this.db.tenantTransaction(workspaceId, SERVICE_ACTOR, async (client) => {
      const booking = await this.byToken(client, workspaceId, token, true);
      if (booking.version !== input.version) throw new ConflictException("This booking changed. Reload and try again");
      const type = (await loadTypeById(client, workspaceId, booking.typeId))!;
      if (!type.active) throw new UnprocessableEntityException("This booking page is closed. Please contact us");
      const change = changeAllowed(booking, type.cancelNoticeMinutes);
      if (!change.allowed) throw new UnprocessableEntityException(change.reason);
      // The same host first, so the meeting stays with the person the client chose; else another free host of the type.
      const { calendar, slot } = await recheckSlot(client, workspaceId, type, start, { enquiryType: type.enquiryType ?? booking.answers.serviceType ?? null, ignoreBookingId: booking.id });
      if (!slot) throw slotTaken(await nextSlots(client, workspaceId, type, start, type.enquiryType ?? booking.answers.serviceType ?? null));
      const hostId = slot.hostIds.includes(booking.hostMembershipId) ? booking.hostMembershipId : slot.hostIds[0];
      await client.query("SAVEPOINT booking_move");
      try {
        await client.query(`UPDATE bookings SET starts_at = $3, ends_at = $4, host_membership_id = $5, visitor_time_zone = COALESCE($6, visitor_time_zone), version = version + 1
          WHERE workspace_id = $1 AND id = $2`, [workspaceId, booking.id, slot.start, slot.end, hostId, validTimeZone(input.timeZone)]);
        await client.query("RELEASE SAVEPOINT booking_move");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT booking_move");
        if ((error as { code?: string }).code === "23P01") throw slotTaken(await nextSlots(client, workspaceId, type, start, type.enquiryType));
        throw error;
      }
      if (booking.activityId) {
        await client.query(`UPDATE crm_activities SET due_at = $3, owner_membership_id = $4, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, booking.activityId, slot.start, hostId]);
        await client.query(`UPDATE crm_appointments SET starts_at = $3, ends_at = $4, attendee_membership_ids = $5, version = version + 1 WHERE workspace_id = $1 AND activity_id = $2`,
          [workspaceId, booking.activityId, slot.start, slot.end, JSON.stringify([hostId])]);
        if (booking.status === "confirmed") await confirmAppointment(client, workspaceId, booking.activityId);
      }
      await recordAudit(client, { workspaceId, actorUserId: null, source: "internal", action: "booking.rescheduled.v1", entityType: "booking", entityId: booking.id,
        before: { startsAt: booking.startsAt, endsAt: booking.endsAt, hostMembershipId: booking.hostMembershipId }, after: { startsAt: slot.start, endsAt: slot.end, hostMembershipId: hostId } });
      await this.requestCalendarPush(client, workspaceId, booking.id, hostId, "update");
      const locale = await this.locale(client, workspaceId);
      const when = describeSlot(slot.start, slot.end, calendar.timeZone, locale);
      await noticeMember(client, workspaceId, hostId, "booking.rescheduled", { clientName: booking.visitorName, typeName: type.name, when }, `booking:${booking.id}:moved:${Date.parse(slot.start)}`);
      if (hostId !== booking.hostMembershipId) await noticeMember(client, workspaceId, booking.hostMembershipId, "booking.cancelled", { clientName: booking.visitorName, typeName: type.name, when: describeSlot(booking.startsAt, booking.endsAt, calendar.timeZone, locale) }, `booking:${booking.id}:handover:${Date.parse(slot.start)}`);
      const updated = await this.byId(client, workspaceId, booking.id);
      return { updated, mail: this.mail(workspaceId, updated, type, "rescheduled", calendar.timeZone, locale, `/book/${slug}/manage/${token}`) };
    });
    await this.mailer.send(done.mail);
    return { status: done.updated.status, version: done.updated.version, start: new Date(done.updated.startsAt).toISOString(), end: new Date(done.updated.endsAt).toISOString() };
  }

  /* ── Staff ───────────────────────────────────────────────────────────────────────────────────── */

  list(actor: RequestActor, workspaceId: string, query: { from?: string; to?: string; status?: string; typeId?: string }) {
    return this.access.withPermission(actor, workspaceId, "crm.activities.view", async (client) => {
      const from = query.from && !Number.isNaN(Date.parse(query.from)) ? new Date(query.from) : new Date(Date.now() - 86_400_000);
      const to = query.to && !Number.isNaN(Date.parse(query.to)) ? new Date(query.to) : new Date(from.getTime() + 62 * 86_400_000);
      if (to <= from || to.getTime() - from.getTime() > 400 * 86_400_000) throw new BadRequestException("Choose a date range of up to a year");
      const status = query.status && ["pending", "confirmed", "cancelled", "completed", "no_show"].includes(query.status) ? query.status : null;
      const rows = (await client.query(
        `SELECT booking.id, booking.status, booking.version, booking.starts_at AS "startsAt", booking.ends_at AS "endsAt", booking.visitor_time_zone AS "visitorTimeZone",
                booking.visitor_name AS "visitorName", booking.source, booking.channel, booking.placement, booking.lead_id AS "leadId", booking.activity_id AS "activityId",
                type.id AS "typeId", type.name AS "typeName", type.color, booking.host_membership_id AS "hostMembershipId", account.display_name AS "hostName",
                enquiry.reference AS "enquiryReference", booking.created_at AS "createdAt"
           FROM bookings booking JOIN booking_types type ON type.workspace_id = booking.workspace_id AND type.id = booking.booking_type_id
           JOIN workspace_memberships member ON member.id = booking.host_membership_id JOIN users account ON account.id = member.user_id
           LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = booking.workspace_id AND enquiry.id = booking.enquiry_id
          WHERE booking.workspace_id = $1 AND booking.starts_at < $3 AND booking.ends_at > $2 AND ($4::text IS NULL OR booking.status = $4) AND ($5::uuid IS NULL OR booking.booking_type_id = $5::uuid)
          ORDER BY booking.starts_at LIMIT 500`, [workspaceId, from, to, status, query.typeId && /^[0-9a-f-]{36}$/i.test(query.typeId) ? query.typeId : null])).rows;
      return { data: rows.map((row) => ({ ...row, version: Number(row.version) })) };
    });
  }

  confirm(actor: RequestActor, workspaceId: string, id: string, version: number) {
    return this.staffAction(actor, workspaceId, id, version, async (client, booking, type, userId) => {
      if (booking.status !== "pending") throw new ConflictException("Only a requested booking can be confirmed");
      await client.query(`UPDATE bookings SET status = 'confirmed', decided_by = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, booking.id, userId]);
      if (booking.activityId) await confirmAppointment(client, workspaceId, booking.activityId, { actorUserId: userId });
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "booking.confirmed.v1", entityType: "booking", entityId: booking.id, before: { status: booking.status }, after: { status: "confirmed" } });
      return "confirmed" as const;
    });
  }

  decline(actor: RequestActor, workspaceId: string, id: string, version: number, reason?: string) {
    return this.staffAction(actor, workspaceId, id, version, async (client, booking, type, userId) => {
      if (!["pending", "confirmed"].includes(booking.status)) throw new ConflictException("This booking is already closed");
      await this.cancel(client, workspaceId, booking, type, { by: "staff", reason, actorUserId: userId });
      return "cancelled" as const;
    });
  }

  complete(actor: RequestActor, workspaceId: string, id: string, version: number) {
    return this.attendance(actor, workspaceId, id, version, "completed");
  }

  noShow(actor: RequestActor, workspaceId: string, id: string, version: number) {
    return this.attendance(actor, workspaceId, id, version, "no_show");
  }

  private attendance(actor: RequestActor, workspaceId: string, id: string, version: number, outcome: "completed" | "no_show") {
    return this.staffAction(actor, workspaceId, id, version, async (client, booking, _type, userId) => {
      if (booking.status !== "confirmed") throw new ConflictException("Only a confirmed booking can be marked");
      if (new Date(booking.startsAt).getTime() > Date.now()) throw new UnprocessableEntityException("Mark it once the meeting has started");
      await client.query(`UPDATE bookings SET status = $3, decided_by = $4, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, booking.id, outcome, userId]);
      if (booking.activityId) {
        await client.query(`UPDATE crm_activities SET status = 'completed', completed_at = now(), completion_outcome = $3, is_next_action = false, version = version + 1
          WHERE workspace_id = $1 AND id = $2 AND status = 'pending'`, [workspaceId, booking.activityId, outcome === "completed" ? "Attended" : "No-show"]);
        await client.query(`UPDATE crm_appointments SET attendance_status = $3, version = version + 1 WHERE workspace_id = $1 AND activity_id = $2`,
          [workspaceId, booking.activityId, outcome === "completed" ? "attended" : "no_show"]);
      }
      await recordAudit(client, { workspaceId, actorUserId: userId, action: `booking.${outcome}.v1`, entityType: "booking", entityId: booking.id, before: { status: booking.status }, after: { status: outcome } });
      return outcome;
    });
  }

  private async staffAction(actor: RequestActor, workspaceId: string, id: string, version: number,
    work: (client: PoolClient, booking: BookingRow, type: BookingTypeRow, userId: string) => Promise<"confirmed" | "cancelled" | "completed" | "no_show">) {
    let mail: BookingMail | null = null;
    const result = await this.access.withPermission(actor, workspaceId, "crm.activities.manage", async (client, user) => {
      const booking = (await client.query<BookingRow>(`SELECT ${BOOKING_COLUMNS} FROM bookings booking WHERE booking.workspace_id = $1 AND booking.id = $2 FOR UPDATE`, [workspaceId, id])).rows[0];
      if (!booking) throw new NotFoundException("Booking not found");
      if (Number(booking.version) !== version) throw new ConflictException("This booking changed. Reload and try again");
      const type = (await loadTypeById(client, workspaceId, booking.typeId))!;
      const outcome = await work(client, booking, type, user.userId);
      const updated = await this.byId(client, workspaceId, id);
      if (outcome === "confirmed" || outcome === "cancelled") {
        const calendar = await firmCalendar(client, workspaceId);
        mail = this.mail(workspaceId, updated, type, outcome, calendar.timeZone, await this.locale(client, workspaceId), await this.managePath(client, workspaceId, updated));
      }
      return { id, status: updated.status, version: updated.version };
    });
    if (mail) await this.mailer.send(mail);
    return result;
  }

  /* ── Shared steps ────────────────────────────────────────────────────────────────────────────── */

  private async cancel(client: PoolClient, workspaceId: string, booking: BookingRow, type: BookingTypeRow, input: { by: "visitor" | "staff"; reason?: string; actorUserId: string | null }) {
    await client.query(`UPDATE bookings SET status = 'cancelled', cancelled_by = $3, cancel_reason = $4, cancelled_at = now(), decided_by = $5, version = version + 1
      WHERE workspace_id = $1 AND id = $2`, [workspaceId, booking.id, input.by, input.reason?.trim().slice(0, 500) || null, input.actorUserId]);
    if (booking.activityId) {
      await client.query(`UPDATE crm_activities SET status = 'cancelled', is_next_action = false, version = version + 1 WHERE workspace_id = $1 AND id = $2 AND status = 'pending'`, [workspaceId, booking.activityId]);
      await client.query(`UPDATE crm_appointments SET attendance_status = 'cancelled', version = version + 1 WHERE workspace_id = $1 AND activity_id = $2`, [workspaceId, booking.activityId]);
    }
    await recordAudit(client, { workspaceId, actorUserId: input.actorUserId, source: input.actorUserId ? "user" : "internal", action: "booking.cancelled.v1", entityType: "booking", entityId: booking.id,
      before: { status: booking.status }, after: { status: "cancelled", by: input.by, reason: input.reason ?? null } });
    await this.requestCalendarPush(client, workspaceId, booking.id, booking.hostMembershipId, "cancel");
    const calendar = await firmCalendar(client, workspaceId);
    const locale = await this.locale(client, workspaceId);
    if (input.by === "visitor") await noticeMember(client, workspaceId, booking.hostMembershipId, "booking.cancelled",
      { clientName: booking.visitorName, typeName: type.name, when: describeSlot(booking.startsAt, booking.endsAt, calendar.timeZone, locale) }, `booking:${booking.id}:cancelled`);
    const updated = await this.byId(client, workspaceId, booking.id);
    return { view: { status: updated.status, version: updated.version }, mail: this.mail(workspaceId, updated, type, "cancelled", calendar.timeZone, locale, null) };
  }

  /** The visitor's manage link for a booking, under the workspace's public slug. */
  private async managePath(client: PoolClient, workspaceId: string, booking: BookingRow) {
    const slug = (await client.query<{ slug: string }>(`SELECT COALESCE(branding.login_slug, workspace.slug) AS slug FROM workspaces workspace
      LEFT JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id WHERE workspace.id = $1`, [workspaceId])).rows[0]?.slug;
    return slug ? `/book/${slug}/manage/${manageToken(this.secret(), workspaceId, booking.id, booking.manageNonce)}` : null;
  }

  private mail(workspaceId: string, booking: BookingRow, type: BookingTypeRow, kind: BookingMail["kind"], firmTimeZone: string, locale: string, managePath: string | null): BookingMail {
    const origin = this.mailer.origin();
    return {
      workspaceId, bookingId: booking.id, version: booking.version, kind, to: booking.visitorEmail, visitorName: booking.visitorName, typeName: type.name,
      startsAt: booking.startsAt, endsAt: booking.endsAt, visitorTimeZone: booking.visitorTimeZone, firmTimeZone, locale,
      location: this.locationText(type, booking.answers),
      manageUrl: managePath ? `${origin}${managePath}` : null,
    };
  }

  /** What the visitor answered: name, mobile and email always; the type's own questions, checked against the workspace's choices. */
  private answers(type: BookingTypeRow, input: PublicBookingInput, choices: Awaited<ReturnType<typeof loadLeadOptions>>) {
    const raw = input.answers ?? {};
    const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
    const displayName = text(raw.displayName, 240);
    if (!displayName) throw new UnprocessableEntityException("Enter your name");
    const mobile = text(raw.mobile, 80);
    if (!mobile) throw new UnprocessableEntityException("Enter a mobile number");
    const email = text(raw.email, 320);
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new UnprocessableEntityException("Enter a valid email address");
    const result: Record<string, string> & { displayName: string; mobile: string; email: string } = { displayName, mobile, email };
    const asked = new Map(type.questions.map((question) => [question.field, question.required]));
    const pick = (field: string, options: Array<{ id: string }> | null, max = 240) => {
      if (!asked.has(field as never)) return;
      const value = text(raw[field as keyof typeof raw], max);
      if (!value) { if (asked.get(field as never)) throw new UnprocessableEntityException("Answer every required question"); return; }
      if (options && !options.some((option) => option.id === value)) throw new UnprocessableEntityException("Choose an answer from the list");
      result[field] = value;
    };
    pick("emirate", choices.emirates.length ? choices.emirates : null);
    pick("area", null);
    pick("budgetRange", choices.budgetRanges);
    pick("summary", null, 4000);
    const asksType = type.hostsMode === "enquiry_type" || (!type.enquiryType && asked.has("serviceType"));
    if (asksType) {
      const chosen = text(input.enquiryType ?? raw.serviceType, 100);
      if (!chosen || !choices.enquiryTypes.some((option) => option.id === chosen)) throw new UnprocessableEntityException("Choose what the meeting is about");
      result.serviceType = chosen;
    }
    if (type.locationKind === "client_address") {
      const address = text(raw.address, 500);
      if (!address) throw new UnprocessableEntityException("Enter the address for the visit");
      result.address = address;
    }
    return result;
  }

  private location(type: BookingTypeRow, answers: Record<string, string>, mobile: string) {
    if (type.locationKind === "video") return { mode: "online", url: type.locationDetail };
    if (type.locationKind === "phone") return { mode: "phone", phone: mobile };
    if (type.locationKind === "client_address") return { mode: "in_person", address: answers.address ?? null };
    return { mode: "in_person", address: type.locationDetail };
  }

  private locationText(type: BookingTypeRow, answers: Record<string, string>) {
    if (type.locationKind === "client_address") return answers.address ?? null;
    if (type.locationKind === "phone") return answers.mobile ? `Phone call · ${answers.mobile}` : "Phone call";
    return type.locationDetail;
  }

  private utm(value: unknown) {
    if (!value || typeof value !== "object") return {} as Record<string, string>;
    const out: Record<string, string> = {};
    for (const key of ["source", "medium", "campaign", "content", "term"]) {
      const item = (value as Record<string, unknown>)[key];
      if (typeof item === "string" && item.trim()) out[key] = item.trim().slice(0, 160);
    }
    return out;
  }

  /** Round-robin: the free host with the fewest upcoming bookings of this type goes first. */
  private async orderHosts(client: PoolClient, workspaceId: string, type: BookingTypeRow, free: string[]) {
    if (free.length < 2) return free;
    const load = new Map((await client.query<{ host: string; count: number }>(
      `SELECT host_membership_id AS host, count(*)::int AS count FROM bookings WHERE workspace_id = $1 AND booking_type_id = $2 AND status IN ('pending', 'confirmed')
         AND starts_at > now() - interval '30 days' AND host_membership_id = ANY($3::uuid[]) GROUP BY host_membership_id`, [workspaceId, type.id, free])).rows.map((row) => [row.host, Number(row.count)]));
    const position = new Map(type.hosts.map((host) => [host.membershipId, host.position]));
    return [...free].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || (position.get(a) ?? 0) - (position.get(b) ?? 0));
  }

  /** A connected host's Google calendar gets the event: the integration worker reads this outbox event. */
  private async requestCalendarPush(client: PoolClient, workspaceId: string, bookingId: string, hostId: string, operation: "create" | "update" | "cancel") {
    const connection = (await client.query<{ id: string }>(
      `SELECT connection.id FROM integration_connections connection JOIN workspace_memberships member ON member.workspace_id = connection.workspace_id AND member.user_id = connection.connected_by
        WHERE connection.workspace_id = $1 AND member.id = $2 AND connection.provider = 'google_workspace' AND connection.status IN ('connected', 'degraded') LIMIT 1`, [workspaceId, hostId])).rows[0];
    if (!connection) return;
    await recordAudit(client, { workspaceId, actorUserId: null, source: "internal", action: "booking.calendar_push_requested.v1", entityType: "booking", entityId: bookingId,
      after: { connectionId: connection.id, hostMembershipId: hostId, operation, sendUpdates: "all" } });
  }

  private async byToken(client: PoolClient, workspaceId: string, token: string, lock: boolean) {
    if (!MANAGE_TOKEN.test(token)) throw new NotFoundException("This booking link is not valid");
    const booking = (await client.query<BookingRow>(`SELECT ${BOOKING_COLUMNS} FROM bookings booking WHERE booking.workspace_id = $1 AND booking.manage_token_hash = $2${lock ? " FOR UPDATE" : ""}`,
      [workspaceId, tokenHash(token)])).rows[0];
    if (!booking) throw new NotFoundException("This booking link is not valid");
    return { ...booking, version: Number(booking.version) };
  }

  private async byId(client: PoolClient, workspaceId: string, id: string) {
    const booking = (await client.query<BookingRow>(`SELECT ${BOOKING_COLUMNS} FROM bookings booking WHERE booking.workspace_id = $1 AND booking.id = $2`, [workspaceId, id])).rows[0];
    return { ...booking, version: Number(booking.version) };
  }

  private async locale(client: PoolClient, workspaceId: string) {
    return (await client.query<{ locale: string }>(`SELECT default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.locale ?? "en";
  }

  private async activeType(client: PoolClient, workspaceId: string, typeSlug: string) {
    if (!SLUG.test(typeSlug)) throw new NotFoundException("This booking page is not available");
    const type = await loadTypeBySlug(client, workspaceId, typeSlug);
    if (!type?.active || !type.hosts.length) throw new NotFoundException("This booking page is not available");
    return type;
  }

  /** The workspace a public page names (its sign-in slug); a disabled workspace has no booking pages. */
  private async workspace(slug: string) {
    if (!SLUG.test(slug)) throw new NotFoundException("This booking page is not available");
    const row = (await this.db.query<{ id: string | null }>(`SELECT booking_public_workspace($1) AS id`, [slug])).rows[0];
    if (!row?.id) throw new NotFoundException("This booking page is not available");
    return row.id;
  }

  /** The key manage links are signed with: its own setting, else the service's signing secret. */
  private secret() {
    const secret = [this.config.get<string>("BOOKING_LINK_SECRET"), this.config.get<string>("LOCAL_AUTH_JWT_SECRET"), this.config.get<string>("MFA_ENCRYPTION_KEY")]
      .map((value) => value?.trim() ?? "").find((value) => value.length >= 32);
    if (!secret) throw new ServiceUnavailableException("Booking pages are not set up yet");
    return secret;
  }
}

/**
 * A host's leave was approved: each of their live bookings in those days moves to another free host of the
 * type's team; when nobody is free, the enquiry's owner (else the Sales admin) is told to act. Never blocks
 * the leave decision: a failure here is rolled back on its own.
 */
export async function reassignBookingsForLeave(client: PoolClient, workspaceId: string, leaveRequestId: string) {
  await client.query("SAVEPOINT booking_leave");
  try {
    const leave = (await client.query<{ membershipId: string; start: string; end: string }>(
      `SELECT membership_id AS "membershipId", start_date::text AS start, end_date::text AS "end" FROM hrms_leave_requests WHERE workspace_id = $1 AND id = $2`, [workspaceId, leaveRequestId])).rows[0];
    if (!leave) { await client.query("RELEASE SAVEPOINT booking_leave"); return { moved: 0, flagged: 0 }; }
    const calendar = await firmCalendar(client, workspaceId);
    const bookings = (await client.query<BookingRow & { leadOwner: string | null }>(
      `SELECT ${BOOKING_COLUMNS}, lead.owner_membership_id AS "leadOwner" FROM bookings booking LEFT JOIN crm_leads lead ON lead.workspace_id = booking.workspace_id AND lead.id = booking.lead_id
        WHERE booking.workspace_id = $1 AND booking.host_membership_id = $2 AND booking.status IN ('pending', 'confirmed') AND booking.starts_at > now()
          AND (booking.starts_at AT TIME ZONE $5)::date BETWEEN $3::date AND $4::date FOR UPDATE OF booking`,
      [workspaceId, leave.membershipId, leave.start, leave.end, calendar.timeZone])).rows;
    let moved = 0, flagged = 0;
    for (const booking of bookings) {
      const type = (await loadTypeById(client, workspaceId, booking.typeId))!;
      const others = hostsFor(type, type.enquiryType ?? booking.answers?.serviceType ?? null).map((host) => host.membershipId).filter((id) => id !== booking.hostMembershipId);
      const date = wallClock(new Date(booking.startsAt).getTime(), calendar.timeZone).date;
      const { slots } = others.length && type.hostsMode !== "one" ? await slotsFor(client, workspaceId, type, { from: date, to: date, hostIds: others, ignoreBookingId: booking.id, staff: true }) : { slots: [] as Slot[] };
      const free = slots.find((slot) => Date.parse(slot.start) === new Date(booking.startsAt).getTime())?.hostIds[0];
      const when = describeSlot(booking.startsAt, booking.endsAt, calendar.timeZone, "en");
      if (free) {
        await client.query(`UPDATE bookings SET host_membership_id = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, booking.id, free]);
        if (booking.activityId) {
          await client.query(`UPDATE crm_activities SET owner_membership_id = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, booking.activityId, free]);
          await client.query(`UPDATE crm_appointments SET attendee_membership_ids = $3, version = version + 1 WHERE workspace_id = $1 AND activity_id = $2`, [workspaceId, booking.activityId, JSON.stringify([free])]);
        }
        await recordAudit(client, { workspaceId, actorUserId: null, source: "internal", action: "booking.host_reassigned.v1", entityType: "booking", entityId: booking.id,
          before: { hostMembershipId: booking.hostMembershipId }, after: { hostMembershipId: free, reason: "host_on_leave", leaveRequestId } });
        await noticeMember(client, workspaceId, free, "booking.created", { clientName: booking.visitorName, typeName: type.name, when }, `booking:${booking.id}:reassigned:${free}`);
        moved += 1;
      } else {
        const settings = (await client.query<{ admin: string | null }>(`SELECT sales_admin_membership_id AS admin FROM workspace_sales_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
        const host = (await client.query<{ name: string }>(`SELECT account.display_name AS name FROM workspace_memberships member JOIN users account ON account.id = member.user_id WHERE member.id = $1`, [booking.hostMembershipId])).rows[0];
        await noticeMember(client, workspaceId, booking.leadOwner && booking.leadOwner !== booking.hostMembershipId ? booking.leadOwner : settings?.admin ?? booking.leadOwner, "booking.host_away",
          { clientName: booking.visitorName, typeName: type.name, when, hostName: host?.name ?? "" }, `booking:${booking.id}:host-away:${leaveRequestId}`);
        flagged += 1;
      }
    }
    await client.query("RELEASE SAVEPOINT booking_leave");
    return { moved, flagged };
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT booking_leave");
    return { moved: 0, flagged: 0 };
  }
}
