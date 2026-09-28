"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { HomeActivityEvent, HomeFocusItem, HomeFocusSource, HomeFunnelStage, HomeMetricWeek, HomeMetrics, HomeRecentRecord, HomeSummary, HomeUpcomingItem } from "@wodana/contracts";
import {
  AlertCircle, Banknote, CalendarClock, ChevronRight, CircleCheck, ClipboardCheck, ClipboardList, Clock3, Factory, FileText, FolderKanban,
  History, MessageSquare, Palette, Receipt, Truck, UserCheck, UserPlus, Users, Wallet, type LucideIcon,
} from "lucide-react";
import { Button, EmptyState, ErrorState, SkeletonBlock, Sparkline, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { changeBetween, formatCount, formatMoneyText, relativeTime, weekLabel, weekValue } from "./home-format";
import s from "./workspace-home.module.css";

type T = ReturnType<typeof useT>;
/** One source of Home's data: loading until `data` or `failed`, with a retry. */
export type Load<V> = { data: V | null; failed: boolean; retry: () => void };

function useLocale() { return useDesignSystem().locale ?? "en"; }

/** A section of Home: one heading (with an optional count and link), then its body. */
export function Section({ id, title, count, link, tour, children }: { id: string; title: string; count?: number; link?: ReactNode; tour?: string; children: ReactNode }) {
  const locale = useLocale();
  return <section className={s.section} aria-labelledby={`home-${id}`} data-section={id} data-tour={tour}>
    <header className={s.sectionHeader}>
      <h2 id={`home-${id}`}>{title}</h2>
      {count ? <span className={s.count}>{formatCount(count, locale)}</span> : null}
      {link ? <span className={s.sectionLink}>{link}</span> : null}
    </header>
    {children}
  </section>;
}

/** Placeholder rows while a section loads. */
function Rows({ rows }: { rows: number }) {
  const t = useT();
  return <div className={s.skeleton} role="status" aria-label={t("Loading")}>
    {Array.from({ length: rows }, (_, index) => <span key={index} className={s.skeletonRow}>
      <SkeletonBlock width={2} height={2} shape="circle" />
      <span><SkeletonBlock width={`${72 - index * 11}%`} height={0.75} /><SkeletonBlock width="38%" height={0.625} /></span>
    </span>)}
  </div>;
}

/** A section that could not load: what happened, and a retry (the full error state is kept for Today). */
function InlineError({ retry }: { retry: () => void }) {
  const t = useT();
  return <div className={s.inlineError} role="alert">
    <AlertCircle size={16} aria-hidden="true" /><span>{t("This could not be loaded")}</span>
    <Button size="compact" variant="quiet" onPress={retry}>{t("Try again")}</Button>
  </div>;
}

/** The workspace's calendar day of an instant (YYYY-MM-DD). */
export function localDay(value: string | Date, timeZone?: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// ---------------------------------------------------------------- Today

type SourceLook = { icon: LucideIcon; reason: string; action: string };
function sourceLooks(t: T): Record<HomeFocusSource, SourceLook> {
  return {
    follow_up: { icon: CalendarClock, reason: t("Follow-up"), action: t("Update") },
    response: { icon: Clock3, reason: t("First response"), action: t("Respond") },
    unowned: { icon: UserPlus, reason: t("No owner yet"), action: t("Assign") },
    confirm_client: { icon: UserCheck, reason: t("Confirm the client"), action: t("Confirm") },
    reply: { icon: MessageSquare, reason: t("Client reply"), action: t("Reply") },
    work: { icon: ClipboardList, reason: t("Task"), action: t("Open") },
    delivery: { icon: Truck, reason: t("Delivery"), action: t("Chase") },
    invoice: { icon: Receipt, reason: t("Invoice"), action: t("Chase") },
    production: { icon: Factory, reason: t("Production"), action: t("Open") },
    quote_review: { icon: FileText, reason: t("Quote review"), action: t("Review") },
    receipt: { icon: Banknote, reason: t("Payment to verify"), action: t("Verify") },
    order_approval: { icon: Truck, reason: t("Order approval"), action: t("Review") },
    design_review: { icon: Palette, reason: t("Design review"), action: t("Review") },
    design_client: { icon: Palette, reason: t("Client decision"), action: t("Record") },
    design_present: { icon: Palette, reason: t("Ready to present"), action: t("Present") },
    design_revise: { icon: Palette, reason: t("Changes requested"), action: t("Revise") },
    petty_cash: { icon: Wallet, reason: t("Petty cash"), action: t("Review") },
    leave: { icon: Users, reason: t("Leave request"), action: t("Decide") },
  };
}

function useDueLabel(today: string, timeZone: string) {
  const t = useT();
  const locale = useLocale();
  const time = (value: string) => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(value));
  const date = (value: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: isDateOnly(value) ? "UTC" : timeZone }).format(new Date(isDateOnly(value) ? `${value}T00:00:00Z` : value));
  return (item: HomeFocusItem) => {
    if (!item.due) return "";
    const day = isDateOnly(item.due) ? item.due : localDay(item.due, timeZone);
    if (item.urgency === "waiting") return t("Since {date}", { date: date(item.due) });
    const late = dayDiff(day, today);
    if (late === 1) return t("1 day late");
    if (late > 1) return t("{count} days late", { count: late });
    if (isDateOnly(item.due)) return t("Today");
    return item.urgency === "overdue" ? t("Due {time}", { time: time(item.due) }) : t("Today {time}", { time: time(item.due) });
  };
}

