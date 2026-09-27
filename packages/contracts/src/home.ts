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
  /** pre_projects.view */
  quotes?: { issuedValue: string; previousIssuedValue: string; issuedCount: number; accepted: number; previousAccepted: number; weekly: HomeMetricWeek[] };
  /** receivables.view — finance-verified client payments; due = open invoice / schedule amounts due this month. */
  payments?: { received: string; previousReceived: string; due: string; weekly: HomeMetricWeek[] };
  /** projects.view (scoped to assigned projects without projects.manage) */
  projects?: { active: number; overdueTasks: number; onTrack: number; atRisk: number; late: number; weekly: HomeMetricWeek[] };
  /** Audited events the caller may see (workspace audit permission), newest first, at most 6. */
  activity?: HomeActivityEvent[];
  /** workspace.settings.manage or data.manage */
  storage?: { usedBytes: string; quotaBytes: string | null; areas: { projects: string; planning: string; catalog: string; other: string } };
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
