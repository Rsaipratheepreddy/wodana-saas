import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../../auth/actor";
import { recordAudit } from "../../audit/record-audit";
import { addDays, zonedInstant } from "../../booking/booking.domain";
import { DatabaseService } from "../../database/database.service";
import { workdays } from "../../project-core/work-calendar";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { readClock, readReminderSettings } from "../engine/context";
import { localDate, type ReminderSourceRegistry } from "../engine/engine";
import { closeSubjects, doneKeys } from "../engine/scan";
import { subjectRef, type SubjectRow } from "../engine/subjects";
import { readStaffPeople } from "../delivery/people";
import { MAX_SNOOZE_DAYS, REMINDER_KIND_INFO, REMINDER_PERMISSIONS, type ReminderKind } from "../reminders-contract";
import { ReminderSourceRegistryService } from "../sources/registry.service";
import {
  actionsFor, myDayPermissionCodes, readMyDay, readVisibleSubjects, toItem, urgencyOf,
  type MyDayFilter, type MyDayItem, type MyDayResponse, type MyDayViewer,
} from "./my-day";

type Db = Pick<PoolClient, "query">;
type ActorUser = { userId: string };

/** The timeline of a record (GET /reminders/subjects?sourceKey=). Structural copy of ReminderSubjectDto. */
export type SubjectTimeline = {
  id: string; kind: ReminderKind; sourceKey: string; title: string; context: string; href: string; dueAt: string | null; dueRevision: number; status: string;
  critical: boolean; remindersSent: number; escalationLevel: number; doneAt: string | null; doneReason: string | null; version: number;
  steps: Array<{ id: string; dueRevision: number; stepKey: string; kind: string; level: number; fireAt: string; state: string; skipReason: string | null;
    holdReason: string | null; heldUntil: string | null; firedAt: string | null; recipients: Array<{ membershipId: string; name: string }> }>;
};

const iso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null);

/**
 * My day (plan §6.24a): the person's one list of what is due, from the engine's subjects. Reading it re-checks the
 * done predicate first (only when no sweep holds the workspace), so nothing finished is shown. Snooze, complete and
 * reassign are version-checked and audited; complete and reassign run the module's own command.
 */
@Injectable()
export class MyDayService {
  constructor(private readonly db: DatabaseService, private readonly access: WorkspaceAccessService, private readonly sources: ReminderSourceRegistryService) {}

  private registry(): ReminderSourceRegistry {
    return this.sources.registry();
  }

