import type { DeliveryMessageStatus, ReminderChainLink, ReminderChannel, ReminderKind, ReminderModule, ReminderUnit } from "@wodana/contracts";
import { tKey, type MessageKey, type Translate } from "@/lib/i18n/keys";

/** What each reminder is about, in the words people use (Settings › Reminders rows, My day's filter). */
export const REMINDER_KIND_LABELS: Record<ReminderKind, MessageKey> = {
  "work.due": tKey("Work due"),
  "crm.follow_up": tKey("Follow-ups due"),
  "approval.waiting": tKey("Approvals waiting"),
  "client.quote_decision": tKey("Quotation waiting on the client"),
  "client.design_decision": tKey("Design waiting on the client"),
  "change_request.client_decision": tKey("Change waiting on the client"),
  "quote.expiring": tKey("Quotation expiring"),
  "payment.due": tKey("Client payment due"),
  "invoice.overdue": tKey("Invoice overdue"),
  "payables.due": tKey("Supplier bill due"),
  "purchase.order_late": tKey("Purchase order late"),
  "design.stage_due": tKey("Design stage due"),
  "permit.expiry": tKey("Permit expiring"),
  "finance_request.waiting": tKey("Finance request waiting"),
  "crm.first_response": tKey("First response"),
  "crm.unowned": tKey("No owner yet"),
  "crm.confirm_client": tKey("Confirm the client"),
  "crm.reply_waiting": tKey("Client reply"),
  "site.daily_report": tKey("Daily report"),
  "factory.production_due": tKey("Production"),
  "books.posting_issue": tKey("Posting issue"),
};

export const REMINDER_MODULE_LABELS: Record<ReminderModule, MessageKey> = {
  sales: tKey("Sales"),
  quotations: tKey("Quotations"),
  design: tKey("Design"),
  projects: tKey("Projects"),
  purchasing: tKey("Purchasing"),
  factory: tKey("Factory"),
  finance: tKey("Finance"),
  ledger: tKey("Ledger"),
  approvals: tKey("Approvals"),
};

export const REMINDER_CHAIN_LABELS: Record<ReminderChainLink, MessageKey> = {
  manager: tKey("Manager"),
  project_manager: tKey("Project manager"),
  finance: tKey("Finance"),
  purchasing: tKey("Purchasing"),
  owner: tKey("Owner"),
};

export const REMINDER_CHANNEL_LABELS: Record<ReminderChannel | "webhook", MessageKey> = {
  in_app: tKey("In app"),
  push: tKey("Push"),
  email: tKey("Email"),
  whatsapp: tKey("WhatsApp"),
  webhook: tKey("Webhook"),
};

/** A delivered message's state: a written label, with a semantic tone that only reinforces it. */
export const DELIVERY_STATUS_LOOK: Record<DeliveryMessageStatus, { label: MessageKey; tone: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  pending: { label: tKey("Waiting"), tone: "neutral" },
  sent: { label: tKey("Sent"), tone: "info" },
  delivered: { label: tKey("Delivered"), tone: "success" },
  read: { label: tKey("Read"), tone: "success" },
  failed: { label: tKey("Failed"), tone: "danger" },
  held: { label: tKey("Held"), tone: "warning" },
  suppressed: { label: tKey("Suppressed"), tone: "neutral" },
};

/** One step of a cadence: "3 days before", "On the day", "2 days after"; hours for an hourly rule. */
export function offsetLabel(t: Translate, offset: number, unit: ReminderUnit) {
  const count = Math.abs(offset);
  if (unit === "hour") {
    if (offset === 0) return t("At the time");
    if (count === 1) return offset < 0 ? t("1 hour before") : t("1 hour after");
    return offset < 0 ? t("{count} hours before", { count }) : t("{count} hours after", { count });
  }
  if (offset === 0) return t("On the day");
  if (count === 1) return offset < 0 ? t("1 day before") : t("1 day after");
  return offset < 0 ? t("{count} days before", { count }) : t("{count} days after", { count });
}
