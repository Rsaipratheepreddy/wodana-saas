import { Injectable, Optional, UnprocessableEntityException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PoolClient } from "pg";
import { recordAudit } from "../../audit/record-audit";
import { RequestActor } from "../../auth/actor";
import { tellClients } from "../../client-portal/portal-notices";
import { DatabaseService } from "../../database/database.service";
import { Dec } from "../../catalog-core/decimal";
import { readInvoices, readMilestonePaid, readMilestones, withBalances } from "../../receivables/receivables";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { SendPaymentReminderDto, UpdatePaymentReminderScheduleDto } from "./dto/whatsapp-templates.dto";
import { clientMessageRule, partyOfCase } from "./inbox/client-messages";
import { clientDailyGate, GATE_PRIORITY } from "../../reminders/delivery/client-gate";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
type Db = Pick<PoolClient, "query">;
export const DEFAULT_REMINDER_OFFSETS = [-3, 0, 3, 7];

export type DueItem = { caseId: string; paymentId: string; invoiceId: string | null; title: string; dueDate: string | null; amount: string; currency: string; status: string; clientName: string };

/** Whole days from `from` to `to` (YYYY-MM-DD). */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Whether the workspace is open now (its work calendar, else 09:00–18:00 in its time zone). */
export function isOpen(now: Date, calendar: { timeZone: string; start: string; end: string; days: number[] | null }) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: calendar.timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const time = `${parts.hour}:${parts.minute}`;
  return (!calendar.days?.length || calendar.days.includes(weekday)) && time >= calendar.start && time < calendar.end;
}

/**
 * Payment reminders to clients: "Send reminder" on any milestone or invoice still owed, and an automatic schedule
 * (days before and after the due date, by default −3, 0, +3, +7) that runs in working hours and stops once the
 * money is paid or the client says they've paid. WhatsApp with the payment_due template, else email; at most one a
 * day per payment, logged on the payment and in the client's chat. Finance hears at a week overdue.
 */
@Injectable()
export class CrmPaymentRemindersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: WorkspaceAccessService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  remind(actor: RequestActor, workspaceId: string, input: SendPaymentReminderDto) {
    return this.access.withAnyPermission(actor, workspaceId, ["receivables.manage", "crm.communications.send"], async (client, actorUser) => {
      const item = await this.dueItem(client, workspaceId, input.caseId, input.paymentId);
      if (!item) throw new UnprocessableEntityException("Nothing is owed on this payment");
      if (item.status !== "pending") throw new UnprocessableEntityException("This payment is paid or waiting for verification");
      const today = await this.today(client, workspaceId);
      const prior = (await client.query<{ channel: string }>(`SELECT channel FROM crm_payment_reminders WHERE workspace_id = $1 AND payment_id = $2 AND sent_on = $3`, [workspaceId, item.paymentId, today])).rows[0];
      if (prior) return { sent: true, already: true, channel: prior.channel, sentOn: today };
      const sent = await this.send(client, workspaceId, item, today, null, actorUser.userId);
      if (!sent.channel) throw new UnprocessableEntityException(`The reminder couldn't go: ${sent.reason}`);
      // A reminder sent by hand is today's one client reminder: the engine holds its own until tomorrow.
      const party = await partyOfCase(client, workspaceId, item.caseId);
      if (party.partyId) await clientDailyGate(client, workspaceId, { partyId: party.partyId, priority: GATE_PRIORITY.payment, key: `manual:payment:${item.paymentId}:${today}`, localDate: today });
      return { sent: true, already: false, channel: sent.channel, sentOn: today };
    });
  }

  /** The schedule and whether reminders are on (Settings → Inbox → Client messages → Payment reminder). */
  schedule(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client) => this.readSchedule(client, workspaceId));
  }

  updateSchedule(actor: RequestActor, workspaceId: string, input: UpdatePaymentReminderScheduleDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const current = await this.readSchedule(client, workspaceId);
      const offsets = [...new Set(input.offsets)].sort((a, b) => a - b);
      if (offsets.join(",") === current.offsets.join(",")) return current;
      if (current.version !== input.version) throw new UnprocessableEntityException("The reminder schedule changed; reload and try again");
      await client.query(
        `INSERT INTO crm_client_message_rules (workspace_id, event, offsets, updated_by) VALUES ($1, 'payments.reminder', $2, $3)
         ON CONFLICT (workspace_id, event) DO UPDATE SET offsets = EXCLUDED.offsets, updated_by = EXCLUDED.updated_by, updated_at = now(), version = crm_client_message_rules.version + 1`,
        [workspaceId, offsets, actorUser.userId]);
      await recordAudit(client, { workspaceId, actorUserId: actorUser.userId, action: "crm.payment_reminders.schedule_updated.v1", entityType: "crm_client_message_rule", entityId: workspaceId, before: { offsets: current.offsets }, after: { offsets } });
      return this.readSchedule(client, workspaceId);
    });
  }

  /**
   * The worker's hourly pass. The automatic schedule moved to the reminder engine (payment.due, plan §6.24a): its
   * offsets are the payment.due rule in Settings › Reminders, it sends in the client window at most one client
   * reminder a day, and Finance hears through invoice.overdue. This only records that the worker checked in.
   */
  async scheduleInternal(workspaceId: string) {
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      await client.query(
        `INSERT INTO crm_client_message_rules (workspace_id, event, checked_at) VALUES ($1, 'payments.reminder', now())
         ON CONFLICT (workspace_id, event) DO UPDATE SET checked_at = now()`, [workspaceId]);
      return { sent: 0, reason: "reminder_engine" };
    });
  }

  private send(client: Db, workspaceId: string, item: DueItem, today: string, offset: number | null, userId: string | null) {
    return sendPaymentReminder(client, workspaceId, item, today, offset, userId);
  }

  private async dueItem(client: Db, workspaceId: string, caseId: string, paymentId: string) {
    return paymentDueItem(client, workspaceId, caseId, paymentId, await this.today(client, workspaceId));
  }

  private async readSchedule(client: Db, workspaceId: string) {
    const rule = await clientMessageRule(client, workspaceId, "payments.reminder");
    const row = (await client.query<{ offsets: number[] | null }>(`SELECT offsets FROM crm_client_message_rules WHERE workspace_id = $1 AND event = 'payments.reminder'`, [workspaceId])).rows[0];
    return { enabled: rule.enabled, offsets: row?.offsets?.length ? row.offsets : DEFAULT_REMINDER_OFFSETS, version: rule.version };
  }

  private async today(client: Db, workspaceId: string) {
    return (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
  }
}

