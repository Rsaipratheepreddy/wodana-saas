"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { HomeMetricWeek, HomeMetrics, HomeUpcomingItem, MyDayItem, MyDayResponse, ReminderKind } from "@wodana/contracts";
import {
  AlertCircle, Banknote, CalendarClock, CircleCheck, ClipboardCheck, ClipboardList, Clock3, Factory, FileText,
  MessageSquare, Palette, Receipt, Truck, UserCheck, UserPlus, Wallet, type LucideIcon,
} from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, SkeletonBlock, Sparkline, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { MY_DAY_ROUTE } from "@/lib/reminders/contract";
import { REMINDER_KIND_LABELS } from "@/lib/reminders/labels";
import { dueLabel, myDayRow, openCount, showCritical, topMyDayItems, withoutItems } from "@/lib/reminders/my-day";
import { changeBetween, formatCount, formatMoneyText, weekLabel, weekValue } from "./home-format";
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

// ---------------------------------------------------------------- Today

type KindLook = { icon: LucideIcon; action: string };
function kindLook(kind: ReminderKind, t: T): KindLook {
  const looks: Partial<Record<ReminderKind, KindLook>> = {
    "crm.follow_up": { icon: CalendarClock, action: t("Update") },
    "meeting.minutes_due": { icon: CalendarClock, action: t("Write") },
    "crm.first_response": { icon: Clock3, action: t("Respond") },
    "crm.unowned": { icon: UserPlus, action: t("Assign") },
    "crm.confirm_client": { icon: UserCheck, action: t("Confirm") },
    "crm.reply_waiting": { icon: MessageSquare, action: t("Reply") },
    "work.due": { icon: ClipboardList, action: t("Open") },
    "approval.waiting": { icon: ClipboardCheck, action: t("Review") },
    "client.quote_decision": { icon: FileText, action: t("Open") },
    "quote.expiring": { icon: FileText, action: t("Open") },
    "quote.value_engineering_idle": { icon: FileText, action: t("Open") },
    "client.design_decision": { icon: Palette, action: t("Open") },
    "design.stage_due": { icon: Palette, action: t("Open") },
    "payment.due": { icon: Banknote, action: t("Open") },
    "invoice.overdue": { icon: Receipt, action: t("Chase") },
    "payables.due": { icon: Wallet, action: t("Open") },
    "finance_request.waiting": { icon: Wallet, action: t("Open") },
    "purchase.order_late": { icon: Truck, action: t("Chase") },
    "factory.production_due": { icon: Factory, action: t("Open") },
    "factory.inspection_due": { icon: ClipboardCheck, action: t("Inspect") },
    "finishes.signature_due": { icon: Palette, action: t("Open") },
    "site.daily_report": { icon: ClipboardList, action: t("Open") },
  };
  return looks[kind] ?? { icon: AlertCircle, action: t("Open") };
}

const VISIBLE = 6;

/**
 * What needs the person now (My day, plan §6.24a): the six most urgent items (late first, then today's, then what
 * waits on them, then what is coming), each with the one action that deals with it, and "See all".
 */
