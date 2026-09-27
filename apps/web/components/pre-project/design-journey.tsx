"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarPlus, Check, CheckCircle2, Play } from "lucide-react";
import { Badge, Button, ControlledModalDialog, EmptyState, InlineNotice, PersonName, SelectField, Skeleton, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { caseRequest } from "@/lib/pre-project/content";
import { zonedToUtc } from "@/lib/crm/zoned-time";
import styles from "./design-journey.module.css";

type StageCode = "inspiration" | "site_visit" | "concepts" | "space_planning" | "material_selection" | "renders" | "approval";
export type JourneyStage = {
  stage: StageCode; label: string; status: "locked" | "active" | "done"; ownerName: string | null; dueAt: string | null; completedAt: string | null;
  overdue: boolean; version: number; scheduledAt: string | null; scheduledEnd: string | null; scheduledTimezone: string | null; scheduledLocation: { address?: string | null } | null;
};
export type JourneyView = {
  journey: { packageName: string | null; includedRevisions: number } | null;
  stages: JourneyStage[];
  measurements: Array<{ title: string; status: string; files: number }>;
  siteEvidenceProblem: string | null;
  timezone: string;
  canStart: boolean;
};
type Dialog = { kind: "close_inspiration" | "schedule" | "complete_visit"; stage: JourneyStage } | null;

/** PLM-047/048: the design stages of a case, each with its owner, deadline and next action. */
export function DesignJourney({ workspaceId, caseId, locale }: { workspaceId: string; caseId: string; locale?: string }) {
  const t = useT();
  const [view, setView] = useState<JourneyView | null>(null);
  const [failure, setFailure] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState("");
  const [starting, setStarting] = useState(false);
  const load = useCallback(() => caseRequest<JourneyView>(workspaceId, caseId, "design-journey").then(setView).catch((error: Error) => setFailure(error.message)), [workspaceId, caseId]);
  useEffect(() => { void load(); }, [load]);

  if (failure && !view) return <InlineNotice message={failure} tone="error" />;
  if (!view) return <Skeleton lines={4} shape="facts" />;
  const labels: Record<StageCode, string> = {
    inspiration: t("Inspiration"), site_visit: t("Site visit"), concepts: t("Concepts"), space_planning: t("Space planning"),
    material_selection: t("Material selection"), renders: t("3D renders"), approval: t("Design approval"),
  };
  const time = (iso: string, withDay = true) => { try { return new Intl.DateTimeFormat(locale, { timeZone: view.timezone, ...(withDay ? { weekday: "short", day: "numeric", month: "short" } : {}), hour: "numeric", minute: "2-digit" }).format(new Date(iso)); } catch { return iso; } };
  const day = (iso: string) => { try { return new Intl.DateTimeFormat(locale, { timeZone: view.timezone, day: "numeric", month: "short" }).format(new Date(iso)); } catch { return iso; } };
  const saved = async (message: string, next: JourneyView) => { setDialog(null); setNotice(message); setView((current) => ({ ...next, canStart: current?.canStart ?? false })); };
  const start = async () => {
    setStarting(true); setFailure("");
    try { await saved(t("Design stages started."), await caseRequest<JourneyView>(workspaceId, caseId, "design-journey/start", "POST", {})); }
    catch (error) { setFailure(error instanceof Error ? error.message : t("The design stages could not start.")); }
    finally { setStarting(false); }
  };

  const done = view.stages.filter((stage) => stage.status === "done").length;
  return <section aria-labelledby="design-journey-title" className={styles.journey}>
    <header className={styles.header}>
      <div className={styles.heading}>
        <h3 id="design-journey-title">{t("Design")}</h3>
        {view.journey?.packageName ? <span className={styles.package}>{view.journey.packageName}</span> : null}
      </div>
      {view.journey ? <span className={styles.progress} aria-label={t("{done} of {total} stages done", { done, total: view.stages.length })}>
        <span className={styles.progressTrack}><span style={{ inlineSize: `${Math.round((done / Math.max(view.stages.length, 1)) * 100)}%` }} /></span>
        {done}/{view.stages.length}
      </span> : view.canStart ? <Button isLoading={starting} size="compact" variant="primary" onPress={() => void start()}><Play aria-hidden="true" size={14} />{t("Start design")}</Button> : null}
    </header>
    {failure ? <InlineNotice message={failure} tone="error" /> : null}
    {notice ? <InlineNotice message={notice} tone="success" /> : null}
    {!view.journey ? <EmptyState illustration="calendar" title={t("Design hasn't started")} description={t("Design starts once the design deposit is paid.")} /> : <ol className={styles.timeline}>
      {view.stages.map((stage) => <li className={styles.step} data-status={stage.status} data-overdue={stage.overdue || undefined} key={stage.stage}>
        <span aria-hidden="true" className={styles.marker}>{stage.status === "done" ? <Check size={12} strokeWidth={3} /> : null}</span>
        <div className={styles.body}>
          <div className={styles.titleRow}>
            <span className={styles.title}>{labels[stage.stage] ?? stage.label}</span>
            {stage.status === "done" && stage.completedAt ? <span className={styles.meta}>{day(stage.completedAt)}</span> : null}
            {stage.status === "active" ? (stage.dueAt ? <Badge tone={stage.overdue ? "danger" : "neutral"}>{stage.overdue ? t("Overdue") : `${t("Due")} ${time(stage.dueAt)}`}</Badge> : <Badge tone="info">{t("Now")}</Badge>) : null}
          </div>
          {stage.status === "active" ? <>
            <p className={styles.meta}>
              {stage.ownerName ? <span><PersonName person={stage.ownerName} /></span> : null}
              {stage.scheduledAt ? <span>{t("Visit")} {time(stage.scheduledAt)}</span> : null}
              {stage.stage === "inspiration" && !stage.dueAt ? <span>{t("Timer starts with the first inspiration")}</span> : null}
            </p>
            {stage.stage === "inspiration" || stage.stage === "site_visit" ? <div className={styles.actions}>
              {stage.stage === "inspiration" ? <Button size="compact" variant="secondary" onPress={() => setDialog({ kind: "close_inspiration", stage })}>{t("Close inspiration")}</Button> : null}
              {stage.stage === "site_visit" ? <>
                <Button size="compact" variant="secondary" onPress={() => setDialog({ kind: "schedule", stage })}><CalendarPlus aria-hidden="true" size={13} />{stage.scheduledAt ? t("Reschedule") : t("Book visit")}</Button>
                <Button size="compact" variant="primary" onPress={() => setDialog({ kind: "complete_visit", stage })}><CheckCircle2 aria-hidden="true" size={13} />{t("Complete")}</Button>
              </> : null}
            </div> : null}
          </> : null}
        </div>
      </li>)}
    </ol>}
    {dialog?.kind === "close_inspiration" ? <CloseInspirationDialog onClose={() => setDialog(null)} onSubmit={async (note) => saved(t("Inspiration closed. The site visit is next."), await caseRequest(workspaceId, caseId, "design-journey/inspiration/close", "POST", { version: dialog.stage.version, note: note || null }))} /> : null}
    {dialog?.kind === "schedule" ? <ScheduleVisitDialog timezone={view.timezone} onClose={() => setDialog(null)} onSubmit={async (value) => saved(t("Site visit booked. The Account Manager has been invited."), await caseRequest(workspaceId, caseId, "design-journey/site-visit/schedule", "POST", { version: dialog.stage.version, ...value }))} /> : null}
    {dialog?.kind === "complete_visit" ? <CompleteVisitDialog caseId={caseId} problem={view.siteEvidenceProblem} measurements={view.measurements} onClose={() => setDialog(null)} onSubmit={async (summary) => saved(t("Site visit completed."), await caseRequest(workspaceId, caseId, "design-journey/site-visit/complete", "POST", { version: dialog.stage.version, summary }))} /> : null}
  </section>;
}

function useSubmit<T>(submit: (value: T) => Promise<unknown>) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (value: T) => {
    setBusy(true); setError("");
    try { await submit(value); } catch (failure) { setError(failure instanceof Error ? failure.message : t("Could not save.")); setBusy(false); }
  };
  return { busy, error, setError, run };
}

function CloseInspirationDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (note: string) => Promise<unknown> }) {
  const t = useT();
  const [note, setNote] = useState("");
  const { busy, error, run } = useSubmit(onSubmit);
  return <ControlledModalDialog footer={<div className="wd-dialog-actions"><Button isDisabled={busy} onPress={onClose}>{t("Cancel")}</Button><Button isLoading={busy} onPress={() => void run(note.trim())} variant="primary">{t("Close inspiration")}</Button></div>}
    isOpen onOpenChange={(open) => { if (!open && !busy) onClose(); }} title={t("Close inspiration")}>
    <div className={styles.form}>
      {error ? <InlineNotice message={error} tone="error" /> : null}
      <TextAreaField label={t("Note")} maxLength={2000} onChange={setNote} value={note} />
    </div>
  </ControlledModalDialog>;
}

function ScheduleVisitDialog({ timezone, onClose, onSubmit }: { timezone: string; onClose: () => void; onSubmit: (value: { startsAt: string; endsAt: string; timezone: string; address: string | null }) => Promise<unknown> }) {
  const t = useT();
  const [value, setValue] = useState({ date: "", time: "10:00", minutes: "90", address: "" });
  const { busy, error, setError, run } = useSubmit(onSubmit);
  const set = (key: keyof typeof value) => (next: string) => setValue((current) => ({ ...current, [key]: next }));
  const book = () => {
    const startsAt = zonedToUtc(value.date, value.time, timezone);
    if (!startsAt) { setError(t("Choose the date and time.")); return; }
    void run({ startsAt, endsAt: new Date(Date.parse(startsAt) + Number(value.minutes) * 60000).toISOString(), timezone, address: value.address.trim() || null });
  };
  return <ControlledModalDialog footer={<div className="wd-dialog-actions"><Button isDisabled={busy} onPress={onClose}>{t("Cancel")}</Button><Button isLoading={busy} onPress={book} variant="primary">{t("Book")}</Button></div>}
    isOpen onOpenChange={(open) => { if (!open && !busy) onClose(); }} title={t("Book site visit")}>
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); book(); }}>
      {error ? <InlineNotice message={error} tone="error" /> : null}
      <div className={styles.row}>
        <TextInput inputType="date" isRequired label={t("Date")} onChange={set("date")} value={value.date} />
        <TextInput inputType="time" isRequired label={t("Start")} onChange={set("time")} value={value.time} />
        <SelectField items={[60, 90, 120, 180].map((minutes) => ({ id: String(minutes), label: t("{count} min", { count: minutes }) }))} label={t("Length")} onSelectionChange={(key) => set("minutes")(String(key))} selectedKey={value.minutes} />
      </div>
      <small className={styles.muted}>{t("Times are in {zone}", { zone: timezone })}</small>
      <TextInput label={t("Address")} maxLength={500} onChange={set("address")} value={value.address} />
    </form>
  </ControlledModalDialog>;
}

