"use client";

import { useEffect, useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { Button, EmptyState, MoreDetails, ToggleButton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId } from "@/lib/client-portal/client";
import { stageName } from "@/lib/client-portal/stage-names";
import type { PortalDayCard } from "@/lib/client-portal/types";
import { ProgressCard } from "../../site/progress-card";
import { FileStrip } from "../forms/attach-files";
import { isolate } from "../portal-format";
import { StateLabel } from "../portal-labels";
import styles from "../portal.module.css";
import type { SectionProps } from "./section-types";

type FeedItem =
  | { kind: "card"; on: string; card: PortalDayCard }
  | { kind: "update"; on: string; id: string; text: string }
  | { kind: "week"; on: string; id: string; digest: string }
  | { kind: "photos"; on: string; photos: Array<{ id: string }> };

/** Where a link from a message points: ?card=<day> opens the feed at that day. */
function linkedCard() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("card");
}

/**
 * The team's days as a feed, newest first: each day's
 * card with its photos (full size on a tap), what was finished and what's next — with 👍 or ❤️ and a question for
 * the team — beside written updates and the week's roll-ups; and the issues the client reported while the work is on.
 */
export function ProgressSection({ project, api, format, open, reload }: SectionProps) {
  const t = useT();
  const progress = project.progress;
  const [highlight] = useState(linkedCard);
  const [reacting, setReacting] = useState<string | null>(null);
  useEffect(() => {
    if (!highlight) return;
    const timer = window.setTimeout(() => document.getElementById(`day-${highlight}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 150);
    return () => window.clearTimeout(timer);
  }, [highlight]);
  if (!progress) return null;
  const report = progress.canReportIssue ? <Button onPress={() => open({ kind: "issue" })}>{t("Report an issue")}</Button> : undefined;
  const feed: FeedItem[] = [
    ...(progress.cards ?? []).map((card) => ({ kind: "card" as const, on: card.date, card })),
    ...progress.updates.map((update) => ({ kind: "update" as const, on: update.at.slice(0, 10), id: update.id, text: update.text })),
    ...(progress.weeks ?? []).map((week) => ({ kind: "week" as const, on: week.weekEnding, id: week.id, digest: week.digest })),
    ...progress.photoDays.map((day) => ({ kind: "photos" as const, on: day.on, photos: day.photos })),
  ].sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0));
  const nothing = !progress.stages.length && !feed.length && !progress.issues.length;
  if (nothing) return <EmptyState illustration="calendar" title={t("Nothing to show yet")} description={t("Your team's updates and photos will appear here.")} action={report} />;
  const photoUrl = (id: string, preview: boolean) => api.file("photo", id, preview);
  const react = async (card: PortalDayCard, reaction: "like" | "love") => {
    setReacting(`${card.id}:${reaction}`);
    try { await api.command(commandId(), { action: "progress_react", caseId: project.id, reportId: card.id, reaction, on: !card.mine[reaction] }); await reload(); }
    catch { /* the next load shows what was kept */ }
    finally { setReacting(null); }
  };
  // The stage and how far the project is are in the project's profile, beside this feed.
  return <div className={styles.section}>
    {feed.length ? <section className={styles.group} aria-labelledby="portal-feed">
      <h2 className={styles.groupTitle} id="portal-feed">{t("Day by day")}</h2>
      <ol className={styles.days}>{feed.map((item) => {
        if (item.kind === "card") {
          const card = item.card;
          return <li key={`card-${card.id}`} id={`day-${card.id}`}>
            <ProgressCard card={{ ...card, summary: card.summary || (card.noWork ? t("No work on site this day.") : "") }} photoUrl={photoUrl} formatDay={format.date}
              highlighted={highlight === card.id} footer={<>
                <ToggleButton size="compact" variant="quiet" isSelected={card.mine.like} isDisabled={Boolean(reacting)} onPress={() => void react(card, "like")}
                  aria-label={t("Like ({count})", { count: card.reactions.like })}><span aria-hidden="true">👍</span>{card.reactions.like || null}</ToggleButton>
                <ToggleButton size="compact" variant="quiet" isSelected={card.mine.love} isDisabled={Boolean(reacting)} onPress={() => void react(card, "love")}
                  aria-label={t("Love ({count})", { count: card.reactions.love })}><span aria-hidden="true">❤️</span>{card.reactions.love || null}</ToggleButton>
                <span className={styles.spacer} />
                <Button size="compact" variant="quiet" onPress={() => open({ kind: "question", id: card.id })}><MessageCircleQuestion aria-hidden="true" size={15} />{t("Ask a question")}</Button>
              </>} />
          </li>;
        }
        if (item.kind === "week") return <li key={`week-${item.id}`}>
          <ProgressCard card={{ date: item.on, summary: item.digest, hero: null, photos: [], completed: [], advanced: [], next: [] }} photoUrl={photoUrl}
            formatDay={(day) => t("Week ending {date}", { date: format.date(day) })} />
        </li>;
        if (item.kind === "update") return <li key={`update-${item.id}`}>
          <ProgressCard card={{ date: item.on, summary: item.text, hero: null, photos: [], completed: [], advanced: [], next: [] }} photoUrl={photoUrl} formatDay={format.date} />
        </li>;
        return <li key={`photos-${item.on}`}>
          <ProgressCard card={{ date: item.on, summary: "", hero: null, photos: item.photos.map((photo) => ({ id: photo.id, area: null, phase: null, pairId: null })), completed: [], advanced: [], next: [] }}
            photoUrl={photoUrl} formatDay={format.date} />
        </li>;
      })}</ol>
    </section> : null}

    {progress.issues.length || report ? <section className={styles.group} aria-labelledby="portal-issues">
      <h2 className={styles.groupTitle} id="portal-issues">{t("Issues you reported")}</h2>
      {progress.issues.length ? <ul className={styles.list}>{progress.issues.map((issue) => <li className={styles.item} key={issue.id}>
        <span className={styles.itemText}>
          <span className={styles.itemTitle} dir="auto">{issue.description}</span>
          <span className={styles.itemMeta}>{[format.date(issue.raisedOn), issue.area ? isolate(issue.area) : ""].filter(Boolean).join(" · ")}</span>
          {issue.status === "declined" && issue.reason ? <span className={styles.itemMeta} dir="auto">{issue.reason}</span> : null}
          <FileStrip files={issue.files} api={api} />
        </span>
        <span className={styles.itemEnd}><StateLabel state={`issue_${issue.status}`} /></span>
      </li>)}</ul> : null}
      {report ? <div>{report}</div> : null}
    </section> : null}

    {progress.stages.length ? <MoreDetails label={t("All stages")}>
      <ol className={styles.timeline}>{progress.stages.map((item, index) => <li key={index}>
        <span aria-hidden="true" className={styles.dot} data-state={item.state} />
        <span className={styles.itemText}>
          <span className={styles.itemTitle} dir="auto">{item.name ? stageName(t, item.name) : t("Stage {number}", { number: index + 1 })}</span>
          <span className={styles.itemMeta}>{item.state === "upcoming" ? t("Coming up") : <StateLabel state={item.state} />}
            {item.finishedOn ? ` · ${format.date(item.finishedOn)}` : item.startedOn ? ` · ${t("since {date}", { date: format.date(item.startedOn) })}` : ""}</span>
        </span>
      </li>)}</ol>
    </MoreDetails> : null}
  </div>;
}
