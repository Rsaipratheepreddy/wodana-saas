"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, HardHat } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";
import { siteApi, siteAttention } from "@/lib/site/client";
import type { SiteAttention } from "@/lib/site/types";
import { useLiveInvalidate } from "@/lib/workspace/live-events";
import { useProjectFormat } from "../project-core/format";
import s from "./workspace-home.module.css";

const SCOPES = ["projects", "approvals"] as const;

/**
 * Home for the people who run projects: the daily reports waiting for their review (each opens its review, the
 * client's card beside it), and — once the workspace's end-of-day time has passed — the running sites that have
 * no report for today. Nothing shows when there's nothing to do.
 */
export function SiteProgressAttention({ workspaceId, limit, onShown }: { workspaceId: string;
  /** At most this many rows, of one kind: the reports to review, else the sites without today's report (Home keeps it short). */
  limit?: number;
  /** Told whether anything shows, so Home's Today doesn't list the same reports again. */
  onShown?: (shown: boolean) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const [data, setData] = useState<SiteAttention | null>(null);
  const load = useCallback(() => {
    siteAttention(workspaceId).then((value) => setData(Array.isArray(value?.toReview) && Array.isArray(value?.missing) ? value : null), () => setData(null));
  }, [workspaceId]);
  useEffect(() => { queueMicrotask(load); }, [load]);
  useLiveInvalidate(workspaceId, SCOPES, load, 5_000);
  const toReview = data ? (limit ? data.toReview.slice(0, limit) : data.toReview) : [];
  const missing = data?.pastDue && !(limit && toReview.length) ? (limit ? data.missing.slice(0, limit) : data.missing) : [];
  const shown = toReview.length + missing.length > 0;
  useEffect(() => { onShown?.(shown); }, [onShown, shown]);
  if (!data || !shown) return null;
  return <>
    {toReview.length ? <section className={s.section} aria-labelledby="home-reports-to-review">
      <div className={s.sectionHeader}><h2 id="home-reports-to-review">{t("Reports to review")}</h2><span className={s.count}>{data.toReview.length}</span></div>
      <ul className={s.list}>{toReview.map((row) => <li key={row.reportId} className={s.focusRow}>
        {row.photoId ? <img className={s.reportThumb} src={siteApi(workspaceId, row.projectId).photoUrl(row.photoId)} alt="" loading="lazy" />
          : <span className={s.mark} aria-hidden="true"><ClipboardCheck size={15} /></span>}
        <span className={s.copy}>
          <strong>{t("{project} · {date}", { project: `${row.reference} · ${row.name}`, date: format.short(row.reportDate) })}</strong>
          <small>{[row.authorName, row.photos ? (row.photos === 1 ? t("1 photo") : t("{count} photos", { count: row.photos })) : null].filter(Boolean).join(" · ")}</small>
          {row.summary ? <small className={s.reportSummary} dir="auto">{row.summary}</small> : null}
        </span>
        <Link className="wd-button" data-size="compact" data-variant="primary" href={`/workspace/projects/${row.projectId}/site?report=${row.reportId}`}>{t("Review")}</Link>
      </li>)}</ul>
    </section> : null}
    {missing.length ? <section className={s.section} aria-labelledby="home-sites-missing">
      <div className={s.sectionHeader}><h2 id="home-sites-missing">{t("Sites without today's report")}</h2><span className={s.count}>{data.missing.length}</span></div>
      <ul className={s.list}>{missing.map((row) => <li key={row.projectId} className={s.focusRow} data-urgency="overdue">
        <span className={s.mark} aria-hidden="true"><HardHat size={15} /></span>
        <span className={s.copy}>
          <strong>{`${row.reference} · ${row.name}`}</strong>
          <small>{[row.supervisor, t("Due by {time}", { time: data.dueTime })].filter(Boolean).join(" · ")}</small>
        </span>
        <Link className="wd-button" data-size="compact" data-variant="secondary" href={`/workspace/projects/${row.projectId}/site`}>{t("Open")}</Link>
      </li>)}</ul>
    </section> : null}
  </>;
}
