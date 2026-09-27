"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { HomeActivityEvent, HomeMetrics, HomeMetricWeek, HomeOverviewItem } from "@wodana/contracts";
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Banknote, CalendarClock, CircleCheck, ClipboardList, FileText, FolderKanban, History, Minus, Package, RefreshCw, Settings2, Sparkles, Users, type LucideIcon } from "lucide-react";
import { BarChart, Button, EmptyState, MiniBars, ProgressRing, SkeletonBlock, SplitBar, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { changeBetween, formatBytes, formatCount, formatMoneyText, relativeTime, weekLabel, weekValue, type Change } from "./home-format";
import s from "./workspace-home.module.css";

export type MetricsState = { data: HomeMetrics | null; failed: boolean; retry: () => void };
type T = ReturnType<typeof useT>;

function useLocale() { return useDesignSystem().locale ?? "en"; }

/** Loading, failure and empty for one widget body; one failing source never blanks the rest of Home. */
export function WidgetBody({ loading, failed, retry, empty, children, rows = 3 }: { loading: boolean; failed: boolean; retry?: () => void; empty?: { title: string; action?: ReactNode; icon?: ReactNode } | null; children: ReactNode; rows?: number }) {
  const t = useT();
  if (loading) return <div className={s.skeleton} role="status" aria-label={t("Loading")}>{Array.from({ length: rows }, (_, index) => <span key={index} className={s.skeletonRow}><SkeletonBlock width={2.25} height={2.25} /><span><SkeletonBlock width={`${70 - index * 12}%`} height={0.75} /><SkeletonBlock width="40%" height={0.625} /></span></span>)}</div>;
  if (failed) return <div className={s.state}><EmptyState illustration={null} icon={<AlertTriangle size={18} aria-hidden="true" />} title={t("This could not be loaded")} action={retry ? <Button size="compact" onPress={retry}><RefreshCw size={14} aria-hidden="true" />{t("Retry")}</Button> : null} /></div>;
  if (empty) return <div className={s.state}><EmptyState illustration={null} icon={empty.icon ?? <CircleCheck size={18} aria-hidden="true" />} title={empty.title} action={empty.action} /></div>;
  return <>{children}</>;
}

function ChangeLine({ change, t }: { change: Change; t: T }) {
  const tone = change.direction === "up" ? "success" : change.direction === "down" ? "danger" : "neutral";
  const Icon = change.direction === "up" ? ArrowUpRight : change.direction === "down" ? ArrowDownRight : change.direction === "new" ? Sparkles : Minus;
  const text = change.direction === "up" ? t("Up {percent}% on last month", { percent: change.percent })
    : change.direction === "down" ? t("Down {percent}% on last month", { percent: change.percent })
      : change.direction === "new" ? t("New this month") : t("Same as last month");
  return <span className={s.kpiChange} data-tone={tone}><Icon size={14} aria-hidden="true" data-directional="true" />{text}</span>;
}

type Kpi = { id: string; label: string; Icon: LucideIcon; value: string; meta?: string; footer: ReactNode; href: string; bars: { label: string; value: number; display: string }[] };

/** The KPI row shows only the cards this person may see; while loading it keeps their places. */
export function KpiRow({ metrics, expected }: { metrics: MetricsState; expected: number }) {
  const t = useT();
  const locale = useLocale();
  const data = metrics.data;
  if (!expected) return null;
  if (!data) {
    if (metrics.failed) return <div className={s.kpiFailure} role="alert"><span>{t("Figures could not be loaded")}</span><Button size="compact" onPress={metrics.retry}><RefreshCw size={14} aria-hidden="true" />{t("Retry")}</Button></div>;
    return <div className={s.kpis} data-count={expected} role="status" aria-label={t("Loading")}>{Array.from({ length: expected }, (_, index) => <div key={index} className={s.kpi}><SkeletonBlock width="45%" height={0.75} /><SkeletonBlock width="60%" height={1.5} /><SkeletonBlock width="70%" height={0.625} /></div>)}</div>;
  }
  const money = (value: string, compact = true) => formatMoneyText(value, data.currency, locale, compact);
  const weeks = (series: HomeMetricWeek[], show: (value: string) => string) => series.map(week => ({ label: weekLabel(week.start, locale), value: weekValue(week), display: show(week.value) }));
  const cards: Kpi[] = [];
  if (data.enquiries) cards.push({ id: "enquiries", label: t("New enquiries"), Icon: Users, value: formatCount(data.enquiries.current, locale), href: "/workspace/crm/leads", footer: <ChangeLine change={changeBetween(data.enquiries.current, data.enquiries.previous)} t={t} />, bars: weeks(data.enquiries.weekly, value => formatCount(Number(value), locale)) });
  if (data.quotes) cards.push({ id: "quotes", label: t("Quotes issued"), Icon: FileText, value: money(data.quotes.issuedValue), meta: t("{count} accepted", { count: formatCount(data.quotes.accepted, locale) }), href: "/workspace/pre-projects?section=quotations", footer: <ChangeLine change={changeBetween(data.quotes.issuedValue, data.quotes.previousIssuedValue)} t={t} />, bars: weeks(data.quotes.weekly, value => money(value, false)) });
  if (data.payments) cards.push({ id: "payments", label: t("Payments received"), Icon: Banknote, value: money(data.payments.received), href: "/workspace/finance", footer: <ChangeLine change={changeBetween(data.payments.received, data.payments.previousReceived)} t={t} />, bars: weeks(data.payments.weekly, value => money(value, false)) });
  if (data.projects) cards.push({ id: "projects", label: t("Active projects"), Icon: Package, value: formatCount(data.projects.active, locale), href: "/workspace/projects", footer: <span className={s.kpiChange} data-tone={data.projects.overdueTasks ? "warning" : "success"}>{data.projects.overdueTasks ? <AlertTriangle size={14} aria-hidden="true" /> : <CircleCheck size={14} aria-hidden="true" />}{data.projects.overdueTasks ? t("{count} overdue tasks", { count: formatCount(data.projects.overdueTasks, locale) }) : t("No overdue tasks")}</span>, bars: weeks(data.projects.weekly, value => formatCount(Number(value), locale)) });
  if (!cards.length) return null;
  return <div className={s.kpis} data-count={cards.length}>{cards.map(card => <Link key={card.id} href={card.href} className={s.kpi} data-kpi={card.id}>
    <span className={s.kpiHead}><span className={s.kpiTitle}><span className={s.kpiIcon} aria-hidden="true"><card.Icon size={14} /></span><span className={s.kpiLabel}>{card.label}</span></span><MiniBars points={card.bars} label={t("{name}, last 8 weeks", { name: card.label })} /></span>
    <span className={s.kpiValue}><strong>{card.value}</strong>{card.meta ? <small>{card.meta}</small> : null}</span>
    {card.footer}
  </Link>)}</div>;
}

export function TrendWidget({ metrics, canEnquiries, canQuotes }: { metrics: MetricsState; canEnquiries: boolean; canQuotes: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [series, setSeries] = useState<"enquiries" | "quotes">(canEnquiries ? "enquiries" : "quotes");
  const data = metrics.data;
  const source = series === "enquiries" ? data?.enquiries?.weekly : data?.quotes?.weekly;
  const points = (source ?? []).map(week => ({ label: weekLabel(week.start, locale), value: weekValue(week), display: series === "enquiries" ? formatCount(Number(week.value), locale) : formatMoneyText(week.value, data?.currency ?? "USD", locale) }));
  const total = points.reduce((sum, point) => sum + point.value, 0);
  return <>
    {canEnquiries && canQuotes ? <div className={s.segmented} role="group" aria-label={t("Show")}>
      <button type="button" aria-pressed={series === "enquiries"} onClick={() => setSeries("enquiries")}>{t("Enquiries")}</button>
      <button type="button" aria-pressed={series === "quotes"} onClick={() => setSeries("quotes")}>{t("Quote value")}</button>
    </div> : null}
    <WidgetBody loading={!data && !metrics.failed} failed={!data && metrics.failed} retry={metrics.retry} rows={4}
      empty={data && total === 0 ? { title: series === "enquiries" ? t("No enquiries in the last 8 weeks") : t("No quotes issued in the last 8 weeks"), icon: <FileText size={18} aria-hidden="true" />, action: <Link className={s.textAction} href={series === "enquiries" ? "/workspace/crm/leads?create=true" : "/workspace/pre-projects?section=quotations"}>{series === "enquiries" ? t("New enquiry") : t("Open quotations")}<ArrowRight size={14} aria-hidden="true" /></Link> } : null}>
      <BarChart ariaLabel={series === "enquiries" ? t("Enquiries per week, last 8 weeks") : t("Quote value issued per week, last 8 weeks")} data={points} />
    </WidgetBody>
  </>;
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
    empty={payments && expected === 0 ? { title: t("Nothing received or due this month"), icon: <Banknote size={18} aria-hidden="true" />, action: <Link className={s.textAction} href="/workspace/finance">{t("Open finance")}<ArrowRight size={14} aria-hidden="true" /></Link> } : null}>
    {payments ? <div className={s.money}>
      <ProgressRing value={received} max={expected} label={t("{percent}% of this month's payments received", { percent })}>{formatCount(percent, locale)}%</ProgressRing>
      <dl>
        <div><dt><i data-series="received" />{t("Received")}</dt><dd>{formatMoneyText(payments.received, currency, locale)}</dd></div>
        <div><dt><i data-series="due" />{t("Still due")}</dt><dd>{formatMoneyText(payments.due, currency, locale)}</dd></div>
      </dl>
    </div> : null}
  </WidgetBody>;
}

export function HealthWidget({ metrics }: { metrics: MetricsState }) {
  const t = useT();
  const locale = useLocale();
  const projects = metrics.data?.projects;
  const rows = projects ? [
    { id: "on-track", label: t("On track"), count: projects.onTrack, tone: "success", Icon: CircleCheck },
    { id: "at-risk", label: t("At risk"), count: projects.atRisk, tone: "warning", Icon: AlertTriangle },
    { id: "late", label: t("Late"), count: projects.late, tone: "danger", Icon: CalendarClock },
  ] : [];
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return <WidgetBody loading={!metrics.data && !metrics.failed} failed={!metrics.data && metrics.failed} retry={metrics.retry}
    empty={projects && total === 0 ? { title: t("No active projects"), icon: <FolderKanban size={18} aria-hidden="true" />, action: <Link className={s.textAction} href="/workspace/projects">{t("Open projects")}<ArrowRight size={14} aria-hidden="true" /></Link> } : null}>
    <ul className={s.health}>{rows.map(({ id, label, count, tone, Icon }) => <li key={id}><Link href={`/workspace/projects?health=${id}`} data-tone={tone}>
      <span className={s.healthIcon}><Icon size={16} aria-hidden="true" /></span><span className={s.healthLabel}>{label}</span>
      <span className={s.healthBar} aria-hidden="true"><i style={{ inlineSize: `${total ? (count / total) * 100 : 0}%` }} /></span>
      <strong>{formatCount(count, locale)}</strong><ArrowRight size={14} aria-hidden="true" />
    </Link></li>)}</ul>
  </WidgetBody>;
}

const areaIcon: Record<string, LucideIcon> = { sales: Users, planning: ClipboardList, projects: Package, finance: Banknote, people: Users, settings: Settings2 };
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
    empty={metrics.data && !events.length ? { title: t("No recent activity"), icon: <History size={18} aria-hidden="true" /> } : null}>
    <ul className={s.list}>{events.slice(0, 5).map(event => <li key={event.id}><ActivityRow event={event} verb={activityVerb(event.action, t)} area={areaLabel(event.area, t)} when={relativeTime(event.at, locale)} /></li>)}</ul>
  </WidgetBody>;
}

function ActivityRow({ event, verb, area, when }: { event: HomeActivityEvent; verb: string; area: string; when: string }) {
  const Icon = areaIcon[event.area] ?? History;
  const body = <><span className={s.rowIcon}><Icon size={16} aria-hidden="true" /></span><span className={s.rowCopy}><strong>{event.subject || area}</strong><small>{[verb, event.actorName].filter(Boolean).join(" · ")}</small></span><time dateTime={event.at}>{when}</time></>;
  return event.href ? <Link className={s.row} href={event.href}>{body}</Link> : <div className={s.row}>{body}</div>;
}

export function StorageWidget({ metrics }: { metrics: MetricsState }) {
  const t = useT();
  const locale = useLocale();
  const storage = metrics.data?.storage;
  const used = Number(storage?.usedBytes ?? 0);
  const quota = storage?.quotaBytes ? Number(storage.quotaBytes) : null;
  const percent = quota ? Math.min(100, Math.round((used / quota) * 100)) : null;
  const areas = storage ? [
    { id: "projects", label: t("Projects"), value: Number(storage.areas.projects), display: formatBytes(storage.areas.projects, locale) },
    { id: "planning", label: t("Planning"), value: Number(storage.areas.planning), display: formatBytes(storage.areas.planning, locale) },
    { id: "catalog", label: t("Catalog"), value: Number(storage.areas.catalog), display: formatBytes(storage.areas.catalog, locale) },
    { id: "other", label: t("Other"), value: Number(storage.areas.other), display: formatBytes(storage.areas.other, locale) },
  ] : [];
  return <WidgetBody loading={!metrics.data && !metrics.failed} failed={!metrics.data && metrics.failed} retry={metrics.retry} rows={2}>
    {storage ? <div className={s.storage}>
      <div className={s.storageTotal} data-tone={percent !== null && percent >= 90 ? "danger" : percent !== null && percent >= 75 ? "warning" : undefined}>
        <span>{t("Total used")}</span>
        <strong>{quota ? t("{used} of {total}", { used: formatBytes(storage.usedBytes, locale), total: formatBytes(storage.quotaBytes ?? 0, locale) }) : formatBytes(storage.usedBytes, locale)}</strong>
        <small>{percent !== null ? t("{percent}% of your allowance", { percent }) : t("No limit set")}</small>
      </div>
      <SplitBar label={t("Storage by area")} segments={areas} total={quota ?? undefined} />
    </div> : null}
  </WidgetBody>;
}

export function ItemList({ items, loading, failed, retry, empty, icon: Icon }: { items?: HomeOverviewItem[]; loading: boolean; failed: boolean; retry?: () => void; empty: { title: string; action?: ReactNode }; icon: LucideIcon }) {
  const locale = useLocale();
  const date = (value: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(value));
  return <WidgetBody loading={loading} failed={failed} retry={retry} empty={items && !items.length ? { ...empty, icon: <Icon size={18} aria-hidden="true" /> } : null}>
    <ul className={s.list}>{items?.map(item => <li key={item.id}><Link href={item.href} className={s.row}><span className={s.rowIcon}><Icon size={16} aria-hidden="true" /></span><span className={s.rowCopy}><strong>{item.title}</strong>{item.detail ? <small>{item.detail}</small> : null}</span>{item.date ? <time dateTime={item.date}>{date(item.date)}</time> : null}</Link></li>)}</ul>
  </WidgetBody>;
}
