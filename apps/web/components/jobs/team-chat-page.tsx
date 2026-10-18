"use client";

import { ArrowLeft, Hash } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, IconButton, PageShell, Skeleton, ToolbarSearch, formatDate, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import type { JobThread } from "@/lib/jobs/journey";
import { JobThreadPanel } from "./job-thread";

type Thread = { jobId: string; reference: string; title: string | null; body: string; at: string; kind: "message" | "event"; author: string | null; unread: number };

/**
 * §0.3, Team chat: the team's own talk, one thread per job, like channels. The threads on one side (the job, its last
 * line, what you haven't read), the open thread on the other; on a phone, the list, then the thread with a way back.
 * The client's conversations stay in the inbox.
 */
export function TeamChatPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const pathname = usePathname();
  const params = useSearchParams();
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(params.get("job"));
  const [thread, setThread] = useState<JobThread | null>(null);
  const query = `workspaceId=${encodeURIComponent(workspaceId)}`;
  const load = useCallback(async () => {
    setFailed(false);
    const response = await fetch(`/api/workspace/jobs/threads?${query}`, { cache: "no-store" }).catch(() => null);
    const data = response?.ok ? await response.json().catch(() => null) : null;
    if (data && Array.isArray(data.items)) setThreads(data.items); else setFailed(true);
  }, [query]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  // The open thread is in the address (?job=…), so a notice or a link opens it.
  const choose = (jobId: string | null) => {
    setOpen(jobId);
    const next = new URLSearchParams(params.toString());
    if (jobId) next.set("job", jobId); else next.delete("job");
    window.history.replaceState(null, "", `${pathname}${next.size ? `?${next}` : ""}`);
  };
  useEffect(() => {
    if (!open) { setThread(null); return; }
    let live = true;
    setThread(null);
    void fetch(`/api/workspace/jobs/${open}/thread?${query}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).catch(() => null)
      .then((data) => { if (live && data) setThread(data); });
    return () => { live = false; };
  }, [open, query]);
  const needle = search.trim().toLocaleLowerCase();
  const shown = useMemo(() => (threads ?? []).filter((item) => !needle || [item.reference, item.title, item.body].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle)), [threads, needle]);
  const when = (at: string) => {
    const day = new Date(at);
    const today = new Date();
    return day.toDateString() === today.toDateString() ? formatDate(at, { locale, timeZone }, { timeStyle: "short" }) : formatDate(at, { locale, timeZone }, { day: "numeric", month: "short" });
  };
  const current = (threads ?? []).find((item) => item.jobId === open) ?? null;
  const read = (jobId: string) => setThreads((items) => items?.map((item) => item.jobId === jobId ? { ...item, unread: 0 } : item) ?? items);

  const list = failed ? <ErrorState onRetry={() => void load()} />
    : !threads ? <Skeleton lines={6} shape="rows" />
    : !threads.length ? <EmptyState illustration="empty" title={t("No team chat yet")} description={t("Each job has its own thread: open a job and write to its team.")} />
    : <ul className="wd-team-chat-list" aria-label={t("Threads")}>
      {shown.map((item) => <li key={item.jobId}>
        <button type="button" className="wd-team-chat-row" aria-current={item.jobId === open || undefined} onClick={() => choose(item.jobId)}>
          <Hash aria-hidden="true" size={15} className="wd-team-chat-hash" />
          <span className="wd-team-chat-text">
            <span className="wd-team-chat-head"><strong>{item.title ?? item.reference}</strong><time dateTime={item.at}>{when(item.at)}</time></span>
            <span className="wd-team-chat-last">{item.kind === "message" && item.author ? `${item.author}: ` : ""}{item.body}</span>
          </span>
          {item.unread ? <span className="wd-count-chip" aria-label={t("{count} unread", { count: item.unread })}>{item.unread}</span> : null}
        </button>
      </li>)}
      {!shown.length ? <li><EmptyState illustration="search" title={t("No matches")} /></li> : null}
    </ul>;

  return <PageShell kind="list" title={t("Team chat")} toolbar={<ToolbarSearch label={t("Search")} value={search} onChange={setSearch} />}>
    <div className="wd-team-chat" data-open={open ? "" : undefined}>
      <section className="wd-team-chat-side" aria-label={t("Threads")}>{list}</section>
      <section className="wd-team-chat-main" aria-label={current ? (current.title ?? current.reference) : t("Team chat")}>
        {open ? <>
          <header className="wd-team-chat-title">
            <IconButton aria-label={t("Back")} size="compact" variant="quiet" onPress={() => choose(null)}><ArrowLeft size={15} /></IconButton>
            <Hash aria-hidden="true" size={15} className="wd-team-chat-hash" />
            <strong>{current ? (current.title ?? current.reference) : ""}</strong>
            {current ? <a className="wd-team-chat-job" href={`/workspace/jobs/${current.jobId}`}>{current.reference}</a> : null}
          </header>
          {thread ? <JobThreadPanel key={open} workspaceId={workspaceId} jobId={open} initial={thread} onUnread={(count) => { if (!count) read(open); }} /> : <Skeleton lines={5} shape="rows" />}
        </> : <EmptyState illustration="empty" title={translateKnown(t, "Choose a thread")} />}
      </section>
    </div>
  </PageShell>;
}
