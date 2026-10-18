import { tKey } from "@/lib/i18n/keys";

/**
 * Notices are grouped by the module their event comes from ("site.report_missing" → Projects). The bell,
 * the notifications page and Settings → Notifications share these groups; delivery uses the same list
 * (business-core src/notifications/notice-choices.ts), where each person's switch per group and channel is kept.
 */
export type NotificationModule = "sales" | "planning" | "projects" | "operations" | "finance" | "ledger" | "people" | "workspace";

export const NOTIFICATION_MODULES: Array<{ id: NotificationModule; label: string; prefixes: string[] }> = [
  { id: "sales", label: tKey("Sales"), prefixes: ["crm"] },
  { id: "planning", label: tKey("Planning"), prefixes: ["design", "quotation", "request", "portal", "client_portal", "pre_project"] },
  { id: "projects", label: tKey("Projects"), prefixes: ["project", "work", "site", "handover", "warranty", "gallery"] },
  { id: "operations", label: tKey("Operations"), prefixes: ["purchasing", "stock", "supplier", "factory"] },
  { id: "finance", label: tKey("Finance"), prefixes: ["payables", "petty_cash", "receivables", "accounting"] },
  // The Ledger (books): lock date moved, a manual journal decided.
  { id: "ledger", label: tKey("Ledger"), prefixes: ["books"] },
  { id: "people", label: tKey("People"), prefixes: ["hrms"] },
  { id: "workspace", label: tKey("Workspace"), prefixes: ["account", "workspace", "delivery"] },
];

export function notificationModule(eventType: string | null | undefined): NotificationModule {
  const prefix = String(eventType ?? "").split(".")[0];
  return NOTIFICATION_MODULES.find((item) => item.prefixes.includes(prefix))?.id ?? "workspace";
}

export type DayGroup = "today" | "week" | "earlier";
export const DAY_GROUP_LABELS: Record<DayGroup, string> = { today: tKey("Today"), week: tKey("This week"), earlier: tKey("Earlier") };

/** Today, the six days before it, or earlier, in the workspace's time zone. */
export function dayGroup(createdAt: string, timeZone: string, now = new Date()): DayGroup {
  const day = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "earlier";
  const today = day(now);
  if (day(created) === today) return "today";
  const weekStart = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  return day(created) >= weekStart ? "week" : "earlier";
}

/** The channels a person can be told on; the workspace turns WhatsApp and push on (Settings › Notifications shows those it has). */
export const NOTICE_CHANNELS = ["in_app", "email", "whatsapp", "push"] as const;
export type NoticeChannel = (typeof NOTICE_CHANNELS)[number];
export const NOTICE_CHANNEL_LABELS: Record<NoticeChannel, string> = { in_app: tKey("In the app"), email: tKey("Email"), whatsapp: tKey("WhatsApp"), push: tKey("Phone") };

/** One group on one channel: on unless the person switched it off. */
export type NoticeChoiceCell = { group: NotificationModule; channel: NoticeChannel; enabled: boolean };
export type HoursWindow = { start: string; end: string };

/** The person's own notification settings (notification-choices/me); one version guards them all. */
export type NoticeChoicesInput = {
  choices: NoticeChoiceCell[];
  quietHours: HoursWindow | null;
  digestEnabled: boolean;
  digestTime: string | null;
  timeZone: string | null;
  version: number;
};
export type NoticeChoicesView = NoticeChoicesInput & {
  groups: NotificationModule[];
  /** The channels the workspace has turned on, in order. */
  channels: NoticeChannel[];
  firm: { quietStart: string; quietEnd: string; digestTime: string };
  effectiveTimeZone: string;
  workspaceTimeZone: string;
};

/** Whether a group reaches the person on a channel in a saved grid (on when nothing was saved). */
export const choiceEnabled = (choices: readonly NoticeChoiceCell[], group: NotificationModule, channel: NoticeChannel) =>
  choices.find((cell) => cell.group === group && cell.channel === channel)?.enabled ?? true;
