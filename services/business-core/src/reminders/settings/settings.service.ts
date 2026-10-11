import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../../auth/actor";
import { recordAudit } from "../../audit/record-audit";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { readClock, readReminderSettings, readRules } from "../engine/context";
import { effectiveRule, resolveRecipientZone } from "../engine/engine";
import { CRITICAL_REMINDER_EVENT_TYPES, ENGINE_REMINDER_KINDS, REMINDER_PERMISSIONS, REMINDER_SETTINGS_DEFAULTS, type EngineReminderKind } from "../reminders-contract";
import {
  isEngineKind, ruleDto, validatePersonSettings, validateRule, validateSettings,
  type NotificationPersonSettingsDto, type ReminderRuleDto, type ReminderRuleInput, type ReminderSettingsDto,
} from "./settings";

type Db = Pick<PoolClient, "query">;
export type ReminderSettingsResponse = { settings: ReminderSettingsDto; rules: ReminderRuleDto[] };
export type NotificationPersonSettingsView = NotificationPersonSettingsDto & {
  firm: { quietStart: string; quietEnd: string; digestTime: string }; effectiveTimeZone: string; workspaceTimeZone: string; criticalEventTypes: string[];
};

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/**
 * Settings › Reminders (reminders.manage): the firm's quiet hours, digest time and client window, and one rule per
 * kind (on/off, cadence, working days, escalation, channels, digest). Settings › Notifications: each person's digest,
 * quiet hours and time zone. Every change is version-checked and audited; saving the same values changes nothing.
 * A rule back to its default (DELETE) removes the firm's row.
 */
@Injectable()
export class ReminderSettingsService {
  constructor(private readonly access: WorkspaceAccessService) {}

  private async read(client: Db, workspaceId: string): Promise<ReminderSettingsResponse> {
    // One query at a time: a transaction's client runs one statement at once.
    const settings = await readReminderSettings(client, workspaceId);
    const rules = await readRules(client, workspaceId);
    return { settings, rules: ENGINE_REMINDER_KINDS.map((kind) => ruleDto(rules.get(kind)!)) };
  }

