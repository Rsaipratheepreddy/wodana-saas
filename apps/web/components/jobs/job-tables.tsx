"use client";

import { useT } from "@/lib/i18n/i18n-provider";
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
  useDesignSystem,
  type DataGridColumn,
} from "@/design-system";
import { tKey, translateKnown, type Translate } from "@/lib/i18n/keys";
import {
  actionableJobs,
  jobFlagLabels,
  jobPhaseLabel,
  jobStateLabel,
  jobStateTone,
  type JobIdentityProjection,
} from "@/lib/jobs/jobs";
import styles from "./jobs.module.css";

/** Dates read in the person's locale and the workspace time zone. */
type JobFormat = { t: Translate; locale: string; timeZone: string };

function useJobFormat(): JobFormat {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  return useMemo(() => ({ t, locale, timeZone }), [t, locale, timeZone]);
}

function dateLabel(format: JobFormat, value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return format.t("No date");
  return new Intl.DateTimeFormat(format.locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: format.timeZone,
  }).format(new Date(value));
}

/** The calendar day ("2026-09-27") in the workspace time zone, for comparisons only. */
function dayKey(timeZone: string, value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone,
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function dueState(timeZone: string, value: string | null, today = dayKey(timeZone, new Date())) {
  const due = value ? dayKey(timeZone, value) : null;
  if (!due || !today) return "unscheduled" as const;
  if (due < today) return "overdue" as const;
  if (due === today) return "today" as const;
  return "upcoming" as const;
}

function dueLabel(format: JobFormat, value: string | null) {
  const { t } = format;
  const state = dueState(format.timeZone, value);
  if (state === "overdue") return t("Overdue · {date}", { date: dateLabel(format, value) });
  if (state === "today") return t("Due today");
  return value ? t("Due {date}", { date: dateLabel(format, value) }) : t("No due date");
}

function identity(t: Translate, job: JobIdentityProjection) {
  return <span className={styles.identity}>
    <Avatar name={job.customer?.name ?? job.title ?? job.reference} size="sm" />
    <span><strong>{job.customer?.name ?? t("Customer not linked")}</strong><small>{job.title ?? t("Untitled job")}</small></span>
  </span>;
}

function state(t: Translate, job: JobIdentityProjection) {
  return <span className={styles.state}>
    <Badge tone={jobStateTone(job)}>{t(jobStateLabel(job) as never)}</Badge>
    {jobFlagLabels(job).slice(1).map((flag) => <small key={flag}>{t(flag as never)}</small>)}
  </span>;
}

function useColumns(format: JobFormat): DataGridColumn<JobIdentityProjection>[] {
  return useMemo(() => {
    const { t } = format;
    return [
    { id: "identity", accessorFn: (job) => `${job.customer?.name ?? ""} ${job.title ?? ""}`, header: t("Customer / Job"), size: 220, meta: { primary: true, renderCell: (job) => identity(t, job) } },
    { accessorKey: "reference", header: t("Reference"), size: 110, meta: { renderCell: (job) => <span className={styles.reference}>{job.reference}</span> } },
    { accessorKey: "phase", header: t("Phase"), size: 95, meta: { renderCell: (job) => <Badge tone={job.phase === "unknown" ? "neutral" : "info"}>{t(jobPhaseLabel(job.phase) as never)}</Badge> } },
    { id: "owner", accessorFn: (job) => job.owner?.name ?? "", header: t("Owner"), size: 115, meta: { mobileHidden: true, renderCell: (job) => job.owner?.name ?? t("Unassigned") } },
    { accessorKey: "targetDate", header: t("Promise"), size: 105, meta: { mobileHidden: true, renderCell: (job) => dateLabel(format, job.targetDate) } },
    { id: "state", accessorFn: (job) => t(jobStateLabel(job) as never), header: t("Risk"), size: 100, meta: { renderCell: (job) => state(t, job) } },
    { id: "nextAction", accessorFn: (job) => job.nextAction?.title ?? "", header: t("Next action"), size: 190, meta: { mobileHidden: true, renderCell: (job) => job.nextAction?.title ?? t("No action due") } },
  ];
  }, [format]);
}

function JobTable({ items }: { items: JobIdentityProjection[] }) {
  const format = useJobFormat();
  const { t } = format;
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [view, setView] = useState("all");
  const columns = useColumns(format);
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
    { id: "all", label: t("All Jobs") },
    { id: "qualify", label: t("Qualify") },
    { id: "design_scope", label: t("Design & scope") },
    { id: "price", label: t("Price") },
    { id: "deliver", label: t("Deliver") },
  ];

  return <DataGrid
    ariaLabel={t("Jobs")}
    columns={columns}
    data={rows}
    emptyDescription={t("Jobs appear here when an enquiry or delivery record is linked.")}
    emptyTitle={t("No Jobs yet")}
    exportFileName="jobs.csv"
    getRowId={(job) => job.jobId}
    onRowAction={(job) => router.push(`/workspace/crm/jobs/${job.jobId}`)}
    onSearchChange={setSearch}
    onViewChange={setView}
    persistKey="job-jobs"
    rowNumbers={false}
    savedViews={savedViews}
    searchLabel={t("Search Jobs")}
    searchValue={search}
    selectable={false}
    selectedView={view}
    totalRowCount={rows.length}
  />;
}

