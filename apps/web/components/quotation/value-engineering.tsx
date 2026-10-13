"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, CheckCircle2, Circle, CircleDot, NotebookPen } from "lucide-react";
import { Badge, Button, FormDialog, IconMenuButton, TextAreaField, useDesignSystem } from "@/design-system";
import { MeetingMinutesSheet } from "@/components/meetings/meeting-minutes";
import { ScheduleVisitDialog } from "@/components/pre-project/design-journey";
import { useT } from "@/lib/i18n/i18n-provider";
import { minorUnits, toMinor } from "@/lib/money-exact";
import { money } from "@/lib/quotation/format";
import type { BuilderState } from "@/lib/quotation/types";
import { valueEngineeringApi, type ValueEngineeringRound, type ValueEngineeringView } from "@/lib/value-engineering/client";
import styles from "./value-engineering.module.css";

type Dialog = "start" | "agree" | "meeting" | "keep" | "withdraw" | "minutes" | null;

/** Loads the job's value engineering for this estimate version, again whenever the quote changes (its revision, status or the QS's review). */
export function useValueEngineering(workspaceId: string, caseId: string, quoteId: string, revision: number | string, enabled: boolean) {
  const [view, setView] = useState<ValueEngineeringView | null>(null);
  const load = useCallback(async () => {
    if (!enabled) return;
    try { setView(await valueEngineeringApi(workspaceId, caseId).view(quoteId)); } catch { setView(null); }
  }, [workspaceId, caseId, quoteId, enabled]);
  useEffect(() => { void load(); }, [load, revision]);
  return { view, setView };
}

/**
 * PLM-147, on the estimate: value engineering led by the lead designer with the QS. While a round is open: who leads,
 * the price against the budget, its three steps (the savings agreed, the options presented at the meeting, the client's
 * decision) and the one next action. Without one, the QS (or a manager) can start it when the price is over the
 * client's budget or no budget is recorded. A new version sent to the client, or the client keeping the price, ends it.
 */
