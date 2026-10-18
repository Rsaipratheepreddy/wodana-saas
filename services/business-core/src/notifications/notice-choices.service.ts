import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { readClock, readReminderSettings } from "../reminders/engine/context";
import { resolveRecipientZone } from "../reminders/engine/engine";
import type { HoursWindow } from "../reminders/reminders-contract";
import { validatePersonSettings } from "../reminders/settings/settings";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { isNoticeChannel, isNoticeGroup, NOTICE_CHANNELS, NOTICE_GROUP_IDS, type NoticeChannel, type NoticeGroup } from "./notice-choices";

type Db = Pick<PoolClient, "query">;

export type NoticeChoiceCell = { group: NoticeGroup; channel: NoticeChannel; enabled: boolean };
export type NoticeChoicesInput = {
  choices: NoticeChoiceCell[];
  quietHours: HoursWindow | null;
  digestEnabled: boolean;
  digestTime: string | null;
  timeZone: string | null;
  version: number;
};
export type NoticeChoicesView = Omit<NoticeChoicesInput, "choices"> & {
  /** The groups in display order, and the channels the workspace has turned on. */
  groups: readonly NoticeGroup[];
  channels: NoticeChannel[];
  /** Every group on every channel the workspace has turned on (on unless the person switched it off). */
  choices: NoticeChoiceCell[];
  firm: { quietStart: string; quietEnd: string; digestTime: string };
  effectiveTimeZone: string;
  workspaceTimeZone: string;
};

const hhmm = (value: string | null | undefined) => (value ? value.slice(0, 5) : null);
const cellKey = (cell: { group: string; channel: string }) => `${cell.group}:${cell.channel}`;

/** Checks the grid a person sends: known groups and channels, each cell once, a switch for each. */
export function validateChoices(value: unknown): NoticeChoiceCell[] {
  if (!Array.isArray(value) || value.length > NOTICE_GROUP_IDS.length * NOTICE_CHANNELS.length) throw new BadRequestException("Choose how you are told for each group.");
  const seen = new Set<string>();
  return value.map((item: unknown) => {
    const cell = (item ?? {}) as Partial<NoticeChoiceCell>;
    if (!isNoticeGroup(cell.group) || !isNoticeChannel(cell.channel) || typeof cell.enabled !== "boolean") throw new BadRequestException("Choose how you are told for each group.");
    if (seen.has(cellKey(cell as NoticeChoiceCell))) throw new BadRequestException("Each group and channel is chosen once.");
    seen.add(cellKey(cell as NoticeChoiceCell));
    return { group: cell.group, channel: cell.channel, enabled: cell.enabled };
  });
}

/**
 * Settings › Notifications (the person's own): for each group, which channels they are told on; quiet hours, the daily
 * digest and the zone they are in. One command saves it all, checked against the person's settings version, audited;
 * saving the same values changes nothing. Delivery reads the same rows through notice-choices.ts.
 */
@Injectable()
export class NoticeChoicesService {
  constructor(private readonly access: WorkspaceAccessService) {}

