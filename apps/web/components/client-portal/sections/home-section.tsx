"use client";

import { ChevronRight } from "lucide-react";
import { Button } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PortalStep } from "@/lib/client-portal/types";
import styles from "../portal.module.css";
import type { SectionProps } from "./section-types";

/** Where the project stands, what's needed from the client now, and the latest word from the team. */
export function HomeSection({ project, format, open, go }: SectionProps) {
  const t = useT();
  const kinds: Record<PortalStep["kind"], string> = {
    quote: t("Quotation to decide"), design: t("Design to review"), definition: t("Requirements to confirm"), materials: t("Material list to sign off"),
    handover: t("Handover to accept"), request: t("Question to answer"), invoice: t("Invoice to pay"),
  };
  const stages = project.progress?.stages ?? [];
  const act = (step: PortalStep) => (step.kind === "invoice" ? go("payments") : open({ kind: step.kind, id: step.id }));
  return <div className={styles.section}>
    {project.stage ? <div className={styles.stage}>
      <p className={styles.itemTitle}>{project.stage.name
        ? t("Stage {number} of {total} · {name}", { number: project.stage.number, total: project.stage.total, name: project.stage.name })
        : t("Stage {number} of {total}", { number: project.stage.number, total: project.stage.total })}</p>
      {stages.length ? <div aria-hidden="true" className={styles.stageBar}>{stages.map((stage, index) => <span data-state={stage.state} key={index} />)}</div> : null}
      {project.handoverDate ? <p className={styles.itemMeta}>{t("Handover planned for {date}", { date: format.date(project.handoverDate) })}</p> : null}
    </div> : null}

    <section className={styles.group} aria-labelledby="portal-next">
      <h2 className={styles.groupTitle} id="portal-next">{t("Needed from you")}</h2>
      {project.next.length ? <ul className={styles.list}>{project.next.map((step) => <li key={`${step.kind}-${step.id}`}>
        <button className={`${styles.item} ${styles.itemButton}`} type="button" onClick={() => act(step)}>
          <span className={styles.itemText}><span className={styles.itemTitle}>{kinds[step.kind]}</span>
            <span className={styles.itemMeta}>{step.title}{step.due ? ` · ${t("by {date}", { date: format.date(step.due) })}` : ""}</span></span>
          <span className={styles.itemEnd}><ChevronRight aria-hidden="true" size={18} /></span>
        </button>
      </li>)}</ul> : <p className={styles.muted}>{t("Nothing is waiting for you right now.")}</p>}
    </section>

    {project.latestUpdate ? <section className={styles.group} aria-labelledby="portal-latest">
      <h2 className={styles.groupTitle} id="portal-latest">{t("Latest update")}</h2>
      <div className={styles.callout}>
        <p className={styles.quote}>{project.latestUpdate.text}</p>
        <span className={styles.muted}>{format.date(project.latestUpdate.at)}</span>
      </div>
      {project.sections.progress ? <div><Button size="compact" variant="quiet" onPress={() => go("progress")}>{t("See progress")}</Button></div> : null}
    </section> : null}

    {project.manager ? <p className={styles.muted}>{t("Your project manager: {name}", { name: project.manager })}</p> : null}
  </div>;
}
