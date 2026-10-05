import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { loadLeadOptions, validateLeadOptions } from "../crm/leads/lead-options";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { isDate, isTime, parseQuestions, slugify } from "./booking.domain";
import { firmCalendar, loadTypeById, TYPE_COLUMNS, mapType } from "./booking-store";

/** Booking types are Sales settings: only people who manage Sales settings change them. */
const MANAGE = "crm.settings.manage";

export type BookingTypeInput = {
  version?: number; name?: string; slug?: string; durationMinutes?: number; color?: string; locationKind?: string; locationDetail?: string | null;
  bufferBeforeMinutes?: number; bufferAfterMinutes?: number; minimumNoticeMinutes?: number; windowDays?: number; maxPerDay?: number | null;
  slotStepMinutes?: number; cancelNoticeMinutes?: number; questions?: unknown; enquiryType?: string | null; source?: string; channel?: string;
  hostsMode?: string; confirmation?: string; active?: boolean; hosts?: Array<{ membershipId: string; enquiryType?: string | null }>;
};
export type OverrideInput = { membershipId: string; startsOn: string; endsOn: string; kind: "extra" | "blocked"; startTime?: string | null; endTime?: string | null; reason?: string | null };

const FIELDS: Array<[keyof BookingTypeInput, string]> = [
  ["name", "name"], ["slug", "slug"], ["durationMinutes", "duration_minutes"], ["color", "color"], ["locationKind", "location_kind"], ["locationDetail", "location_detail"],
  ["bufferBeforeMinutes", "buffer_before_minutes"], ["bufferAfterMinutes", "buffer_after_minutes"], ["minimumNoticeMinutes", "minimum_notice_minutes"],
  ["windowDays", "window_days"], ["maxPerDay", "max_per_day"], ["slotStepMinutes", "slot_step_minutes"], ["cancelNoticeMinutes", "cancel_notice_minutes"],
  ["questions", "questions"], ["enquiryType", "enquiry_type"], ["source", "source"], ["channel", "channel"], ["hostsMode", "hosts_mode"],
  ["confirmation", "confirmation"], ["active", "active"],
];

@Injectable()
export class BookingTypesService {
  constructor(private readonly access: WorkspaceAccessService) {}