const VISIBLE = 6;

/** What needs the person now, most urgent first, each with the one action that deals with it. */
export function TodayList({ summary, open, allClear }: {
  summary: Load<HomeSummary>;
  /** Opens a follow-up or a work item in place; other items follow their link. */
  open: (item: HomeFocusItem) => void;
  /** The next step when nothing is waiting (a quick action), shown under "all caught up". */
  allClear: ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const data = summary.data;
  const looks = sourceLooks(t);
  const due = useDueLabel(data?.today ?? localDay(new Date()), data?.timeZone ?? "UTC");
  const items = data?.focus.items ?? [];
  const next = data?.upcoming[0];
  const shown = expanded ? items : items.slice(0, VISIBLE);
  const body = !data && !summary.failed ? <Rows rows={4} />
    : !data ? <div className={s.state}><ErrorState title={t("Today's work could not be loaded")} description="" onRetry={summary.retry} /></div>
    : !items.length ? <div className={s.state} data-state="clear"><EmptyState illustration={null} icon={<CircleCheck size={18} aria-hidden="true" />} title={t("You're all caught up")}
      description={next ? <NextUp item={next} timeZone={data.timeZone} /> : null} action={allClear} /></div>
    : <>
      <ul className={s.list}>{shown.map((item) => {
        const look = looks[item.source];
        const Icon = look.icon;
        const title = item.title || look.reason;
        const when = due(item);
        const inPlace = item.source === "follow_up" || (item.source === "work" && Boolean(item.projectId));
        return <li key={item.id} className={s.focusRow} data-urgency={item.urgency}>
          <span className={s.mark} aria-hidden="true"><Icon size={15} /></span>
          <span className={s.copy}>
            <strong>{title}</strong>
            <small>{[look.reason, item.context].filter(Boolean).join(" · ")}{when ? <em>{when}</em> : null}</small>
          </span>
          {inPlace
            ? <Button size="compact" aria-label={`${look.action}: ${title}`} onPress={() => open(item)}>{look.action}</Button>
            : <Link className="wd-button" data-size="compact" data-variant="secondary" aria-label={`${look.action}: ${title}`} href={item.href}>{look.action}</Link>}
        </li>;
      })}</ul>
      {items.length > VISIBLE || data.focus.total > items.length ? <div className={s.listFooter}>
        {items.length > VISIBLE ? <Button size="compact" variant="quiet" onPress={() => setExpanded((value) => !value)}>
          {expanded ? t("Show less") : t("Show all {count}", { count: formatCount(items.length, locale) })}</Button> : null}
        {data.focus.total > items.length ? <small className={s.quiet}>{t("{count} more not shown", { count: formatCount(data.focus.total - items.length, locale) })}</small> : null}
      </div> : null}
    </>;
  return <Section id="today" title={t("Today")} count={data?.focus.total} tour="home-widget-attention">{body}</Section>;
}

/** "Next: …" under the all-caught-up state, so a clear day still says what's coming. */
function NextUp({ item, timeZone }: { item: HomeUpcomingItem; timeZone: string }) {
  const t = useT();
  const when = useWhen(timeZone);
  return <Link className={s.nextUp} href={item.href}>{t("Next: {title}", { title: item.title })}<span> · {when(item).long}</span></Link>;
}

// ---------------------------------------------------------------- Coming up

function useWhen(timeZone: string) {
  const locale = useLocale();
  return (item: HomeUpcomingItem) => {
    const at = item.allDay ? new Date(`${item.at.slice(0, 10)}T12:00:00Z`) : new Date(item.at);
    const zone = item.allDay ? "UTC" : timeZone;
    return {
      weekday: new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: zone }).format(at),
      day: new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: zone }).format(at),
      time: item.allDay ? "" : new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: zone }).format(at),
      long: new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", ...(item.allDay ? {} : { hour: "numeric", minute: "2-digit" }), timeZone: zone }).format(at),
    };
  };
}

