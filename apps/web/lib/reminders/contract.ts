/**
 * The reminder contract's values for the web app (plan §6.24a). The contracts index re-exports with NodeNext ".js"
 * paths the web bundler can't follow, so web code takes types from "@wodana/contracts" and these values from the
 * self-contained source file.
 */
export {
  CRITICAL_REMINDER_EVENT_TYPES,
  DELIVERY_MESSAGE_STATUSES,
  ENGINE_REMINDER_KINDS,
  MAX_SNOOZE_DAYS,
  MY_DAY_ROUTE,
  MY_DAY_SCOPES,
  MY_DAY_URGENCIES,
  REMINDER_CHAIN_LINKS,
  REMINDER_CHANNELS,
  REMINDER_KIND_DEFAULTS,
  REMINDER_KIND_INFO,
  REMINDER_MODULES,
  REMINDER_PERMISSIONS,
  REMINDER_RULE_LIMITS,
  REMINDER_SETTINGS_DEFAULTS,
  WAITING_REMINDER_KINDS,
  isEngineReminderKind,
  isReminderKind,
  myDayHref,
  reminderApi,
  reminderHref,
} from "../../../../packages/contracts/src/reminders";
