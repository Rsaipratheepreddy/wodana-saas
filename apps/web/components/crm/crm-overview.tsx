"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, BellRing, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Plus, RefreshCw, Search } from "lucide-react";
import { Avatar, Button, Callout } from "@/design-system";
import { crmRequest, label, rows, type RecordData } from "@/lib/crm/client";
import { CRM_LEAD_STAGES, leadStage } from "@/lib/crm/leads";
import type { CrmScreenPageData } from "@/lib/crm/screens";
import { CrmProductShell, crmRecordLink, crmTime } from "./crm-product-shell";
import styles from "./crm-overview.module.css";

type SourceRow = { monthKey: string; monthLabel: string; source: string; count: number };
type PipelineLead = RecordData & { status?: string; partyName?: string; title?: string; source?: string; ownerName?: string; nextActionAt?: string; priority?: string };
type OverviewResponse = RecordData & {
  items?: RecordData[];
  summary?: Record<string, unknown>;
  total?: number;
  monthlyLeadSources?: SourceRow[];
  leadPipeline?: PipelineLead[];
};

const stages = CRM_LEAD_STAGES;

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function reminderLabel(kind: unknown) {
  if (kind === "overdue_activity") return "Overdue";
  if (kind === "due_today") return "Today";
  if (kind === "upcoming_activity") return "Upcoming";
  if (kind === "meeting_preparation") return "Meeting";
  if (kind === "customer_reply") return "Reply needed";
  if (kind === "sla_breach") return "SLA breached";
  return "Needs attention";
}

