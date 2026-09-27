"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { HomeActivityEvent, HomeMetrics, HomeOverviewItem } from "@wodana/contracts";
import { AlertTriangle, ArrowRight, Banknote, CalendarClock, CircleCheck, ClipboardList, FileText, FolderKanban, History, Package, RefreshCw, Settings2, Truck, Users, type LucideIcon } from "lucide-react";
import { BarChart, Button, EmptyState, ErrorState, Progress, SkeletonBlock, SplitBar, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { formatBytes, formatCount, formatMoneyText, relativeTime, weekLabel, weekValue } from "./home-format";
import s from "./workspace-home.module.css";

export type MetricsState = { data: HomeMetrics | null; failed: boolean; retry: () => void };
/** A data-viz palette slot (`--wd-color-viz-N`): small accents only, such as icon tints and chart series. */
export type Series = 1 | 2 | 3 | 4 | 5 | 6;
type T = ReturnType<typeof useT>;

function useLocale() { return useDesignSystem().locale ?? "en"; }

/** A quiet "go to the list" link, the same on every widget. */
export function ViewLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link className={s.textAction} href={href}>{children}<ArrowRight size={14} aria-hidden="true" /></Link>;
}

/** Loading, failure and empty for one widget body; one failing source never blanks the rest of Home. */
export function WidgetBody({ loading, failed, retry, empty, children, rows = 3 }: { loading: boolean; failed: boolean; retry?: () => void; empty?: { title: string; action?: ReactNode; icon?: ReactNode } | null; children: ReactNode; rows?: number }) {
  const t = useT();
  if (loading) return <div className={s.skeleton} role="status" aria-label={t("Loading")}>{Array.from({ length: rows }, (_, index) => <span key={index} className={s.skeletonRow}><SkeletonBlock width={1.75} height={1.75} /><span><SkeletonBlock width={`${70 - index * 12}%`} height={0.75} /><SkeletonBlock width="40%" height={0.625} /></span></span>)}</div>;
  if (failed) return <div className={s.state} data-state="error"><ErrorState title={t("This could not be loaded")} description="" onRetry={retry} /></div>;
  if (empty) return <div className={s.state}><EmptyState illustration={null} icon={empty.icon ?? <CircleCheck size={16} aria-hidden="true" />} title={empty.title} action={empty.action} /></div>;
  return <>{children}</>;
}

/** One list row: a tinted icon, the name with a quiet second line, and a date or action at the end. */
export function Row({ href, icon: Icon, series, tone, title, detail, end }: { href?: string; icon: LucideIcon; series?: Series; tone?: "warning" | "danger"; title: ReactNode; detail?: ReactNode; end?: ReactNode }) {
  const body = <>
    <span className={s.rowIcon} data-series={tone ? undefined : series} data-tone={tone} aria-hidden="true"><Icon size={15} /></span>
    <span className={s.rowCopy}><strong>{title}</strong>{detail ? <small>{detail}</small> : null}</span>
    {end}
  </>;
  return href ? <Link className={s.row} href={href}>{body}</Link> : <div className={s.row}>{body}</div>;
}

type Figure = { id: string; label: string; value: string; href: string; Icon: LucideIcon; series: Series; note?: { text: string; tone: "warning" | "danger" } };

