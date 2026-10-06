"use client";

import { ArrowRight, CalendarClock, ChevronRight, MessageCircleReply, PenLine } from "lucide-react";
import { Button } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PortalFeedCard, PortalStep } from "@/lib/client-portal/types";
import { stageName } from "@/lib/client-portal/stage-names";
import { ProgressCard } from "../../site/progress-card";
import { StateLabel } from "../portal-labels";
import styles from "../portal.module.css";
import { ProfileDetails, useStepText } from "../project-profile";
import { BudgetTracker, FeedList, feedTarget, WhatChanged } from "./portal-home";
import type { SectionProps } from "./section-types";

/**
 * The portal home (plan §5b): what changed since the client last looked (AI2), everything waiting for them with its
 * due date, the latest day on site, what's coming up, their budget (R1), then the feed — typed cards, newest first
 * (the day shown above isn't repeated in it). On a narrow screen the key dates, balance and team follow at the foot.
 */
export function HomeSection({ project, site, api, format, today, open, go, wide }: SectionProps) {
  const t = useT();
  const step = useStepText(format);
  const act = (item: PortalStep) => {
    if (item.kind === "invoice") return go("payments");
    // Concepts and choices are decided where they're listed.
    if (item.kind === "presentation" || item.kind === "choice") return go("decisions");
    open({ kind: item.kind, id: item.id });
  };
  const replies = (project.messages?.requests ?? []).filter((request) => request.unread > 0);
  const waiting = project.next.length + replies.length;
  const card = project.progress?.cards?.[0] ?? null;
  const latest = card ? null : project.latestUpdate;
  const stages = project.progress?.stages ?? [];
  const current = stages.findIndex((stage) => stage.state === "current");
  const coming = stages.map((stage, index) => ({ ...stage, index })).filter((stage) => stage.state !== "done").slice(0, current >= 0 ? 4 : 3);
  // The handover date belongs to the last stage: on its row when that stage is listed, else as its own row.
  const handover = project.handoverDate && !project.handedOverOn ? project.handoverDate : null;
  const lastListed = coming.some((stage) => stage.index === stages.length - 1);
  // The feed, without what's already shown above it (the latest day or update).
  const feed = (project.feed ?? []).filter((item) => !(card && item.kind === "day" && item.id === card.id) && !(latest && item.kind === "update" && item.id === latest.id));
  const openCard = (item: PortalFeedCard) => {
    const where = feedTarget(item);
    if (where.target) open(where.target);
    else if (where.section && project.sections[where.section]) go(where.section);
  };
  // A day shows its lead photo, a shared design its picture.
  const thumb = (item: PortalFeedCard) => {
    if (item.kind === "day") { const hero = project.progress?.cards?.find((day) => day.id === item.id)?.hero; return hero ? api.file("photo", hero.id, true) : null; }
    if (item.kind === "design") return project.design?.designs.some((design) => design.versions.some((version) => version.id === item.id && version.hasPreview)) ? api.file("design", item.id, true) : null;
    return null;
  };
  const canAskChange = project.role === "approver" && project.sections.decisions && Boolean(project.changes);
  return <div className={styles.section} data-tour="portal-home">
    <WhatChanged digest={project.digest} format={format} />

    <section className={styles.group} aria-labelledby="portal-next">
      <h3 className={styles.groupTitle} id="portal-next">{t("Waiting for you")}</h3>
      {waiting ? <ul className={styles.actionCards}>
        {project.next.map((item) => <li key={`${item.kind}-${item.id}`}>
          <button className={styles.actionCard} type="button" onClick={() => act(item)}>
            <span className={styles.itemText}>
              <span className={styles.actionTitle}>{step.title(item)}</span>
              <span className={styles.itemMeta} dir="auto">{[item.title, step.due(item)].filter(Boolean).join(" · ")}</span>
            </span>
            <ArrowRight aria-hidden="true" size={18} />
          </button>
        </li>)}
        {replies.map((request) => <li key={`reply-${request.id}`}>
          <button className={styles.actionCard} data-tone="info" type="button" onClick={() => open({ kind: "thread", id: request.id })}>
            <span className={styles.itemText}>
              <span className={styles.actionTitle}><MessageCircleReply aria-hidden="true" size={16} /> {t("New reply from your team")}</span>
              <span className={styles.itemMeta} dir="auto">{request.title}</span>
            </span>
            <ArrowRight aria-hidden="true" size={18} />
          </button>
        </li>)}
      </ul> : <p className={styles.allClear}>{t("Nothing is waiting for you right now.")}</p>}
    </section>

    {card ? <section className={styles.group} aria-labelledby="portal-latest">
      <div className={styles.groupHead}>
        <h3 className={styles.groupTitle} id="portal-latest">{t("Latest from site")}</h3>
        <Button size="compact" variant="quiet" onPress={() => go("progress")}>{t("See progress")}<ChevronRight aria-hidden="true" size={16} /></Button>
      </div>
      <ProgressCard card={{ ...card, summary: card.summary || (card.noWork ? t("No work on site this day.") : "") }} photoUrl={(id, preview) => api.file("photo", id, preview)}
        formatDay={format.date} />
    </section> : latest ? <section className={styles.group} aria-labelledby="portal-latest">
      <div className={styles.groupHead}>
        <h3 className={styles.groupTitle} id="portal-latest">{t("Latest update")}</h3>
        {project.sections.progress && project.progress ? <Button size="compact" variant="quiet" onPress={() => go("progress")}>{t("See progress")}<ChevronRight aria-hidden="true" size={16} /></Button> : null}
      </div>
      <div className={styles.callout}>
        <p className={styles.quote} dir="auto">{latest.text}</p>
        <span className={styles.muted}>{format.date(latest.at)}</span>
      </div>
    </section> : null}

    {coming.length ? <section className={styles.group} aria-labelledby="portal-coming">
      <h3 className={styles.groupTitle} id="portal-coming">{t("Coming up")}</h3>
      <ol className={styles.milestones}>{coming.map((stage) => <li key={stage.index} data-state={stage.state}>
        <CalendarClock aria-hidden="true" size={16} />
        <span className={styles.itemText}>
          <span className={styles.milestoneName} dir="auto">{stage.name ? stageName(t, stage.name) : t("Stage {number}", { number: stage.index + 1 })}</span>
          {stage.state === "current" && stage.startedOn ? <span className={styles.itemMeta}>{t("since {date}", { date: format.date(stage.startedOn) })}</span> : null}
          {handover && stage.index === stages.length - 1 ? <span className={styles.itemMeta}>{format.date(handover)}</span> : null}
        </span>
        {stage.state === "current" ? <StateLabel state="current" /> : null}
      </li>)}
        {handover && !lastListed ? <li data-state="handover">
          <CalendarClock aria-hidden="true" size={16} />
          <span className={styles.itemText}><span className={styles.milestoneName}>{t("Handover")}</span>
            <span className={styles.itemMeta}>{format.date(handover)}</span></span>
        </li> : null}
      </ol>
    </section> : null}

    {project.budget ? <BudgetTracker budget={project.budget} format={format} onOpen={open} compact /> : null}

    {feed.length || canAskChange ? <section className={styles.group} aria-labelledby="portal-feed">
      <div className={styles.groupHead}>
        <h3 className={styles.groupTitle} id="portal-feed">{t("Latest")}</h3>
        {canAskChange ? <Button size="compact" variant="quiet" onPress={() => open({ kind: "raise-change" })}><PenLine aria-hidden="true" size={16} />{t("Ask for a change")}</Button> : null}
      </div>
      {feed.length ? <FeedList cards={feed} format={format} onOpen={openCard} thumb={thumb} /> : null}
    </section> : null}

    {wide ? null : <div className={styles.profileFoot}><ProfileDetails project={project} site={site} format={format} today={today} go={go} /></div>}
  </div>;
}