export function TodayJobsPage({ items, loadError }: { items: JobIdentityProjection[]; loadError?: string }) {
  const format = useJobFormat();
  const { t, locale, timeZone } = format;
  const router = useRouter();
  const actionable = actionableJobs(items);
  const [filter, setFilter] = useState<"all" | "overdue" | "blocked" | "client" | "risk">("all");
  const overview = useMemo(() => ({
    attention: actionable.length,
    overdue: actionable.filter((job) => dueState(timeZone, job.nextAction?.dueAt ?? null) === "overdue").length,
    blocked: actionable.filter((job) => job.flags.blocked.active).length,
    client: actionable.filter((job) => job.flags.awaiting_client.active).length,
    risk: actionable.filter((job) => job.flags.at_risk.active).length,
  }), [actionable, timeZone]);
  const queue = useMemo(() => actionable
    .filter((job) => filter === "all"
      || filter === "overdue" && dueState(timeZone, job.nextAction?.dueAt ?? null) === "overdue"
      || filter === "blocked" && job.flags.blocked.active
      || filter === "client" && job.flags.awaiting_client.active
      || filter === "risk" && job.flags.at_risk.active)
    .sort((left, right) => {
      const priority = (job: JobIdentityProjection) => job.flags.blocked.active
        ? 0
        : dueState(timeZone, job.nextAction?.dueAt ?? null) === "overdue"
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
    }), [actionable, filter, timeZone]);
  const promises = useMemo(() => items
    .filter((job) => job.targetDate && Number.isFinite(Date.parse(job.targetDate)) && (dayKey(timeZone, job.targetDate) ?? "") >= (dayKey(timeZone, new Date()) ?? ""))
    .sort((left, right) => Date.parse(left.targetDate ?? "") - Date.parse(right.targetDate ?? ""))
    .slice(0, 4), [items, timeZone]);
  const onTrack = items.filter((job) => !job.accessLimited && jobFlagLabels(job).length === 0).length;
  const limited = items.filter((job) => job.accessLimited).length;
  const dataGaps = items.filter((job) => job.missingSourceCount > 0).length;
  const metrics = [
    { id: "all", label: t("Needs attention"), value: overview.attention, icon: CircleAlert, tone: "attention", empty: "" },
    { id: "overdue", label: t("Overdue"), value: overview.overdue, icon: Clock3, tone: "danger", empty: t("No overdue work") },
    { id: "blocked", label: t("Blocked"), value: overview.blocked, icon: AlertTriangle, tone: "danger", empty: t("No blocked work") },
    { id: "client", label: t("Awaiting client"), value: overview.client, icon: UserRoundCheck, tone: "warning", empty: t("No awaiting client work") },
    { id: "risk", label: t("At risk"), value: overview.risk, icon: ShieldCheck, tone: "warning", empty: t("No at risk work") },
  ] as const;

  return <Container as="section" className={`${styles.page} ${styles.todayPage}`} size="full">
    <Stack gap={5}>
      <header className={styles.todayHeader}>
        <p className={styles.todayDate}>{new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone }).format(new Date())}</p>
        <div className={styles.todayTitleRow}><div><h1>{t("Today")}</h1><p>{t("A little clarity for the day ahead.")}</p></div>
          <Button onPress={() => router.push("/workspace/crm/leads?create=true")} size="compact" variant="primary"><Plus aria-hidden="true" size={15} />{t("Add enquiry")}</Button>
        </div>
        <div className={styles.quickLinks}><Button onPress={() => router.push("/workspace/crm/jobs")} size="compact" variant="quiet"><BriefcaseBusiness aria-hidden="true" size={15} />{t("All Jobs")}<ArrowRight aria-hidden="true" size={14} /></Button><Button onPress={() => router.push("/workspace/crm/follow-ups?view=schedule")} size="compact" variant="quiet"><CalendarClock aria-hidden="true" size={15} />{t("Calendar")}</Button></div>
      </header>
      {loadError ? <Callout title={t("Jobs could not be refreshed")} tone="warning">{translateKnown(t, loadError)}</Callout> : null}
      <div aria-label={t("Today's work summary")} className={styles.metricGrid} role="region">
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
            <div><p>{t("Action queue")}</p><h2 id="priority-queue-heading">{filter === "all" ? t("What needs your attention") : metrics.find((metric) => metric.id === filter)?.label}</h2></div>
            <span>{queue.length === 1 ? t("1 action") : t("{count} actions", { count: queue.length })}</span>
          </header>

          {queue.length ? <div className={styles.queueList}>
            {queue.slice(0, 8).map((job) => {
              const title = job.nextAction?.title ?? t("Review {state} Job", { state: t(jobStateLabel(job) as never).toLocaleLowerCase(locale) });
              const reason = job.nextAction?.reason
                ?? job.flags.blocked.reason
                ?? job.flags.at_risk.reason
                ?? job.flags.awaiting_client.reason
                ?? t("Review the current Job state");
              return <button className={styles.queueItem} data-state={jobStateTone(job)} key={job.jobId} onClick={() => router.push(job.nextAction?.route ?? `/workspace/crm/jobs/${job.jobId}`)} type="button">
                <span className={styles.queueIcon}><CalendarClock aria-hidden="true" size={16} /></span>
                <span className={styles.queueBody}>
                  <span className={styles.queueMeta}><strong>{job.customer?.name ?? t("Customer not linked")}</strong><small>{job.reference} · {t(jobPhaseLabel(job.phase) as never)}</small></span>
                  <b>{title}</b>
                  <small>{reason}</small>
                  <span className={styles.queueFooter}><span className={styles.owner}><Avatar name={job.nextAction?.owner?.name ?? job.owner?.name ?? job.customer?.name ?? job.reference} size="sm" />{job.nextAction?.owner?.name ?? job.owner?.name ?? t("Unassigned")}</span><time data-overdue={dueState(timeZone, job.nextAction?.dueAt ?? null) === "overdue" || undefined}>{dueLabel(format, job.nextAction?.dueAt ?? null)}</time></span>
                </span>
                <ArrowRight aria-hidden="true" className={styles.queueArrow} size={16} />
              </button>;
            })}
            {queue.length > 8 ? <footer className={styles.queueMore}><span>{t("Showing the 8 highest-priority actions")}</span><Button onPress={() => router.push("/workspace/crm/jobs")} size="compact">{t("Open all Jobs")}<ArrowRight aria-hidden="true" size={14} /></Button></footer> : null}
          </div> : <div className={styles.clearState}>
            <span><CheckCircle2 aria-hidden="true" size={22} /></span>
            <div><h3>{filter === "all" ? t("You’re clear for now") : metrics.find((metric) => metric.id === filter)?.empty}</h3><p>{filter === "all" ? t("No active Job needs immediate action. New follow-ups and delivery risks will appear here automatically.") : t("Choose another view or open all Jobs to review the wider pipeline.")}</p></div>
            {filter !== "all" ? <Button onPress={() => setFilter("all")} size="compact">{t("Show all attention")}</Button> : <Button onPress={() => router.push("/workspace/crm/jobs")} size="compact">{t("Review Jobs")}<ArrowRight aria-hidden="true" size={14} /></Button>}
          </div>}
        </section>

        <aside className={styles.dashboardRail}>
          <section aria-labelledby="portfolio-health-heading" className={styles.railPanel}>
            <header className={styles.panelHeader}><div><p>{t("Portfolio")}</p><h2 id="portfolio-health-heading">{t("Job health")}</h2></div><strong>{items.length}</strong></header>
            <div className={styles.healthList}>
              <span><i data-tone="success" /><b>{t("On track")}</b><strong>{onTrack}</strong></span>
              <span><i data-tone="warning" /><b>{t("Waiting on client")}</b><strong>{overview.client}</strong></span>
              <span><i data-tone="neutral" /><b>{t("Limited access")}</b><strong>{limited}</strong></span>
              <span><i data-tone="danger" /><b>{t("Data gaps")}</b><strong>{dataGaps}</strong></span>
            </div>
          </section>

          <section aria-labelledby="promises-heading" className={styles.railPanel}>
            <header className={styles.panelHeader}><div><p>{t("Delivery horizon")}</p><h2 id="promises-heading">{t("Upcoming promises")}</h2></div></header>
            {promises.length ? <div className={styles.promiseList}>{promises.map((job) => <button key={job.jobId} onClick={() => router.push(`/workspace/crm/jobs/${job.jobId}`)} type="button">
              <span><strong>{job.customer?.name ?? job.title ?? job.reference}</strong><small>{job.title ?? job.reference}</small></span>
              <time>{dateLabel(format, job.targetDate)}</time>
            </button>)}</div> : <div className={styles.railEmpty}><CalendarClock aria-hidden="true" size={17} /><span><strong>{t("No promises scheduled")}</strong><small>{t("Customer target dates will appear here.")}</small></span></div>}
          </section>
        </aside>
      </div>
    </Stack>
  </Container>;
}

export function JobsPage({ items, total, loadError }: { items: JobIdentityProjection[]; total: number; loadError?: string }) {
  const t = useT();
  return <Container as="section" className={styles.page} size="full">
    <Stack gap={5}>
      <PageHeader description={t("One record from first enquiry through handover, without copying source-owned facts.")} eyebrow={total === 1 ? t("1 Job") : t("{count} Jobs", { count: total })} title={t("Jobs")} />
      {loadError ? <Callout title={t("Jobs could not be refreshed")} tone="warning">{translateKnown(t, loadError)}</Callout> : null}
      <JobTable items={items} />
    </Stack>
  </Container>;
}