function CompleteVisitDialog({ caseId, problem, measurements, onClose, onSubmit }: { caseId: string; problem: string | null; measurements: JourneyView["measurements"]; onClose: () => void; onSubmit: (summary: string) => Promise<unknown> }) {
  const t = useT();
  const [summary, setSummary] = useState("");
  const { busy, error, setError, run } = useSubmit(onSubmit);
  return <ControlledModalDialog footer={<div className="wd-dialog-actions"><Button isDisabled={busy} onPress={onClose}>{t("Cancel")}</Button><Button isDisabled={Boolean(problem)} isLoading={busy} onPress={() => summary.trim() ? void run(summary.trim()) : setError(t("Summarise what was found on site."))} variant="primary">{t("Complete site visit")}</Button></div>}
    isOpen onOpenChange={(open) => { if (!open && !busy) onClose(); }} title={t("Complete site visit")}>
    <div className={styles.form}>
      {error ? <InlineNotice message={error} tone="error" /> : null}
      {problem ? <InlineNotice tone="info" message={<>{problem}. <Link href={`/workspace/pre-projects/cases/${caseId}/site`}>{t("Open site records")}</Link></>} /> : null}
      {measurements.length ? <ul className={styles.measurements}>{measurements.map((item) => <li key={item.title}><span>{item.title}</span><small>{["measured", "verified"].includes(item.status) ? t("Measured") : t("Not measured")} · {t("{count} files", { count: item.files })}</small></li>)}</ul> : null}
      <TextAreaField isRequired label={t("What was found on site")} maxLength={5000} onChange={setSummary} value={summary} />
    </div>
  </ControlledModalDialog>;
}
