"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Plus,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Container,
  DataGrid,
  PageHeader,
  Stack,
  type DataGridColumn,
} from "@/design-system";
import {
  actionableJobs,
  jobFlagLabels,
  jobPhaseLabel,
  jobStateLabel,
  jobStateTone,
  type JobIdentityProjection,
} from "@/lib/jobs/jobs";
import styles from "./jobs.module.css";

function dateLabel(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "No date";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Dubai",
  }).format(new Date(value));
}

function dayKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Dubai",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function dueState(value: string | null, today = dayKey(new Date())) {
  const due = value ? dayKey(value) : null;
  if (!due || !today) return "unscheduled" as const;
  if (due < today) return "overdue" as const;
  if (due === today) return "today" as const;
  return "upcoming" as const;
}

function dueLabel(value: string | null) {
  const state = dueState(value);
  if (state === "overdue") return `Overdue · ${dateLabel(value)}`;
  if (state === "today") return "Due today";
  return value ? `Due ${dateLabel(value)}` : "No due date";
}

function identity(job: JobIdentityProjection) {
  return <span className={styles.identity}>
    <Avatar name={job.customer?.name ?? job.title ?? job.reference} size="sm" />
    <span><strong>{job.customer?.name ?? "Customer not linked"}</strong><small>{job.title ?? "Untitled job"}</small></span>
  </span>;
}

function state(job: JobIdentityProjection) {
  return <span className={styles.state}>
    <Badge tone={jobStateTone(job)}>{jobStateLabel(job)}</Badge>
    {jobFlagLabels(job).slice(1).map((flag) => <small key={flag}>{flag}</small>)}
  </span>;
}

function useColumns(): DataGridColumn<JobIdentityProjection>[] {
  return useMemo(() => [
    { id: "identity", accessorFn: (job) => `${job.customer?.name ?? ""} ${job.title ?? ""}`, header: "Customer / Job", size: 220, meta: { primary: true, renderCell: identity } },
    { accessorKey: "reference", header: "Reference", size: 110, meta: { renderCell: (job) => <span className={styles.reference}>{job.reference}</span> } },
    { accessorKey: "phase", header: "Phase", size: 95, meta: { renderCell: (job) => <Badge tone={job.phase === "unknown" ? "neutral" : "info"}>{jobPhaseLabel(job.phase)}</Badge> } },
    { id: "owner", accessorFn: (job) => job.owner?.name ?? "", header: "Owner", size: 115, meta: { mobileHidden: true, renderCell: (job) => job.owner?.name ?? "Unassigned" } },
    { accessorKey: "targetDate", header: "Promise", size: 105, meta: { mobileHidden: true, renderCell: (job) => dateLabel(job.targetDate) } },
    { id: "state", accessorFn: jobStateLabel, header: "Risk", size: 100, meta: { renderCell: state } },
    { id: "nextAction", accessorFn: (job) => job.nextAction?.title ?? "", header: "Next action", size: 190, meta: { mobileHidden: true, renderCell: (job) => job.nextAction?.title ?? "No action due" } },
  ], []);
}

function JobTable({ items }: { items: JobIdentityProjection[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [view, setView] = useState("all");
  const columns = useColumns();
  const rows = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    return items.filter((job) => {
      const matchesView = view === "all"
        || view === "attention" && (job.nextAction || jobFlagLabels(job).length)
        || view === "blocked" && job.flags.blocked.active
        || view === "client" && job.flags.awaiting_client.active
        || view === "risk" && job.flags.at_risk.active
        || view === job.phase;
      const matchesSearch = !normalized || [job.reference, job.title, job.customer?.name, job.owner?.name, job.nextAction?.title]
        .some((value) => value?.toLocaleLowerCase().includes(normalized));
      return matchesView && matchesSearch;
    });
  }, [items, search, view]);
  const savedViews = [
    { id: "all", label: "All Jobs" },
    { id: "qualify", label: "Qualify" },
    { id: "design_scope", label: "Design & scope" },
    { id: "price", label: "Price" },
    { id: "deliver", label: "Deliver" },
  ];

  return <DataGrid
    ariaLabel="Jobs"
    columns={columns}
    data={rows}
    emptyDescription="Jobs appear here when an enquiry or delivery record is linked."
    emptyTitle="No Jobs yet"
    exportFileName="jobs.csv"
    getRowId={(job) => job.jobId}
    onRowAction={(job) => router.push(`/workspace/crm/jobs/${job.jobId}`)}
    onSearchChange={setSearch}
    onViewChange={setView}
    persistKey="job-jobs"
    rowNumbers={false}
    savedViews={savedViews}
    searchLabel="Search Jobs"
    searchValue={search}
    selectable={false}
    selectedView={view}
    totalRowCount={rows.length}
  />;
}

