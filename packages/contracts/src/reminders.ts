/**
 * Reminder engine (E4) and My day: the shared contract every reminder slice builds on (plan §6.24a).
 *
 * One subject per thing that is due (reminder_subjects), one step per planned reminder or escalation
 * (reminder_steps). Sources say what is due and when it is done; the engine plans, fires, escalates and
 * falls back; My day lists the open subjects. Dates are ISO strings; offsets are whole days or hours.
 */

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

// ---- My day ------------------------------------------------------------------------------------------------

export const MY_DAY_SCOPES = ["me", "team"] as const;
export type MyDayScope = (typeof MY_DAY_SCOPES)[number];

/** overdue (due before today), today, upcoming (a before-due reminder is out), waiting (on you since), snoozed. */
export const MY_DAY_URGENCIES = ["overdue", "today", "upcoming", "waiting", "snoozed"] as const;
export type MyDayUrgency = (typeof MY_DAY_URGENCIES)[number];

export const MY_DAY_ACTIONS = ["open", "snooze", "complete", "reassign"] as const;
export type MyDayAction = (typeof MY_DAY_ACTIONS)[number];

export type MyDayItem = {
  /** The subject id. */
  id: string;
  kind: ReminderKind;
  module: ReminderModule;
  title: string;
  context: string;
  /** /workspace/... */
  href: string;
  dueAt: string | null;
  urgency: MyDayUrgency;
  critical: boolean;
  audience: ReminderAudience;
  owner: { membershipId: string; name: string } | null;
  reminders: { sent: number; escalationLevel: number; nextAt: string | null };
  snoozed: { until: string; reason: string } | null;
  /** What the person may do; "complete" runs the module's own command and carries its label. */
  actions: MyDayAction[];
  completeLabel: string | null;
  version: number;
};

/** Items of one job (enquiry → case → project); items with no job are grouped on their own. */
export type MyDayGroup = {
  jobId: string | null;
  jobReference: string | null;
  title: string;
  href: string | null;
  items: MyDayItem[];
};

export type MyDayCounts = { overdue: number; today: number; upcoming: number; waiting: number; snoozed: number; total: number };

export type MyDayResponse = {
  generatedAt: string;
  scope: MyDayScope;
  timeZone: string;
  /** The person's local day (YYYY-MM-DD). */
  today: string;
  counts: MyDayCounts;
  groups: MyDayGroup[];
};

export type MyDayQuery = { scope?: MyDayScope; urgency?: MyDayUrgency; module?: ReminderModule; limit?: number };
export type MyDaySnoozeInput = { until: string; reason: string; version: number };
export type MyDayCompleteInput = { version: number };
export type MyDayReassignInput = { membershipId: string; version: number };
/** What a My day action returns: the item as it is now (null when it closed or left the person's list). */
export type MyDayActionResult = { item: MyDayItem | null };
/** People an item can be reassigned to (GET /my-day/:id/assignees). */
export type MyDayAssignee = { membershipId: string; name: string };

// ---- Timeline on a record ----------------------------------------------------------------------------------

export type ReminderStepDto = {
  id: string;
  dueRevision: number;
  stepKey: string;
  kind: ReminderStepKind;
  level: number;
  fireAt: string;
  state: ReminderStepState;
  skipReason: ReminderSkipReason | null;
  holdReason: ReminderHoldReason | null;
  heldUntil: string | null;
  firedAt: string | null;
  recipients: Array<{ membershipId: string; name: string }>;
};

export type ReminderSubjectDto = {
  id: string;
  kind: ReminderKind;
  sourceKey: string;
  title: string;
  context: string;
  href: string;
  dueAt: string | null;
  dueRevision: number;
  status: ReminderSubjectStatus;
  critical: boolean;
  remindersSent: number;
  escalationLevel: number;
  doneAt: string | null;
  doneReason: ReminderDoneReason | null;
  steps: ReminderStepDto[];
  version: number;
};

// ---- Settings ------------------------------------------------------------------------------------------------

export type ReminderRuleDto = {
  kind: EngineReminderKind;
  module: ReminderModule;
  audience: ReminderAudience;
  /** Critical kinds are always on ("Always on"). */
  critical: boolean;
  enabled: boolean;
  offsets: number[];
  unit: ReminderUnit;
  workingDays: boolean;
  escalateAfter: number | null;
  chain: ReminderChainLink[];
  channels: ReminderChannel[];
  digest: boolean;
  quietHours: HoursWindow | null;
  /** True when no firm row exists and the contract defaults apply. */
  isDefault: boolean;
  version: number;
};

export type ReminderRuleInput = Omit<ReminderRuleDto, "kind" | "module" | "audience" | "critical" | "isDefault">;

export type ReminderSettingsDto = {
  quietStart: string;
  quietEnd: string;
  digestTime: string;
  /** Null = the work calendar's hours. */
  clientWindow: HoursWindow | null;
  criticalBreaksQuiet: boolean;
  version: number;
};

