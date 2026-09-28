export type HomeOverviewItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  date: string | null;
};

export type HomeOverview = {
  sections: { sales: boolean; planning: boolean; projects: boolean };
  metrics: {
    myFollowUps: number | null;
    planningCases: number | null;
    activeProjects: number | null;
    myProjectTasks: number | null;
  };
  sales: HomeOverviewItem[];
  planning: HomeOverviewItem[];
  projects: HomeOverviewItem[];
  tasks: HomeOverviewItem[];
};

/** One week of a metric series. `start` is the local first day of the week (YYYY-MM-DD) in the workspace time zone. */
export type HomeMetricWeek = { start: string; value: string; count: number };

/**
 * Live Home metrics. Every section is present only when the caller has its permission;
 * money values are numeric strings in `currency`, never floats. Month values are month-to-date,
 * `previous` is the same elapsed span of the previous month.
 */
export type HomeMetrics = {
  generatedAt: string;
  timeZone: string;
  /** 0 = Sunday … 6 = Saturday, from the workspace region. */
  weekStartsOn: number;
  currency: string;
  /** crm.leads.view */
  enquiries?: { current: number; previous: number; weekly: HomeMetricWeek[] };
  /** pre_projects.view — `awaiting` = quotations issued to the client and not yet decided, on open cases. */
  quotes?: { issuedValue: string; previousIssuedValue: string; issuedCount: number; accepted: number; previousAccepted: number; awaiting: number; weekly: HomeMetricWeek[] };
  /** receivables.view — finance-verified client payments; due = open invoice / schedule amounts due this month. */
  payments?: { received: string; previousReceived: string; due: string; weekly: HomeMetricWeek[] };
  /** projects.view (scoped to assigned projects without projects.manage) */
  projects?: { active: number; overdueTasks: number; onTrack: number; atRisk: number; late: number; weekly: HomeMetricWeek[] };
  /** Audited events the caller may see (workspace audit permission), newest first, at most 6. */
  activity?: HomeActivityEvent[];
  /** workspace.settings.manage or data.manage */
  storage?: { usedBytes: string; quotaBytes: string | null; areas: { projects: string; planning: string; catalog: string; other: string } };
  /** crm.activities.view — open follow-ups in the workspace (the follow-ups list's To do); overdue = due before now. */
  followUps?: { open: number; overdue: number };
  /** purchasing.view — orders placed with a supplier that have not fully arrived. */
  orders?: { toReceive: number };
};

export type HomeActivityEvent = {
  id: string;
  /** Coarse area used for the icon: sales | planning | projects | finance | people | settings | other */
  area: string;
  /** Audit action key, e.g. crm.lead.created */
  action: string;
  /** Short subject such as the record name; may be empty. */
  subject: string;
  actorName: string | null;
  at: string;
  href: string | null;
};

/**
 * Home's calm overview for one person, read in one tenant transaction. Every section follows the caller's
 * permissions; what they may not see is left out, never guessed.
 */
export type HomeSummary = {
  generatedAt: string;
  timeZone: string;
  /** The workspace's local calendar day (YYYY-MM-DD). */
  today: string;
  /** What needs this person now: overdue first, then due today, then what waits on them (approvals). */
  focus: { items: HomeFocusItem[]; total: number };
  /** Dated work after now: the next 7 days, or the next 30 when the week is quiet (`horizonDays`). */
  upcoming: HomeUpcomingItem[];
  horizonDays: 7 | 30;
  /** The business flow the person can see, in order; a stage they can't see is left out. */
  funnel: HomeFunnelStage[];
  /** Records the person worked on most recently, then the ones in their care. */
  recent: HomeRecentRecord[];
  /** The person's running projects, most recent first, for actions that start on a project (a site report). */
  projects: Array<{ id: string; name: string }>;
};

/** Where a Today item comes from; the web picks the action label from it. */
export type HomeFocusSource =
  | "follow_up" | "response" | "reply" | "work" | "delivery" | "invoice" | "production"
  | "quote_review" | "receipt" | "order_approval" | "design_review" | "design_client" | "design_present" | "design_revise" | "petty_cash" | "leave";

export type HomeFocusItem = {
  /** Stable across reloads: `${source}:${recordId}`. */
  id: string;
  source: HomeFocusSource;
  urgency: "overdue" | "today" | "waiting";
  recordId: string;
  title: string;
  /** The client, project, supplier or person the item belongs to; may be empty. */
  context: string;
  /** When it was due (overdue, today) or since when it has waited (waiting); an ISO date or date-time. */
  due: string | null;
  href: string;
  /** The project of a work item, so it opens in place. */
  projectId?: string;
};

export type HomeUpcomingItem = {
  id: string;
  kind: "meeting" | "follow_up" | "work" | "delivery" | "payment" | "production";
  title: string;
  context: string;
  /** An ISO date-time for timed items (meetings, follow-ups), an ISO date for all-day ones. */
  at: string;
  allDay: boolean;
  href: string;
};

export type HomeFunnelStageId = "enquiries" | "planning" | "quotes" | "projects" | "handover";
export type HomeFunnelStage = {
  id: HomeFunnelStageId;
  count: number;
  /** Of `count`, the ones that have stalled: no movement for a while, overdue or late. */
  stuck: number;
  href: string;
};

export type HomeRecentRecord = {
  id: string;
  kind: "enquiry" | "case" | "project" | "order" | "work_order";
  title: string;
  context: string;
  /** When the person last worked on it, else when it last changed. */
  at: string;
  href: string;
};