  private async membership(client: Db, workspaceId: string, userId: string) {
    const membership = (await client.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, userId])).rows[0];
    if (!membership) throw new NotFoundException("Workspace membership not found");
    return membership.id;
  }

  async read(client: Db, workspaceId: string, userId: string): Promise<NoticeChoicesView> {
    const membershipId = await this.membership(client, workspaceId, userId);
    // One query at a time: a transaction's client runs one statement at once.
    const person = (await client.query<{ digestEnabled: boolean; digestTime: string | null; quietStart: string | null; quietEnd: string | null; timeZone: string | null; version: number }>(
      `SELECT digest_enabled AS "digestEnabled", digest_time::text AS "digestTime", quiet_start::text AS "quietStart", quiet_end::text AS "quietEnd", time_zone AS "timeZone", version
         FROM notification_person_settings WHERE workspace_id = $1 AND membership_id = $2`, [workspaceId, membershipId])).rows[0];
    const saved = (await client.query<{ group: string; channel: string; enabled: boolean }>(
      `SELECT notice_group AS "group", channel, enabled FROM notification_channel_choices WHERE workspace_id = $1 AND membership_id = $2`, [workspaceId, membershipId])).rows;
    const facts = (await client.query<{ push: boolean; whatsapp: boolean; device: string | null; preferred: string | null }>(
      `SELECT EXISTS (SELECT 1 FROM device_endpoints WHERE workspace_id = $1 AND status = 'active') AS push,
              EXISTS (SELECT 1 FROM integration_connections WHERE workspace_id = $1 AND provider = 'whatsapp' AND status = 'connected') AS whatsapp,
              (SELECT timezone FROM device_endpoints WHERE workspace_id = $1 AND user_id = $2 AND status = 'active' ORDER BY last_seen_at DESC NULLS LAST LIMIT 1) AS device,
              (SELECT preferred_timezone FROM users WHERE id = $2) AS preferred`, [workspaceId, userId])).rows[0];
    const firm = await readReminderSettings(client, workspaceId);
    const clock = await readClock(client, workspaceId, new Date());
    const channels = NOTICE_CHANNELS.filter((channel) => channel === "in_app" || channel === "email" || (channel === "push" ? facts?.push : facts?.whatsapp) === true);
    const stored = new Map(saved.map((row) => [cellKey(row), row.enabled]));
    return {
      groups: NOTICE_GROUP_IDS, channels,
      choices: NOTICE_GROUP_IDS.flatMap((group) => channels.map((channel) => ({ group, channel, enabled: stored.get(cellKey({ group, channel })) ?? true }))),
      quietHours: person?.quietStart && person?.quietEnd ? { start: hhmm(person.quietStart)!, end: hhmm(person.quietEnd)! } : null,
      digestEnabled: person?.digestEnabled ?? true, digestTime: hhmm(person?.digestTime), timeZone: person?.timeZone ?? null, version: Number(person?.version ?? 0),
      firm: { quietStart: firm.quietStart, quietEnd: firm.quietEnd, digestTime: firm.digestTime },
      effectiveTimeZone: resolveRecipientZone(person?.timeZone, facts?.device, facts?.preferred, clock.timeZone), workspaceTimeZone: clock.timeZone,
    };
  }

  mine(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, (client, user) => this.read(client, workspaceId, user.userId));
  }

  saveMine(actor: RequestActor, workspaceId: string, input: NoticeChoicesInput) {
    return this.access.asMember(actor, workspaceId, (client, user) => this.save(client, workspaceId, user.userId, input));
  }

  async save(client: Db, workspaceId: string, userId: string, input: NoticeChoicesInput): Promise<NoticeChoicesView> {
    if (!Number.isInteger(input?.version) || input.version < 0) throw new BadRequestException("A version is needed.");
    const choices = validateChoices(input.choices);
    const next = validatePersonSettings({ digestEnabled: input.digestEnabled, digestTime: input.digestTime, quietHours: input.quietHours, timeZone: input.timeZone, version: input.version });
    const current = await this.read(client, workspaceId, userId);
    const before = new Map(current.choices.map((cell) => [cellKey(cell), cell.enabled]));
    const changed = choices.filter((cell) => (before.get(cellKey(cell)) ?? true) !== cell.enabled);
    const values = { digestEnabled: current.digestEnabled, digestTime: current.digestTime, quietHours: current.quietHours, timeZone: current.timeZone };
    // The same values again (a retried save) change nothing.
    if (!changed.length && JSON.stringify(values) === JSON.stringify(next)) return current;
    if (current.version !== input.version) throw new ConflictException("Your notification settings changed. Reload them and try again.");
    const membershipId = await this.membership(client, workspaceId, userId);
    const params = [workspaceId, membershipId, next.digestEnabled, next.digestTime, next.quietHours?.start ?? null, next.quietHours?.end ?? null, next.timeZone];
    // The person's settings row carries the one version for both tables.
    const saved = current.version === 0
      ? await client.query(
        `INSERT INTO notification_person_settings (workspace_id, membership_id, digest_enabled, digest_time, quiet_start, quiet_end, time_zone)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (workspace_id, membership_id) DO NOTHING`, params)
      : await client.query(
        `UPDATE notification_person_settings SET digest_enabled = $3, digest_time = $4, quiet_start = $5, quiet_end = $6, time_zone = $7, updated_at = now(), version = version + 1
          WHERE workspace_id = $1 AND membership_id = $2 AND version = $8`, [...params, current.version]);
    if (!saved.rowCount) throw new ConflictException("Your notification settings changed. Reload them and try again.");
    for (const cell of changed) {
      await client.query(
        `INSERT INTO notification_channel_choices (workspace_id, membership_id, notice_group, channel, enabled, updated_by) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (workspace_id, membership_id, notice_group, channel) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [workspaceId, membershipId, cell.group, cell.channel, cell.enabled, userId]);
    }
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "notifications.choices_changed.v1", entityType: "workspace_membership", entityId: membershipId,
      before: { ...values, choices: changed.map((cell) => ({ ...cell, enabled: !cell.enabled })) }, after: { ...next, choices: changed } });
    return this.read(client, workspaceId, userId);
  }
}
