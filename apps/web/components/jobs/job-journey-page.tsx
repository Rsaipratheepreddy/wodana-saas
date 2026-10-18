"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { CalendarDays, Hash, ListChecks, MessagesSquare, Tag } from "lucide-react";
import { Badge, Button, JourneyMap, PageShell, SideSheet, Tabs, formatDate, formatMoney, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { CHAPTER_HUE, CHAPTER_LABEL, LANE_LABEL, STATE_LABEL, type JobCosts, type JobDocuments, type JobMoney, type JobThread, type JourneyStep, type JourneyView } from "@/lib/jobs/journey";
import { JobThreadPanel } from "./job-thread";
import { rememberJob } from "../workspace/recent-jobs";
import { JobSuggestions } from "./job-suggestions";
import { JobCostsBlock } from "./job-costs";
import { JobDocumentsBlock } from "./job-documents";
import { JobMoneyBlock } from "./job-money";

/**
 * §0.3 P2: the job page: one title (the job) with the team thread beside it, its facts in one compact row, the step
 * now as a slim bar (what, done when, then, who, when, its one action), and the job's parts in tabs (journey, money,
 * costs, documents) so nothing waits below the fold.
 */
export function JobJourneyPage({ view, documents, money: statement, costs, thread, workspaceId, jobId }: { view: JourneyView; documents?: JobDocuments; money?: JobMoney | null;
  costs?: JobCosts | null; thread?: JobThread | null; workspaceId?: string; jobId?: string }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const day = (value: string | null) => value ? formatDate(value, { locale, timeZone }) : null;
  const money = (amount: string, currency: string) => {
    // Exact to the minor unit: the amount string is formatted as stored (never through a float), with the currency's own decimals.
    try { return formatMoney(amount, { locale, currency }); } catch { return `${currency} ${amount}`; }
  };
  // A done step shows when; a skipped one why; one in progress its count (items, reports) or when it is due.
  const detail = (step: JourneyStep) => step.state === "done" ? [day(step.doneAt), step.note].filter(Boolean).join(" · ") || null
    : step.note ? translateKnown(t, step.note) : step.dueAt ? t("Due {date}", { date: day(step.dueAt) ?? "" }) : null;
  const done = view.chapters.reduce((sum, chapter) => sum + chapter.done, 0);
  const total = view.chapters.reduce((sum, chapter) => sum + chapter.total, 0);
  const now = view.now;
  // The tab shown is in the address (?tab=money), so a link or a notice opens the job on it.
  const pathname = usePathname();
  const params = useSearchParams();
  const asked = params.get("tab") ?? "journey";
  // Switching tabs only changes the address (no reload of the page's data).
  const choose = (key: string) => { const next = new URLSearchParams(params.toString()); if (key === "journey") next.delete("tab"); else next.set("tab", key);
    window.history.replaceState(null, "", `${pathname}${next.size ? `?${next}` : ""}`); };
  // A count shows only when something needs a look.
  const attention = (count: number) => (count > 0 ? count : undefined);
  const [unread, setUnread] = useState(thread?.unread ?? 0);
  const late = Boolean(now?.dueAt && now.dueAt < new Date().toISOString());
  // A tab the job doesn't have (or an old link's) shows the journey.
  const available = ["journey", ...(statement && (statement.lines.length || statement.milestones.length) ? ["money"] : []), ...(costs && (costs.orders.length || costs.bills.length) ? ["costs"] : []),
    ...(documents && (documents.sends.length || documents.signatures.length) ? ["documents"] : [])];
  const tab = (key: string) => (available.includes(key) ? key : "journey");
  // The team thread opens beside the page (like a channel's side panel), so the page keeps its full width; ?chat=1 opens it.
  const [chatOpen, setChatOpen] = useState(false);
  // A mention's link (?tab=team, or ?chat=1) opens the thread once the page is on screen.
  const wantsChat = params.get("tab") === "team" || params.get("chat") === "1";
  useEffect(() => { if (wantsChat) setChatOpen(true); }, [wantsChat]);
  // The quick panel lists this viewer's recent jobs.
  useEffect(() => { rememberJob(view.jobId); }, [view.jobId]);
  const hasThread = Boolean(thread && workspaceId && jobId);
  const chatButton = hasThread ? <Button variant="secondary" onPress={() => setChatOpen(true)}>
    <MessagesSquare aria-hidden="true" size={14} />{t("Team")}{unread ? <span className="wd-count-chip">{unread}</span> : null}</Button> : null;
  return <PageShell kind="record" title={view.title ?? view.reference} action={chatButton}>
    {hasThread ? <SideSheet title={t("Team")} size="md" isOpen={chatOpen} onOpenChange={setChatOpen} trigger={null}>
      <JobThreadPanel workspaceId={workspaceId!} jobId={jobId!} initial={thread!} onUnread={setUnread} />
    </SideSheet> : null}
    <div className="wd-job-page">
      {/* The job's facts in one compact row, then the step now as a slim bar: the content below keeps the space. */}
      <div className="wd-job-head">
        <ul className="wd-job-facts" aria-label={t("Job facts")}>
          <li data-hue={1}><Hash aria-hidden="true" size={13} /><strong>{view.reference}</strong>{view.client ? <span>{view.client}</span> : null}</li>
          <li data-tone={total && done === total ? "success" : undefined} data-hue={now ? CHAPTER_HUE[now.chapter] : undefined}><ListChecks aria-hidden="true" size={13} />
            <strong>{t("{done} of {total} steps", { done, total })}</strong>{now ? <Badge hue={CHAPTER_HUE[now.chapter]}>{translateKnown(t, CHAPTER_LABEL[now.chapter])}</Badge> : null}</li>
          <li data-hue={2}><CalendarDays aria-hidden="true" size={13} /><span>{t("Target date")}</span><strong>{day(view.targetDate) ?? t("Not set")}</strong></li>
          {view.value ? <li data-hue={6}><Tag aria-hidden="true" size={13} /><span>{t("Value")}</span><strong className="wd-job-money-figure">{money(view.value.amount, view.value.currency)}</strong></li> : null}
        </ul>
      </div>
      {now ? <section className="wd-job-now" aria-label={t("Now · {chapter}", { chapter: translateKnown(t, CHAPTER_LABEL[now.chapter]) })} data-late={late || undefined}>
        <span className="wd-job-now-kicker">{translateKnown(t, STATE_LABEL.now)}</span>
        <div className="wd-job-now-main">
          <strong className="wd-job-now-title">{translateKnown(t, now.label)}</strong>
          <span className="wd-job-now-why">{t("Done when: {condition}", { condition: translateKnown(t, now.doneWhen) })}</span>
          {view.next.length ? <span className="wd-job-now-why">{t("Then")}: {view.next.map((step) => translateKnown(t, step.label)).join(" · ")}</span> : null}
        </div>
        <div className="wd-job-now-meta">
          <Badge hue="auto">{now.owner ?? translateKnown(t, LANE_LABEL[now.lane])}</Badge>
          {now.dueAt ? <Badge tone={late ? "danger" : "neutral"}>{t("Due {date}", { date: day(now.dueAt) ?? "" })}</Badge> : null}
          {now.href ? <Link className="wd-button" data-variant="primary" href={now.href}>{t("Open {step}", { step: translateKnown(t, now.label) })}</Link> : null}
        </div>
        {/* §0.3 P11: one-click suggestions for this step (optional; nothing shows with AI off). */}
        {workspaceId && jobId ? <JobSuggestions workspaceId={workspaceId} jobId={jobId} /> : null}
      </section> : <Badge tone="success">{t("Every step is done")}</Badge>}

      {/* The job's parts in tabs, so nothing waits below the fold: the journey, its money, its supplier costs and its documents. */}
      <Tabs ariaLabel={t("Sections")} selectedKey={tab(asked)} onSelectionChange={choose} items={[
        { id: "journey", label: t("Journey"), panel: <>
          <JourneyMap label={t("Journey map")}
            bands={view.chapters.map((chapter) => ({ key: chapter.key, label: translateKnown(t, CHAPTER_LABEL[chapter.key]), state: chapter.state, done: chapter.done, total: chapter.total, hue: CHAPTER_HUE[chapter.key] }))}
            lanes={view.lanes.map((lane) => ({ key: lane, label: translateKnown(t, LANE_LABEL[lane]) }))}
            steps={view.steps.map((step) => ({ key: step.key, band: step.chapter, lane: step.lane, label: translateKnown(t, step.label), state: step.state, detail: detail(step), href: step.href,
              late: step.state !== "done" && step.state !== "skipped" && Boolean(step.dueAt) && new Date(step.dueAt!).getTime() < Date.now() }))}
            stateLabel={(state) => translateKnown(t, STATE_LABEL[state])} />
        </> },
        ...(statement && (statement.lines.length || statement.milestones.length) ? [{ id: "money", label: t("Money"), count: attention(statement.milestones.filter((item) => item.overdue).length + statement.checks.length),
          panel: <JobMoneyBlock money={statement} /> }] : []),
        ...(costs && (costs.orders.length || costs.bills.length) ? [{ id: "costs", label: t("Costs"), count: attention(costs.checks.length), panel: <JobCostsBlock costs={costs} /> }] : []),
        ...(documents && (documents.sends.length || documents.signatures.length) ? [{ id: "documents", label: t("Documents"), count: documents.sends.length + documents.signatures.length,
          panel: <JobDocumentsBlock documents={documents} /> }] : []),
      ]} />
    </div>
  </PageShell>;
}
