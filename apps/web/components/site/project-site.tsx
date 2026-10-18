"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Plus } from "lucide-react";
import Link from "next/link";
import { parseDate } from "@internationalized/date";
import { Button, ControlledModalDialog, DateRangeField, ErrorState, FormDialog, InlineNotice, SegmentedControl, Skeleton, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { siteApi } from "@/lib/site/client";
import { useLiveInvalidate } from "@/lib/workspace/live-events";
import type { InstallationOwed, SiteReport, SiteState } from "@/lib/site/types";
import { ProjectCrewDays } from "../hrms/crew-days";
import { ProjectSiteAccess } from "../hrms/site-access";
import { useProjectFormat } from "../project-core/format";
import { ProjectArrivals } from "../purchasing/project-arrivals";
import { ClientIssues, useClientIssues } from "./client-issues";
import { DailyCapture } from "./daily-capture";
import { DayFeed } from "./day-feed";
import { ReportReview } from "./report-review";
import styles from "./site.module.css";

type SiteView = "reports" | "crew-days" | "deliveries" | "access" | "issues";

/**
 * A project's site: whether site work is running, and its daily progress — a timeline of each day's report (draft,
 * submitted, approved, sent to the client, returned) with late and missing days marked; the days waiting for the
 * manager's review first (a notice's `?report=` link opens one). Beside it, each crew's day (`?crewDay=`), what's
 * arriving, site access, and the issues the client reported in the portal (`?issue=`).
 */
export function ProjectSite({ workspaceId, projectId, projectName = "", showDeliveries = true }: { workspaceId: string; projectId: string; projectName?: string;
  /** PLM-098: what's arriving shows when the job's path uses Supply (or it already has purchases). */
  showDeliveries?: boolean }) {
  const t = useT();
  const params = useSearchParams();
  const linkedDay = params?.get("crewDay") ?? null;
  const linkedIssue = params?.get("issue") ?? null;
  const [view, setView] = useState<SiteView>(linkedDay ? "crew-days" : linkedIssue ? "issues" : params?.get("view") === "deliveries" && showDeliveries ? "deliveries" : "reports");
  const issues = useClientIssues(workspaceId, projectId);
  const format = useProjectFormat();
  const api = useMemo(() => siteApi(workspaceId, projectId), [workspaceId, projectId]);
  const [state, setState] = useState<SiteState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Home's "Site report" opens a new report on arrival (`?new=report`) for someone who reports on this project.
  const [editing, setEditing] = useState<SiteReport | "new" | null>(() => params?.get("new") === "report" ? "new" : null);
  // A notice or Approvals opens the day it's about (`?report=`).
  const [reviewing, setReviewing] = useState<string | null>(() => params?.get("report") ?? null);
  const [rejecting, setRejecting] = useState<{ report: SiteReport; lineId: string; title: string } | null>(null);
  // PLM-065: finishing site work signs the installation off; with money owed before installation it asks first.
  const [finishing, setFinishing] = useState(false);
  // A new report for a missed day (a "No report" marker), and the progress report's period.
  const [newDay, setNewDay] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const load = useCallback(async () => {
    try { setState(await api.state()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The site didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  // Someone else's report or approval on this project shows without a refresh (a report being edited stays put).
  useLiveInvalidate(workspaceId, [`project:${projectId}`], () => { if (!editing) void load(); });
  const run = async (action: string, input: Record<string, unknown> = {}) => {
    setNotice("");
    try { setState(await api.command(action, input)); return true; }
    catch (cause) {
      setNotice(cause instanceof Error ? cause.message : t("Could not save."));
      if (cause instanceof Error && "status" in cause && cause.status === 409) await load();
      return false;
    }
  };
  if (error && !state) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!state) return <Skeleton lines={6} shape="rows" />;
  const onTeam = state.canReport || state.canManage;
  const switcher = <SegmentedControl label={t("Show")} value={view} onChange={(value) => setView(value as SiteView)}
    options={[{ id: "reports", label: t("Daily progress") }, { id: "crew-days", label: t("Crew days") },
      // What's on its way to site, received where it arrives.
      ...(onTeam && showDeliveries ? [{ id: "deliveries", label: t("Deliveries") }] : []),
      // Who may be on site: only for whoever can see that list (the project's managers and site supervisors, and HR).
      ...(onTeam && state.canSeeSiteAccess !== false ? [{ id: "access", label: t("Access") }] : []),
      // Only once the client has reported something (or a notice links here).
      ...(issues.data?.issues.length || view === "issues" ? [{ id: "issues", label: t("Client issues"), count: issues.toTriage || undefined }] : [])]} />;
  if (view === "crew-days") return <div className={styles.site}>
    <ProjectCrewDays workspaceId={workspaceId} projectId={projectId} openId={linkedDay} switcher={switcher} me={state.me} onTeam={onTeam} />
  </div>;
  if (view === "deliveries") return <div className={styles.site}>
    <ProjectArrivals workspaceId={workspaceId} projectId={projectId} switcher={switcher} />
  </div>;
  if (view === "issues") return <div className={styles.site}>
    <ClientIssues projectId={projectId} client={issues} switcher={switcher} openId={linkedIssue} />
  </div>;
  if (view === "access") return <div className={styles.site}>
    <ProjectSiteAccess workspaceId={workspaceId} projectId={projectId} projectName={projectName} members={state.members} switcher={switcher} />
  </div>;
  const running = Boolean(state.site.startedOn && !state.site.finishedOn);
  const own = (report: { authorId: string; status: string }) => report.authorId === state.me && ["draft", "returned"].includes(report.status) && state.canReport;
  // A report from a card: its author continues a draft; anyone else opens its review (or reads it as it is).
  const open = (report: { id: string; authorId: string; status: string }) => {
    const full = state.reports.find((item) => item.id === report.id);
    if (full && own(full)) setEditing(full);
    else setReviewing(report.id);
  };
  // "Add today's report" (or a missed day's): the draft I already have for that day, else a new one.
  const add = (day: string | null) => {
    const date = day ?? state.today;
    const mine = state.reports.find((report) => report.authorId === state.me && report.reportDate === date);
    if (mine && own(mine)) setEditing(mine);
    else if (mine) setReviewing(mine.id);
    else { setNewDay(day); setEditing("new"); }
  };
  const feed = state.days ?? { from: state.today, to: state.today, today: state.today, cards: [], missing: state.missing ?? [], stages: [], trades: [] };

  return <div className={styles.site}>
    <div className={styles.toolbar}>
      {switcher}
      <span className={styles.muted}>{running ? t("Site work since {date}", { date: format.day(state.site.startedOn) })
        : state.site.finishedOn ? t("Site work {from} – {to}", { from: format.day(state.site.startedOn), to: format.day(state.site.finishedOn) }) : t("Site work hasn't started")}</span>
      <span className={styles.spacer} />
      {state.canManage ? <Button size="compact" onPress={() => running && state.installationOwed?.stages.length ? setFinishing(true)
        : void run(running ? "finish_site" : "start_site", { on: state.today })}>{running ? t("Finish site work") : t("Start site work")}</Button> : null}
      {feed.cards.length || state.site.startedOn ? <Button size="compact" onPress={() => setPrinting(true)}><Download aria-hidden="true" size={14} />{t("Progress report")}</Button> : null}
      {state.canReport ? <Button size="compact" variant="primary" onPress={() => add(null)}><Plus aria-hidden="true" size={14} />{t("Add today's report")}</Button> : null}
    </div>
    {notice ? <InlineNotice tone="error" message={notice} /> : null}
    <DayFeed api={api} projectId={projectId} feed={feed} startedOn={state.site.startedOn} me={state.me} canReport={state.canReport} canApprove={state.canApprove}
      canManage={state.canManage} onTeam={onTeam} members={state.members} highlight={params?.get("day") ?? null} onAdd={add} onOpenReport={open}
      onCommand={(action, input) => run(action, input)} />
    {editing && (editing !== "new" || state.canReport) ? <DailyCapture workspaceId={workspaceId} projectId={projectId} api={api} state={state} report={editing === "new" ? null : editing}
      day={editing === "new" ? newDay : null} onState={setState} onClose={() => { setEditing(null); setNewDay(null); void load(); }} /> : null}
    {printing ? <ProgressReportDialog today={state.today} startedOn={state.site.startedOn} onClose={() => setPrinting(false)}
      onOpen={(from, to) => { window.open(api.progressPrintUrl(from, to), "_blank", "noopener"); setPrinting(false); }} /> : null}
    {reviewing ? <ReportReview api={api} state={state} reportId={reviewing} onState={setState} onClose={() => setReviewing(null)}
      onReject={(report, lineId, title) => setRejecting({ report, lineId, title })} /> : null}
    {finishing && state.installationOwed ? <FinishSiteDialog owed={state.installationOwed} canSignOff={Boolean(state.canSignOffOwed)} paymentsHref={`/workspace/projects/${projectId}/money?view=client`}
      onClose={() => setFinishing(false)} onSubmit={async (owedReason) => { setState(await api.command("finish_site", { on: state.today, owedReason })); setFinishing(false); }} /> : null}
    {rejecting ? <ReasonDialog title={t("{item} not accepted", { item: rejecting.title })} label={t("What isn't right")} action={t("Raise a snag")} onClose={() => setRejecting(null)}
      onSave={async (reason) => { if (await run("reject_installation", { reportId: rejecting.report.id, lineId: rejecting.lineId, reason })) setRejecting(null); }} /> : null}
  </div>;
}

/** The progress report's period (the last two weeks by default, never before site work started), then its printout. */
function ProgressReportDialog({ today, startedOn, onClose, onOpen }: { today: string; startedOn: string | null; onClose: () => void; onOpen: (from: string, to: string) => void }) {
  const t = useT();
  const twoWeeks = new Date(Date.parse(`${today}T00:00:00Z`) - 13 * 86_400_000).toISOString().slice(0, 10);
  const [range, setRange] = useState({ from: startedOn && startedOn > twoWeeks ? startedOn : twoWeeks, to: today });
  const valid = range.from <= range.to && range.to <= today;
  return <FormDialog size="md" title={t("Progress report")} onClose={onClose} submitLabel={t("Open PDF")} isSubmitDisabled={!valid} onSubmit={() => onOpen(range.from, range.to)}>
    <DateRangeField label={t("Period")} value={{ start: parseDate(range.from), end: parseDate(range.to) }} maxValue={parseDate(today)}
      onChange={(value) => { if (value) setRange({ from: value.start.toString(), to: value.end.toString() }); }} />
  </FormDialog>;
}

/** Why something isn't right: one required line of text, then the action. */
function ReasonDialog({ title, label, action, onClose, onSave }: { title: string; label: string; action: string; onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={title} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!reason.trim()} onPress={async () => { setBusy(true); await onSave(reason.trim()); setBusy(false); }}>{action}</Button></div>}>
    <TextAreaField label={label} isRequired value={reason} onChange={setReason} autoFocus />
  </ControlledModalDialog>;
}

/**
 * PLM-065: installation is signed off (site work finished) only once the payment due before installation is in.
 * The dialog lists what is owed; someone who manages projects can still sign it off, saying why.
 */
function FinishSiteDialog({ owed, canSignOff, paymentsHref, onClose, onSubmit }: {
  owed: InstallationOwed; canSignOff: boolean; paymentsHref: string; onClose: () => void; onSubmit: (reason: string) => Promise<void>;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [reason, setReason] = useState("");
  const states: Record<InstallationOwed["stages"][number]["state"], string> = { to_invoice: t("To invoice"), invoiced: t("Invoiced"), reported: t("Waiting for Finance"), verified: t("Received") };
  const total = owed.totals.map((row) => format.money(row.amount, row.currency)).join(" · ");
  return <FormDialog size="md" title={t("Finish site work")} onClose={onClose} cancelLabel={t("Back")} isDirty={Boolean(reason.trim())} hideSubmit={!canSignOff}
    isSubmitDisabled={!reason.trim()} submitLabel={t("Finish site work")} onSubmit={() => onSubmit(reason.trim())}>
    <InlineNotice tone="info" message={t("{amount} is still owed before installation", { amount: total })} />
    <ul className={styles.owed} aria-label={t("Owed before installation")}>
      {owed.stages.map((stage) => <li key={stage.id}><span>{stage.title}</span><span>{format.money(stage.amount, stage.currency)}</span><small>{states[stage.state]}</small></li>)}
    </ul>
    <Link href={paymentsHref}>{t("Open payments")}</Link>
    {canSignOff ? <TextAreaField label={t("Why it's signed off before it's paid")} isRequired value={reason} onChange={setReason} maxLength={500} /> : null}
  </FormDialog>;
}
