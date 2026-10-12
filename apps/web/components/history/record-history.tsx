"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HistoryFilter, HistoryItem, HistoryPage, HistoryRecordType } from "@wodana/contracts/history";
import { Avatar, Button, EmptyState, ErrorState, SegmentedControl, Skeleton, TextLink, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Translate } from "@/lib/i18n/keys";
import { historyChanges, historyHref, historyLinkLabel, historySentence, type HistoryFormat } from "@/lib/history/format";
import styles from "./record-history.module.css";

/** One page of a record's history from the workspace API. */
export async function fetchHistory(workspaceId: string, recordType: HistoryRecordType, recordId: string, filter: HistoryFilter, before: string | null, t: Translate): Promise<HistoryPage> {
  const query = new URLSearchParams({ workspaceId, filter, ...(before ? { before } : {}) });
  const response = await fetch(`/api/history/${recordType}/${recordId}?${query}`, { cache: "no-store" });
  const body = await response.json().catch(() => null) as (HistoryPage & { message?: string }) | null;
  if (!response.ok || !body || !Array.isArray(body.items)) throw new Error(body?.message || t("The history didn't load."));
  return body;
}

/** Money as an exact decimal string in the workspace's locale, dates in its time zone, and day keys for grouping. */
export function useHistoryFormat(timeZone: string) {
  const { locale } = useDesignSystem();
  return useMemo(() => {
    const zone = (value: Intl.DateTimeFormatOptions) => { try { return new Intl.DateTimeFormat(locale, { timeZone, ...value }); } catch { return new Intl.DateTimeFormat(locale, value); } };
    const dayKey = (iso: string) => { try { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)); } catch { return iso.slice(0, 10); } };
    const format: HistoryFormat & { time: (iso: string) => string; full: (iso: string) => string; day: (key: string) => string; dayKey: (iso: string) => string } = {
      money: (value, currency) => {
        // A string is formatted exactly (Intl.NumberFormat v3); the currency's own decimals.
        try { return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value as unknown as number); } catch { return `${currency} ${value}`; }
      },
      date: (value) => {
        const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
        const at = new Date(dateOnly ? `${value}T00:00:00Z` : value);
        if (Number.isNaN(at.getTime())) return value;
        return (dateOnly ? new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }) : zone({ day: "numeric", month: "short", year: "numeric" })).format(at);
      },
      time: (iso) => zone({ hour: "numeric", minute: "2-digit" }).format(new Date(iso)),
      full: (iso) => zone({ dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)),
      day: (key) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${key}T00:00:00Z`)),
      dayKey,
    };
    return format;
  }, [locale, timeZone]);
}

/** "5 min ago", "3 h ago", "2 days ago" in the person's language. */
function relative(iso: string, locale: string, now: number) {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [["day", 86_400], ["hour", 3_600], ["minute", 60]];
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  return formatter.format(0, "minute");
}

const FILTERS: HistoryFilter[] = ["all", "changes", "messages", "approvals"];

/**
 * The one History of a record (who did what, when): every change, message and approval on it, newest first, grouped
 * by day in the workspace's time zone, with the person, the time (relative, and exact on hover), what changed from →
 * to, and links to related records. The same component on every record.
 */
export function RecordHistory({ workspaceId, recordType, recordId, load = fetchHistory }: {
  workspaceId: string;
  recordType: HistoryRecordType;
  recordId: string;
  /** For tests and stories; the workspace API by default. */
  load?: typeof fetchHistory;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [state, setState] = useState<{ items: HistoryItem[]; next: string | null; timeZone: string } | null>(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const request = useRef(0);
  const format = useHistoryFormat(state?.timeZone ?? "UTC");
  // "Now" for relative times is taken when a page arrives, not while rendering.
  const [now, setNow] = useState(0);

  const read = useCallback(async (before: string | null) => {
    const ticket = ++request.current;
    try {
      const page = await load(workspaceId, recordType, recordId, filter, before, t);
      if (ticket !== request.current) return;
      setNow(Date.now());
      setState((current) => ({ items: before && current ? [...current.items, ...page.items] : page.items, next: page.next, timeZone: page.timeZone }));
      setError("");
    } catch (cause) {
      if (ticket === request.current) setError(cause instanceof Error ? cause.message : t("The history didn't load."));
    } finally {
      if (ticket === request.current) setLoadingMore(false);
    }
  }, [filter, load, recordId, recordType, t, workspaceId]);

  useEffect(() => { queueMicrotask(() => { setState(null); void read(null); }); }, [read]);

  const days = useMemo(() => {
    const groups: Array<{ key: string; items: HistoryItem[] }> = [];
    for (const item of state?.items ?? []) {
      const key = format.dayKey(item.occurredAt);
      const last = groups.at(-1);
      if (last?.key === key) last.items.push(item); else groups.push({ key, items: [item] });
    }
    return groups;
  }, [format, state]);
  const today = format.dayKey(new Date(now).toISOString());
  const yesterday = format.dayKey(new Date(now - 86_400_000).toISOString());

  const labels: Record<HistoryFilter, string> = { all: t("All"), changes: t("Changes"), messages: t("Messages"), approvals: t("Approvals") };
  return <div className={styles.history} data-history={recordType}>
    <div className={styles.toolbar}>
      <SegmentedControl label={t("Show")} onChange={(value) => setFilter(value as HistoryFilter)} options={FILTERS.map((id) => ({ id, label: labels[id] }))} value={filter} />
    </div>
    {error && !state ? <ErrorState description={error} onRetry={() => void read(null)} />
      : !state ? <Skeleton lines={6} shape="rows" />
      : !state.items.length ? <EmptyState title={filter === "all" ? t("No history yet") : t("Nothing to show for this filter")} />
      : <div className={styles.days}>
        {days.map((day) => <section aria-label={day.key === today ? t("Today") : day.key === yesterday ? t("Yesterday") : format.day(day.key)} className={styles.day} key={day.key}>
          <h3 className={styles.dayTitle}>{day.key === today ? t("Today") : day.key === yesterday ? t("Yesterday") : format.day(day.key)}</h3>
          <ol className={styles.list}>
            {day.items.map((item) => {
              const changes = historyChanges(item, t, format);
              const links = item.links.map((link) => ({ link, href: historyHref(link) })).filter((entry): entry is { link: typeof entry.link; href: string } => Boolean(entry.href));
              return <li className={styles.item} data-category={item.category} key={item.id}>
                <Avatar name={item.actor.kind === "client" ? item.actor.name ?? t("The client") : item.actor.name ?? t("Automation")} preset={item.actor.preset}
                  roles={item.actor.kind === "person" ? item.actor.roles : null} seed={item.actor.kind === "person" ? item.actor.id ?? undefined : undefined} size="sm" />
                <div className={styles.body}>
                  <p className={styles.sentence}><bdi>{historySentence(item, t, format)}</bdi></p>
                  {item.amount && !(item.subject === "payment" && ["verified", "paid"].includes(item.verb)) ? <p className={styles.amount}>{format.money(item.amount.value, item.amount.currency)}</p> : null}
                  {item.note ? <p className={styles.note} dir="auto">{item.note}</p> : null}
                  {changes.length ? <dl className={styles.changes}>{changes.map((change, index) => <div key={`${change.field}-${index}`}>
                    <dt>{change.field}</dt>
                    <dd><bdi className={styles.before}>{change.before}</bdi> <span aria-hidden="true" className={styles.arrow}>→</span><span className={styles.visuallyHidden}>{t("to")}</span> <bdi>{change.after}</bdi></dd>
                  </div>)}</dl> : null}
                  <div className={styles.meta}>
                    <time dateTime={item.occurredAt} title={format.full(item.occurredAt)}>{`${relative(item.occurredAt, locale, now)} · ${format.time(item.occurredAt)}`}</time>
                    {links.map(({ link, href }) => <TextLink href={href} key={`${link.type}-${link.id}`}>{historyLinkLabel(link, t)}</TextLink>)}
                  </div>
                </div>
              </li>;
            })}
          </ol>
        </section>)}
        {error ? <ErrorState description={error} onRetry={() => void read(state.next)} /> : null}
        {state.next ? <div className={styles.more}><Button isDisabled={loadingMore} onPress={() => { setLoadingMore(true); void read(state.next); }}>{t("Show older")}</Button></div> : null}
      </div>}
  </div>;
}