const UPCOMING_ICONS: Record<HomeUpcomingItem["kind"], LucideIcon> = { meeting: Users, follow_up: CalendarClock, work: ClipboardList, delivery: Truck, payment: Banknote, production: Factory };

/** Meetings, visits, deliveries, payments and work coming up, on the workspace's calendar. */
export function UpcomingList({ summary, empty }: { summary: Load<HomeSummary>; empty: ReactNode }) {
  const t = useT();
  const data = summary.data;
  const when = useWhen(data?.timeZone ?? "UTC");
  const kinds: Record<HomeUpcomingItem["kind"], string> = { meeting: t("Meeting"), follow_up: t("Follow-up"), work: t("Task"), delivery: t("Delivery"), payment: t("Payment due"), production: t("Production") };
  const title = data?.horizonDays === 30 ? t("Next 30 days") : t("Next 7 days");
  const body = !data && !summary.failed ? <Rows rows={3} />
    : !data ? <InlineError retry={summary.retry} />
    : !data.upcoming.length ? <div className={s.state}><EmptyState illustration={null} icon={<CalendarClock size={18} aria-hidden="true" />} title={t("Nothing scheduled")} action={empty} /></div>
    : <ul className={s.list}>{data.upcoming.map((item) => {
      const date = when(item);
      const Icon = UPCOMING_ICONS[item.kind];
      return <li key={item.id}><Link className={s.upcomingRow} href={item.href}>
        <span className={s.dateBlock} aria-hidden="true"><small>{date.weekday}</small><strong>{date.day}</strong></span>
        <span className={s.copy}>
          <strong>{item.title}</strong>
          <small className={s.metaLine}><Icon size={12} aria-hidden="true" /><span>{[date.time, kinds[item.kind], item.context].filter(Boolean).join(" · ")}</span></small>
        </span>
        <span className="wd-visually-hidden">{date.long}</span>
        <ChevronRight className={s.chevron} size={16} aria-hidden="true" />
      </Link></li>;
    })}</ul>;
  return <Section id="upcoming" title={t("Coming up")} link={data ? <span className={s.quiet}>{title}</span> : null}>{body}</Section>;
}

// ---------------------------------------------------------------- Pipeline

/** The business flow the person can see: a count per stage and a gentle mark where work has stalled. */
export function Pipeline({ summary }: { summary: Load<HomeSummary> }) {
  const t = useT();
  const locale = useLocale();
  const data = summary.data;
  const labels: Record<HomeFunnelStage["id"], string> = { enquiries: t("Enquiries"), planning: t("Planning"), quotes: t("Quotes"), projects: t("Projects"), handover: t("Handover") };
  if (data && !data.funnel.length) return null;
  const body = !data && !summary.failed ? <div className={s.pulse} role="status" aria-label={t("Loading")}>{Array.from({ length: 5 }, (_, index) => <span key={index} className={s.stage}><SkeletonBlock width={4} height={0.625} /><SkeletonBlock width={2} height={1.5} /></span>)}</div>
    : !data ? <InlineError retry={summary.retry} />
    : <ol className={s.pulse}>{data.funnel.map((stage) => <li key={stage.id}>
      <Link className={s.stage} href={stage.href} data-stalled={stage.stuck > 0 || undefined}
        aria-label={[labels[stage.id], formatCount(stage.count, locale), stage.stuck ? t("{count} stalled", { count: formatCount(stage.stuck, locale) }) : ""].filter(Boolean).join(", ")}>
        <span className={s.stageLabel}>{labels[stage.id]}</span>
        <strong className={s.stageCount}>{formatCount(stage.count, locale)}</strong>
        <small className={s.stageNote}>{stage.stuck ? t("{count} stalled", { count: formatCount(stage.stuck, locale) }) : null}</small>
      </Link>
    </li>)}</ol>;
  return <Section id="pipeline" title={t("Pipeline")}>{body}</Section>;
}

// ---------------------------------------------------------------- Key numbers

type Figure = { id: string; label: string; value: string; href: string; trend?: { points: { label: string; value: number }[]; label: string }; note?: { text: string; tone: "success" | "warning" | "danger" | "neutral" } };
/** Which figures a person sees, from what they may do: the business for those who run it, their own area otherwise. */
export type NumbersLens = "business" | "finance" | "sales" | "estimating" | "purchasing" | "projects";