/**
 * Sends one payment reminder to the client (WhatsApp with the payment_due template, else email) and logs it on the
 * payment. Used by the schedule, "Send reminder" and events that make a payment due (a factory order ready).
 */
export async function sendPaymentReminder(client: Db, workspaceId: string, item: DueItem, today: string, offset: number | null, userId: string | null) {
  const result = await tellClients(client, {
    workspaceId, caseId: item.caseId, event: "payment_due", recordId: `${item.paymentId}:${today}`, title: item.title, due: item.dueDate,
    record: { paymentId: item.paymentId, invoiceId: item.invoiceId, amountDue: { amount: item.amount, currency: item.currency } },
  });
  if (!result.queued) return { channel: null, reason: result.reason ?? "no_contact" };
  const channel = "channel" in result && result.channel === "whatsapp" ? "whatsapp" : "email";
  const messageId = "messageId" in result ? result.messageId ?? null : null;
  await recordPaymentReminder(client, workspaceId, item, today, offset, channel, messageId, userId);
  return { channel, reason: null };
}

/**
 * Logs a payment reminder on the payment (at most one a day) and audits it. The reminder engine's payment.due source
 * calls it after its own send; "Send reminder" through sendPaymentReminder.
 */
export async function recordPaymentReminder(client: Db, workspaceId: string, item: Pick<DueItem, "caseId" | "paymentId" | "invoiceId" | "amount" | "currency">, today: string,
  offset: number | null, channel: "whatsapp" | "email", messageId: string | null, userId: string | null) {
  await client.query(
    `INSERT INTO crm_payment_reminders (workspace_id, case_id, payment_id, invoice_id, sent_on, offset_days, channel, message_id, sent_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (workspace_id, payment_id, sent_on) DO NOTHING`,
    [workspaceId, item.caseId, item.paymentId, item.invoiceId, today, offset, channel, messageId, userId]);
  await recordAudit(client, { workspaceId, actorUserId: userId, source: userId ? "user" : "internal", action: "receivables.payment_reminder.sent.v1", entityType: "commercial_payment", entityId: item.caseId,
    after: { paymentId: item.paymentId, invoiceId: item.invoiceId, channel, offset, amount: item.amount, currency: item.currency } });
}

/** What is still owed on a payment: its invoice's balance when it has one, else the milestone less what's paid. */
export async function paymentDueItem(client: Db, workspaceId: string, caseId: string, paymentId: string, today: string): Promise<DueItem | null> {
  const milestone = (await readMilestones(client, workspaceId, { caseId, paymentId }))[0];
  if (!milestone) return null;
  const status = (await client.query<{ status: string }>(`SELECT status FROM commercial_payments WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, paymentId])).rows[0]?.status ?? "pending";
  if (milestone.invoiceId) {
    const invoice = (await withBalances(client, workspaceId, await readInvoices(client, workspaceId, { id: milestone.invoiceId }), today))[0];
    if (invoice && invoice.status === "issued") {
      if (Dec.of(invoice.balance).cmp(0) <= 0) return null;
      return { caseId, paymentId, invoiceId: invoice.id, title: invoice.number, dueDate: invoice.dueDate, amount: invoice.balance, currency: invoice.currency, status, clientName: milestone.clientName };
    }
  }
  const paid = (await readMilestonePaid(client, workspaceId, [{ caseId, paymentId }])).get(`${caseId}|${paymentId}`) ?? Dec.ZERO;
  const owed = Dec.of(milestone.amount).sub(paid);
  if (owed.cmp(0) <= 0 || !milestone.currency) return null;
  return { caseId, paymentId, invoiceId: null, title: milestone.title, dueDate: milestone.dueDate, amount: owed.toFixed(4), currency: milestone.currency, status, clientName: milestone.clientName };
}