  /** Every type with its hosts, plus what the settings form needs: members, enquiry choices and the firm's zone. */
  list(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client) => {
      const types = (await client.query(`SELECT ${TYPE_COLUMNS},
          (SELECT count(*)::int FROM bookings booking WHERE booking.workspace_id = type.workspace_id AND booking.booking_type_id = type.id
            AND booking.status IN ('pending', 'confirmed') AND booking.starts_at > now()) AS upcoming
        FROM booking_types type WHERE type.workspace_id = $1 ORDER BY type.active DESC, type.name`, [workspaceId])).rows
        .map((row) => ({ ...mapType(row), upcoming: Number(row.upcoming) }));
      const members = (await client.query<{ membershipId: string; name: string }>(
        `SELECT member.id AS "membershipId", account.display_name AS name FROM workspace_memberships member JOIN users account ON account.id = member.user_id
          WHERE member.workspace_id = $1 AND member.status = 'active' ORDER BY account.display_name`, [workspaceId])).rows;
      const options = await loadLeadOptions(client, workspaceId);
      const workspace = (await client.query<{ slug: string; loginSlug: string | null }>(
        `SELECT workspace.slug, branding.login_slug AS "loginSlug" FROM workspaces workspace LEFT JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id WHERE workspace.id = $1`, [workspaceId])).rows[0];
      const calendar = await firmCalendar(client, workspaceId);
      return {
        data: types, members, timeZone: calendar.timeZone, publicSlug: workspace?.loginSlug ?? workspace?.slug ?? null,
        options: { enquiryTypes: options.enquiryTypes, sources: options.sources.filter((source) => !(source as { allowedRoles?: string[] }).allowedRoles?.length), channels: options.channels, hasRegions: options.emirates.length > 0 },
      };
    });
  }

  create(actor: RequestActor, workspaceId: string, input: BookingTypeInput) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const values = await this.validate(client, workspaceId, input, null);
      const slug = await this.freeSlug(client, workspaceId, values.slug ?? slugify(String(values.name ?? "")), null);
      const row = (await client.query<{ id: string }>(
        `INSERT INTO booking_types (workspace_id, name, slug, duration_minutes, color, location_kind, location_detail, buffer_before_minutes, buffer_after_minutes,
           minimum_notice_minutes, window_days, max_per_day, slot_step_minutes, cancel_notice_minutes, questions, enquiry_type, source, channel, hosts_mode, confirmation,
           active, created_by, updated_by)
         VALUES ($1, $2, $3, $4, COALESCE($5, 'viz-1'), COALESCE($6, 'our_location'), $7, COALESCE($8, 0), COALESCE($9, 0), COALESCE($10, 240), COALESCE($11, 30), $12,
           COALESCE($13, 30), COALESCE($14, 240), $15::jsonb, $16, COALESCE($17, 'company'), COALESCE($18, 'website'), COALESCE($19, 'one'), COALESCE($20, 'automatic'),
           COALESCE($21, true), $22, $22) RETURNING id`,
        [workspaceId, values.name, slug, values.durationMinutes ?? 60, values.color ?? null, values.locationKind ?? null, values.locationDetail ?? null,
          values.bufferBeforeMinutes ?? null, values.bufferAfterMinutes ?? null, values.minimumNoticeMinutes ?? null, values.windowDays ?? null, values.maxPerDay ?? null,
          values.slotStepMinutes ?? null, values.cancelNoticeMinutes ?? null, JSON.stringify(values.questions ?? []), values.enquiryType ?? null, values.source ?? null,
          values.channel ?? null, values.hostsMode ?? null, values.confirmation ?? null, values.active ?? null, user.userId])).rows[0];
      await this.saveHosts(client, workspaceId, row.id, input.hosts ?? []);
      const type = await this.assertBookable(client, workspaceId, row.id);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "booking.type_created.v1", entityType: "booking_type", entityId: row.id, after: type });
      return type;
    });
  }

  update(actor: RequestActor, workspaceId: string, id: string, input: BookingTypeInput) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const before = await loadTypeById(client, workspaceId, id, true);
      if (!before) throw new NotFoundException("Booking type not found");
      if (before.version !== input.version) throw new ConflictException("This booking type changed. Reload before saving");
      const values = await this.validate(client, workspaceId, input, before);
      if (values.slug !== undefined) values.slug = await this.freeSlug(client, workspaceId, String(values.slug), id);
      const sets: string[] = [], params: unknown[] = [workspaceId, id, user.userId];
      for (const [key, column] of FIELDS) {
        if (values[key] === undefined) continue;
        params.push(key === "questions" ? JSON.stringify(values.questions) : values[key]);
        sets.push(`${column} = $${params.length}${key === "questions" ? "::jsonb" : ""}`);
      }
      await client.query(`UPDATE booking_types SET ${[...sets, "version = version + 1", "updated_by = $3"].join(", ")} WHERE workspace_id = $1 AND id = $2`, params);
      if (input.hosts) await this.saveHosts(client, workspaceId, id, input.hosts);
      const type = await this.assertBookable(client, workspaceId, id);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "booking.type_updated.v1", entityType: "booking_type", entityId: id, before, after: type });
      return type;
    });
  }

  listOverrides(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client) => ({
      data: (await client.query(`SELECT override.id, override.membership_id AS "membershipId", account.display_name AS "memberName", override.starts_on::text AS "startsOn",
          override.ends_on::text AS "endsOn", override.kind, to_char(override.start_time, 'HH24:MI') AS "startTime", to_char(override.end_time, 'HH24:MI') AS "endTime",
          override.reason, override.version
        FROM availability_overrides override JOIN workspace_memberships member ON member.id = override.membership_id JOIN users account ON account.id = member.user_id
        WHERE override.workspace_id = $1 AND override.ends_on >= current_date - 1 ORDER BY override.starts_on, account.display_name`, [workspaceId])).rows,
    }));
  }

  createOverride(actor: RequestActor, workspaceId: string, input: OverrideInput) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      if (!isDate(input.startsOn) || !isDate(input.endsOn) || input.endsOn < input.startsOn) throw new UnprocessableEntityException("Choose a valid date range");
      const withTimes = Boolean(input.startTime || input.endTime);
      if (withTimes && (!isTime(input.startTime) || !isTime(input.endTime) || input.endTime! <= input.startTime!)) throw new UnprocessableEntityException("The end time must be after the start time");
      if (input.kind === "extra" && !withTimes) throw new UnprocessableEntityException("Extra hours need a start and end time");
      const member = await client.query(`SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, input.membershipId]);
      if (!member.rowCount) throw new UnprocessableEntityException("Choose an active team member");
      const row = (await client.query(`INSERT INTO availability_overrides (workspace_id, membership_id, starts_on, ends_on, kind, start_time, end_time, reason, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, version`,
        [workspaceId, input.membershipId, input.startsOn, input.endsOn, input.kind, withTimes ? input.startTime : null, withTimes ? input.endTime : null, input.reason?.trim()?.slice(0, 240) || null, user.userId])).rows[0];
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "booking.availability_override_created.v1", entityType: "availability_override", entityId: row.id, after: input });
      return row;
    });
  }

  removeOverride(actor: RequestActor, workspaceId: string, id: string, version: number) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const removed = await client.query(`DELETE FROM availability_overrides WHERE workspace_id = $1 AND id = $2 AND version = $3 RETURNING id`, [workspaceId, id, version]);
      if (!removed.rowCount) throw new ConflictException("This override changed or was removed. Reload and try again");
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "booking.availability_override_removed.v1", entityType: "availability_override", entityId: id, before: { version } });
      return { id, removed: true };
    });
  }

  private async validate(client: PoolClient, workspaceId: string, input: BookingTypeInput, before: Awaited<ReturnType<typeof loadTypeById>>) {
    const values: BookingTypeInput = {};
    const integer = (key: keyof BookingTypeInput, min: number, max: number, label: string, nullable = false) => {
      const value = input[key];
      if (value === undefined) return;
      if (value === null && nullable) { (values as Record<string, unknown>)[key] = null; return; }
      if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new UnprocessableEntityException(`${label} must be between ${min} and ${max}`);
      (values as Record<string, unknown>)[key] = value;
    };
    if (input.name !== undefined) {
      if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 120) throw new UnprocessableEntityException("Enter a name");
      values.name = input.name.trim();
    } else if (!before) throw new UnprocessableEntityException("Enter a name");
    if (input.slug !== undefined) {
      const slug = slugify(String(input.slug));
      if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug)) throw new UnprocessableEntityException("Enter a link name with letters, numbers and dashes");
      values.slug = slug;
    }
    integer("durationMinutes", 5, 480, "Duration");
    integer("bufferBeforeMinutes", 0, 240, "Buffer before");
    integer("bufferAfterMinutes", 0, 240, "Buffer after");
    integer("minimumNoticeMinutes", 0, 43200, "Minimum notice");
    integer("windowDays", 1, 365, "Booking window");
    integer("maxPerDay", 1, 100, "Maximum per day", true);
    integer("cancelNoticeMinutes", 0, 43200, "Cancellation notice");
    if (input.slotStepMinutes !== undefined) {
      if (![10, 15, 20, 30, 60].includes(Number(input.slotStepMinutes))) throw new UnprocessableEntityException("Choose a start-time step of 10, 15, 20, 30 or 60 minutes");
      values.slotStepMinutes = Number(input.slotStepMinutes);
    }
    if (input.color !== undefined) {
      if (!/^viz-[1-6]$/.test(String(input.color))) throw new UnprocessableEntityException("Choose a colour");
      values.color = input.color;
    }
    if (input.locationKind !== undefined) {
      if (!["our_location", "client_address", "video", "phone"].includes(String(input.locationKind))) throw new UnprocessableEntityException("Choose where it takes place");
      values.locationKind = input.locationKind;
    }
    if (input.locationDetail !== undefined) {
      const detail = typeof input.locationDetail === "string" ? input.locationDetail.trim().slice(0, 500) : "";
      const kind = values.locationKind ?? before?.locationKind ?? "our_location";
      if (kind === "video" && detail && !/^https:\/\/\S+$/i.test(detail)) throw new UnprocessableEntityException("The video link must start with https://");
      values.locationDetail = detail || null;
    }
    if (input.questions !== undefined) {
      try { values.questions = parseQuestions(input.questions); } catch (error) { throw new UnprocessableEntityException(error instanceof Error ? error.message : "Invalid questions"); }
    }
    if (input.hostsMode !== undefined) {
      if (!["one", "round_robin", "enquiry_type"].includes(String(input.hostsMode))) throw new UnprocessableEntityException("Choose who hosts it");
      values.hostsMode = input.hostsMode;
    }
    if (input.confirmation !== undefined) {
      if (!["automatic", "approval"].includes(String(input.confirmation))) throw new UnprocessableEntityException("Choose how bookings are confirmed");
      values.confirmation = input.confirmation;
    }
    if (input.active !== undefined) values.active = input.active === true;
    if (input.enquiryType !== undefined) values.enquiryType = input.enquiryType?.trim() || null;
    if (input.source !== undefined || input.channel !== undefined) {
      values.source = input.source ?? before?.source;
      values.channel = input.channel ?? before?.channel;
    }
    // Source, channel and enquiry type must be the workspace's own choices.
    if (values.source !== undefined || values.enquiryType) {
      await validateLeadOptions(client, workspaceId, {
        ...(values.source !== undefined ? { source: values.source, channel: values.channel } : {}),
        serviceType: values.enquiryType ?? (await loadLeadOptions(client, workspaceId)).enquiryTypes[0]?.id,
      }, undefined, { requireEmirate: false });
    }
    return values;
  }

  private async freeSlug(client: PoolClient, workspaceId: string, wanted: string, id: string | null) {
    const base = slugify(wanted);
    for (let index = 1; index < 50; index += 1) {
      const slug = index === 1 ? base : `${base.slice(0, 56)}-${index}`;
      const taken = await client.query(`SELECT 1 FROM booking_types WHERE workspace_id = $1 AND slug = $2 AND ($3::uuid IS NULL OR id <> $3::uuid)`, [workspaceId, slug, id]);
      if (!taken.rowCount) return slug;
    }
    throw new BadRequestException("Choose another link name");
  }

  private async saveHosts(client: PoolClient, workspaceId: string, typeId: string, hosts: Array<{ membershipId: string; enquiryType?: string | null }>) {
    if (!Array.isArray(hosts) || hosts.length > 50) throw new UnprocessableEntityException("Choose up to 50 hosts");
    const ids = hosts.map((host) => host.membershipId);
    if (new Set(ids).size !== ids.length) throw new UnprocessableEntityException("Each person can host once");
    if (ids.length) {
      const active = await client.query(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`, [workspaceId, ids]);
      if (active.rowCount !== ids.length) throw new UnprocessableEntityException("Choose active team members as hosts");
    }
    await client.query(`DELETE FROM booking_type_hosts WHERE workspace_id = $1 AND booking_type_id = $2`, [workspaceId, typeId]);
    for (const [position, host] of hosts.entries()) {
      await client.query(`INSERT INTO booking_type_hosts (workspace_id, booking_type_id, membership_id, enquiry_type, position) VALUES ($1, $2, $3, $4, $5)`,
        [workspaceId, typeId, host.membershipId, host.enquiryType?.trim() || null, position]);
    }
  }

  /** An active type must have a host; one host for "one person". */
  private async assertBookable(client: PoolClient, workspaceId: string, id: string) {
    const type = (await loadTypeById(client, workspaceId, id))!;
    if (type.active && !type.hosts.length) throw new UnprocessableEntityException("Choose at least one host");
    if (type.active) {
      // Each booking becomes an enquiry: like a published form, it needs somewhere to be routed.
      const routed = await client.query(`SELECT 1 FROM crm_assignment_policies WHERE workspace_id = $1 AND status = 'active'
        UNION ALL SELECT 1 FROM crm_queues WHERE workspace_id = $1 AND status = 'active' AND is_fallback LIMIT 1`, [workspaceId]);
      if (!routed.rowCount) throw new UnprocessableEntityException("Set up a default sales team or routing rule before publishing");
    }
    if (type.hostsMode === "one" && type.hosts.length > 1) throw new UnprocessableEntityException("One person hosts this type. Choose round-robin for a team");
    if (type.locationKind === "video" && type.locationDetail && !/^https:\/\//.test(type.locationDetail)) throw new UnprocessableEntityException("The video link must start with https://");
    return type;
  }
}