export function TodayList({ myDay, next, nextZone, inPlace, allClear, hide }: {
  myDay: Load<MyDayResponse>;
  /** The next thing coming up, shown under "all caught up". */
  next?: HomeUpcomingItem | null;
  nextZone: string;
  /** Opens a follow-up or a work item in place (null: the item follows its link). */
  inPlace: (item: MyDayItem) => (() => void) | null;
  /** The next step when nothing is waiting (a quick action), shown under "all caught up". */
  allClear: ReactNode;
  /** Items another block on Home already shows (left out of the rows and the count). */
  hide?: (item: MyDayItem) => boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const data = myDay.data;
  const hidden = data && hide ? new Set(data.groups.flatMap((group) => group.items).filter(hide).map((item) => item.id)) : null;
  const shown = data && hidden?.size ? withoutItems(data, hidden) : data;
  const items = shown ? topMyDayItems(shown, VISIBLE) : [];
  const total = shown ? openCount(shown.counts) : undefined;
  const body = !data && !myDay.failed ? <Rows rows={4} />
    : !data ? <div className={s.state}><ErrorState title={t("Today's work could not be loaded")} description="" onRetry={myDay.retry} /></div>
    : !items.length ? <div className={s.state} data-state="clear"><EmptyState illustration={null} icon={<CircleCheck size={18} aria-hidden="true" />} title={t("You're all caught up")}
      description={next ? <NextUp item={next} timeZone={nextZone} /> : null} action={allClear} /></div>
    : <ul className={s.list}>{items.map((item) => {
      const look = kindLook(item.kind, t);
      const Icon = look.icon;
      const row = myDayRow(item, { t, locale, timeZone: data.timeZone });
      const title = row.title || t(REMINDER_KIND_LABELS[item.kind]);
      const when = dueLabel(item, { today: data.today, timeZone: data.timeZone, locale, t });
      const open = inPlace(item);
      return <li key={item.id} className={s.focusRow} data-urgency={item.urgency}>
        <span className={s.mark} aria-hidden="true"><Icon size={15} /></span>
        <span className={s.copy}>
          <strong>{title}{showCritical(item, data.today, data.timeZone) ? <Badge tone="danger">{t("Critical")}</Badge> : null}</strong>
          <small>{row.detail}{when ? <em>{when}</em> : null}</small>
        </span>
        {open
          ? <Button size="compact" aria-label={`${look.action}: ${title}`} onPress={open}>{look.action}</Button>
          : <Link className="wd-button" data-size="compact" data-variant="secondary" aria-label={`${look.action}: ${title}`} href={item.href}>{look.action}</Link>}
      </li>;
    })}</ul>;
  return <Section id="today" title={t("Today")} count={total} tour="home-widget-attention"
    link={data && (items.length || total) ? <Link className={s.textLink} href={MY_DAY_ROUTE}>{t("See all")}</Link> : null}>{body}</Section>;
}

/** "Next: …" under the all-caught-up state, so a clear day still says what's coming. */
function NextUp({ item, timeZone }: { item: HomeUpcomingItem; timeZone: string }) {
  const t = useT();
  const locale = useLocale();
  const at = item.allDay ? new Date(`${item.at.slice(0, 10)}T12:00:00Z`) : new Date(item.at);
  const when = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", ...(item.allDay ? {} : { hour: "numeric", minute: "2-digit" }), timeZone: item.allDay ? "UTC" : timeZone }).format(at);
  return <Link className={s.nextUp} href={item.href}>{t("Next: {title}", { title: item.title })}<span> · {when}</span></Link>;
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
  return LENS_FIGURES[lens].map((key) => all[key]).filter((figure): figure is Figure => Boolean(figure)).slice(0, MAX_FIGURES);
}

/** Home shows at most four figures, chosen by the person's role, in this order. */
const MAX_FIGURES = 4;
const LENS_FIGURES: Record<NumbersLens, string[]> = {
  business: ["moneyIn", "projects", "enquiries", "quoted"],
  finance: ["moneyIn", "due", "projects"],
  sales: ["enquiries", "quoted", "awaiting", "projects"],
  estimating: ["quoted", "awaiting", "projects"],
  purchasing: ["orders", "projects", "overdue"],
  projects: ["projects", "overdue", "orders"],
};

/** Up to four figures that matter for the person's role (money compact), each with a tiny trend and a link to its list. */
export function KeyNumbers({ metrics, lens, expected }: { metrics: Load<HomeMetrics>; lens: NumbersLens; expected: boolean }) {
  const t = useT();
  const locale = useLocale();
  const data = metrics.data;
  if (!expected) return null;
  if (!data && !metrics.failed) return <div className={s.numbers} role="status" aria-label={t("Loading")}>{LENS_FIGURES[lens].slice(0, MAX_FIGURES).map((_, index) => <span key={index} className={s.number}><SkeletonBlock width={7} height={0.75} /><SkeletonBlock width={5} height={1.75} /><SkeletonBlock width="60%" height={0.625} /></span>)}</div>;
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
