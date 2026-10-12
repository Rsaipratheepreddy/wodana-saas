"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, EmptyState, SelectField, Switch } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { SiteApi } from "@/lib/site/client";
import type { DayCard as DayCardData, DayFeed as DayFeedData, DayReport } from "@/lib/site/types";
import { useProjectFormat } from "../project-core/format";
import { DayCard, type DayCommand } from "./day-card";
import styles from "./day-feed.module.css";

const shift = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
const STEP_DAYS = 28;

export type DayFilters = { stage: string; trade: string; issues: boolean; review: boolean };
export const NO_FILTERS: DayFilters = { stage: "", trade: "", issues: false, review: false };

/** The cards a set of filters keeps: a stage of the plan, a trade on site, days with issues, days waiting for my review. */
export function filterCards(cards: DayCardData[], filters: DayFilters, reviewable: (report: DayReport) => boolean) {
  return cards.filter((card) => (!filters.stage || card.stageIds.includes(filters.stage))
    && (!filters.trade || card.trades.some((trade) => trade.toLowerCase() === filters.trade.toLowerCase()))
    && (!filters.issues || card.issues.length > 0)
    && (!filters.review || card.reports.some(reviewable)));
}

/**
 * The project's daily progress: a clean vertical feed of day cards, newest first, with a small marker for each working
 * day that ended without a report (the workspace's calendar), filters by stage, trade, issues and what waits for my
 * review, and earlier days a step at a time. A notice's `?day=` opens on that day.
 */
export function DayFeed({ api, projectId, feed, startedOn, me, canReport, canApprove, canManage, onTeam, members, highlight, onAdd, onOpenReport, onCommand }: {
  api: SiteApi; projectId: string; feed: DayFeedData; startedOn: string | null; me: string; canReport: boolean; canApprove: boolean; canManage: boolean; onTeam: boolean;
  members: Array<{ membershipId: string; name: string }>; highlight: string | null;
  /** Add a report: today's, or a missed day's. */
  onAdd: (day: string | null) => void;
  onOpenReport: (report: DayReport) => void;
  onCommand: DayCommand;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [filters, setFilters] = useState<DayFilters>(NO_FILTERS);
  const [earlier, setEarlier] = useState<DayFeedData[]>([]);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState("");
  const reviewable = (report: DayReport) => canApprove && report.authorId !== me && report.status === "submitted";
  const feeds = [feed, ...earlier];
  const cards = feeds.flatMap((item) => item.cards);
  const missing = feeds.flatMap((item) => item.missing);
  const stages = feed.stages;
  const trades = [...new Set(feeds.flatMap((item) => item.trades))].sort((a, b) => a.localeCompare(b));
  const filtered = filterCards(cards, filters, reviewable);
  const filtering = Boolean(filters.stage || filters.trade || filters.issues || filters.review);
  const toReview = cards.filter((card) => card.reports.some(reviewable)).length;
  const oldest = feeds.at(-1)!.from;
  const more = Boolean(startedOn && oldest > startedOn);
  // The day a notice links to: scrolled into view once it's there.
  useEffect(() => {
    if (!highlight) return;
    const frame = requestAnimationFrame(() => document.getElementById(`day-${highlight}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [highlight, cards.length]);
  const entries = useMemo(() => [
    ...filtered.map((card) => ({ day: card.date, card })),
    ...(filtering ? [] : missing.map((day) => ({ day, card: null }))),
  ].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)), [filtered, missing, filtering]);

  const loadEarlier = async () => {
    setLoading(true); setProblem("");
    try {
      const to = shift(oldest, -1);
      const next = await api.days({ from: shift(to, -(STEP_DAYS - 1)), to });
      setEarlier((current) => [...current, next]);
    } catch (cause) { setProblem(cause instanceof Error ? cause.message : t("The site didn't load.")); }
    finally { setLoading(false); }
  };
  const command: DayCommand = async (action, input) => {
    const saved = await onCommand(action, input);
    // A card from an earlier step reads again after a change.
    if (saved && earlier.length) {
      const refreshed = await Promise.all(earlier.map((item) => api.days({ from: item.from, to: item.to }).catch(() => item)));
      setEarlier(refreshed);
    }
    return saved;
  };

  if (!cards.length && !missing.length && !more) return <EmptyState illustration={null} title={t("No daily progress yet")}
    action={canReport ? <Button variant="primary" onPress={() => onAdd(null)}>{t("Add today's report")}</Button> : undefined} />;

  return <div className={styles.feed}>
    <div className={styles.filters} role="group" aria-label={t("Filters")}>
      {stages.length ? <SelectField aria-label={t("Stage")} label={null} accent="neutral" selectedKey={filters.stage} onSelectionChange={(key) => setFilters({ ...filters, stage: key ? String(key) : "" })}
        items={[{ id: "", label: t("All stages") }, ...stages.map((stage) => ({ id: stage.id, label: stage.name }))]} /> : null}
      {trades.length ? <SelectField aria-label={t("Trade")} label={null} accent="neutral" selectedKey={filters.trade} onSelectionChange={(key) => setFilters({ ...filters, trade: key ? String(key) : "" })}
        items={[{ id: "", label: t("All trades") }, ...trades.map((trade) => ({ id: trade, label: trade }))]} /> : null}
      <Switch isSelected={filters.issues} onChange={(issues) => setFilters({ ...filters, issues })}>{t("With issues")}</Switch>
      {toReview || filters.review ? <Switch isSelected={filters.review} onChange={(review) => setFilters({ ...filters, review })}>{t("To review ({count})", { count: toReview })}</Switch> : null}
      {filtering ? <Button size="compact" variant="quiet" onPress={() => setFilters(NO_FILTERS)}>{t("Clear filters")}</Button> : null}
    </div>
    {entries.length ? <ol className={styles.list} aria-label={t("Daily progress")}>{entries.map((entry) => entry.card
      ? <li key={entry.day}><DayCard card={entry.card} projectId={projectId} photoUrl={api.photoUrl} me={me} canApprove={canApprove}
        canManage={canManage} onTeam={onTeam} canReport={canReport} members={members} highlighted={highlight === entry.day} onOpenReport={onOpenReport} onCommand={command} /></li>
      : <li key={`missing-${entry.day}`} className={styles.missing} id={`day-${entry.day}`}>
        <time dateTime={entry.day}>{format.day(entry.day)}</time>
        <Badge tone="danger">{t("No report")}</Badge>
        {canReport ? <Button size="compact" variant="quiet" onPress={() => onAdd(entry.day)}>{t("Add report")}</Button> : null}
      </li>)}</ol>
      : <EmptyState illustration={null} title={t("No days match")} action={<Button onPress={() => setFilters(NO_FILTERS)}>{t("Clear filters")}</Button>} />}
    {problem ? <p className={styles.problem} role="alert">{problem}</p> : null}
    {more ? <Button className={styles.earlier} variant="quiet" isLoading={loading} onPress={() => void loadEarlier()}>{t("Earlier days")}</Button> : null}
  </div>;
}
