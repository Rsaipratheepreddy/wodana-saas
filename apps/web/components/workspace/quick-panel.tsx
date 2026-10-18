"use client";

import Link from "next/link";
import { ArrowLeft, PanelRightOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, EmptyState, ErrorState, IconButton, SideSheet, Skeleton, Tabs, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { CHAPTER_HUE, CHAPTER_LABEL, type JobDocuments, type JobMoney, type JobRow, type JobThread, type JourneyView } from "@/lib/jobs/journey";
import { JobDocumentsBlock } from "../jobs/job-documents";
import { JobMoneyBlock } from "../jobs/job-money";
import { JobThreadPanel } from "../jobs/job-thread";
import { recentJobs } from "./recent-jobs";
import styles from "./quick-panel.module.css";

type Peek = { journey: JourneyView; money: JobMoney | null; documents: JobDocuments | null; thread: JobThread | null };

/**
 * §0.3: the quick panel. From any page (the top-bar button or ⌘J / Ctrl+J), look at a job without leaving where you
 * are: find it, see where it is now, then its money, documents and team chat; "Open job" goes to the full page.
 */
export function QuickPanel({ workspaceId, className }: { workspaceId: string; className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<JobRow | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [peekFailed, setPeekFailed] = useState(false);
  const query = `workspaceId=${encodeURIComponent(workspaceId)}`;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "j") { event.preventDefault(); setOpen((value) => !value); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const loadJobs = useCallback(async () => {
    setFailed(false);
    const response = await fetch(`/api/workspace/jobs/overview?${query}`, { cache: "no-store" }).catch(() => null);
    const data = response?.ok ? await response.json().catch(() => null) : null;
    if (data && Array.isArray(data.items)) setJobs(data.items); else setFailed(true);
  }, [query]);
  useEffect(() => { if (open && !jobs) queueMicrotask(() => void loadJobs()); }, [open, jobs, loadJobs]);

  const loadPeek = useCallback(async (job: JobRow) => {
    setPeek(null); setPeekFailed(false);
    const read = async <T,>(path: string): Promise<T | null> => {
      const response = await fetch(path, { cache: "no-store" }).catch(() => null);
      return response?.ok ? await response.json().catch(() => null) as T | null : null;
    };
    const base = `/api/workspace/jobs/${job.id}`;
    const [journey, money, documents, thread] = await Promise.all([
      read<JourneyView>(`${base}/journey?${query}`), read<JobMoney>(`${base}/money?${query}`), read<JobDocuments>(`${base}/documents?${query}`), read<JobThread>(`${base}/thread?${query}`),
    ]);
    if (!journey) { setPeekFailed(true); return; }
    setPeek({ journey, money, documents, thread });
  }, [query]);
  const pick = (job: JobRow) => { setPicked(job); void loadPeek(job); };

  const needle = search.trim().toLocaleLowerCase();
  const found = useMemo(() => !jobs || !needle ? [] : jobs.filter((job) => [job.reference, job.title, job.client, job.now?.label].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle)).slice(0, 12), [jobs, needle]);
  const recent = useMemo(() => {
    if (!jobs) return [];
    const ids = recentJobs();
    return ids.map((id) => jobs.find((job) => job.id === id)).filter((job): job is JobRow => Boolean(job)).slice(0, 6);
  }, [jobs, open]); // eslint-disable-line react-hooks/exhaustive-deps -- re-read the viewer's recent jobs each time the panel opens
  const late = useMemo(() => (jobs ?? []).filter((job) => job.now?.late).slice(0, 6), [jobs]);

  const row = (job: JobRow) => <li key={job.id}>
    <button type="button" className={styles.row} onClick={() => pick(job)}>
      <span className={styles.rowText}><strong>{job.title ?? job.reference}</strong><small>{[job.reference, job.client].filter(Boolean).join(" · ")}</small></span>
      <span className={styles.rowChips}>
        {job.chapter ? <Badge hue={CHAPTER_HUE[job.chapter]}>{translateKnown(t, CHAPTER_LABEL[job.chapter])}</Badge> : null}
        {job.now?.late ? <Badge tone="danger">{t("Late")}</Badge> : null}
      </span>
    </button>
  </li>;
  const group = (title: string, items: JobRow[]) => items.length ? <section className={styles.group} aria-label={title}>
    <h3 className={styles.groupTitle}>{title}</h3><ul className={styles.list}>{items.map(row)}</ul></section> : null;

  const finder = failed ? <ErrorState onRetry={() => void loadJobs()} />
    : !jobs ? <Skeleton lines={6} shape="rows" />
    : <div className={styles.finder}>
      <TextInput label={t("Find a job")} value={search} onChange={setSearch} placeholder={t("Client, reference or step")} autoFocus />
      {needle ? (found.length ? group(t("Results"), found) : <EmptyState illustration="search" title={t("No matches")} />)
        : <>{group(t("Late"), late)}{group(t("Recent"), recent)}
          {!late.length && !recent.length ? group(t("Jobs"), jobs.slice(0, 8)) : null}</>}
    </div>;

  const view = picked ? <div className={styles.peek}>
    <div className={styles.peekHead}>
      <IconButton aria-label={t("Back")} size="compact" variant="quiet" onPress={() => { setPicked(null); setPeek(null); }}><ArrowLeft size={15} /></IconButton>
      <span className={styles.rowText}><strong>{picked.title ?? picked.reference}</strong><small>{[picked.reference, picked.client].filter(Boolean).join(" · ")}</small></span>
      <Link className="wd-button" data-size="compact" data-variant="secondary" href={`/workspace/jobs/${picked.id}`} onClick={() => setOpen(false)}>{t("Open job")}</Link>
    </div>
    {peekFailed ? <ErrorState onRetry={() => void loadPeek(picked)} /> : !peek ? <Skeleton lines={5} shape="rows" /> : <>
      {peek.journey.now ? <div className={styles.now}>
        <span className={styles.nowKicker}>{t("Now")}</span>
        <strong>{translateKnown(t, peek.journey.now.label)}</strong>
        <span className={styles.rowChips}>
          <Badge hue={CHAPTER_HUE[peek.journey.now.chapter]}>{translateKnown(t, CHAPTER_LABEL[peek.journey.now.chapter])}</Badge>
          {peek.journey.now.owner ? <Badge hue="auto">{peek.journey.now.owner}</Badge> : null}
          {picked.now?.late ? <Badge tone="danger">{t("Late")}</Badge> : null}
        </span>
      </div> : <Badge tone="success">{t("Every step is done")}</Badge>}
      <Tabs ariaLabel={t("Job")} items={[
        { id: "money", label: t("Money"), panel: peek.money && (peek.money.lines.length || peek.money.milestones.length) ? <JobMoneyBlock money={peek.money} /> : <EmptyState illustration="empty" title={t("No money yet")} /> },
        { id: "documents", label: t("Documents"), count: peek.documents ? (peek.documents.sends.length + peek.documents.signatures.length) || undefined : undefined,
          panel: peek.documents && (peek.documents.sends.length || peek.documents.signatures.length) ? <JobDocumentsBlock documents={peek.documents} /> : <EmptyState illustration="empty" title={t("Nothing sent yet")} /> },
        ...(peek.thread ? [{ id: "team", label: t("Team"), count: peek.thread.unread || undefined, panel: <JobThreadPanel workspaceId={workspaceId} jobId={picked.id} initial={peek.thread} /> }] : []),
      ]} />
    </>}
  </div> : finder;

  return <>
    <button type="button" className={className} aria-label={t("Quick look")} title={`${t("Quick look")} (⌘J)`} aria-keyshortcuts="Meta+J Control+J" onClick={() => setOpen(true)}>
      <PanelRightOpen aria-hidden="true" size={16} />
    </button>
    <SideSheet title={t("Quick look")} size="lg" isOpen={open} onOpenChange={setOpen} trigger={null}>{view}</SideSheet>
  </>;
}
