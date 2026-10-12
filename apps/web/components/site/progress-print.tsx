"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, ErrorState, NoAccessState, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { stageName } from "@/lib/client-portal/stage-names";
import { siteApi, SiteRequestError } from "@/lib/site/client";
import { clientViewPrint } from "@/lib/site/progress-print";
import type { CardPhoto, ClientView, ProgressPrintData, ProgressReport } from "@/lib/site/types";
import ops from "../operations/print.module.css";
import { useProjectFormat } from "../project-core/format";
import styles from "./progress-print.module.css";
import { useDocumentTitle } from "@/lib/document-title";

const PER_ROW = 3;

/** The photos by room, in the order they were picked (a before right ahead of its after), three to a row. */
function photoRooms(photos: CardPhoto[]) {
  const ordered: CardPhoto[] = [];
  for (const photo of photos) {
    if (ordered.includes(photo)) continue;
    const pair = photo.pairId ? photos.find((item) => item.id === photo.pairId && !ordered.includes(item)) : undefined;
    ordered.push(...(pair ? [photo, pair].sort((a, b) => (a.phase === "before" ? -1 : b.phase === "before" ? 1 : 0)) : [photo]));
  }
  const rooms = new Map<string, CardPhoto[]>();
  for (const photo of ordered) rooms.set(photo.area ?? "", [...(rooms.get(photo.area ?? "") ?? []), photo]);
  return [...rooms].map(([area, list]) => ({ area, rows: Array.from({ length: Math.ceil(list.length / PER_ROW) }, (_, index) => list.slice(index * PER_ROW, (index + 1) * PER_ROW)) }));
}

/**
 * A day on site (or the week's roll-up) on A4, in the firm's name, to print or save as PDF: the project, the day,
 * where it stands, the team's words, what was finished and what's next, and the photos by room. The same page for
 * the team and the client, and only ever the client's card.
 */
export function ProgressPrint({ kind, data, photoUrl, formatDay }: {
  kind: "day" | "week"; data: ProgressPrintData; photoUrl: (id: string) => string; formatDay: (day: string) => string;
}) {
  const t = useT();
  const day = formatDay(data.date);
  useDocumentTitle([kind === "week" ? t("Week ending {date}", { date: day }) : t("Progress on {date}", { date: day }), data.project.reference || data.project.name, data.brand.name]);
  const summary = data.summary || (data.noWork ? t("No work on site this day.") : "");
  const phase = (photo: CardPhoto) => (photo.phase === "before" ? t("Before") : photo.phase === "after" ? t("After") : null);
  const rooms = photoRooms(data.photos);
  const named = rooms.some((room) => room.area);
  const numbers = new Map(rooms.flatMap((room) => room.rows.flat()).map((photo, at) => [photo.id, at + 1]));
  const list = (title: string, items: string[]) => (items.length ? <section className={styles.part} aria-label={title}>
    <h2 className={styles.partTitle}>{title}</h2>
    <ul className={styles.items}>{items.map((item, at) => <li key={at} dir="auto">{item}</li>)}</ul>
  </section> : null);
  return <main className={ops.page}>
    <div className={ops.actions}><Button variant="primary" onPress={() => window.print()}>{t("Download PDF")}</Button></div>
    <article className={`${ops.document} ${styles.sheet}`} aria-label={kind === "week" ? t("Week ending {date}", { date: day }) : t("Progress on {date}", { date: day })}>
      <div className={styles.brand}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the tenant's own logo */}
        {data.brand.logoUrl ? <img className={styles.logo} alt={data.brand.name} src={data.brand.logoUrl} /> : <strong>{data.brand.name}</strong>}
      </div>
      <h1 className={ops.title}>{kind === "week" ? t("Weekly progress") : t("Daily progress")}</h1>
      <dl className={ops.facts}>
        <div><dt>{t("Project")}</dt><dd dir="auto">{[data.project.reference, data.project.name].filter(Boolean).join(" · ")}</dd></div>
        <div><dt>{t("Date")}</dt><dd>{kind === "week" ? t("Week ending {date}", { date: day }) : day}</dd></div>
        {data.stage ? <div><dt>{t("Stage")}</dt><dd dir="auto">{[t("Stage {number} of {total}", { number: data.stage.number, total: data.stage.total }),
          data.stage.name ? stageName(t, data.stage.name) : ""].filter(Boolean).join(" · ")}</dd></div> : null}
        {data.percent !== null ? <div><dt>{t("Progress")}</dt><dd>{t("{percent}% complete", { percent: data.percent })}</dd></div> : null}
      </dl>
      {summary ? <p className={styles.summary} dir="auto">{summary}</p> : null}
      {list(t("Completed today"), data.completed)}
      {list(t("Moving forward"), data.advanced.map((item) => t("{name}: {percent}%", { name: item.title, percent: item.progress })))}
      {list(t("Next up"), data.next)}
      {list(t("Good to know"), data.notes)}
      {rooms.length ? <section className={styles.part} aria-label={t("Photos")}>
        <h2 className={styles.partTitle}>{t("Photos")}</h2>
        {rooms.map((room) => <div key={room.area} className={styles.room}>
          {named ? <h3 className={styles.roomTitle} dir="auto">{room.area || t("Other")}</h3> : null}
          {room.rows.map((row) => <div key={row[0].id} className={styles.row}>{row.map((photo) => {
            const caption = [photo.area, phase(photo)].filter(Boolean).join(" · ");
            return <figure key={photo.id} className={styles.photo}>
              {/* eslint-disable-next-line @next/next/no-img-element -- private photos streamed through an authenticated route */}
              <img src={photoUrl(photo.id)} alt={caption || t("Site photo {number}, {date}", { number: numbers.get(photo.id) ?? 1, date: day })} />
              {caption ? <figcaption dir="auto">{caption}</figcaption> : null}
            </figure>;
          })}</div>)}
        </div>)}
      </section> : null}
    </article>
  </main>;
}

