// Structural copy of the reminder contract's constants in packages/contracts/src/reminders.ts (business-core does
// not depend on contracts). reminders-contract.spec.ts keeps both in step, and with the 0289 CHECK lists.

/** Kinds the engine plans and sends (the module's legacy chaser is removed when its kind moves here). */
export const ENGINE_REMINDER_KINDS = [
  "work.due",
  "crm.follow_up",
  "approval.waiting",
  "client.quote_decision",
  "client.design_decision",
  "quote.expiring",
  "payment.due",
  "invoice.overdue",
  "payables.due",
  "purchase.order_late",
  "design.stage_due",
  "permit.expiry",
  "finance_request.waiting",
  "change_request.client_decision",
] as const;
export type EngineReminderKind = (typeof ENGINE_REMINDER_KINDS)[number];

/** Kinds shown in My day only: the module keeps sending its own notices (`notify: "module"`). */
export const MY_DAY_ONLY_KINDS = [
  "crm.first_response",
  "crm.unowned",
  "crm.confirm_client",
  "crm.reply_waiting",
  "site.daily_report",
  "factory.production_due",
  "books.posting_issue",
] as const;
export type MyDayOnlyKind = (typeof MY_DAY_ONLY_KINDS)[number];

export const REMINDER_KINDS = [...ENGINE_REMINDER_KINDS, ...MY_DAY_ONLY_KINDS] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/** The module a kind belongs to: Settings › Reminders has one section per module, My day filters by it. */
export const REMINDER_MODULES = ["sales", "quotations", "design", "projects", "purchasing", "factory", "finance", "ledger", "approvals"] as const;
export type ReminderModule = (typeof REMINDER_MODULES)[number];

export const REMINDER_AUDIENCES = ["staff", "client"] as const;
export type ReminderAudience = (typeof REMINDER_AUDIENCES)[number];

/** Who sends: the engine, or the module itself (My day only). */
export type ReminderNotify = "engine" | "module";

export const REMINDER_UNITS = ["day", "hour"] as const;
export type ReminderUnit = (typeof REMINDER_UNITS)[number];

/**
 * Escalation chain links, resolved per subject: manager = a team lead of the owner's team, else the project
 * manager; project_manager; finance (receivables.manage); purchasing (purchasing.approve); owner (system role).
 * A level that resolves to nobody passes to the next link. Each level fires once.
 */
export const REMINDER_CHAIN_LINKS = ["manager", "project_manager", "finance", "purchasing", "owner"] as const;
export type ReminderChainLink = (typeof REMINDER_CHAIN_LINKS)[number];

