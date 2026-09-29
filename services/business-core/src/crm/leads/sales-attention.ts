import type { PoolClient } from "pg";
import { notifyUserInApp, queueUserEmail, queueUserPushFromTemplate } from "../../notifications/default-templates";
import { addSlaMinutes, normalizeSlaSchedule, type SlaSchedule } from "./sla-schedule";

type Db = Pick<PoolClient, "query">;

/** Active enquiries that someone must work: paused ones wait for their date instead. */
export const WORKING_LEAD_STATUSES = ["new", "attempting_contact", "connected", "nurturing"];

export type Notice = {
  code: string;
  variables: Record<string, string>;
  deepLink: string;
  /** Unique per event; the recipient's user id is appended. */
  key: string;
  channels: Array<"in_app" | "push" | "email">;
};

/** One notice to several people on the channels the event uses; every send is idempotent per person. */
export async function tell(db: Db, workspaceId: string, recipients: Array<{ userId: string }>, notice: Notice) {
  const seen = new Set<string>();
  let told = 0;
  for (const recipient of recipients) {
    if (seen.has(recipient.userId)) continue;
    seen.add(recipient.userId);
    const base = { workspaceId, recipientUserId: recipient.userId, code: notice.code, eventType: notice.code, variables: notice.variables, deepLink: notice.deepLink };
    if (notice.channels.includes("in_app")) {
      const sent = await notifyUserInApp(db, { ...base, idempotencyKey: `${notice.key}:${recipient.userId}` });
      if (sent.queued) told += 1;
    }
    if (notice.channels.includes("push")) await queueUserPushFromTemplate(db, { ...base, idempotencyKey: `${notice.key}:${recipient.userId}:push` });
    if (notice.channels.includes("email")) await queueUserEmail(db, { ...base, idempotencyKey: `${notice.key}:${recipient.userId}:email` });
  }
  return told;
}

/** The person behind a membership, for notices. */
export async function memberPerson(db: Db, workspaceId: string, membershipId: string | null) {
  if (!membershipId) return null;
  const result = await db.query<Recipient>(
    `SELECT membership.user_id AS "userId", membership.id AS "membershipId",
            coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS name
       FROM workspace_memberships membership JOIN users account ON account.id = membership.user_id
      WHERE membership.workspace_id = $1 AND membership.id = $2 AND membership.status = 'active' AND account.status = 'active'`,
    [workspaceId, membershipId]);
  return result.rows[0] ?? null;
}

/** Reference and client name of an enquiry, for notices. */
export async function leadFacts(db: Db, workspaceId: string, leadId: string) {
  const result = await db.query<{ reference: string | null; clientName: string | null }>(
    `SELECT enquiry.reference, party.display_name AS "clientName"
       FROM crm_leads lead
       JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
       JOIN crm_parties party ON party.workspace_id = lead.workspace_id AND party.id = lead.party_id
      WHERE lead.workspace_id = $1 AND lead.id = $2`, [workspaceId, leadId]);
  return { reference: result.rows[0]?.reference ?? "", clientName: result.rows[0]?.clientName ?? "" };
}

export const leadLink = (leadId: string) => `/workspace/crm/leads?lead=${leadId}`;

/**
 * S-2: an enquiry that someone must work but that has no owner starts a countdown (in Sales working
 * minutes); one that gains an owner, closes or pauses stops it. Called after every change of owner or state.
 */