/** The team's printout of a day: the client's card exactly as it went (or as it would go now). */
export function DailyReportPrint({ workspaceId, projectId, reportId }: { workspaceId: string; projectId: string; reportId: string }) {
  const t = useT();
  const format = useProjectFormat();
  const api = useMemo(() => siteApi(workspaceId, projectId), [workspaceId, projectId]);
  const [view, setView] = useState<ClientView | null>(null);
  const [error, setError] = useState<{ message: string; denied: boolean } | null>(null);
  const load = useCallback(async () => {
    try {
      const loaded = await api.clientView(reportId);
      if (!loaded?.view?.project) throw new Error(t("The client's view didn't load."));
      setView(loaded.view); setError(null);
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : t("The client's view didn't load."), denied: cause instanceof SiteRequestError && cause.status === 403 });
    }
  }, [api, reportId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (error && !view) return <main className={ops.page}>{error.denied ? <NoAccessState /> : <ErrorState description={error.message} onRetry={() => void load()} />}</main>;
  if (!view) return <main className={ops.page}><Skeleton lines={10} shape="rows" /></main>;
  return <ProgressPrint kind="day" data={clientViewPrint(view)} photoUrl={(id) => api.photoUrl(id, false)} formatDay={(value) => format.day(value)} />;
}

/**
 * The "Progress report" for a period on A4, in the firm's name: a cover (the project, the period, where it stands and
 * how many days were reported), then one section per day — the team's words, what was finished, what moved forward,
 * what's next and the day's photos. Only the client's card of each approved day is printed, so nothing internal can be.
 */