  settings(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, REMINDER_PERMISSIONS.manage, (client) => this.read(client, workspaceId));
  }

  saveSettings(actor: RequestActor, workspaceId: string, input: ReminderSettingsDto) {
    return this.access.withPermission(actor, workspaceId, REMINDER_PERMISSIONS.manage, async (client, user) => {
      const next = validateSettings(input);
      const current = await readReminderSettings(client, workspaceId);
      const { version: _version, ...currentValues } = current;
      if (same(currentValues, next)) return this.read(client, workspaceId);
      if (current.version !== input.version) throw new ConflictException("The reminder settings changed. Reload them and try again.");
      const saved = current.version === 0
        ? await client.query(
          `INSERT INTO reminder_settings (workspace_id, quiet_start, quiet_end, digest_time, client_window_start, client_window_end, critical_breaks_quiet, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (workspace_id) DO NOTHING`,
          [workspaceId, next.quietStart, next.quietEnd, next.digestTime, next.clientWindow?.start ?? null, next.clientWindow?.end ?? null, next.criticalBreaksQuiet, user.userId])
        : await client.query(
          `UPDATE reminder_settings SET quiet_start = $2, quiet_end = $3, digest_time = $4, client_window_start = $5, client_window_end = $6, critical_breaks_quiet = $7,
                  updated_by = $8, updated_at = now(), version = version + 1
            WHERE workspace_id = $1 AND version = $9`,
          [workspaceId, next.quietStart, next.quietEnd, next.digestTime, next.clientWindow?.start ?? null, next.clientWindow?.end ?? null, next.criticalBreaksQuiet, user.userId, current.version]);
      if (!saved.rowCount) throw new ConflictException("The reminder settings changed. Reload them and try again.");
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "reminders.settings_changed.v1", entityType: "workspace", entityId: workspaceId,
        before: currentValues, after: next });
      return this.read(client, workspaceId);
    });
  }

  saveRule(actor: RequestActor, workspaceId: string, kind: string, input: ReminderRuleInput) {
    return this.access.withPermission(actor, workspaceId, REMINDER_PERMISSIONS.manage, async (client, user) => {
      if (!isEngineKind(kind)) throw new NotFoundException("Unknown reminder.");
      const next = validateRule(kind, input);
      const current = (await readRules(client, workspaceId)).get(kind)!;
      const { version: currentVersion, kind: _kind, ...currentValues } = current;
      if (same(currentValues, next)) return ruleDto(current);
      if (currentVersion !== input.version) throw new ConflictException("This reminder changed. Reload it and try again.");
      const saved = currentVersion === 0
        ? await client.query(
          `INSERT INTO reminder_rules (workspace_id, kind, enabled, offsets, unit, working_days, escalate_after, chain, channels, digest, quiet_hours, updated_by)
           VALUES ($1, $2, $3, $4::integer[], $5, $6, $7, $8::text[], $9::text[], $10, $11::jsonb, $12) ON CONFLICT (workspace_id, kind) DO NOTHING`,
          [workspaceId, kind, next.enabled, next.offsets, next.unit, next.workingDays, next.escalateAfter, next.chain, next.channels, next.digest,
            next.quietHours ? JSON.stringify(next.quietHours) : null, user.userId])
        : await client.query(
          `UPDATE reminder_rules SET enabled = $3, offsets = $4::integer[], unit = $5, working_days = $6, escalate_after = $7, chain = $8::text[], channels = $9::text[],
                  digest = $10, quiet_hours = $11::jsonb, updated_by = $12, updated_at = now(), version = version + 1
            WHERE workspace_id = $1 AND kind = $2 AND version = $13`,
          [workspaceId, kind, next.enabled, next.offsets, next.unit, next.workingDays, next.escalateAfter, next.chain, next.channels, next.digest,
            next.quietHours ? JSON.stringify(next.quietHours) : null, user.userId, currentVersion]);
      if (!saved.rowCount) throw new ConflictException("This reminder changed. Reload it and try again.");
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "reminders.rule_changed.v1", entityType: "workspace", entityId: workspaceId,
        before: { kind, ...currentValues, isDefault: currentVersion === 0 }, after: { kind, ...next } });
      return ruleDto((await readRules(client, workspaceId)).get(kind)!);
    });
  }

  resetRule(actor: RequestActor, workspaceId: string, kind: string, version: number) {
    return this.access.withPermission(actor, workspaceId, REMINDER_PERMISSIONS.manage, async (client, user) => {
      if (!isEngineKind(kind)) throw new NotFoundException("Unknown reminder.");
      const current = (await readRules(client, workspaceId)).get(kind)!;
      if (current.version === 0) return ruleDto(current);
      if (!Number.isInteger(version) || current.version !== version) throw new ConflictException("This reminder changed. Reload it and try again.");
      await client.query(`DELETE FROM reminder_rules WHERE workspace_id = $1 AND kind = $2 AND version = $3`, [workspaceId, kind, version]);
      const { version: _version, kind: _kind, ...before } = current;
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "reminders.rule_reset.v1", entityType: "workspace", entityId: workspaceId, before: { kind, ...before }, after: { kind, isDefault: true } });
      return ruleDto(effectiveRule(kind as EngineReminderKind, null));
    });
  }

  private async personView(client: Db, workspaceId: string, userId: string): Promise<NotificationPersonSettingsView> {
    const membership = (await client.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, userId])).rows[0];
    if (!membership) throw new NotFoundException("Workspace membership not found");
    const row = (await client.query<{ digestEnabled: boolean; digestTime: string | null; quietStart: string | null; quietEnd: string | null; timeZone: string | null; version: number }>(
      `SELECT digest_enabled AS "digestEnabled", digest_time::text AS "digestTime", quiet_start::text AS "quietStart", quiet_end::text AS "quietEnd", time_zone AS "timeZone", version
         FROM notification_person_settings WHERE workspace_id = $1 AND membership_id = $2`, [workspaceId, membership.id])).rows[0];
    const firm = await readReminderSettings(client, workspaceId);
    const clock = await readClock(client, workspaceId, new Date());
    const device = (await client.query<{ zone: string | null }>(
      `SELECT timezone AS zone FROM device_endpoints WHERE workspace_id = $1 AND user_id = $2 AND status = 'active' ORDER BY last_seen_at DESC NULLS LAST LIMIT 1`, [workspaceId, userId])).rows[0]?.zone;
    const preferred = (await client.query<{ zone: string | null }>(`SELECT preferred_timezone AS zone FROM users WHERE id = $1`, [userId])).rows[0]?.zone;
    const hhmm = (value: string | null | undefined) => (value ? value.slice(0, 5) : null);
    return {
      digestEnabled: row?.digestEnabled ?? true, digestTime: hhmm(row?.digestTime), timeZone: row?.timeZone ?? null,
      quietHours: row?.quietStart && row?.quietEnd ? { start: hhmm(row.quietStart)!, end: hhmm(row.quietEnd)! } : null, version: Number(row?.version ?? 0),
      firm: { quietStart: firm.quietStart, quietEnd: firm.quietEnd, digestTime: firm.digestTime },
      effectiveTimeZone: resolveRecipientZone(row?.timeZone, device, preferred, clock.timeZone), workspaceTimeZone: clock.timeZone,
      criticalEventTypes: [...CRITICAL_REMINDER_EVENT_TYPES],
    };
  }

  personSettings(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, (client, user) => this.personView(client, workspaceId, user.userId));
  }

  savePersonSettings(actor: RequestActor, workspaceId: string, input: NotificationPersonSettingsDto) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const next = validatePersonSettings(input);
      const current = await this.personView(client, workspaceId, user.userId);
      const values = { digestEnabled: current.digestEnabled, digestTime: current.digestTime, quietHours: current.quietHours, timeZone: current.timeZone };
      if (same(values, next)) return current;
      if (current.version !== input.version) throw new ConflictException("Your notification settings changed. Reload them and try again.");
      const membership = (await client.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, user.userId])).rows[0];
      const params = [workspaceId, membership.id, next.digestEnabled, next.digestTime, next.quietHours?.start ?? null, next.quietHours?.end ?? null, next.timeZone];
      const saved = current.version === 0
        ? await client.query(
          `INSERT INTO notification_person_settings (workspace_id, membership_id, digest_enabled, digest_time, quiet_start, quiet_end, time_zone)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (workspace_id, membership_id) DO NOTHING`, params)
        : await client.query(
          `UPDATE notification_person_settings SET digest_enabled = $3, digest_time = $4, quiet_start = $5, quiet_end = $6, time_zone = $7, updated_at = now(), version = version + 1
            WHERE workspace_id = $1 AND membership_id = $2 AND version = $8`, [...params, current.version]);
      if (!saved.rowCount) throw new ConflictException("Your notification settings changed. Reload them and try again.");
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "reminders.person_settings_changed.v1", entityType: "workspace_membership", entityId: membership.id,
        before: values, after: next });
      return this.personView(client, workspaceId, user.userId);
    });
  }
}

export const parseVersion = (value: unknown) => {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0) throw new BadRequestException("A version is needed.");
  return version;
};

export const REMINDER_DEFAULT_SETTINGS = REMINDER_SETTINGS_DEFAULTS;
