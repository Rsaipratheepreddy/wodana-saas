"use client";

import Link from "next/link";
import { Badge, formatDate, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { useJobNow, type RecordType } from "@/lib/jobs/job-now";
import { CHAPTER_HUE, CHAPTER_LABEL, type JourneyChapter } from "@/lib/jobs/journey";

/**
 * §0.3 P10: the job's step now on a record's own page (a lead, opportunity, planning case or project), read from the
 * journey, so every screen names the same next step. One slim tinted row; "Open job" goes to the job's page.
 * `except`: chapters whose step this page already works in full (the opportunity's own checklist covers Win).
 */
export function JobNowBar({ workspaceId, record, except = [] }: { workspaceId: string; record: { type: RecordType; id: string }; except?: JourneyChapter[] }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const { lookup } = useJobNow(workspaceId, [record]);
  const job = lookup(record.type, record.id);
  if (!job) return null;
  if (!job.now) return <div className="wd-job-now-bar" data-done=""><Badge tone="success">{t("Every step is done")}</Badge>
    <Link className="wd-button" data-size="compact" data-variant="secondary" href={`/workspace/jobs/${job.jobId}`}>{t("Open job")}</Link></div>;
  if (job.chapter && except.includes(job.chapter)) return null;
  const due = job.now.dueAt ? formatDate(job.now.dueAt, { locale, timeZone }) : null;
  return <section className="wd-job-now-bar" aria-label={t("Now · {chapter}", { chapter: job.chapter ? translateKnown(t, CHAPTER_LABEL[job.chapter]) : "" })}>
    <span className="wd-job-now-bar-kicker">{t("Now")}</span>
    <strong className="wd-job-now-bar-step">{translateKnown(t, job.now.label)}</strong>
    <span className="wd-job-now-bar-chips">
      {job.chapter ? <Badge hue={CHAPTER_HUE[job.chapter]}>{translateKnown(t, CHAPTER_LABEL[job.chapter])}</Badge> : null}
      {job.now.owner ? <Badge hue="auto">{job.now.owner}</Badge> : null}
      {job.now.late ? <Badge tone="danger">{due ? t("Late · {date}", { date: due }) : t("Late")}</Badge> : due ? <Badge>{t("Due {date}", { date: due })}</Badge> : null}
    </span>
    <Link className="wd-button" data-size="compact" data-variant="secondary" href={`/workspace/jobs/${job.jobId}`}>{t("Open job")}</Link>
  </section>;
}