export function CrmOverview({ initialData }: { initialData: CrmScreenPageData }) {
  const [items, setItems] = useState(initialData.items);
  const [summary, setSummary] = useState((initialData.supporting.summary ?? {}) as Record<string, unknown>);
  const [monthlyLeadSources, setMonthlyLeadSources] = useState((initialData.supporting.monthlyLeadSources ?? []) as SourceRow[]);
  const [leadPipeline, setLeadPipeline] = useState((initialData.supporting.leadPipeline ?? []) as PipelineLead[]);
  const [total, setTotal] = useState(Number(initialData.supporting.total ?? items.length));
  const [search, setSearch] = useState("");
  const [selectedChartMonth, setSelectedChartMonth] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const reminderCarousel = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    setBusy(true);
    setFailure("");
    try {
      const result = await crmRequest<OverviewResponse>(initialData.workspaceId, "today");
      const nextItems = rows(result).map((item) => ({ ...item, id: `${item.kind}-${item.recordId}` }));
      setItems(nextItems);
      setSummary(result.summary ?? {});
      setMonthlyLeadSources(result.monthlyLeadSources ?? []);
      setLeadPipeline(result.leadPipeline ?? []);
      setTotal(Number(result.total ?? nextItems.length));
    } catch (error) {
      setFailure((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visiblePipeline = useMemo(() => leadPipeline.filter((lead) => !normalizedSearch || [lead.partyName, lead.title, lead.source, lead.ownerName].some((value) => String(value ?? "").toLocaleLowerCase().includes(normalizedSearch))), [leadPipeline, normalizedSearch]);
  const visibleReminders = useMemo(() => items.filter((item) => !normalizedSearch || [item.partyName, item.title, item.reason].some((value) => String(value ?? "").toLocaleLowerCase().includes(normalizedSearch))), [items, normalizedSearch]);

  const chart = useMemo(() => {
    const months = [...new Map(monthlyLeadSources.map((row) => [row.monthKey, row.monthLabel])).entries()];
    const sourceTotals = new Map<string, number>();
    for (const row of monthlyLeadSources) sourceTotals.set(row.source, (sourceTotals.get(row.source) ?? 0) + number(row.count));
    const sources = [...sourceTotals].sort((a, b) => b[1] - a[1]).map(([source]) => source);
    const totals = months.map(([monthKey]) => monthlyLeadSources.filter((row) => row.monthKey === monthKey).reduce((sum, row) => sum + number(row.count), 0));
    return { months, sources, max: Math.max(1, ...totals) };
  }, [monthlyLeadSources]);

  return <CrmProductShell title="Overview" description="Your leads and upcoming reminders." canView={initialData.canView} useWorkspaceColors headerClassName={styles.overviewHeader} actions={<div className={styles.commandBar}>
      <label><Search aria-hidden="true" size={14} /><input aria-label="Search CRM overview" placeholder="Search leads or clients…" type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <Button aria-label="Refresh CRM overview" size="compact" isLoading={busy} onPress={() => void refresh()}><RefreshCw aria-hidden="true" size={14} />Refresh</Button>
      <Link className={styles.primaryAction} href="/workspace/crm/leads?create=true"><Plus aria-hidden="true" size={14} />Add lead</Link>
    </div>}>

    {failure ? <Callout title="Could not refresh overview" tone="warning">{failure}</Callout> : null}

    <div className={styles.insightGrid}>
      <section aria-label="Lead sources over six months" className={styles.chartPanel}>
        <header><div><p>Last six months</p><h2>New leads by source</h2></div><strong>{monthlyLeadSources.reduce((sum, row) => sum + number(row.count), 0)} leads</strong></header>
        {chart.months.length && chart.sources.length ? <>
          <div className={styles.chart}>
            {chart.months.map(([monthKey, monthLabel], monthIndex) => {
              const monthRows = monthlyLeadSources.filter((row) => row.monthKey === monthKey);
              const monthTotal = monthRows.reduce((sum, row) => sum + number(row.count), 0);
              return <div className={styles.month} key={monthKey} aria-label={`${monthLabel}: ${monthTotal} leads`}>
                <button
                  aria-expanded={selectedChartMonth === monthKey}
                  aria-label={`Show ${monthLabel} lead source details`}
                  className={styles.bar}
                  onClick={() => setSelectedChartMonth((current) => current === monthKey ? null : monthKey)}
                  style={{ blockSize: `${Math.max(monthTotal ? 10 : 0, (monthTotal / chart.max) * 100)}%` }}
                  type="button"
                >
                  {chart.sources.map((source, index) => {
                    const count = number(monthRows.find((row) => row.source === source)?.count);
                    return count ? <span data-tone={index % 5} key={source} style={{ flexGrow: count }} title={`${label(source)}: ${count}`} /> : null;
                  })}
                </button>
                <small>{monthLabel}</small>
                {selectedChartMonth === monthKey ? <div className={styles.chartTooltip} role="tooltip" style={{ insetInlineStart: `${((monthIndex + .5) / chart.months.length) * 100}%` }}>
                  <strong>{monthLabel} · {monthTotal} {monthTotal === 1 ? "lead" : "leads"}</strong>
                  {chart.sources.map((source, index) => {
                    const count = number(monthRows.find((row) => row.source === source)?.count);
                    return count ? <span key={source}><i data-tone={index % 5} />{label(source)} <b>{count}</b></span> : null;
                  })}
                </div> : null}
              </div>;
            })}
          </div>
          <div className={styles.legend}>{chart.sources.map((source, index) => <span key={source}><i data-tone={index % 5} />{label(source)} <strong>{monthlyLeadSources.filter((row) => row.source === source).reduce((sum, row) => sum + number(row.count), 0)}</strong></span>)}</div>
        </> : <div className={styles.chartEmpty}><p>No lead-source activity yet.</p><small>New enquiries will build this chart automatically.</small></div>}
      </section>

      <aside aria-label="CRM key metrics" className={styles.metrics}>
        <Link href="/workspace/crm/follow-ups"><span><BellRing size={17} />Active follow-ups</span><strong>{summary.pendingFollowUps == null ? "—" : number(summary.pendingFollowUps).toLocaleString("en-GB")}</strong><small>Scheduled reminders</small></Link>
        <Link href="/workspace/crm/opportunities"><span><CheckCircle2 size={17} />Won this month</span><strong>{summary.wonThisMonth == null ? "—" : number(summary.wonThisMonth).toLocaleString("en-GB")}</strong><small>Deals ready to move forward</small></Link>
      </aside>
    </div>

    <section aria-label="Upcoming reminders" className={styles.reminders}>
      <header><div><h2>Upcoming reminders</h2><span>{total}</span></div><div className={styles.reminderControls}><button aria-label="Previous reminders" onClick={() => reminderCarousel.current?.scrollBy({ left: -280, behavior: "smooth" })} type="button"><ChevronLeft size={15} /></button><button aria-label="Next reminders" onClick={() => reminderCarousel.current?.scrollBy({ left: 280, behavior: "smooth" })} type="button"><ChevronRight size={15} /></button><Link href="/workspace/crm/follow-ups">View all <ArrowRight size={14} /></Link></div></header>
      {visibleReminders.length ? <div className={styles.reminderCarousel} ref={reminderCarousel}>{visibleReminders.map((item) => <Link href={crmRecordLink(item)} key={item.id}>
        <span className={styles.reminderTop}><span className={styles.reminderIcon} data-overdue={item.kind === "overdue_activity" || item.kind === "sla_breach" || undefined}><CalendarClock size={15} /></span><em>{reminderLabel(item.kind)}</em></span>
        <strong>{String(item.title ?? item.partyName ?? "CRM follow-up")}</strong>
        <small>{String(item.partyName ?? item.reason ?? "Client reminder")}</small>
        <time dateTime={typeof item.dueAt === "string" ? item.dueAt : undefined}>{crmTime(item.dueAt)}</time>
      </Link>)}</div> : <p className={styles.emptyState}>{normalizedSearch ? "No reminders match your search." : "No reminders need attention right now."}</p>}
    </section>

    <section aria-label="Lead pipeline" className={styles.pipeline}>
      <header><div><p>Lead pipeline</p><h2>Move every enquiry forward</h2></div><Link href="/workspace/crm/leads">Open full lead workspace <ArrowRight size={14} /></Link></header>
      <div className={styles.pipelineScroll}>
        {stages.map((stage) => {
          const leads = visiblePipeline.filter((lead) => leadStage(String(lead.status)) === stage.id);
          return <section aria-label={`${stage.label} column`} className={styles.column} key={stage.id}>
            <h3>{stage.label}<span>{leads.length}</span></h3>
            <div>{leads.slice(0, 6).map((lead) => <Link className={styles.leadCard} data-priority={lead.priority === "urgent" || lead.priority === "high" ? "high" : undefined} href={`/workspace/crm/leads?lead=${lead.id}`} key={lead.id}>
              <span className={styles.cardTop}><em>{label(lead.source, "Direct")}</em><ArrowRight size={14} /></span>
              <strong>{lead.partyName ?? "Unnamed lead"}</strong>
              <p>{lead.title ?? "Design enquiry"}</p>
              <span className={styles.cardFooter}><span><Avatar name={lead.ownerName ?? String(lead.partyName ?? "Lead")} size="sm" /><small>{lead.ownerName ?? "Unassigned"}</small></span><time dateTime={lead.nextActionAt}>{crmTime(lead.nextActionAt)}</time></span>
            </Link>)}</div>
            {!leads.length ? <p className={styles.columnEmpty}>{normalizedSearch ? "No matches" : "No leads in this stage"}</p> : null}
          </section>;
        })}
      </div>
    </section>
  </CrmProductShell>;
}