function figures(data: HomeMetrics, lens: NumbersLens, t: T, locale: string): Figure[] {
  const count = (value: number) => formatCount(value, locale);
  const money = (value: string) => formatMoneyText(value, data.currency, locale, true);
  const change = (current: string | number, previous: string | number, upIsGood = true): Figure["note"] => {
    const delta = changeBetween(current, previous);
    if (delta.direction === "flat") return { text: t("Same as last month"), tone: "neutral" };
    if (delta.direction === "new") return { text: t("None last month"), tone: "neutral" };
    const good = (delta.direction === "up") === upIsGood;
    return { text: delta.direction === "up" ? t("{percent}% up on last month", { percent: delta.percent }) : t("{percent}% down on last month", { percent: delta.percent }), tone: good ? "success" : "warning" };
  };
  const weekly = (weeks: HomeMetricWeek[], label: string) => ({ points: weeks.map((week) => ({ label: weekLabel(week.start, locale), value: weekValue(week) })), label });
  const all: Record<string, Figure | null> = {
    moneyIn: data.payments ? { id: "money-in", label: t("Money in this month"), value: money(data.payments.received), href: "/workspace/finance/client-invoices",
      trend: weekly(data.payments.weekly, t("Money in per week, last 8 weeks")), note: change(data.payments.received, data.payments.previousReceived) } : null,
    due: data.payments ? { id: "due", label: t("Still due this month"), value: money(data.payments.due), href: "/workspace/finance/client-invoices" } : null,
    projects: data.projects ? { id: "projects", label: t("Projects on track"), value: t("{count} of {total}", { count: count(data.projects.onTrack), total: count(data.projects.active) }), href: "/workspace/projects",
      note: data.projects.late ? { text: t("{count} late", { count: count(data.projects.late) }), tone: "danger" }
        : data.projects.atRisk ? { text: t("{count} at risk", { count: count(data.projects.atRisk) }), tone: "warning" }
          : { text: t("All on track"), tone: "success" } } : null,
    overdue: data.projects ? { id: "overdue", label: t("Overdue tasks"), value: count(data.projects.overdueTasks), href: "/workspace/tasks",
      note: data.projects.overdueTasks ? { text: t("On your projects"), tone: "warning" } : { text: t("Nothing overdue"), tone: "success" } } : null,
    enquiries: data.enquiries ? { id: "enquiries", label: t("New enquiries this month"), value: count(data.enquiries.current), href: "/workspace/crm/leads",
      trend: weekly(data.enquiries.weekly, t("Enquiries per week, last 8 weeks")), note: change(data.enquiries.current, data.enquiries.previous) } : null,
    quoted: data.quotes ? { id: "quoted", label: t("Quoted this month"), value: money(data.quotes.issuedValue), href: "/workspace/pre-projects?section=quotations",
      trend: weekly(data.quotes.weekly, t("Quote value issued per week, last 8 weeks")), note: change(data.quotes.issuedValue, data.quotes.previousIssuedValue) } : null,
    awaiting: data.quotes ? { id: "awaiting", label: t("Quotes with clients"), value: count(data.quotes.awaiting), href: "/workspace/pre-projects?section=quotations" } : null,
    orders: data.orders ? { id: "orders", label: t("Orders to receive"), value: count(data.orders.toReceive), href: "/workspace/purchasing/orders" } : null,
  };
  const order: Record<NumbersLens, string[]> = {
    business: ["moneyIn", "projects", "enquiries", "quoted"],
    finance: ["moneyIn", "due", "projects"],
    sales: ["enquiries", "quoted", "awaiting", "projects"],
    estimating: ["quoted", "awaiting", "projects"],
    purchasing: ["orders", "projects", "overdue"],
    projects: ["projects", "overdue", "orders"],
  };
  return order[lens].map((key) => all[key]).filter((figure): figure is Figure => Boolean(figure)).slice(0, 2);
}