export function ProgressReportPrint({ report, photoUrl, formatDay }: { report: ProgressReport; photoUrl: (id: string) => string; formatDay: (day: string) => string }) {
  const t = useT();
  const period = t("{from} – {to}", { from: formatDay(report.from), to: formatDay(report.to) });
  useDocumentTitle([t("Progress report"), report.project.reference || report.project.name, period]);
  const phase = (photo: CardPhoto) => (photo.phase === "before" ? t("Before") : photo.phase === "after" ? t("After") : null);
  const list = (title: string, items: string[]) => (items.length ? <section className={styles.part} aria-label={title}>
    <h3 className={styles.partTitle}>{title}</h3>
    <ul className={styles.items}>{items.map((item, at) => <li key={at} dir="auto">{item}</li>)}</ul>
  </section> : null);
  const { project } = report;
  return <main className={ops.page}>
    <div className={ops.actions}><Button variant="primary" onPress={() => window.print()}>{t("Download PDF")}</Button></div>
    <article className={`${ops.document} ${styles.sheet}`} aria-label={t("Progress report")}>
      <header className={styles.cover}>
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the tenant's own logo */}
          {report.brand.logoUrl ? <img className={styles.logo} alt={report.brand.name} src={report.brand.logoUrl} /> : <strong>{report.brand.name}</strong>}
        </div>
        <h1 className={ops.title}>{t("Progress report")}</h1>
        <dl className={ops.facts}>
          <div><dt>{t("Project")}</dt><dd dir="auto">{[project.reference, project.name].filter(Boolean).join(" · ")}</dd></div>
          <div><dt>{t("Period")}</dt><dd>{period}</dd></div>
          {project.stageNumber && project.stageCount ? <div><dt>{t("Stage")}</dt><dd dir="auto">{[t("Stage {number} of {total}", { number: project.stageNumber, total: project.stageCount }),
            project.stage ? stageName(t, project.stage) : ""].filter(Boolean).join(" · ")}</dd></div> : null}
          {project.progress !== null ? <div><dt>{t("Progress")}</dt><dd>{t("{percent}% complete", { percent: project.progress })}</dd></div> : null}
          {project.handoverDate ? <div><dt>{t("Handover")}</dt><dd>{formatDay(project.handoverDate)}</dd></div> : null}
          <div><dt>{t("Days reported")}</dt><dd>{report.days.length}</dd></div>
        </dl>
      </header>
      {report.days.length ? report.days.map((day) => <section key={day.date} className={styles.day} aria-label={formatDay(day.date)}>
        <h2 className={styles.dayTitle}><time dateTime={day.date}>{formatDay(day.date)}</time></h2>
        {day.summary || day.noWork ? <p className={styles.summary} dir="auto">{day.summary || t("No work on site this day.")}</p> : null}
        {list(t("Completed"), day.completed)}
        {list(t("Moving forward"), day.advanced.map((item) => t("{name}: {percent}%", { name: item.title, percent: item.progress })))}
        {list(t("Next up"), day.next)}
        {list(t("Good to know"), day.notes)}
        {day.photos.length ? <div className={styles.photos}>{day.photos.map((photo, at) => {
          const caption = [photo.area, phase(photo)].filter(Boolean).join(" · ");
          return <figure key={photo.id} className={styles.photo}>
            {/* eslint-disable-next-line @next/next/no-img-element -- private photos streamed through an authenticated route */}
            <img src={photoUrl(photo.id)} alt={caption || t("Site photo {number}, {date}", { number: at + 1, date: formatDay(day.date) })} />
            {caption ? <figcaption dir="auto">{caption}</figcaption> : null}
          </figure>;
        })}</div> : null}
      </section>) : <p className={styles.summary}>{t("No approved days in this period.")}</p>}
    </article>
  </main>;
}

/** The team's printout of a period: the progress report, loaded for the project. */
export function PeriodReportPrint({ workspaceId, projectId, from, to }: { workspaceId: string; projectId: string; from: string; to: string }) {
  const t = useT();
  const format = useProjectFormat();
  const api = useMemo(() => siteApi(workspaceId, projectId), [workspaceId, projectId]);
  const [report, setReport] = useState<ProgressReport | null>(null);
  const [error, setError] = useState<{ message: string; denied: boolean } | null>(null);
  const load = useCallback(async () => {
    try {
      const loaded = await api.progressReport(from, to);
      if (!Array.isArray(loaded?.days)) throw new Error(t("The progress report didn't load."));
      setReport(loaded); setError(null);
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : t("The progress report didn't load."), denied: cause instanceof SiteRequestError && cause.status === 403 });
    }
  }, [api, from, to, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (error && !report) return <main className={ops.page}>{error.denied ? <NoAccessState /> : <ErrorState description={error.message} onRetry={() => void load()} />}</main>;
  if (!report) return <main className={ops.page}><Skeleton lines={10} shape="rows" /></main>;
  return <ProgressReportPrint report={report} photoUrl={(id) => api.photoUrl(id, false)} formatDay={(value) => format.day(value)} />;
}
