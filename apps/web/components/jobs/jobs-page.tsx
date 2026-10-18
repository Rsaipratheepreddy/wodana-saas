"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, DataGrid, EmptyState, PageShell, SegmentedControl, ToolbarSearch, formatDate, formatMoney, useDesignSystem, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { CHAPTER_HUE, CHAPTER_LABEL, type JobRow, type JourneyChapter } from "@/lib/jobs/journey";

const CHAPTERS: JourneyChapter[] = ["win", "design", "price", "make", "install", "care"];

/**
 * §0.3: the Jobs list. Each job once, from enquiry to warranty: its client, the chapter it's in and the step now (late
 * when past its date), how far along it is, its value and target date. A chapter filter with counts; a row opens the job.
 */
export function JobsPage({ items, total }: { items: JobRow[]; total: number }) {
  const t = useT();
  const router = useRouter();
  const { locale, timeZone } = useDesignSystem();
  const [search, setSearch] = useState("");
  const [chapter, setChapter] = useState<string>("all");
  const counts = useMemo(() => new Map(CHAPTERS.map((key) => [key, items.filter((item) => item.chapter === key).length])), [items]);
  const needle = search.trim().toLocaleLowerCase();
  const shown = items.filter((item) => (chapter === "all" || item.chapter === chapter)
    && (!needle || [item.reference, item.title, item.client, item.now?.label].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle)));
  const money = (value: JobRow["value"]) => { if (!value) return "—"; try { return formatMoney(value.amount, { locale, currency: value.currency }); } catch { return `${value.currency} ${value.amount}`; } };
  const columns: DataGridColumn<JobRow>[] = [
    { accessorKey: "reference", header: t("Job"), size: 230, cell: ({ row: { original: job } }) => <span className="wd-job-doc">
      <strong>{job.title ?? job.reference}</strong><small>{[job.reference, job.client].filter(Boolean).join(" · ")}</small></span> },
    { id: "now", header: t("Now"), size: 250, accessorFn: (job) => job.now?.label ?? "", cell: ({ row: { original: job } }) => job.now ? <span className="wd-job-doc-chips">
      {job.chapter ? <Badge hue={CHAPTER_HUE[job.chapter]}>{translateKnown(t, CHAPTER_LABEL[job.chapter])}</Badge> : null}
      <span>{translateKnown(t, job.now.label)}</span>
      {job.now.late ? <Badge tone="danger">{t("Late")}</Badge> : null}</span> : <Badge tone="success">{t("Every step is done")}</Badge> },
    { id: "progress", header: t("Progress"), size: 130, accessorFn: (job) => (job.progress.total ? job.progress.done / job.progress.total : 0), cell: ({ row: { original: job } }) => {
      const share = job.progress.total ? Math.round((job.progress.done / job.progress.total) * 100) : 0;
      return <span className="wd-job-progress"><span className="wd-job-progress-bar" aria-hidden="true" data-hue={job.chapter ? CHAPTER_HUE[job.chapter] : undefined}><span style={{ inlineSize: `${share}%` }} /></span>
        <span className="wd-job-doc-muted">{t("{done} of {total}", { done: job.progress.done, total: job.progress.total })}</span></span>;
    } },
    { id: "value", header: t("Value"), size: 130, meta: { align: "end" }, accessorFn: (job) => Number(job.value?.amount ?? 0), cell: ({ row: { original: job } }) => <span className="wd-job-money-figure">{money(job.value)}</span> },
    { accessorKey: "targetDate", header: t("Target date"), size: 120, cell: ({ row: { original: job } }) => <span className="wd-job-doc-muted">{job.targetDate ? formatDate(job.targetDate, { locale, timeZone }) : "—"}</span> },
  ];
  return <PageShell kind="list" title={t("Jobs")} toolbar={<ToolbarSearch label={t("Search")} value={search} onChange={setSearch} />}>
    <div className="wd-job-page">
      <SegmentedControl label={t("Chapter")} value={chapter} onChange={setChapter}
        options={[{ id: "all", label: t("All"), count: total }, ...CHAPTERS.filter((key) => counts.get(key)).map((key) => ({ id: key, label: translateKnown(t, CHAPTER_LABEL[key]), count: counts.get(key) }))]} />
      {items.length ? <div data-sales-grid><DataGrid ariaLabel={t("Jobs")} columns={columns} data={shown} getRowId={(job) => job.id} rowNumbers={false} selectable={false} showToolbar={false}
        emptyTitle={t("No matches")} emptyDescription={t("Try a different word or clear the filters.")} onRowAction={(job) => router.push(`/workspace/jobs/${job.id}`)} /></div>
        : <EmptyState illustration="empty" title={t("Nothing here yet")} description={t("A job starts with its enquiry.")} />}
    </div>
  </PageShell>;
}