export async function refreshUnownedEscalation(db: Db, workspaceId: string, leadId: string, now = new Date()) {
  const lead = await db.query<{ owner: string | null; status: string; due: Date | null }>(
    `SELECT owner_membership_id AS owner, status::text AS status, escalation_due_at AS due FROM crm_leads WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, leadId]);
  const row = lead.rows[0];
  if (!row) return null;
  const waiting = !row.owner && WORKING_LEAD_STATUSES.includes(row.status);
  if (!waiting) {
    if (row.due) await db.query(`UPDATE crm_leads SET escalation_due_at = NULL WHERE workspace_id = $1 AND id = $2`, [workspaceId, leadId]);
    return null;
  }
  if (row.due) return row.due;
  const settings = await loadSalesSettings(db, workspaceId);
  const due = addSlaMinutes(now, settings.unownedEscalationMinutes, await salesSchedule(db, workspaceId));
  await db.query(`UPDATE crm_leads SET escalation_due_at = $3, escalated_at = NULL WHERE workspace_id = $1 AND id = $2`, [workspaceId, leadId, due]);
  return due;
}

/** The Sales rules the timers read; a workspace without its own row gets these. */
export type SalesSettings = {
  takeoverCap: number;
  unownedEscalationMinutes: number;
  clientReviewMinutes: number;
  duplicateWindowDays: number;
  salesAdminMembershipId: string | null;
  version: number;
};

export const DEFAULT_SALES_SETTINGS: SalesSettings = {
  takeoverCap: 2, unownedEscalationMinutes: 15, clientReviewMinutes: 30, duplicateWindowDays: 90,
  salesAdminMembershipId: null, version: 0,
};

export async function loadSalesSettings(db: Db, workspaceId: string): Promise<SalesSettings> {
  const row = await db.query<SalesSettings>(
    `SELECT takeover_cap AS "takeoverCap", unowned_escalation_minutes AS "unownedEscalationMinutes",
            client_review_minutes AS "clientReviewMinutes", duplicate_window_days AS "duplicateWindowDays",
            sales_admin_membership_id AS "salesAdminMembershipId", version
       FROM workspace_sales_settings WHERE workspace_id = $1`, [workspaceId]);
  return row.rows[0] ? { ...row.rows[0], version: Number(row.rows[0].version) } : { ...DEFAULT_SALES_SETTINGS };
}

export type Recipient = { userId: string; membershipId: string; name: string };

/**
 * Who a Sales escalation goes to: the workspace's named Sales admin, and everyone who manages Sales
 * settings (the Owner and administrators by default). Decided by permission, never by a role's name.
 */
export async function salesEscalationRecipients(db: Db, workspaceId: string, excludeMembershipIds: Array<string | null> = []): Promise<Recipient[]> {
  const result = await db.query<Recipient>(
    `SELECT DISTINCT ON (membership.id) membership.user_id AS "userId", membership.id AS "membershipId",
            coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS name
       FROM workspace_memberships membership
       JOIN users account ON account.id = membership.user_id AND account.status = 'active'
      WHERE membership.workspace_id = $1 AND membership.status = 'active'
        AND NOT (membership.id = ANY($2::uuid[]))
        AND (membership.id = (SELECT sales_admin_membership_id FROM workspace_sales_settings WHERE workspace_id = $1)
          OR EXISTS (SELECT 1 FROM effective_member_roles assigned
                       JOIN role_permissions granted ON granted.role_id = assigned.role_id
                       JOIN permissions permission ON permission.id = granted.permission_id
                      WHERE assigned.workspace_id = membership.workspace_id AND assigned.membership_id = membership.id
                        AND permission.code = 'crm.settings.manage'))
      ORDER BY membership.id`,
    [workspaceId, excludeMembershipIds.filter((id): id is string => Boolean(id))],
  );
  return result.rows;
}

function moneyText(amount: string, currency: string, locale: string) {
  try { return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount as unknown as number); } catch { return `${currency} ${amount}`; }
}

/**
 * S-23: a deal won or lost is told in the app to the Sales admin (and whoever manages Sales settings) and to the
 * workspace's Owners, with the reason; never to the person who closed it. Once each time the deal closes.
 */
export async function tellDealOutcome(db: Db, workspaceId: string, input: { opportunityId: string; outcome: "won" | "lost"; reason: string | null; actorUserId: string | null }) {
  const deal = (await db.query<{ title: string; clientName: string | null; amount: string | null; currency: string | null; closedAt: Date | null }>(
    `SELECT opportunity.title, party.display_name AS "clientName", opportunity.amount::text AS amount, opportunity.currency_code AS currency, opportunity.closed_at AS "closedAt"
       FROM crm_opportunities opportunity LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
      WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`, [workspaceId, input.opportunityId])).rows[0];
  if (!deal) return 0;
  const owners = (await db.query<Recipient>(
    `SELECT DISTINCT membership.user_id AS "userId", membership.id AS "membershipId", coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS name
       FROM workspace_memberships membership
       JOIN users account ON account.id = membership.user_id AND account.status = 'active'
       JOIN effective_member_roles assigned ON assigned.workspace_id = membership.workspace_id AND assigned.membership_id = membership.id
       JOIN roles role ON role.id = assigned.role_id AND role.code = 'owner'
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows;
  const recipients = [...await salesEscalationRecipients(db, workspaceId), ...owners].filter((person) => person.userId !== input.actorUserId);
  // The stored decimal, formatted exactly in the workspace's language (no float arithmetic).
  const { locale } = await workspaceClock(db, workspaceId);
  const amount = deal.amount && deal.currency ? moneyText(deal.amount, deal.currency, locale) : "";
  return tell(db, workspaceId, recipients, {
    code: input.outcome === "won" ? "crm.deal_won" : "crm.deal_lost", channels: ["in_app"],
    deepLink: `/workspace/crm/opportunities?record=${input.opportunityId}`, key: `crm:deal-${input.outcome}:${input.opportunityId}:${deal.closedAt ? new Date(deal.closedAt).getTime() : ""}`,
    variables: { title: deal.title, clientName: deal.clientName ?? "", amount, reason: input.reason?.trim() || "" },
  });
}

export type WorkspaceClock = { timeZone: string; locale: string };

/** The workspace's own time zone and language, so every deadline in a notice reads in local time. */
export async function workspaceClock(db: Db, workspaceId: string): Promise<WorkspaceClock> {
  const row = await db.query<{ timeZone: string | null; locale: string | null }>(
    `SELECT default_timezone AS "timeZone", default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId]);
  return { timeZone: validZone(row.rows[0]?.timeZone) ?? "UTC", locale: validLocale(row.rows[0]?.locale) ?? "en" };
}

function validZone(zone: string | null | undefined) {
  if (!zone) return null;
  try { new Intl.DateTimeFormat("en", { timeZone: zone }); return zone; } catch { return null; }
}

function validLocale(locale: string | null | undefined) {
  if (!locale) return null;
  try { return Intl.DateTimeFormat.supportedLocalesOf([locale]).length ? locale : null; } catch { return null; }
}

/** "Sat 10:00" on another day, "10:00" today, in the workspace's zone and language. */
export function formatDeadline(at: Date, clock: WorkspaceClock, now = new Date()): string {
  const day = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: clock.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const time = new Intl.DateTimeFormat(clock.locale, { timeZone: clock.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  if (day(at) === day(now)) return time;
  const weekday = new Intl.DateTimeFormat(clock.locale, { timeZone: clock.timeZone, weekday: "short" }).format(at);
  return `${weekday} ${time}`;
}

/** The workspace-local calendar date and time of day, e.g. to send a digest once per local day. */
export function localDay(at: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(at).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: String(parts.weekday).toLowerCase().slice(0, 3) };
}

/**
 * The Sales working hours: the active first-response policy's calendar (one place, S-8), else elapsed
 * time. Escalation windows count only these minutes, so a Friday-evening enquiry escalates on Saturday
 * morning, not at night.
 */
export async function salesSchedule(db: Db, workspaceId: string): Promise<SlaSchedule> {
  const policy = await db.query<{ schedule: Record<string, unknown> | null; mode: string | null }>(
    `SELECT schedule, calculation_mode AS mode FROM crm_sla_policies
      WHERE workspace_id = $1 AND status = 'active' AND event_type = 'first_response'
      ORDER BY created_at, id LIMIT 1`, [workspaceId]);
  const row = policy.rows[0];
  if (!row) return { version: 1, mode: "elapsed" };
  try { return normalizeSlaSchedule(row.schedule ?? undefined, row.mode ?? undefined); }
  catch { return { version: 1, mode: "elapsed" }; }
}

/** Whether the calendar has any working window on this local weekday (elapsed time works every day). */
export function isWorkingDay(schedule: SlaSchedule, weekday: string, date: string) {
  if (schedule.mode === "elapsed") return true;
  if (schedule.holidays.includes(date)) return false;
  if (schedule.dateOverrides[date]) return schedule.dateOverrides[date].length > 0;
  const key = Object.keys(schedule.weeklyHours).find((day) => day.slice(0, 3) === weekday) as keyof typeof schedule.weeklyHours | undefined;
  return Boolean(key && schedule.weeklyHours[key]?.length);
}