export function TodayJobsPage({ items, loadError }: { items: JobIdentityProjection[]; loadError?: string }) {
  const router = useRouter();
  const actionable = actionableJobs(items);
  const [filter, setFilter] = useState<"all" | "overdue" | "blocked" | "client" | "risk">("all");
  const overview = useMemo(() => ({
    attention: actionable.length,
    overdue: actionable.filter((job) => dueState(job.nextAction?.dueAt ?? null) === "overdue").length,
    blocked: actionable.filter((job) => job.flags.blocked.active).length,
    client: actionable.filter((job) => job.flags.awaiting_client.active).length,
    risk: actionable.filter((job) => job.flags.at_risk.active).length,
  }), [actionable]);
  const queue = useMemo(() => actionable
    .filter((job) => filter === "all"
      || filter === "overdue" && dueState(job.nextAction?.dueAt ?? null) === "overdue"
      || filter === "blocked" && job.flags.blocked.active
      || filter === "client" && job.flags.awaiting_client.active
      || filter === "risk" && job.flags.at_risk.active)
    .sort((left, right) => {
      const priority = (job: JobIdentityProjection) => job.flags.blocked.active
        ? 0
        : dueState(job.nextAction?.dueAt ?? null) === "overdue"
          ? 1
          : job.flags.at_risk.active
            ? 2
            : job.flags.awaiting_client.active
              ? 3
              : 4;
      const priorityDifference = priority(left) - priority(right);
      if (priorityDifference) return priorityDifference;
      return (Date.parse(left.nextAction?.dueAt ?? left.targetDate ?? "9999-12-31") || Number.MAX_SAFE_INTEGER)
        - (Date.parse(right.nextAction?.dueAt ?? right.targetDate ?? "9999-12-31") || Number.MAX_SAFE_INTEGER);
    }), [actionable, filter]);
  const promises = useMemo(() => items
    .filter((job) => job.targetDate && Number.isFinite(Date.parse(job.targetDate)) && (dayKey(job.targetDate) ?? "") >= (dayKey(new Date()) ?? ""))
    .sort((left, right) => Date.parse(left.targetDate ?? "") - Date.parse(right.targetDate ?? ""))
    .slice(0, 4), [items]);
  const onTrack = items.filter((job) => !job.accessLimited && jobFlagLabels(job).length === 0).length;
  const limited = items.filter((job) => job.accessLimited).length;
  const dataGaps = items.filter((job) => job.missingSourceCount > 0).length;
  const metrics = [
    { id: "all", label: "Needs attention", value: overview.attention, icon: CircleAlert, tone: "attention" },
    { id: "overdue", label: "Overdue", value: overview.overdue, icon: Clock3, tone: "danger" },
    { id: "blocked", label: "Blocked", value: overview.blocked, icon: AlertTriangle, tone: "danger" },
    { id: "client", label: "Awaiting client", value: overview.client, icon: UserRoundCheck, tone: "warning" },
    { id: "risk", label: "At risk", value: overview.risk, icon: ShieldCheck, tone: "warning" },
  ] as const;

  return <Container as="section" className={`${styles.page} ${styles.todayPage}`} size="full">
    <Stack gap={5}>
      <header className={styles.todayHeader}>
        <p className={styles.todayDate}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: "Asia/Dubai" }).format(new Date())}</p>
        <div className={styles.todayTitleRow}><div><h1>Today</h1><p>A little clarity for the day ahead.</p></div>
          <Button onPress={() => router.push("/workspace/crm/leads?create=true")} size="compact" variant="primary"><Plus aria-hidden="true" size={15} />Add enquiry</Button>
        </div>
        <div className={styles.quickLinks}><Button onPress={() => router.push("/workspace/crm/jobs")} size="compact" variant="quiet"><BriefcaseBusiness aria-hidden="true" size={15} />All Jobs<ArrowRight aria-hidden="true" size={14} /></Button><Button onPress={() => router.push("/workspace/crm/follow-ups?view=schedule")} size="compact" variant="quiet"><CalendarClock aria-hidden="true" size={15} />Calendar</Button></div>
      </header>
      {loadError ? <Callout title="Jobs could not be refreshed" tone="warning">{loadError}</Callout> : null}
      <div aria-label="Today's work summary" className={styles.metricGrid} role="region">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return <button aria-pressed={filter === metric.id} className={styles.metricCard} data-tone={metric.tone} key={metric.id} onClick={() => setFilter(metric.id)} type="button">
            <span><Icon aria-hidden="true" size={16} />{metric.label}</span>
            <strong>{metric.value}</strong>
          </button>;
        })}
      </div>

      <div className={styles.dashboardGrid}>
        <section aria-labelledby="priority-queue-heading" className={styles.queuePanel}>
          <header className={styles.panelHeader}>
            <div><p>Action queue</p><h2 id="priority-queue-heading">{filter === "all" ? "What needs your attention" : metrics.find((metric) => metric.id === filter)?.label}</h2></div>
            <span>{queue.length} {queue.length === 1 ? "action" : "actions"}</span>
          </header>

          {queue.length ? <div className={styles.queueList}>
            {queue.slice(0, 8).map((job) => {
              const title = job.nextAction?.title ?? `Review ${jobStateLabel(job).toLocaleLowerCase()} Job`;
              const reason = job.nextAction?.reason
                ?? job.flags.blocked.reason
                ?? job.flags.at_risk.reason
                ?? job.flags.awaiting_client.reason
                ?? "Review the current Job state";
              return <button className={styles.queueItem} data-state={jobStateTone(job)} key={job.jobId} onClick={() => router.push(job.nextAction?.route ?? `/workspace/crm/jobs/${job.jobId}`)} type="button">
                <span className={styles.queueIcon}><CalendarClock aria-hidden="true" size={16} /></span>
                <span className={styles.queueBody}>
                  <span className={styles.queueMeta}><strong>{job.customer?.name ?? "Customer not linked"}</strong><small>{job.reference} · {jobPhaseLabel(job.phase)}</small></span>
                  <b>{title}</b>
                  <small>{reason}</small>
                  <span className={styles.queueFooter}><span className={styles.owner}><Avatar name={job.nextAction?.owner?.name ?? job.owner?.name ?? job.customer?.name ?? job.reference} size="sm" />{job.nextAction?.owner?.name ?? job.owner?.name ?? "Unassigned"}</span><time data-overdue={dueState(job.nextAction?.dueAt ?? null) === "overdue" || undefined}>{dueLabel(job.nextAction?.dueAt ?? null)}</time></span>
                </span>
                <ArrowRight aria-hidden="true" className={styles.queueArrow} size={16} />
              </button>;
            })}
            {queue.length > 8 ? <footer className={styles.queueMore}><span>Showing the 8 highest-priority actions</span><Button onPress={() => router.push("/workspace/crm/jobs")} size="compact">Open all Jobs<ArrowRight aria-hidden="true" size={14} /></Button></footer> : null}
          </div> : <div className={styles.clearState}>
            <span><CheckCircle2 aria-hidden="true" size={22} /></span>
            <div><h3>{filter === "all" ? "You’re clear for now" : `No ${metrics.find((metric) => metric.id === filter)?.label.toLocaleLowerCase()} work`}</h3><p>{filter === "all" ? "No active Job needs immediate action. New follow-ups and delivery risks will appear here automatically." : "Choose another view or open all Jobs to review the wider pipeline."}</p></div>
            {filter !== "all" ? <Button onPress={() => setFilter("all")} size="compact">Show all attention</Button> : <Button onPress={() => router.push("/workspace/crm/jobs")} size="compact">Review Jobs<ArrowRight aria-hidden="true" size={14} /></Button>}
          </div>}
        </section>

        <aside className={styles.dashboardRail}>
          <section aria-labelledby="portfolio-health-heading" className={styles.railPanel}>
            <header className={styles.panelHeader}><div><p>Portfolio</p><h2 id="portfolio-health-heading">Job health</h2></div><strong>{items.length}</strong></header>
            <div className={styles.healthList}>
              <span><i data-tone="success" /><b>On track</b><strong>{onTrack}</strong></span>
              <span><i data-tone="warning" /><b>Waiting on client</b><strong>{overview.client}</strong></span>
              <span><i data-tone="neutral" /><b>Limited access</b><strong>{limited}</strong></span>
              <span><i data-tone="danger" /><b>Data gaps</b><strong>{dataGaps}</strong></span>
            </div>
          </section>

          <section aria-labelledby="promises-heading" className={styles.railPanel}>
            <header className={styles.panelHeader}><div><p>Delivery horizon</p><h2 id="promises-heading">Upcoming promises</h2></div></header>
            {promises.length ? <div className={styles.promiseList}>{promises.map((job) => <button key={job.jobId} onClick={() => router.push(`/workspace/crm/jobs/${job.jobId}`)} type="button">
              <span><strong>{job.customer?.name ?? job.title ?? job.reference}</strong><small>{job.title ?? job.reference}</small></span>
              <time>{dateLabel(job.targetDate)}</time>
            </button>)}</div> : <div className={styles.railEmpty}><CalendarClock aria-hidden="true" size={17} /><span><strong>No promises scheduled</strong><small>Customer target dates will appear here.</small></span></div>}
          </section>
        </aside>
      </div>
    </Stack>
  </Container>;
}

export function JobsPage({ items, total, loadError }: { items: JobIdentityProjection[]; total: number; loadError?: string }) {
  return <Container as="section" className={styles.page} size="full">
    <Stack gap={5}>
      <PageHeader description="One record from first enquiry through handover, without copying source-owned facts." eyebrow={`${total} ${total === 1 ? "Job" : "Jobs"}`} title="Jobs" />
      {loadError ? <Callout title="Jobs could not be refreshed" tone="warning">{loadError}</Callout> : null}
      <JobTable items={items} />
    </Stack>
  </Container>;
}
