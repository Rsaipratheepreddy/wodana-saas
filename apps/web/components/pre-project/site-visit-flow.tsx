"use client";

import { useState } from "react";
import { CalendarPlus, Camera, Check, CircleCheck, CircleDashed, Ruler } from "lucide-react";
import { AccessPointsEditor } from "@/components/catalog/fit-check-panel";
import { Button, InlineNotice, TextAreaField, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { JourneyStageView, JourneyView, SiteMeasurement } from "@/lib/pre-project/design-workspace";
import { SiteLocation } from "@/components/ui/site-location";
import { CaseModal } from "./case-controls";
import styles from "./design-decisions.module.css";

export type SiteVisitStep = "visit" | "measurements" | "access" | "photos" | "questions" | "finish";
const STEPS: SiteVisitStep[] = ["visit", "measurements", "access", "photos", "questions", "finish"];
/**
 * R5: the way in (doors, lifts, stairs, corridors), written to the case's access points for the fit check. Never
 * needed to complete the visit; on a furniture or joinery job the step nudges for it.
 */
export type SiteVisitAccess = { workspaceId: string; caseId: string; canEdit: boolean; count: number | null; nudge: boolean; onChanged: () => void; onLoaded?: (count: number) => void };
/** Furniture and joinery orders (PLM-080/081) carry items through the door: the access step asks for the way in. */
export const accessMatters = (view: Pick<JourneyView, "journey" | "startsAs">) => (view.journey?.kind ?? view.startsAs) === "site_and_materials";
const measured = (item: SiteMeasurement) => ["measured", "verified"].includes(item.status);

/** Which steps are done, from the journey's facts (the server checks the same before completing). */
export function siteVisitProgress(view: Pick<JourneyView, "measurements" | "checklist" | "stages">) {
  const stage = view.stages.find((item) => item.stage === "site_visit");
  const measurements = view.measurements ?? [];
  const checklist = view.checklist ?? [];
  return {
    visit: Boolean(stage?.scheduledAt),
    measurements: measurements.length > 0 && measurements.every(measured),
    photos: measurements.length > 0 && measurements.every((item) => item.files > 0),
    questions: checklist.every((item) => Boolean(item.answer)),
    finish: stage?.status === "done",
  } satisfies Record<Exclude<SiteVisitStep, "access">, boolean>;
}

/**
 * PLM-048/128: the site visit as one guided flow, on the web and on a phone on site — the visit, every wall
 * measured, photos, the firm's question list, then complete. Each step says what's left; the last step completes
 * the visit only when everything is in.
 */
export function SiteVisitFlow({ view, stage, access, onClose, onBook, onMeasure, onAddPhotos, onSaveAnswers, onComplete }: {
  view: JourneyView; stage: JourneyStageView; access?: SiteVisitAccess; onClose: () => void; onBook: () => void; onMeasure: (roomId: string | null) => void; onAddPhotos: (roomId: string | null) => void;
  onSaveAnswers: (answers: Array<{ key: string; answer: string }>) => Promise<unknown>; onComplete: (summary: string) => Promise<unknown>;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  // The open stage is the one passed in (the flow opens on the current site visit).
  const steps = STEPS.filter((item) => item !== "access" || access);
  const progress = { ...siteVisitProgress({ ...view, stages: [stage] }), access: (access?.count ?? 0) > 0 };
  // Access is optional: the flow opens on it only when the job carries furniture or joinery through the door.
  const [step, setStep] = useState<SiteVisitStep>(() => steps.find((item) => !progress[item] && (item !== "access" || access?.nudge)) ?? "finish");
  const missingAccess = Boolean(access?.nudge && access.count === 0);
  const checklist = view.checklist ?? [];
  const measurements = view.measurements ?? [];
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(checklist.map((item) => [item.key, item.answer ?? ""])));
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unsaved = checklist.filter((item) => (drafts[item.key] ?? "").trim() !== (item.answer ?? ""));
  const problem = view.siteEvidenceProblem ?? view.siteChecklistProblem ?? null;
  const labels: Record<SiteVisitStep, string> = { visit: t("Visit"), measurements: t("Measurements"), access: t("Access"), photos: t("Photos"), questions: t("Questions"), finish: t("Complete") };
  const index = steps.indexOf(step);
  const run = async (work: () => Promise<unknown>) => { setBusy(true); setError(""); try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); } finally { setBusy(false); } };
  const when = (iso: string) => { try { return new Intl.DateTimeFormat(locale, { timeZone: view.timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso)); } catch { return iso; } };
  const answered = checklist.filter((item) => item.answer).length;

  return <CaseModal title={t("Site visit")} size="lg" layout="sheet" onClose={onClose} busy={busy} dirty={Boolean(summary.trim()) || unsaved.length > 0}
    footer={<div className={styles.footer}>
      <Button size="compact" variant="quiet" isDisabled={index === 0 || busy} onPress={() => setStep(steps[index - 1])}>{t("Back")}</Button>
      {step === "finish" ? <Button size="compact" variant="primary" isLoading={busy} isDisabled={Boolean(problem) || !summary.trim() || unsaved.length > 0}
        onPress={() => void run(() => onComplete(summary.trim()))}>{t("Complete site visit")}</Button>
        : <Button size="compact" variant="primary" isDisabled={busy} onPress={() => void (step === "questions" && unsaved.length
          ? run(async () => { await onSaveAnswers(unsaved.map((item) => ({ key: item.key, answer: (drafts[item.key] ?? "").trim() }))); setStep(steps[index + 1]); })
          : setStep(steps[index + 1]))}>{step === "questions" && unsaved.length ? t("Save and continue") : t("Continue")}</Button>}
    </div>}>
    {view.site ? <div className={styles.muted}><SiteLocation address={view.site.address} latitude={view.site.latitude} longitude={view.site.longitude} /></div> : null}
    <nav aria-label={t("Site visit steps")}><ol className={styles.steps}>{steps.map((item, position) => <li key={item}>
      <button type="button" aria-current={item === step ? "step" : undefined} data-done={progress[item] || undefined} onClick={() => setStep(item)}>
        <span className={styles.stepIcon} aria-hidden="true">{progress[item] ? <Check size={12} strokeWidth={3} /> : position + 1}</span>{labels[item]}
      </button></li>)}</ol></nav>
    {error ? <InlineNotice tone="error" message={error} /> : null}

    {step === "visit" ? <div className={styles.stack}>
      {stage.scheduledAt ? <p>{t("Visit {when}", { when: when(stage.scheduledAt) })}{stage.scheduledLocation?.address ? ` · ${stage.scheduledLocation.address}` : ""}</p>
        : <p className={styles.muted}>{t("Not booked yet. The designer and the Account Manager are both invited.")}</p>}
      {stage.dueAt ? <p className={styles.muted}>{t("Due {date}", { date: when(stage.dueAt) })}</p> : null}
      <div><Button size="compact" variant={stage.scheduledAt ? "secondary" : "primary"} onPress={onBook}><CalendarPlus aria-hidden="true" size={14} />{stage.scheduledAt ? t("Reschedule") : t("Book visit")}</Button></div>
    </div> : null}

    {step === "measurements" || step === "photos" ? <div className={styles.stack}>
      <p className={styles.muted}>{step === "measurements" ? t("Measure every wall of each room.") : t("Add at least one photo for each measured room.")}</p>
      {measurements.length ? <ul className={styles.checks}>{measurements.map((item) => {
        const ok = step === "measurements" ? measured(item) : item.files > 0;
        return <li data-ok={ok || undefined} key={`${item.roomId ?? ""}-${item.title}`}>
          <span className={styles.checkName}>{ok ? <CircleCheck aria-hidden="true" size={16} /> : <CircleDashed aria-hidden="true" size={16} />}{item.title}</span>
          {step === "measurements"
            ? <Button size="compact" variant={ok ? "quiet" : "secondary"} onPress={() => onMeasure(item.roomId ?? null)}><Ruler aria-hidden="true" size={14} />{ok ? t("Edit") : t("Measure")}</Button>
            : <Button size="compact" variant={ok ? "quiet" : "secondary"} onPress={() => onAddPhotos(item.roomId ?? null)}><Camera aria-hidden="true" size={14} />{t("{count} photos", { count: item.files })}</Button>}
        </li>;
      })}</ul> : <p className={styles.muted}>{t("No rooms measured yet. Add each room as you reach it.")}</p>}
      {step === "measurements" ? <div><Button size="compact" onPress={() => onMeasure(null)}><Ruler aria-hidden="true" size={14} />{t("Measure a room")}</Button></div> : null}
    </div> : null}

    {step === "access" && access ? <div className={styles.stack}>
      <p className={styles.muted}>{t("Measure the doors, lifts, stairs and corridors on the way in.")}</p>
      {missingAccess ? <InlineNotice tone="info" message={t("Furniture and joinery have to get through. Measure the way in so each item can be checked.")} /> : null}
      <AccessPointsEditor workspaceId={access.workspaceId} caseId={access.caseId} canEdit={access.canEdit} onChanged={access.onChanged} onLoaded={(points) => access.onLoaded?.(points.length)} />
    </div> : null}

    {step === "questions" ? <div className={styles.stack}>
      <p className={styles.muted}>{t("{answered} of {total} answered", { answered, total: checklist.length })}</p>
      {checklist.map((item) => <TextAreaField key={item.key} label={item.question} maxLength={2000} value={drafts[item.key] ?? ""}
        onChange={(next) => setDrafts((current) => ({ ...current, [item.key]: next }))}
        description={item.answer && item.answeredByName ? t("Answered by {name}", { name: item.answeredByName }) : undefined} />)}
    </div> : null}

    {step === "finish" ? <div className={styles.stack}>
      {problem ? <InlineNotice tone="info" message={problem} /> : <InlineNotice tone="success" message={t("Everything is in.")} />}
      {missingAccess ? <InlineNotice tone="info" message={t("No access measured. Items can't be checked against the way in.")} /> : null}
      <TextAreaField isRequired label={t("What was found on site")} maxLength={5000} value={summary} onChange={setSummary} />
    </div> : null}
  </CaseModal>;
}
