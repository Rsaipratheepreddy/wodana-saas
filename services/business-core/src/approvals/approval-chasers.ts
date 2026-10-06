import type { PoolClient } from "pg";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { waitingFor, type ApprovalContext, type ApprovalRow } from "./approval-sources";
import { escalateWaitingApprovals } from "./approval-engine";

type Db = Pick<PoolClient, "query">;

export const APPROVAL_REMINDER_EVENT = "approvals.reminder";
export const DEFAULT_CHASE = { remindAfterHours: 24, escalateAfterHours: 48 };
const HOUR = 3_600_000;
/** At most this many reminders to one person in one run: the rest wait for the next, and the list shows them all. */
const PER_PERSON = 10;

export type ChaseSettings = { enabled: boolean; remindAfterHours: number; escalateAfterHours: number; email: boolean };

/** Hours between 1 and a month; escalation never before the reminder. */
export function chaseSettings(policy: { status: string; conditions: unknown; channels: unknown } | undefined): ChaseSettings {
  const conditions = policy?.conditions && typeof policy.conditions === "object" ? policy.conditions as Record<string, unknown> : {};
  const hours = (value: unknown, fallback: number) => { const n = Number(value); return Number.isInteger(n) && n >= 1 && n <= 720 ? n : fallback; };
  const remindAfterHours = hours(conditions.remindAfterHours, DEFAULT_CHASE.remindAfterHours);
  const escalateAfterHours = Math.max(remindAfterHours, hours(conditions.escalateAfterHours, DEFAULT_CHASE.escalateAfterHours));
  return { enabled: policy ? policy.status === "active" : true, remindAfterHours, escalateAfterHours,
    email: Array.isArray(policy?.channels) && (policy!.channels as unknown[]).includes("email") };
}

const waited = (row: ApprovalRow, now: number) => Math.floor((now - Date.parse(row.since)) / HOUR);

/**
 * Approvals that wait get chased (AU-3), in the daily run. Each item in "Waiting for you" that someone may decide
 * and has waited past the reminder hours (24 by default) reminds that person, once; past the escalation hours
 * (48 by default) the workspace's owners hear it, once per item. Workspace setting: Settings → Reminders →
 * Approval reminders (on by default; hours, and email as well as the app).
 */
export async function chaseApprovals(db: Db, workspaceId: string, now = Date.now()) {
  const policy = (await db.query<{ status: string; conditions: unknown; channels: unknown }>(
    `SELECT status, conditions, channels FROM notification_policies WHERE workspace_id = $1 AND event_type = $2 ORDER BY updated_at DESC LIMIT 1`,
    [workspaceId, APPROVAL_REMINDER_EVENT])).rows[0];
  const settings = chaseSettings(policy);
  // E3-1: a step that waited past its policy's escalation hours passes to the next approver (the Owner past the last).
  await escalateWaitingApprovals(db, workspaceId, new Date(now));
  if (!settings.enabled) return { reminded: 0, escalated: 0 };
  const people = (await db.query<{ membershipId: string; userId: string; name: string; permissions: string[] }>(
    `SELECT membership.id AS "membershipId", membership.user_id AS "userId", coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS name,
            coalesce(array_agg(DISTINCT permission.code) FILTER (WHERE permission.code IS NOT NULL), '{}') AS permissions
       FROM workspace_memberships membership
       JOIN users account ON account.id = membership.user_id
       LEFT JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
       LEFT JOIN role_permissions granted ON granted.role_id = assigned.role_id
       LEFT JOIN permissions permission ON permission.id = granted.permission_id
      WHERE membership.workspace_id = $1 AND membership.status = 'active'
      GROUP BY membership.id, membership.user_id, account.display_name, account.primary_email`, [workspaceId])).rows;
  const currency = (await db.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? "";
  const owners = (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
       JOIN roles role ON role.id = assigned.role_id AND role.code = 'owner' AND role.is_system
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows.map((row) => row.userId);

  let reminded = 0, escalated = 0;
  const overdue = new Map<string, { row: ApprovalRow; approvers: string[] }>();
  for (const person of people) {
    const granted = new Set(person.permissions);
    const managed = (await db.query<{ projectId: string }>(
      `SELECT DISTINCT project_id AS "projectId" FROM project_assignments WHERE workspace_id = $1 AND membership_id = $2 AND active AND is_manager AND project_id IS NOT NULL`,
      [workspaceId, person.membershipId])).rows.map((row) => row.projectId);
    const context: ApprovalContext = { workspaceId, userId: person.userId, displayName: person.name, membershipId: person.membershipId,
      can: async (permission) => granted.has(permission), managedProjects: new Set(managed), currency };
    const due = (await waitingFor(db, context)).rows.filter((row) => row.canDecide && waited(row, now) >= settings.remindAfterHours);
    let sent = 0;
    for (const row of due) {
      const key = `${row.kind}:${row.id}`;
      if (waited(row, now) >= settings.escalateAfterHours) {
        const entry = overdue.get(key) ?? { row, approvers: [] };
        entry.approvers.push(person.name);
        overdue.set(key, entry);
      }
      if (sent >= PER_PERSON) continue;
      const message = { workspaceId, recipientUserId: person.userId, code: "approvals.reminder", eventType: "approvals.reminder",
        variables: { title: row.title, hours: String(waited(row, now)), approvers: "" }, deepLink: row.href };
      const result = await notifyUserInApp(db, { ...message, idempotencyKey: `approvals.reminder:${key}:${person.userId}`.slice(0, 160) });
      if (settings.email) await queueUserEmail(db, { ...message, idempotencyKey: `approvals.reminder:${key}:${person.userId}:email`.slice(0, 160) });
      if (result.queued) { reminded += 1; sent += 1; }
    }
  }
  for (const [key, { row, approvers }] of overdue) {
    for (const userId of owners) {
      const message = { workspaceId, recipientUserId: userId, code: "approvals.escalated", eventType: "approvals.escalated",
        variables: { title: row.title, hours: String(waited(row, now)), approvers: approvers.slice(0, 3).join(", ") }, deepLink: row.href };
      const result = await notifyUserInApp(db, { ...message, idempotencyKey: `approvals.escalated:${key}:${userId}`.slice(0, 160) });
      if (settings.email) await queueUserEmail(db, { ...message, idempotencyKey: `approvals.escalated:${key}:${userId}:email`.slice(0, 160) });
      if (result.queued) escalated += 1;
    }
  }
  return { reminded, escalated };
}
