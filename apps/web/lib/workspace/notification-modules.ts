import { tKey } from "@/lib/i18n/keys";

/**
 * Notices are grouped by the module their event comes from ("site.report_missing" → Projects). The bell,
 * the notifications page and Settings → Notifications share these groups; a preference for a group is
 * stored as each of its event prefixes with ".*".
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

export type NotificationPreference = { eventType: string; channel: string; enabled: boolean; quietHours: Record<string, unknown>; version: number };
export const PREFERENCE_CHANNELS = ["in_app", "email", "push"] as const;
export type PreferenceChannel = (typeof PREFERENCE_CHANNELS)[number];

/** Whether a module's notices reach the person on a channel: off only when every prefix is switched off. */
export function moduleEnabled(preferences: NotificationPreference[], module: NotificationModule, channel: PreferenceChannel) {
  const prefixes = NOTIFICATION_MODULES.find((item) => item.id === module)?.prefixes ?? [];
  return !prefixes.every((prefix) => preferences.some((row) => row.eventType === `${prefix}.*` && row.channel === channel && !row.enabled));
}
