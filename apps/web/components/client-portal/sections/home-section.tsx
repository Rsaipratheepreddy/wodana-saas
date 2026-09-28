"use client";

import { ChevronRight } from "lucide-react";
import { Button } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PortalStep } from "@/lib/client-portal/types";
import { stageName } from "@/lib/client-portal/stage-names";
import { daysBetween, isolate } from "../portal-format";
import styles from "../portal.module.css";
import type { SectionProps } from "./section-types";

/** Where the project stands, what's needed from the client now (decisions, payments, new replies), and the latest word from the team. */
export function HomeSection({ project, format, today, open, go }: SectionProps) {
  const t = useT();
  const kinds: Record<PortalStep["kind"], string> = {
    quote: t("Quotation to decide"), design: t("Design to review"), definition: t("Requirements to confirm"), materials: t("Material list to sign off"),
    handover: t("Handover to accept"), request: t("Question to answer"), invoice: t("Invoice to pay"),
  };
  const stages = project.progress?.stages ?? [];
  const act = (step: PortalStep) => (step.kind === "invoice" ? go("payments") : open({ kind: step.kind, id: step.id }));
  const replies = (project.messages?.requests ?? []).filter((request) => request.unread > 0);
  const handover = () => {
    if (project.handedOverOn) return project.warrantyUntil
      ? t("Handed over on {date} · warranty until {until}", { date: format.date(project.handedOverOn), until: format.date(project.warrantyUntil) })
      : t("Handed over on {date}", { date: format.date(project.handedOverOn) });
    if (!project.handoverDate) return null;
    const days = daysBetween(today, project.handoverDate);
    const when = days > 0 ? (days === 1 ? t("tomorrow") : t("in {count} days", { count: days })) : days === 0 ? t("today") : days === -1 ? t("1 day late") : t("{count} days late", { count: -days });
    return t("Handover planned for {date} · {when}", { date: format.date(project.handoverDate), when });
  };
  const handoverLine = handover();
  return <div className={styles.section} data-tour="portal-home">
    {project.stage ? <div className={styles.stage}>
      <p className={styles.itemTitle}>{project.stage.name
        ? t("Stage {number} of {total} · {name}", { number: project.stage.number, total: project.stage.total, name: isolate(stageName(t, project.stage.name)) })
        : t("Stage {number} of {total}", { number: project.stage.number, total: project.stage.total })}</p>
      {stages.length ? <div aria-hidden="true" className={styles.stageBar}>{stages.map((stage, index) => <span data-state={stage.state} key={index} />)}</div> : null}
      {handoverLine ? <p className={styles.itemMeta}>{handoverLine}</p> : null}
    </div> : handoverLine ? <p className={styles.itemMeta}>{handoverLine}</p> : null}

    <section className={styles.group} aria-labelledby="portal-next">
      <h2 className={styles.groupTitle} id="portal-next">{t("Needed from you")}</h2>
      {project.next.length || replies.length ? <ul className={styles.list}>
        {project.next.map((step) => <li key={`${step.kind}-${step.id}`}>
          <button className={`${styles.item} ${styles.itemButton}`} type="button" onClick={() => act(step)}>
            <span className={styles.itemText}><span className={styles.itemTitle}>{kinds[step.kind]}</span>
              <span className={styles.itemMeta} dir="auto">{step.title}{step.due ? ` · ${t("by {date}", { date: format.date(step.due) })}` : ""}</span></span>
            <span className={styles.itemEnd}><ChevronRight aria-hidden="true" size={18} /></span>
          </button>
        </li>)}
        {replies.map((request) => <li key={`reply-${request.id}`}>
          <button className={`${styles.item} ${styles.itemButton}`} type="button" onClick={() => open({ kind: "thread", id: request.id })}>
            <span className={styles.itemText}><span className={styles.itemTitle}>{t("New reply from your team")}</span>
              <span className={styles.itemMeta} dir="auto">{request.title}</span></span>
            <span className={styles.itemEnd}><ChevronRight aria-hidden="true" size={18} /></span>
          </button>
        </li>)}
      </ul> : <p className={styles.muted}>{t("Nothing is waiting for you right now.")}</p>}
    </section>

    {project.latestUpdate ? <section className={styles.group} aria-labelledby="portal-latest">
      <h2 className={styles.groupTitle} id="portal-latest">{t("Latest update")}</h2>
      <div className={styles.callout}>
        <p className={styles.quote} dir="auto">{project.latestUpdate.text}</p>
        <span className={styles.muted}>{format.date(project.latestUpdate.at)}</span>
      </div>
      {project.sections.progress ? <div><Button size="compact" variant="quiet" onPress={() => go("progress")}>{t("See progress")}</Button></div> : null}
    </section> : null}

    {project.manager ? <p className={styles.muted}>{t("Your project manager: {name}", { name: isolate(project.manager) })}</p> : null}
  </div>;
}