  /** Who is asking: their membership, the permissions My day asks about, and their zone. */
  private async viewer(client: PoolClient, workspaceId: string, user: ActorUser): Promise<MyDayViewer> {
    const membership = (await client.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`,
      [workspaceId, user.userId])).rows[0];
    if (!membership) throw new NotFoundException("Workspace membership not found");
    const permissions = await this.access.grantedPermissions(client, workspaceId, user.userId, myDayPermissionCodes(this.registry()));
    const clock = await readClock(client, workspaceId, new Date());
    const person = (await readStaffPeople(client, workspaceId, [membership.id], await readReminderSettings(client, workspaceId), clock.timeZone)).get(membership.id);
    return { workspaceId, membershipId: membership.id, userId: user.userId, permissions, timeZone: person?.timeZone ?? clock.timeZone };
  }

  /** Closes what the sources say is done, among these subjects, unless a sweep is running (it does the same). */
  private async recheck(client: Db, workspaceId: string, subjects: readonly Pick<SubjectRow, "kind" | "sourceKey">[], now: Date) {
    if (!subjects.length) return 0;
    const locked = (await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_xact_lock(hashtextextended('reminders_sweep:' || $1::text, 0)) AS locked`, [workspaceId])).rows[0].locked;
    if (!locked) return 0;
    const today = localDate(now, (await readClock(client, workspaceId, now)).timeZone);
    let closed = 0;
    for (const kind of new Set(subjects.map((subject) => subject.kind))) {
      const source = this.registry().get(kind);
      if (!source) continue;
      const keys = [...new Set(subjects.filter((subject) => subject.kind === kind).map((subject) => subject.sourceKey))];
      closed += await closeSubjects(client, workspaceId, kind, await doneKeys(client, workspaceId, source, keys, { now, today }), now);
    }
    return closed;
  }

  myDay(actor: RequestActor, workspaceId: string, filter: MyDayFilter): Promise<MyDayResponse> {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const viewer = await this.viewer(client, workspaceId, user);
      if (filter.scope === "team" && !viewer.permissions.has(REMINDER_PERMISSIONS.team)) throw new ForbiddenException(`Permissions required: ${REMINDER_PERMISSIONS.team}`);
      const now = new Date();
      await this.recheck(client, workspaceId, await readVisibleSubjects(client, viewer, this.registry(), filter.scope ?? "me"), now);
      return readMyDay(client, viewer, this.registry(), filter, now);
    });
  }

  /** One subject the person sees, with the actions they may take on it. */
  private async load(client: PoolClient, workspaceId: string, viewer: MyDayViewer, subjectId: string) {
    const scope = viewer.permissions.has(REMINDER_PERMISSIONS.team) ? "team" : "me";
    const row = (await readVisibleSubjects(client, viewer, this.registry(), scope, { ids: [subjectId] }))[0]
      ?? (scope === "team" ? (await readVisibleSubjects(client, viewer, this.registry(), "me", { ids: [subjectId] }))[0] : undefined);
    if (!row) throw new NotFoundException("This item isn't on your list any more.");
    return row;
  }

  private item(row: Awaited<ReturnType<MyDayService["load"]>>, viewer: MyDayViewer, now: Date): MyDayItem | null {
    const urgency = urgencyOf(row, now, viewer.timeZone);
    return urgency ? toItem(row, urgency, viewer, this.registry()) : null;
  }

  private assertVersion(row: { version: number }, version: number) {
    if (!Number.isInteger(version) || row.version !== version) throw new ConflictException("Someone else changed this item. Reload to see it as it is now.");
  }

  /**
   * Snoozes an item until a moment with a reason (required): at most 14 days; a critical item only to the end of the
   * next working day, and its escalation clock keeps running. The same snooze again changes nothing.
   */
  snooze(actor: RequestActor, workspaceId: string, subjectId: string, input: { until: string; reason: string; version: number }) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const viewer = await this.viewer(client, workspaceId, user);
      const row = await this.load(client, workspaceId, viewer, subjectId);
      if (!actionsFor(row, viewer, this.registry()).actions.includes("snooze")) throw new ForbiddenException("You can't snooze someone else's item.");
      const reason = String(input.reason ?? "").trim();
      if (!reason) throw new BadRequestException("Say why you're snoozing it.");
      if (reason.length > 300) throw new BadRequestException("Keep the reason under 300 characters.");
      const until = new Date(input.until);
      const now = new Date();
      if (Number.isNaN(until.getTime())) throw new BadRequestException("Choose when it should come back.");
      if (until.getTime() <= now.getTime()) throw new BadRequestException("Choose a time after now.");
      if (until.getTime() > now.getTime() + MAX_SNOOZE_DAYS * 86_400_000) throw new UnprocessableEntityException(`An item can be snoozed for up to ${MAX_SNOOZE_DAYS} days.`);
      if (row.critical) {
        const clock = await readClock(client, workspaceId, now);
        const isWorking = workdays({ workingDays: clock.workingDays, holidays: clock.holidays }).isWorking;
        let day = addDays(clock.today, 1);
        for (let guard = 0; guard < 30 && !isWorking(day); guard++) day = addDays(day, 1);
        const [hour, minute] = clock.end.split(":").map(Number);
        const latest = zonedInstant(day, (hour || 0) * 60 + (minute || 0), clock.timeZone, "compatible") ?? now.getTime() + 2 * 86_400_000;
        if (until.getTime() > latest) throw new UnprocessableEntityException("A critical item can only be snoozed to the next working day.");
      }
      if (row.status === "snoozed" && row.snoozedUntil?.getTime() === until.getTime() && row.snoozeReason === reason) return { item: this.item(row, viewer, now) };
      this.assertVersion(row, input.version);
      const updated = await client.query(
        `UPDATE reminder_subjects SET status = 'snoozed', snoozed_until = $4, snooze_reason = $5, snoozed_by = $6, version = version + 1, updated_at = now()
          WHERE workspace_id = $1 AND id = $2 AND version = $3 AND status IN ('open', 'snoozed')`, [workspaceId, subjectId, input.version, until, reason, user.userId]);
      if (!updated.rowCount) throw new ConflictException("Someone else changed this item. Reload to see it as it is now.");
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "reminders.subject_snoozed.v1", entityType: "reminder_subject", entityId: subjectId,
        before: { status: row.status, snoozedUntil: iso(row.snoozedUntil) }, after: { status: "snoozed", snoozedUntil: until.toISOString(), reason } });
      return { item: this.item(await this.load(client, workspaceId, viewer, subjectId), viewer, now) };
    });
  }

  /** Brings a snoozed item back now (Undo). */
  unsnooze(actor: RequestActor, workspaceId: string, subjectId: string, input: { version: number }) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const viewer = await this.viewer(client, workspaceId, user);
      const row = await this.load(client, workspaceId, viewer, subjectId);
      if (!actionsFor(row, viewer, this.registry()).actions.includes("snooze")) throw new ForbiddenException("You can't change someone else's item.");
      const now = new Date();
      if (row.status !== "snoozed") return { item: this.item(row, viewer, now) };
      this.assertVersion(row, input.version);
      await client.query(`UPDATE reminder_subjects SET status = 'open', snoozed_until = NULL, snooze_reason = NULL, snoozed_by = NULL, version = version + 1, updated_at = now()
                           WHERE workspace_id = $1 AND id = $2 AND version = $3`, [workspaceId, subjectId, input.version]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "reminders.subject_unsnoozed.v1", entityType: "reminder_subject", entityId: subjectId,
        before: { status: "snoozed", snoozedUntil: iso(row.snoozedUntil) }, after: { status: "open" } });
      return { item: this.item(await this.load(client, workspaceId, viewer, subjectId), viewer, now) };
    });
  }

  /** "Mark done": runs the module's own command, then the done predicate decides whether the item closed. */
  async complete(actor: RequestActor, workspaceId: string, subjectId: string, input: { version: number }) {
    const prepared = await this.access.asMember(actor, workspaceId, async (client, user) => {
      const viewer = await this.viewer(client, workspaceId, user);
      const row = await this.load(client, workspaceId, viewer, subjectId);
      if (!actionsFor(row, viewer, this.registry()).actions.includes("complete")) throw new ForbiddenException("This item can't be marked done here. Open it instead.");
      this.assertVersion(row, input.version);
      return { row, viewer };
    });
    const source = this.registry().get(prepared.row.kind)!;
    await source.complete!.run({ workspaceId, subject: subjectRef(prepared.row), actor: { userId: prepared.viewer.userId, membershipId: prepared.viewer.membershipId, request: actor } });
    return this.access.asMember(actor, workspaceId, async (client) => {
      const now = new Date();
      await this.recheck(client, workspaceId, [prepared.row], now);
      const row = (await readVisibleSubjects(client, prepared.viewer, this.registry(), "team", { ids: [subjectId] }))[0]
        ?? (await readVisibleSubjects(client, prepared.viewer, this.registry(), "me", { ids: [subjectId] }))[0];
      return { item: row ? this.item(row, prepared.viewer, now) : null };
    });
  }

  /** People an item can go to: active members who may see its kind. */
  assignees(actor: RequestActor, workspaceId: string, subjectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const viewer = await this.viewer(client, workspaceId, user);
      const row = await this.load(client, workspaceId, viewer, subjectId);
      const source = this.registry().get(row.kind);
      return (await client.query<{ membershipId: string; name: string }>(
        `SELECT DISTINCT membership.id AS "membershipId", coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS name
           FROM workspace_memberships membership JOIN users account ON account.id = membership.user_id
           JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
           JOIN role_permissions granted ON granted.role_id = assigned.role_id
           JOIN permissions permission ON permission.id = granted.permission_id
          WHERE membership.workspace_id = $1 AND membership.status = 'active' AND permission.code = ANY($2::text[])
          ORDER BY name, membership.id`, [workspaceId, [source?.viewPermission, source?.reassign?.permission].filter(Boolean)])).rows;
    });
  }

  /** "Reassign": the module's own command moves the record; the item follows it now. */
  async reassign(actor: RequestActor, workspaceId: string, subjectId: string, input: { membershipId: string; version: number }) {
    const prepared = await this.access.asMember(actor, workspaceId, async (client, user) => {
      const viewer = await this.viewer(client, workspaceId, user);
      const row = await this.load(client, workspaceId, viewer, subjectId);
      if (!actionsFor(row, viewer, this.registry()).actions.includes("reassign")) throw new ForbiddenException("You can't reassign this item.");
      this.assertVersion(row, input.version);
      const target = (await client.query(`SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, input.membershipId])).rowCount;
      if (!target) throw new UnprocessableEntityException("Choose someone in the workspace.");
      return { row, viewer };
    });
    if (prepared.row.ownerMembershipId === input.membershipId) return this.access.asMember(actor, workspaceId, async () => ({ item: this.item(prepared.row, prepared.viewer, new Date()) }));
    const source = this.registry().get(prepared.row.kind)!;
    await source.reassign!.run({ workspaceId, subject: subjectRef(prepared.row), toMembershipId: input.membershipId,
      actor: { userId: prepared.viewer.userId, membershipId: prepared.viewer.membershipId, request: actor } });
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await client.query(`UPDATE reminder_subjects SET owner_membership_id = $3, cc_membership_ids = array_remove(cc_membership_ids, $3::uuid), version = version + 1, updated_at = now()
                           WHERE workspace_id = $1 AND id = $2 AND status IN ('open', 'snoozed')`, [workspaceId, subjectId, input.membershipId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "reminders.subject_reassigned.v1", entityType: "reminder_subject", entityId: subjectId,
        before: { ownerMembershipId: prepared.row.ownerMembershipId }, after: { ownerMembershipId: input.membershipId } });
      const now = new Date();
      const row = (await readVisibleSubjects(client, prepared.viewer, this.registry(), "team", { ids: [subjectId] }))[0]
        ?? (await readVisibleSubjects(client, prepared.viewer, this.registry(), "me", { ids: [subjectId] }))[0];
      return { item: row ? this.item(row, prepared.viewer, now) : null };
    });
  }

  /** The reminders of one record (its timeline): every subject with this source key the person may see, with its steps. */
  subjects(actor: RequestActor, workspaceId: string, sourceKey: string): Promise<SubjectTimeline[]> {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      if (!sourceKey || sourceKey.length > 200) throw new BadRequestException("A record is needed.");
      const viewer = await this.viewer(client, workspaceId, user);
      const viewable = [...this.registry().values()].filter((source) => viewer.permissions.has(source.viewPermission)).map((source) => source.kind);
      const subjects = (await client.query<{ id: string; kind: ReminderKind; sourceKey: string; title: string; context: string; href: string; dueAt: Date | null; dueRevision: number;
        status: string; critical: boolean; remindersSent: number; escalationLevel: number; doneAt: Date | null; doneReason: string | null; version: number }>(
        `SELECT id, kind, source_key AS "sourceKey", title, context, href, due_at AS "dueAt", due_revision AS "dueRevision", status, critical,
                reminders_sent AS "remindersSent", escalation_level AS "escalationLevel", done_at AS "doneAt", done_reason AS "doneReason", version
           FROM reminder_subjects WHERE workspace_id = $1 AND source_key = $2
            AND (kind = ANY($3::text[]) OR owner_membership_id = $4 OR $4 = ANY(cc_membership_ids))
          ORDER BY created_at, id`, [workspaceId, sourceKey, viewable, viewer.membershipId])).rows;
      if (!subjects.length) return [];
      const steps = (await client.query<{ id: string; subjectId: string; dueRevision: number; stepKey: string; kind: string; level: number; fireAt: Date; state: string;
        skipReason: string | null; holdReason: string | null; heldUntil: Date | null; firedAt: Date | null; recipients: string[] }>(
        `SELECT id, subject_id AS "subjectId", due_revision AS "dueRevision", step_key AS "stepKey", kind, level, fire_at AS "fireAt", state, skip_reason AS "skipReason",
                hold_reason AS "holdReason", held_until AS "heldUntil", fired_at AS "firedAt", recipient_membership_ids AS recipients
           FROM reminder_steps WHERE workspace_id = $1 AND subject_id = ANY($2::uuid[]) ORDER BY fire_at, id`, [workspaceId, subjects.map((subject) => subject.id)])).rows;
      const people = new Map((await client.query<{ id: string; name: string }>(
        `SELECT membership.id, coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS name FROM workspace_memberships membership
           JOIN users account ON account.id = membership.user_id WHERE membership.workspace_id = $1 AND membership.id = ANY($2::uuid[])`,
        [workspaceId, [...new Set(steps.flatMap((step) => step.recipients))]])).rows.map((row) => [row.id, row.name]));
      return subjects.map((subject) => ({
        id: subject.id, kind: subject.kind, sourceKey: subject.sourceKey, title: subject.title, context: subject.context, href: subject.href, dueAt: iso(subject.dueAt),
        dueRevision: Number(subject.dueRevision), status: subject.status, critical: subject.critical, remindersSent: Number(subject.remindersSent),
        escalationLevel: Number(subject.escalationLevel), doneAt: iso(subject.doneAt), doneReason: subject.doneReason, version: Number(subject.version),
        steps: steps.filter((step) => step.subjectId === subject.id).map((step) => ({
          id: step.id, dueRevision: Number(step.dueRevision), stepKey: step.stepKey, kind: step.kind, level: Number(step.level), fireAt: iso(step.fireAt)!, state: step.state,
          skipReason: step.skipReason, holdReason: step.holdReason, heldUntil: iso(step.heldUntil), firedAt: iso(step.firedAt),
          recipients: step.recipients.map((membershipId) => ({ membershipId, name: people.get(membershipId) ?? "" })),
        })),
      }));
    });
  }
}

export const kindModule = (kind: ReminderKind) => REMINDER_KIND_INFO[kind].module;