/** One or two figures that matter for the person's role, each with a tiny trend and a link to its list. */
export function KeyNumbers({ metrics, lens, expected }: { metrics: Load<HomeMetrics>; lens: NumbersLens; expected: boolean }) {
  const t = useT();
  const locale = useLocale();
  const data = metrics.data;
  if (!expected) return null;
  if (!data && !metrics.failed) return <div className={s.numbers} role="status" aria-label={t("Loading")}>{[0, 1].map((index) => <span key={index} className={s.number}><SkeletonBlock width={7} height={0.75} /><SkeletonBlock width={5} height={1.75} /><SkeletonBlock width="60%" height={0.625} /></span>)}</div>;
  if (!data) return <InlineError retry={metrics.retry} />;
  const shown = figures(data, lens, t, locale);
  if (!shown.length) return null;
  return <nav aria-label={t("Key numbers")}><ul className={s.numbers}>{shown.map((figure) => <li key={figure.id}>
    <Link className={s.number} href={figure.href} data-figure={figure.id}>
      <span className={s.numberLabel}>{figure.label}</span>
      <strong className={s.numberValue}>{figure.value}</strong>
      <span className={s.numberFoot}>
        {figure.trend && figure.trend.points.some((point) => point.value > 0) ? <span className={s.spark}><Sparkline points={figure.trend.points} label={figure.trend.label} /></span> : null}
        {figure.note ? <small data-tone={figure.note.tone}>{figure.note.text}</small> : null}
      </span>
    </Link>
  </li>)}</ul></nav>;
}

// ---------------------------------------------------------------- Jump back in

const RECENT_ICONS: Record<HomeRecentRecord["kind"], LucideIcon> = { enquiry: Users, case: ClipboardCheck, project: FolderKanban, order: Truck, work_order: Factory };

/** The records the person worked on last, then the ones in their care. */
export function JumpBackIn({ summary, empty }: { summary: Load<HomeSummary>; empty: ReactNode }) {
  const t = useT();
  const locale = useLocale();
  const data = summary.data;
  const kinds: Record<HomeRecentRecord["kind"], string> = { enquiry: t("Enquiry"), case: t("Planning"), project: t("Project"), order: t("Order"), work_order: t("Work order") };
  const body = !data && !summary.failed ? <Rows rows={3} />
    : !data ? <InlineError retry={summary.retry} />
    : !data.recent.length ? <div className={s.state}><EmptyState illustration={null} icon={<History size={18} aria-hidden="true" />} title={t("Nothing to pick up yet")} action={empty} /></div>
    : <ul className={s.list}>{data.recent.map((record) => {
      const Icon = RECENT_ICONS[record.kind];
      return <li key={`${record.kind}:${record.id}`}><Link className={s.recentRow} href={record.href}>
        <span className={s.recentIcon} aria-hidden="true"><Icon size={15} /></span>
        <span className={s.copy}><strong>{record.title || kinds[record.kind]}</strong><small>{[kinds[record.kind], record.context].filter(Boolean).join(" · ")}</small></span>
        <time dateTime={record.at}>{relativeTime(record.at, locale)}</time>
      </Link></li>;
    })}</ul>;
  return <Section id="recent" title={t("Jump back in")}>{body}</Section>;
}

// ---------------------------------------------------------------- Recent activity

function activityVerb(action: string, t: T) {
  const verb = action.split(/[._]/).at(-1) ?? "";
  const verbs: Record<string, string> = { created: t("Created"), updated: t("Updated"), sent: t("Sent"), approved: t("Approved"), accepted: t("Accepted"), rejected: t("Declined"), archived: t("Archived"), deleted: t("Removed"), verified: t("Verified"), assigned: t("Assigned"), completed: t("Completed"), converted: t("Converted"), published: t("Published"), joined: t("Joined"), recorded: t("Recorded") };
  return verbs[verb] ?? t("Updated");
}

/** The latest audited changes in the workspace, for people who can read the audit log. */
export function RecentActivity({ metrics }: { metrics: Load<HomeMetrics> }) {
  const t = useT();
  const locale = useLocale();
  const data = metrics.data;
  if (data && !data.activity) return null;
  const events: HomeActivityEvent[] = data?.activity?.slice(0, 5) ?? [];
  const body = !data && !metrics.failed ? <Rows rows={3} />
    : !data ? <InlineError retry={metrics.retry} />
    : !events.length ? <div className={s.state}><EmptyState illustration={null} icon={<History size={18} aria-hidden="true" />} title={t("No recent activity")} /></div>
    : <ul className={s.activity}>{events.map((event) => {
      const line = <><span className={s.copy}><strong>{event.subject || t("Workspace")}</strong><small>{[activityVerb(event.action, t), event.actorName].filter(Boolean).join(" · ")}</small></span>
        <time dateTime={event.at}>{relativeTime(event.at, locale)}</time></>;
      return <li key={event.id}>{event.href ? <Link className={s.activityRow} href={event.href}>{line}</Link> : <span className={s.activityRow}>{line}</span>}</li>;
    })}</ul>;
  return <Section id="activity" title={t("Recent activity")} link={<Link className={s.textLink} href="/workspace/settings/audit-logs">{t("View all")}</Link>}>{body}</Section>;
}
