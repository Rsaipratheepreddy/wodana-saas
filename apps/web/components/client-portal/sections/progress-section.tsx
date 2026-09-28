"use client";

import { Button, EmptyState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { stageName } from "@/lib/client-portal/stage-names";
import { FileStrip } from "../forms/attach-files";
import { isolate } from "../portal-format";
import { StateLabel } from "../portal-labels";
import styles from "../portal.module.css";
import type { SectionProps } from "./section-types";

/** The project's stages, the updates and site photos the team shared, and the issues the client reported while the work is on. */
export function ProgressSection({ project, api, format, open }: SectionProps) {
  const t = useT();
  const progress = project.progress;
  if (!progress) return null;
  const report = progress.canReportIssue ? <Button onPress={() => open({ kind: "issue" })}>{t("Report an issue")}</Button> : undefined;
  const nothing = !progress.stages.length && !progress.updates.length && !progress.photoDays.length && !progress.issues.length;
  if (nothing) return <EmptyState illustration="calendar" title={t("Nothing to show yet")} description={t("Your team's updates and photos will appear here.")} action={report} />;
  return <div className={styles.section}>
    {progress.stages.length ? <section className={styles.group} aria-labelledby="portal-stages">
      <h2 className={styles.groupTitle} id="portal-stages">{t("Stages")}</h2>
      <ol className={styles.timeline}>{progress.stages.map((stage, index) => <li key={index}>
        <span aria-hidden="true" className={styles.dot} data-state={stage.state} />
        <span className={styles.itemText}>
          <span className={styles.itemTitle} dir="auto">{stage.name ? stageName(t, stage.name) : t("Stage {number}", { number: index + 1 })}</span>
          <span className={styles.itemMeta}>{stage.state === "upcoming" ? t("Coming up") : <StateLabel state={stage.state} />}
            {stage.finishedOn ? ` · ${format.date(stage.finishedOn)}` : stage.startedOn ? ` · ${t("since {date}", { date: format.date(stage.startedOn) })}` : ""}</span>
        </span>
      </li>)}</ol>
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

    {progress.updates.length ? <section className={styles.group} aria-labelledby="portal-updates">
      <h2 className={styles.groupTitle} id="portal-updates">{t("Updates")}</h2>
      <ol className={styles.feed}>{progress.updates.map((update) => <li key={update.id}>
        <p className={styles.body} dir="auto">{update.text}</p><span className={styles.muted}>{format.date(update.at)}</span>
      </li>)}</ol>
    </section> : null}

    {progress.photoDays.length ? <section className={styles.group} aria-labelledby="portal-photos">
      <h2 className={styles.groupTitle} id="portal-photos">{t("From the site")}</h2>
      {progress.photoDays.map((day) => <div className={styles.group} key={day.on}>
        <span className={styles.muted}>{format.date(day.on)}</span>
        <div className={styles.photos}>{day.photos.map((photo, index) => <a className={styles.photo} href={api.file("photo", photo.id)} key={photo.id} rel="noreferrer" target="_blank">
          {/* eslint-disable-next-line @next/next/no-img-element -- private photos streamed through the signed-in portal route */}
          <img alt={t("Site photo {number}, {date}", { number: index + 1, date: format.date(day.on) })} loading="lazy" src={api.file("photo", photo.id, true)}
            onError={(event) => { event.currentTarget.closest("a")?.setAttribute("hidden", ""); }} />
        </a>)}</div>
      </div>)}
    </section> : null}
  </div>;
}