/** The figures a person can act on, most actionable first; each links to its list. */
function summaryFigures(data: HomeMetrics, t: T, locale: string): Figure[] {
  const count = (value: number) => formatCount(value, locale);
  const figures: Figure[] = [];
  if (data.followUps) figures.push({ id: "follow-ups", label: t("Follow-ups to do"), value: count(data.followUps.open), href: "/workspace/crm/follow-ups", Icon: CalendarClock, series: 1,
    note: data.followUps.overdue ? { text: t("{count} overdue", { count: count(data.followUps.overdue) }), tone: "warning" } : undefined });
  if (typeof data.quotes?.awaiting === "number") figures.push({ id: "quotes", label: t("Quotes awaiting the client"), value: count(data.quotes.awaiting), href: "/workspace/pre-projects?section=quotations", Icon: FileText, series: 2 });
  if (data.projects) figures.push({ id: "projects", label: t("Active projects"), value: count(data.projects.active), href: "/workspace/projects", Icon: FolderKanban, series: 3,
    note: data.projects.late ? { text: t("{count} late", { count: count(data.projects.late) }), tone: "danger" }
      : data.projects.overdueTasks ? { text: t("{count} overdue tasks", { count: count(data.projects.overdueTasks) }), tone: "warning" } : undefined });
  if (data.orders) figures.push({ id: "orders", label: t("Orders to receive"), value: count(data.orders.toReceive), href: "/workspace/purchasing/orders", Icon: Truck, series: 4 });
  if (data.payments) figures.push({ id: "payments", label: t("Due this month"), value: formatMoneyText(data.payments.due, data.currency, locale, true), href: "/workspace/finance", Icon: Banknote, series: 6 });
  if (data.enquiries) figures.push({ id: "enquiries", label: t("New enquiries this month"), value: count(data.enquiries.current), href: "/workspace/crm/leads", Icon: Users, series: 5 });
  return figures.slice(0, 4);
}

/** One row of up to four figures; while loading it keeps their places, and a failure keeps the rest of Home. */
export function SummaryStrip({ metrics, expected }: { metrics: MetricsState; expected: number }) {
  const t = useT();
  const locale = useLocale();
  const data = metrics.data;
  if (!data) {
    if (metrics.failed) return <div className={s.strip} data-state="error" role="alert"><AlertTriangle size={16} aria-hidden="true" /><span>{t("Figures could not be loaded")}</span><Button size="compact" onPress={metrics.retry}><RefreshCw size={14} aria-hidden="true" />{t("Retry")}</Button></div>;
    if (!expected) return null;
    return <div className={s.strip} data-count={expected} role="status" aria-label={t("Loading")}>{Array.from({ length: expected }, (_, index) => <span key={index} className={s.figure}><SkeletonBlock width={2} height={2} /><span className={s.figureCopy}><SkeletonBlock width={2.5} height={1.25} /><SkeletonBlock width={7} height={0.625} /></span></span>)}</div>;
  }
  const figures = summaryFigures(data, t, locale);
  if (!figures.length) return null;
  return <nav aria-label={t("Summary")}><ul className={s.strip} data-count={figures.length}>{figures.map(({ id, label, value, href, Icon, series, note }) => <li key={id}>
    <Link className={s.figure} data-figure={id} data-series={series} href={href}>
      <span className={s.figureIcon} aria-hidden="true"><Icon size={16} /></span>
      <span className={s.figureCopy}>
        <strong className={s.figureValue}>{value}</strong>
        <span className={s.figureLabel}>{label}{note ? <em data-tone={note.tone}>{note.text}</em> : null}</span>
      </span>
    </Link>
  </li>)}</ul></nav>;
}

/** Enquiries or quote value per week for the last eight weeks; the series is chosen in the widget header. */
export function TrendWidget({ metrics, series }: { metrics: MetricsState; series: "enquiries" | "quotes" }) {
  const t = useT();
  const locale = useLocale();
  const data = metrics.data;
  const source = series === "enquiries" ? data?.enquiries?.weekly : data?.quotes?.weekly;
  const points = (source ?? []).map(week => ({ label: weekLabel(week.start, locale), value: weekValue(week), display: series === "enquiries" ? formatCount(Number(week.value), locale) : formatMoneyText(week.value, data?.currency ?? "USD", locale) }));
  const total = points.reduce((sum, point) => sum + point.value, 0);
  return <WidgetBody loading={!data && !metrics.failed} failed={!data && metrics.failed} retry={metrics.retry} rows={3}
    empty={data && total === 0 ? { title: series === "enquiries" ? t("No enquiries in the last 8 weeks") : t("No quotes issued in the last 8 weeks"), icon: <FileText size={16} aria-hidden="true" />, action: <ViewLink href={series === "enquiries" ? "/workspace/crm/leads?create=true" : "/workspace/pre-projects?section=quotations"}>{series === "enquiries" ? t("New enquiry") : t("Open quotations")}</ViewLink> } : null}>
    <div className={s.trend} data-series={series === "enquiries" ? 1 : 2}>
      <BarChart ariaLabel={series === "enquiries" ? t("Enquiries per week, last 8 weeks") : t("Quote value issued per week, last 8 weeks")} data={points} />
    </div>
  </WidgetBody>;
}

