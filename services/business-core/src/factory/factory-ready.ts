import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { paymentDueItem, sendPaymentReminder } from "../crm/conversations/crm-payment-reminders.service";
import { clientMessageRule } from "../crm/conversations/inbox/client-messages";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { everythingMade } from "./factory";

type Db = Pick<PoolClient, "query">;

export type ReadyOrder = { id: string; number: number; title: string; projectId: string; projectReference: string; projectName: string };

/** Why the client wasn't reminded when the order was ready, or the channel the reminder went on. */
export type ReminderOutcome = "sent" | "reminders_off" | "nothing_owed" | "not_pending" | "already_today" | string;

/**
 * A work order is ready (everything made passed its checks), on `readyOn`:
 * - Finance and the account manager hear, in the app and by email, with the ready date;
 * - when every work order tied to the same payment stage is ready, the client gets that stage's payment
 *   reminder, once per stage, through the usual payment reminder (WhatsApp, else email);
 * - when everything the factory makes for the project is ready, the project manager and the people who
 *   deliver and install hear, in the app and by email.
 * The person who checked it is never told about their own step.
 */
export async function orderReady(db: Db, workspaceId: string, order: ReadyOrder, input: { checkId: string; readyOn: string; actorId: string }) {
  const reminder = await remindForReady(db, workspaceId, order, input.actorId);
  const facts = await projectFacts(db, workspaceId, order.projectId);
  const day = await dayFormat(db, workspaceId);
  const variables = {
    order: `WO-${String(order.number).padStart(4, "0")}`, item: order.title, project: `${order.projectReference} · ${order.projectName}`, date: day(input.readyOn),
    actor: await actorName(db, input.actorId),
    payment: reminderText(reminder),
  };
  await tell(db, workspaceId, await financeAndAccountManager(db, workspaceId, order.projectId, facts.ownerMembershipId), input.actorId, {
    code: "factory.order_ready", variables, deepLink: `/workspace/projects/${order.projectId}/money`, key: input.checkId });
  if (await everythingMade(db, workspaceId, order.projectId)) {
    // Once per project, and again only after something came back from site to be made again.
    const reworked = (await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM work_order_reworks rework JOIN work_orders wo ON wo.workspace_id = rework.workspace_id AND wo.id = rework.work_order_id
        WHERE rework.workspace_id = $1 AND wo.project_id = $2`, [workspaceId, order.projectId])).rows[0].count;
    await tell(db, workspaceId, await deliveryTeam(db, workspaceId, order.projectId), input.actorId, {
      code: "factory.project_ready", variables, deepLink: `/workspace/projects/${order.projectId}`, key: `${order.projectId}:${reworked}` });
  }
  return reminder;
}

/**
 * The payment reminder an order-ready date triggers: the stage the work order is tied to, once every work
 * order tied to it is ready (or closed). One per stage, ever: the claim row is the idempotency key, and it
 * records why nothing went (reminders off, nothing owed, already paid or reminded today).
 */
export async function remindForReady(db: Db, workspaceId: string, order: Pick<ReadyOrder, "id" | "projectId">, actorId: string) {
  const link = (await db.query<{ caseId: string; paymentId: string | null; readyOn: string | null }>(
    `SELECT project.case_id AS "caseId", wo.ready_payment_id AS "paymentId", wo.ready_on::text AS "readyOn"
       FROM work_orders wo JOIN delivery_projects project ON project.workspace_id = wo.workspace_id AND project.id = wo.project_id
      WHERE wo.workspace_id = $1 AND wo.id = $2`, [workspaceId, order.id])).rows[0];
  if (!link?.paymentId || !link.readyOn) return null;
  const title = (await db.query<{ title: string }>(`SELECT title FROM commercial_payments WHERE workspace_id = $1 AND case_id = $2 AND id = $3`,
    [workspaceId, link.caseId, link.paymentId])).rows[0]?.title;
  if (!title) return null;
  // Every work order tied to the stage is ready (or closed): the order is ready as the client sees it.
  const open = (await db.query(`SELECT 1 FROM work_orders WHERE workspace_id = $1 AND project_id = $2 AND ready_payment_id = $3 AND status IN ('planned', 'released', 'in_production', 'on_hold') LIMIT 1`,
    [workspaceId, order.projectId, link.paymentId])).rowCount;
  if (open) return { title, outcome: "waiting" as const };
  const claimed = (await db.query(
    `INSERT INTO factory_ready_reminders (workspace_id, case_id, payment_id, project_id, work_order_id, ready_on, outcome) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     ON CONFLICT (workspace_id, case_id, payment_id) DO NOTHING`, [workspaceId, link.caseId, link.paymentId, order.projectId, order.id, link.readyOn])).rowCount;
  if (!claimed) return { title, outcome: "earlier" as const };
  const today = (await db.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
  let outcome: ReminderOutcome;
  let channel: string | null = null;
  const item = await paymentDueItem(db, workspaceId, link.caseId, link.paymentId, today);
  if (!(await clientMessageRule(db, workspaceId, "payments.reminder")).enabled) outcome = "reminders_off";
  else if (!item) outcome = "nothing_owed";
  else if (item.status !== "pending") outcome = "not_pending";
  else if ((await db.query(`SELECT 1 FROM crm_payment_reminders WHERE workspace_id = $1 AND payment_id = $2 AND sent_on = $3`, [workspaceId, link.paymentId, today])).rowCount) outcome = "already_today";
  else {
    const sent = await sendPaymentReminder(db, workspaceId, item, today, null, actorId);
    channel = sent.channel;
    outcome = sent.channel ? "sent" : String(sent.reason).slice(0, 40);
  }
  await db.query(`UPDATE factory_ready_reminders SET outcome = $4, channel = $5 WHERE workspace_id = $1 AND case_id = $2 AND payment_id = $3`,
    [workspaceId, link.caseId, link.paymentId, outcome, channel]);
  await recordAudit(db, { workspaceId, actorUserId: actorId, action: "work_order.ready_reminder", entityType: "work_order", entityId: order.id,
    after: { caseId: link.caseId, paymentId: link.paymentId, readyOn: link.readyOn, outcome, channel } });
  return { title, outcome, channel };
}

/** What Finance reads about the stage's reminder: sent, or why the client wasn't reminded (nothing while other work orders on it are still made). */
export function reminderText(reminder: Awaited<ReturnType<typeof remindForReady>>) {
  if (!reminder || reminder.outcome === "waiting" || reminder.outcome === "earlier") return "";
  if (reminder.outcome === "sent") return `The client was reminded to pay ${reminder.title}.`;
  const why: Record<string, string> = { reminders_off: "payment reminders are off", nothing_owed: "nothing is owed on it", not_pending: "it's paid or waiting for verification",
    already_today: "they were already reminded today" };
  return `The client wasn't reminded to pay ${reminder.title}: ${why[reminder.outcome] ?? "they can't be reached"}.`;
}

/** The reminder an order-ready date triggered for a payment stage, if one was due yet. */
export async function readReadyReminder(db: Db, workspaceId: string, caseId: string, paymentId: string | null) {
  if (!paymentId) return null;
  return (await db.query<{ readyOn: string; outcome: string; channel: string | null; at: string; on: string }>(
    `SELECT reminder.ready_on::text AS "readyOn", reminder.outcome, reminder.channel, reminder.created_at AS at,
            (reminder.created_at AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date::text AS on
       FROM factory_ready_reminders reminder JOIN workspaces workspace ON workspace.id = reminder.workspace_id
      WHERE reminder.workspace_id = $1 AND reminder.case_id = $2 AND reminder.payment_id = $3`,
    [workspaceId, caseId, paymentId])).rows[0] ?? null;
}

async function projectFacts(db: Db, workspaceId: string, projectId: string) {
  return (await db.query<{ ownerMembershipId: string | null }>(
    `SELECT opportunity.owner_membership_id AS "ownerMembershipId" FROM delivery_projects project
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
      WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, projectId])).rows[0] ?? { ownerMembershipId: null };
}

/** The project's people in these roles (active members only). */
async function inRoles(db: Db, workspaceId: string, projectId: string, roles: string[], manager = false) {
  return (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND (assignment.role_keys && $3::varchar[] OR ($4 AND assignment.is_manager))`,
    [workspaceId, projectId, roles, manager])).rows.map((row) => row.userId);
}

/**
 * Finance: the project team's Finance member, else whoever manages receivables in the workspace. The
 * account manager: the team's account manager, else the person who owns the opportunity.
 */
export async function financeAndAccountManager(db: Db, workspaceId: string, projectId: string, ownerMembershipId: string | null) {
  let finance = await inRoles(db, workspaceId, projectId, ["finance"]);
  if (!finance.length)
    finance = (await db.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
         JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = effective_role.role_id
         JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'receivables.manage'
        WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows.map((row) => row.userId);
  let manager = await inRoles(db, workspaceId, projectId, ["account_manager"]);
  if (!manager.length && ownerMembershipId)
    manager = (await db.query<{ userId: string }>(`SELECT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`,
      [workspaceId, ownerMembershipId])).rows.map((row) => row.userId);
  return [...new Set([...finance, ...manager])];
}

/**
 * Who takes the made goods from here: the project manager, the installation lead, the owner of the stage that
 * follows the one waiting for everything to be made (the firm's own delivery stage), and the installation team
 * (PLM-069: the owner of a stage holding a delivery or installation check).
 */
export async function deliveryTeam(db: Db, workspaceId: string, projectId: string) {
  const next = (await db.query<{ role: string }>(
    `SELECT DISTINCT following.owner_role AS role FROM project_stages made
       JOIN project_stages following ON following.workspace_id = made.workspace_id AND following.project_id = made.project_id AND following.position = made.position + 1
      WHERE made.workspace_id = $1 AND made.project_id = $2 AND made.checks @> '[{"kind": "everything_made"}]'::jsonb AND following.owner_role IS NOT NULL
     UNION
     SELECT DISTINCT stage.owner_role FROM project_stages stage
      WHERE stage.workspace_id = $1 AND stage.project_id = $2 AND stage.status <> 'skipped' AND stage.owner_role IS NOT NULL
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(stage.checks) item WHERE item->>'kind' IN ('installation_scheduled', 'goods_delivered', 'installation_done'))`,
    [workspaceId, projectId])).rows.map((row) => row.role);
  return inRoles(db, workspaceId, projectId, [...new Set(["project_manager", "installation_lead", ...next])], true);
}

async function tell(db: Db, workspaceId: string, users: string[], actorId: string, notice: { code: string; variables: Record<string, string>; deepLink: string; key: string }) {
  for (const userId of new Set(users.filter((id) => id !== actorId))) {
    const message = { workspaceId, recipientUserId: userId, code: notice.code, eventType: notice.code, variables: notice.variables, deepLink: notice.deepLink };
    await notifyUserInApp(db, { ...message, idempotencyKey: `${notice.code}:${notice.key}:${userId}` });
    await queueUserEmail(db, { ...message, idempotencyKey: `${notice.code}:${notice.key}:${userId}:email` });
  }
}

async function actorName(db: Db, userId: string) {
  return (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? "";
}

/** Dates as the workspace writes them. */
async function dayFormat(db: Db, workspaceId: string) {
  const locale = (await db.query<{ locale: string | null }>(`SELECT default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.locale || "en";
  return (value: string) => {
    try { return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00Z`)); } catch { return value; }
  };
}