/** Channels in the order a rule lists them. Staff: in_app → push → email. Clients: whatsapp → email. */
export const REMINDER_CHANNELS = ["in_app", "push", "email", "whatsapp"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export const REMINDER_SUBJECT_STATUSES = ["open", "snoozed", "done", "cancelled"] as const;
export type ReminderSubjectStatus = (typeof REMINDER_SUBJECT_STATUSES)[number];

/** Why a subject closed: its record says so, the record is gone, or it was cancelled. Never marked by hand. */
export const REMINDER_DONE_REASONS = ["record", "source_gone", "cancelled"] as const;
export type ReminderDoneReason = (typeof REMINDER_DONE_REASONS)[number];

export const REMINDER_STEP_KINDS = ["remind", "escalate"] as const;
export type ReminderStepKind = (typeof REMINDER_STEP_KINDS)[number];

export const REMINDER_STEP_STATES = ["planned", "held", "sent", "digested", "skipped", "cancelled"] as const;
export type ReminderStepState = (typeof REMINDER_STEP_STATES)[number];

export const REMINDER_SKIP_REASONS = ["done", "snoozed", "consent_missing", "cap_reached", "no_recipient", "muted", "unreachable", "disabled"] as const;
export type ReminderSkipReason = (typeof REMINDER_SKIP_REASONS)[number];

/** Why a step waits: the recipient's quiet hours, the one-a-day client cap, or outside the client window. */
export const REMINDER_HOLD_REASONS = ["quiet_hours", "client_cap", "client_window"] as const;
export type ReminderHoldReason = (typeof REMINDER_HOLD_REASONS)[number];

/** One client reminder per party per local day: the lower number wins, the rest are held. */
export const CLIENT_REMINDER_PRIORITY = { payment: 1, decision: 2, other: 3 } as const;
export type ClientReminderPriority = (typeof CLIENT_REMINDER_PRIORITY)[keyof typeof CLIENT_REMINDER_PRIORITY];

/** Step keys: `r:<offset>` for a reminder (offset in the rule's unit), `e:<level>` for an escalation. */
export const reminderStepKey = {
  remind: (offset: number) => `r:${offset}`,
  escalate: (level: number) => `e:${level}`,
};

export type ReminderKindInfo = {
  module: ReminderModule;
  audience: ReminderAudience;
  critical: boolean;
  notify: ReminderNotify;
  /**
   * The notification event type the engine sends under. Its first segment is the module prefix the person's
   * notification settings mute ("work.*" mutes work.due); a critical kind ignores mutes. Null for My day only.
   */
  eventType: string | null;
};

export const REMINDER_KIND_INFO: Record<ReminderKind, ReminderKindInfo> = {
  "work.due": { module: "projects", audience: "staff", critical: false, notify: "engine", eventType: "work.due" },
  "crm.follow_up": { module: "sales", audience: "staff", critical: false, notify: "engine", eventType: "crm.follow_up_due" },
  "approval.waiting": { module: "approvals", audience: "staff", critical: true, notify: "engine", eventType: "approvals.waiting" },
  "client.quote_decision": { module: "quotations", audience: "client", critical: false, notify: "engine", eventType: "quotation.client_decision" },
  "client.design_decision": { module: "design", audience: "client", critical: false, notify: "engine", eventType: "design.client_decision" },
  "quote.expiring": { module: "quotations", audience: "staff", critical: false, notify: "engine", eventType: "quotation.expiring" },
  "payment.due": { module: "finance", audience: "client", critical: true, notify: "engine", eventType: "receivables.payment_due" },
  "invoice.overdue": { module: "finance", audience: "staff", critical: true, notify: "engine", eventType: "receivables.overdue" },
  "payables.due": { module: "finance", audience: "staff", critical: true, notify: "engine", eventType: "payables.due" },
  "purchase.order_late": { module: "purchasing", audience: "staff", critical: false, notify: "engine", eventType: "purchasing.order_late" },
  "design.stage_due": { module: "design", audience: "staff", critical: false, notify: "engine", eventType: "design.stage_due" },
  "permit.expiry": { module: "projects", audience: "staff", critical: true, notify: "engine", eventType: "site.permit_expiry" },
  "finance_request.waiting": { module: "finance", audience: "staff", critical: false, notify: "engine", eventType: "finance_request.waiting" },
  "change_request.client_decision": { module: "projects", audience: "client", critical: false, notify: "engine", eventType: "change_request.client_decision" },
  "crm.first_response": { module: "sales", audience: "staff", critical: false, notify: "module", eventType: null },
  "crm.unowned": { module: "sales", audience: "staff", critical: false, notify: "module", eventType: null },
  "crm.confirm_client": { module: "sales", audience: "staff", critical: false, notify: "module", eventType: null },
  "crm.reply_waiting": { module: "sales", audience: "staff", critical: false, notify: "module", eventType: null },
  "site.daily_report": { module: "projects", audience: "staff", critical: false, notify: "module", eventType: null },
  "factory.production_due": { module: "factory", audience: "staff", critical: false, notify: "module", eventType: null },
  "books.posting_issue": { module: "ledger", audience: "staff", critical: false, notify: "module", eventType: null },
};

/**
 * A kind's cadence and routing (a reminder_rules row; no row = these defaults).
 * - offsets: 1 to 6 ascending values in `unit`, relative to the due moment (negative = before).
 * - workingDays: day offsets count the workspace's working days and skip its holidays.
 * - escalateAfter: escalate after this many reminders went unanswered (null = never). For a client kind the
 *   first escalation is the staff copy to the subject's owner; later levels follow `chain`.
 * - chain: at most 3 links, in order. channels: ordered, at least one.
 * - digest: non-critical items go only into the person's digest instead of being sent one by one.
 */
export type ReminderRuleDefaults = {
  offsets: readonly number[];
  unit: ReminderUnit;
  workingDays: boolean;
  escalateAfter: number | null;
  chain: readonly ReminderChainLink[];
  channels: readonly ReminderChannel[];
  digest: boolean;
  /** Client kinds only (CLIENT_REMINDER_PRIORITY); null for staff kinds. */
  priority: ClientReminderPriority | null;
};

const STAFF_CHANNELS = ["in_app", "push", "email"] as const;
const CLIENT_CHANNELS = ["whatsapp", "email"] as const;

/** Plan §6.24a "Sources the engine notifies (MVP)". */
export const REMINDER_KIND_DEFAULTS: Record<EngineReminderKind, ReminderRuleDefaults> = {
  "work.due": { offsets: [-1, 0, 1, 3], unit: "day", workingDays: false, escalateAfter: 2, chain: ["manager", "owner"], channels: STAFF_CHANNELS, digest: false, priority: null },
  "crm.follow_up": { offsets: [0, 1], unit: "day", workingDays: false, escalateAfter: 2, chain: ["manager", "owner"], channels: STAFF_CHANNELS, digest: false, priority: null },
  "approval.waiting": { offsets: [24, 48], unit: "hour", workingDays: false, escalateAfter: 2, chain: ["owner"], channels: STAFF_CHANNELS, digest: false, priority: null },
  "client.quote_decision": { offsets: [2, 5], unit: "day", workingDays: false, escalateAfter: 2, chain: [], channels: CLIENT_CHANNELS, digest: false, priority: CLIENT_REMINDER_PRIORITY.decision },
  "client.design_decision": { offsets: [2, 5], unit: "day", workingDays: false, escalateAfter: 2, chain: [], channels: CLIENT_CHANNELS, digest: false, priority: CLIENT_REMINDER_PRIORITY.decision },
  "quote.expiring": { offsets: [-3, 0], unit: "day", workingDays: false, escalateAfter: null, chain: [], channels: STAFF_CHANNELS, digest: false, priority: null },
  "payment.due": { offsets: [-3, 0, 3, 7], unit: "day", workingDays: false, escalateAfter: null, chain: [], channels: CLIENT_CHANNELS, digest: false, priority: CLIENT_REMINDER_PRIORITY.payment },
  "invoice.overdue": { offsets: [1, 7, 14], unit: "day", workingDays: false, escalateAfter: 2, chain: ["finance", "owner"], channels: STAFF_CHANNELS, digest: false, priority: null },
  "payables.due": { offsets: [-3, 0, 3], unit: "day", workingDays: false, escalateAfter: 2, chain: ["finance", "owner"], channels: STAFF_CHANNELS, digest: false, priority: null },
  "purchase.order_late": { offsets: [1, 7, 14], unit: "day", workingDays: false, escalateAfter: 2, chain: ["purchasing", "owner"], channels: STAFF_CHANNELS, digest: false, priority: null },
  "design.stage_due": { offsets: [-1, 0, 1, 3], unit: "day", workingDays: false, escalateAfter: 2, chain: ["manager", "owner"], channels: STAFF_CHANNELS, digest: false, priority: null },
  "permit.expiry": { offsets: [-3, -1, 0], unit: "day", workingDays: true, escalateAfter: 1, chain: ["project_manager", "owner"], channels: STAFF_CHANNELS, digest: false, priority: null },
  "finance_request.waiting": { offsets: [1, 3], unit: "day", workingDays: false, escalateAfter: 2, chain: ["finance", "owner"], channels: STAFF_CHANNELS, digest: false, priority: null },
  "change_request.client_decision": { offsets: [2, 5], unit: "day", workingDays: false, escalateAfter: 2, chain: [], channels: CLIENT_CHANNELS, digest: false, priority: CLIENT_REMINDER_PRIORITY.decision },
};

/** Bounds a rule must keep (the database checks the same). */
export const REMINDER_RULE_LIMITS = { maxOffsets: 6, maxChain: 3, maxEscalateAfter: 6, offsetRange: { day: 90, hour: 720 } } as const;

/** Firm-wide defaults (reminder_settings; no row = these). Times are local HH:MM in the recipient's zone. */
export const REMINDER_SETTINGS_DEFAULTS = { quietStart: "20:00", quietEnd: "08:00", digestTime: "08:00", clientWindow: null, criticalBreaksQuiet: false } as const;

/** A snooze lasts at most 14 days; a critical item snoozes only to the next working day. */
export const MAX_SNOOZE_DAYS = 14;

export const REMINDER_PERMISSIONS = { manage: "reminders.manage", team: "reminders.team" } as const;

/** Notification template codes (business-core notifications/default-templates.ts). */
export const reminderTemplateCode = {
  /** Staff kinds (in_app, push, email); client kinds (email to the client). */
  kind: (kind: EngineReminderKind) => `reminders.${kind}`,
  /** The staff copy of a client kind after `escalateAfter` reminders (in_app, push, email). */
  staffCopy: (kind: ClientDecisionKind) => `reminders.${kind}.staff`,
  escalated: "reminders.escalated",
  digest: "reminders.digest",
  unreachable: "reminders.unreachable",
  deliveryFailed: "reminders.delivery_failed",
} as const;

export type HoursWindow = { start: string; end: string };

/** Client kinds whose first escalation is a staff copy to the subject's owner ("waiting on the client"). */
export type ClientDecisionKind = "client.quote_decision" | "client.design_decision" | "change_request.client_decision";
export const CLIENT_DECISION_KINDS: readonly ClientDecisionKind[] = ["client.quote_decision", "client.design_decision", "change_request.client_decision"];

/** Kinds that wait on someone since a moment (My day's "Waiting"), rather than fall due on a day. */
export const WAITING_REMINDER_KINDS: readonly ReminderKind[] = [
  "approval.waiting", "client.quote_decision", "client.design_decision", "change_request.client_decision", "finance_request.waiting",
  "crm.unowned", "crm.confirm_client", "crm.reply_waiting",
];

/** Notification event types that can't be muted (R13): the critical kinds' events. Settings › Notifications shows them "Always on". */
export const CRITICAL_REMINDER_EVENT_TYPES: readonly string[] = (Object.keys(REMINDER_KIND_INFO) as ReminderKind[])
  .filter((kind) => REMINDER_KIND_INFO[kind].critical && REMINDER_KIND_INFO[kind].eventType)
  .map((kind) => REMINDER_KIND_INFO[kind].eventType as string);

export const isEngineReminderKind = (value: string): value is EngineReminderKind => (ENGINE_REMINDER_KINDS as readonly string[]).includes(value);
export const isReminderKind = (value: string): value is ReminderKind => (REMINDER_KINDS as readonly string[]).includes(value);