export function MoneyWidget({ metrics }: { metrics: MetricsState }) {
  const t = useT();
  const locale = useLocale();
  const payments = metrics.data?.payments;
  const currency = metrics.data?.currency ?? "USD";
  const received = Number(payments?.received ?? 0);
  const due = Number(payments?.due ?? 0);
  const expected = received + due;
  const percent = expected > 0 ? Math.round((received / expected) * 100) : 0;
  return <WidgetBody loading={!metrics.data && !metrics.failed} failed={!metrics.data && metrics.failed} retry={metrics.retry} rows={2}
    empty={payments && expected === 0 ? { title: t("Nothing received or due this month"), icon: <Banknote size={16} aria-hidden="true" />, action: <ViewLink href="/workspace/finance">{t("Open finance")}</ViewLink> } : null}>
    {payments ? <div className={s.money}>
      <dl>
        <div><dt><i data-series="received" />{t("Received")}</dt><dd>{formatMoneyText(payments.received, currency, locale)}</dd></div>
        <div><dt><i data-series="due" />{t("Still due")}</dt><dd>{formatMoneyText(payments.due, currency, locale)}</dd></div>
      </dl>
      <Progress label={t("{percent}% of this month's payments received", { percent })} value={received} max={expected} />
    </div> : null}
  </WidgetBody>;
}

export function HealthWidget({ metrics }: { metrics: MetricsState }) {
  const t = useT();
  const locale = useLocale();
  const projects = metrics.data?.projects;
  const rows = projects ? [
    { id: "on-track", label: t("On track"), count: projects.onTrack, tone: "success" },
    { id: "at-risk", label: t("At risk"), count: projects.atRisk, tone: "warning" },
    { id: "late", label: t("Late"), count: projects.late, tone: "danger" },
  ] : [];
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return <WidgetBody loading={!metrics.data && !metrics.failed} failed={!metrics.data && metrics.failed} retry={metrics.retry}
    empty={projects && total === 0 ? { title: t("No active projects"), icon: <FolderKanban size={16} aria-hidden="true" />, action: <ViewLink href="/workspace/projects">{t("Open projects")}</ViewLink> } : null}>
    <ul className={s.health}>{rows.map(({ id, label, count, tone }) => <li key={id}><Link href={`/workspace/projects?health=${id}`} data-tone={tone}>
      <i aria-hidden="true" /><span>{label}</span>
      <span className={s.healthBar} aria-hidden="true"><b style={{ inlineSize: `${total ? (count / total) * 100 : 0}%` }} /></span>
      <strong>{formatCount(count, locale)}</strong>
    </Link></li>)}</ul>
  </WidgetBody>;
}

const areas: Record<string, { Icon: LucideIcon; series?: Series }> = {
  sales: { Icon: Users, series: 1 }, planning: { Icon: ClipboardList, series: 2 }, projects: { Icon: Package, series: 3 },
  finance: { Icon: Banknote, series: 6 }, people: { Icon: Users, series: 4 }, settings: { Icon: Settings2 },
};
function activityVerb(action: string, t: T) {
  const verb = action.split(/[._]/).at(-1) ?? "";
  const verbs: Record<string, string> = { created: t("Created"), updated: t("Updated"), sent: t("Sent"), approved: t("Approved"), accepted: t("Accepted"), rejected: t("Declined"), archived: t("Archived"), deleted: t("Removed"), verified: t("Verified"), assigned: t("Assigned"), completed: t("Completed"), converted: t("Converted"), published: t("Published"), joined: t("Joined"), recorded: t("Recorded") };
  return verbs[verb] ?? t("Updated");
}
function areaLabel(area: string, t: T) {
  return ({ sales: t("Sales"), planning: t("Planning"), projects: t("Projects"), finance: t("Finance"), people: t("People"), settings: t("Settings") } as Record<string, string>)[area] ?? t("Workspace");
}