export function ValueEngineering({ workspaceId, caseId, state }: { workspaceId: string; caseId: string; state: BuilderState }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const estimate = state.quote.kind === "quotation" && state.quote.round !== "design";
  // The QS confirming the price opens a round without a new revision: reload on the review too.
  const { view, setView } = useValueEngineering(workspaceId, caseId, state.quote.id, `${state.quote.revision}:${state.quote.status}:${state.flow?.canReview ?? ""}:${state.canPrice ?? ""}`, estimate);
  const [dialog, setDialog] = useState<Dialog>(null);
  if (!estimate || !view?.can) return null;
  const api = valueEngineeringApi(workspaceId, caseId);
  const round = view.open && state.family.some((item) => item.id === view.open!.familyId || item.id === view.open!.quoteId) ? view.open : null;
  const m = (value: string, currency: string) => money(value, currency, minorUnits(currency), locale);
  // A refused command stays in its dialog, which says why.
  const run = async (work: () => Promise<ValueEngineeringView>) => { setView(await work()); setDialog(null); };
  const dialogs = <>
    {dialog === "start" ? <NoteDialog title={t("Start value engineering")} label={t("Note for the designer")} submit={t("Start")} onClose={() => setDialog(null)}
      onSubmit={(note) => run(() => api.start(state.quote.id, note))} /> : null}
    {round && dialog === "agree" ? <NoteDialog title={t("Savings agreed with the QS")} label={t("Savings")} required initial={round.optionsNote ?? ""} maxLength={4000} submit={t("Save")}
      onClose={() => setDialog(null)} onSubmit={(note) => run(() => api.agree(round, note))} /> : null}
    {round && dialog === "meeting" ? <ScheduleVisitDialog title={t("Book value engineering meeting")} timezone={view.timezone} onClose={() => setDialog(null)}
      onSubmit={(value) => run(() => api.meeting(round, value))} /> : null}
    {round && dialog === "keep" ? <NoteDialog title={t("Client keeps the price")} label={t("Note")} submit={t("Save")} onClose={() => setDialog(null)}
      onSubmit={(note) => run(() => api.keepPrice(round, note))} /> : null}
    {round && dialog === "withdraw" ? <NoteDialog title={t("Stop value engineering")} label={t("Reason")} required submit={t("Stop")} danger onClose={() => setDialog(null)}
      onSubmit={(note) => run(() => api.withdraw(round, note))} /> : null}
    {round?.meeting && dialog === "minutes" ? <MeetingMinutesSheet workspaceId={workspaceId} activityId={round.meeting.activityId} title={t("Value engineering meeting")} onClose={() => setDialog(null)} /> : null}
  </>;

  if (!round) {
    // The QS's manual start: over the recorded budget, or no budget to compare with.
    const fits = Boolean(view.quote && !view.quote.overBy && view.budget && view.budget.currency === view.quote.currency);
    if (!view.can.start || fits || !view.quote) return dialogs;
    return <section className={styles.panel} aria-label={t("Value engineering")}>
      <div className={styles.head}>
        <span className={styles.facts}>{!view.budget ? t("No client budget recorded")
          : view.budget.currency !== view.quote.currency ? t("The client's budget is in {currency}", { currency: view.budget.currency })
            : t("{over} over the client's budget of {budget}", { over: m(view.quote.overBy ?? "0", view.quote.currency), budget: m(view.budget.amount, view.budget.currency) })}</span>
        <Button size="compact" onPress={() => setDialog("start")}>{t("Over budget: start value engineering")}</Button>
      </div>
      {dialogs}
    </section>;
  }

  const meetingAt = round.meeting?.startsAt ? new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(round.meeting.startsAt)) : null;
  const meetingStarted = Boolean(round.meeting?.startsAt && Date.parse(round.meeting.startsAt) <= Date.now());
  const steps: Array<{ id: string; label: string; detail: string | null; state: "done" | "current" | "upcoming" }> = [
    { id: "agree", label: t("Savings agreed with the QS"), detail: round.optionsNote, state: round.optionsAgreedAt ? "done" : "current" },
    { id: "present", label: t("Options presented to the client"), detail: meetingAt ? t("Meeting {when}", { when: meetingAt }) : null,
      state: meetingStarted ? "done" : round.step === "present_options" ? "current" : "upcoming" },
    { id: "decide", label: t("Client's decision"), detail: round.step === "client_decision" ? t("A new version sent to the client closes this round.") : null,
      state: round.step === "client_decision" ? "current" : "upcoming" },
  ];
  // The page keeps its one primary action (the quote's own step); the round's next action sits beside its steps.
  const primary = view.can.lead && round.step === "agree_options" ? <Button size="compact" variant="secondary" onPress={() => setDialog("agree")}>{t("Record the savings")}</Button>
    : view.can.lead && round.step === "present_options" ? <Button size="compact" variant="secondary" onPress={() => setDialog("meeting")}>
      <CalendarPlus aria-hidden="true" size={13} />{round.meeting ? t("Reschedule") : t("Book meeting")}</Button>
      : null;
  const menu = [
    ...(view.can.lead && round.step !== "agree_options" ? [{ id: "agree", label: t("Change the savings") }] : []),
    ...(view.can.lead && round.step === "client_decision" ? [{ id: "meeting", label: t("Reschedule") }] : []),
    ...(view.can.decide ? [{ id: "keep", label: t("Client keeps the price") }] : []),
    ...(view.can.withdraw ? [{ id: "withdraw", label: t("Stop value engineering"), tone: "danger" as const }] : []),
  ];
  return <section className={styles.panel} aria-label={t("Value engineering")}>
    <div className={styles.head}>
      <strong>{t("Value engineering · round {round}", { round: round.round })}</strong>
      {round.chargeable ? <Badge tone="warning">{t("Chargeable")}</Badge> : null}
      <span className={styles.facts}>{round.lead.fallback
        ? t("{name} leads · no lead designer on the job", { name: round.lead.name })
        : t("{name} leads with {qs}", { name: round.lead.name || t("The lead designer"), qs: round.qsName || t("the QS") })}</span>
      {round.overBy ? <span className={styles.over}>{t("{amount} over budget", { amount: m(round.overBy, round.currency) })}</span> : null}
      {/* The client's budget changed since the round started: the new one, beside the price it started from. */}
      {view.budget && (!round.budgetAmount || view.budget.currency !== round.currency || toMinor(view.budget.amount, round.currency) !== toMinor(round.budgetAmount, round.currency))
        ? <span className={styles.facts}>{t("Budget now {amount}", { amount: m(view.budget.amount, view.budget.currency) })}</span> : null}
    </div>
    <ol className={styles.steps}>
      {steps.map((step) => <li key={step.id} data-state={step.state}>
        {step.state === "done" ? <CheckCircle2 aria-hidden="true" size={14} /> : step.state === "current" ? <CircleDot aria-hidden="true" size={14} /> : <Circle aria-hidden="true" size={14} />}
        <span className={styles.stepText}><span>{step.label}</span>{step.detail ? <span className={styles.detail} dir="auto">{step.detail}</span> : null}</span>
      </li>)}
    </ol>
    {primary || menu.length || round.meeting ? <div className={styles.actions}>
      {round.meeting && meetingStarted ? <Button size="compact" variant="quiet" onPress={() => setDialog("minutes")}><NotebookPen aria-hidden="true" size={13} />{t("Minutes")}</Button> : null}
      <span className={styles.spacer} />
      {primary}
      {menu.length ? <IconMenuButton ariaLabel={t("Value engineering actions")} items={menu} onAction={(id) => setDialog(id as Dialog)} /> : null}
    </div> : null}
    {dialogs}
  </section>;
}

function NoteDialog({ title, label, submit, required = false, danger = false, initial = "", maxLength = 2000, onClose, onSubmit }: {
  title: string; label: string; submit: string; required?: boolean; danger?: boolean; initial?: string; maxLength?: number; onClose: () => void; onSubmit: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState(initial);
  return <FormDialog title={title} onClose={onClose} submitLabel={submit} submitVariant={danger ? "danger" : "primary"} isDirty={note.trim() !== initial.trim()}
    isSubmitDisabled={required && !note.trim()} onSubmit={() => onSubmit(note.trim())}>
    <TextAreaField label={label} isRequired={required} maxLength={maxLength} value={note} onChange={setNote} />
  </FormDialog>;
}

export type { ValueEngineeringRound };