/** GET /reminders/settings: the firm's settings and one rule per engine kind (the default when the firm has none). */
export type ReminderSettingsResponse = { settings: ReminderSettingsDto; rules: ReminderRuleDto[] };
export type ReminderSettingsInput = ReminderSettingsDto;

export type NotificationPersonSettingsDto = {
  digestEnabled: boolean;
  /** Null = the firm's digest time. */
  digestTime: string | null;
  /** Null = the firm's quiet hours. */
  quietHours: HoursWindow | null;
  /** IANA zone; null = the device's, then the profile's, then the workspace's. */
  timeZone: string | null;
  version: number;
};

/** GET /notification-person-settings/me: the person's own values and what applies when they leave one unset. */
export type NotificationPersonSettingsView = NotificationPersonSettingsDto & {
  firm: { quietStart: string; quietEnd: string; digestTime: string };
  /** The zone their reminders use now (own, then phone, then profile, then workspace). */
  effectiveTimeZone: string;
  workspaceTimeZone: string;
  /** Event types that are always on (critical); a mute of one is refused. */
  criticalEventTypes: string[];
};
export type NotificationPersonSettingsInput = NotificationPersonSettingsDto;

// ---- Delivery health -----------------------------------------------------------------------------------------

export const DELIVERY_MESSAGE_STATUSES = ["pending", "sent", "delivered", "read", "failed", "held", "suppressed"] as const;
export type DeliveryMessageStatus = (typeof DELIVERY_MESSAGE_STATUSES)[number];

export type DeliveryHealthMessage = {
  id: string;
  createdAt: string;
  updatedAt: string;
  channel: ReminderChannel | "webhook";
  eventType: string;
  recipient: { type: string; id: string; label: string };
  status: DeliveryMessageStatus;
  /** Why it was held, suppressed or failed. */
  reason: string | null;
  attempts: number;
  providerMessageId: string | null;
  critical: boolean;
  reminderStepId: string | null;
  fallbackOf: string | null;
  href: string | null;
};

export type DeliveryHealthMessagesQuery = { status?: DeliveryMessageStatus; channel?: string; from?: string; to?: string; cursor?: string; limit?: number };
export type DeliveryHealthMessagesResponse = { items: DeliveryHealthMessage[]; nextCursor: string | null };

// ---- Routes --------------------------------------------------------------------------------------------------

export const MY_DAY_ROUTE = "/workspace/my-day";

const query = (values: Record<string, string | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : "";
};

/** My day, with its toolbar state in the address (the default scope "me" is left out). */
export function myDayHref(filter: Omit<MyDayQuery, "limit"> = {}) {
  return `${MY_DAY_ROUTE}${query({ scope: filter.scope === "team" ? "team" : undefined, urgency: filter.urgency, module: filter.module })}`;
}

export const reminderHref = {
  myDay: myDayHref,
  settings: (kind?: EngineReminderKind) => `/workspace/settings/reminders${query({ kind })}`,
  notificationSettings: () => "/workspace/settings/notifications",
  deliveryHealth: () => "/workspace/settings/delivery",
};

/** API paths (business-core). */
export const reminderApi = {
  myDay: (workspaceId: string, filter: MyDayQuery = {}) =>
    `/workspaces/${workspaceId}/my-day${query({ scope: filter.scope, urgency: filter.urgency, module: filter.module, limit: filter.limit ? String(filter.limit) : undefined })}`,
  snooze: (workspaceId: string, subjectId: string) => `/workspaces/${workspaceId}/my-day/${subjectId}/snooze`,
  complete: (workspaceId: string, subjectId: string) => `/workspaces/${workspaceId}/my-day/${subjectId}/complete`,
  reassign: (workspaceId: string, subjectId: string) => `/workspaces/${workspaceId}/my-day/${subjectId}/reassign`,
  assignees: (workspaceId: string, subjectId: string) => `/workspaces/${workspaceId}/my-day/${subjectId}/assignees`,
  subjects: (workspaceId: string, sourceKey: string) => `/workspaces/${workspaceId}/reminders/subjects${query({ sourceKey })}`,
  settings: (workspaceId: string) => `/workspaces/${workspaceId}/reminders/settings`,
  rule: (workspaceId: string, kind: EngineReminderKind) => `/workspaces/${workspaceId}/reminders/rules/${encodeURIComponent(kind)}`,
  personSettings: (workspaceId: string) => `/workspaces/${workspaceId}/notification-person-settings/me`,
  healthMessages: (workspaceId: string) => `/workspaces/${workspaceId}/delivery-health/messages`,
  sweep: () => "/internal/reminders/sweep",
};

export const isEngineReminderKind = (value: string): value is EngineReminderKind => (ENGINE_REMINDER_KINDS as readonly string[]).includes(value);
export const isReminderKind = (value: string): value is ReminderKind => (REMINDER_KINDS as readonly string[]).includes(value);