export function ActivityWidget({ metrics }: { metrics: MetricsState }) {
  const t = useT();
  const locale = useLocale();
  const events = metrics.data?.activity ?? [];
  return <WidgetBody loading={!metrics.data && !metrics.failed} failed={!metrics.data && metrics.failed} retry={metrics.retry}
    empty={metrics.data && !events.length ? { title: t("No recent activity"), icon: <History size={16} aria-hidden="true" /> } : null}>
    <ul className={s.list}>{events.slice(0, 5).map(event => <li key={event.id}><ActivityRow event={event} verb={activityVerb(event.action, t)} area={areaLabel(event.area, t)} when={relativeTime(event.at, locale)} /></li>)}</ul>
  </WidgetBody>;
}

function ActivityRow({ event, verb, area, when }: { event: HomeActivityEvent; verb: string; area: string; when: string }) {
  const { Icon, series } = areas[event.area] ?? { Icon: History };
  return <Row href={event.href ?? undefined} icon={Icon} series={series} title={event.subject || area} detail={[verb, event.actorName].filter(Boolean).join(" · ")} end={<time dateTime={event.at}>{when}</time>} />;
}

export function StorageWidget({ metrics }: { metrics: MetricsState }) {
  const t = useT();
  const locale = useLocale();
  const storage = metrics.data?.storage;
  const used = Number(storage?.usedBytes ?? 0);
  const quota = storage?.quotaBytes ? Number(storage.quotaBytes) : null;
  const percent = quota ? Math.min(100, Math.round((used / quota) * 100)) : null;
  const parts = storage ? [
    { id: "projects", label: t("Projects"), value: Number(storage.areas.projects), display: formatBytes(storage.areas.projects, locale) },
    { id: "planning", label: t("Planning"), value: Number(storage.areas.planning), display: formatBytes(storage.areas.planning, locale) },
    { id: "catalog", label: t("Catalog"), value: Number(storage.areas.catalog), display: formatBytes(storage.areas.catalog, locale) },
    { id: "other", label: t("Other"), value: Number(storage.areas.other), display: formatBytes(storage.areas.other, locale) },
  ] : [];
  return <WidgetBody loading={!metrics.data && !metrics.failed} failed={!metrics.data && metrics.failed} retry={metrics.retry} rows={2}>
    {storage ? <div className={s.storage}>
      <p className={s.storageTotal} data-tone={percent !== null && percent >= 90 ? "danger" : percent !== null && percent >= 75 ? "warning" : undefined}>
        <strong>{quota ? t("{used} of {total}", { used: formatBytes(storage.usedBytes, locale), total: formatBytes(storage.quotaBytes ?? 0, locale) }) : formatBytes(storage.usedBytes, locale)}</strong>
        <small>{percent !== null ? t("{percent}% of your allowance", { percent }) : t("No limit set")}</small>
      </p>
      <SplitBar label={t("Storage by area")} segments={parts} total={quota ?? undefined} />
    </div> : null}
  </WidgetBody>;
}

export function ItemList({ items, loading, failed, retry, empty, icon, series }: { items?: HomeOverviewItem[]; loading: boolean; failed: boolean; retry?: () => void; empty: { title: string; action?: ReactNode }; icon: LucideIcon; series: Series }) {
  const locale = useLocale();
  const date = (value: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(value));
  const Icon = icon;
  return <WidgetBody loading={loading} failed={failed} retry={retry} empty={items && !items.length ? { ...empty, icon: <Icon size={16} aria-hidden="true" /> } : null}>
    <ul className={s.list}>{items?.slice(0, 5).map(item => <li key={item.id}><Row href={item.href} icon={icon} series={series} title={item.title} detail={item.detail || undefined} end={item.date ? <time dateTime={item.date}>{date(item.date)}</time> : undefined} /></li>)}</ul>
  </WidgetBody>;
}
