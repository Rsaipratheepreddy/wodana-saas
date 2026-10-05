"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Button as AriaButton, Dialog, DialogTrigger, Heading } from "react-aria-components";
import { CalendarClock, CalendarPlus, Check, Circle, CircleCheck } from "lucide-react";
import { Avatar, Badge, Button, PopoverSurface, TooltipBubble, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { groupRequirements, type Checklist, type ChecklistRow, type NowPlan, type NowStep } from "@/lib/crm/now-step";
import { translateKnown } from "@/lib/i18n/keys";
import type { OpportunityFlowView } from "@/lib/crm/opportunity-flow";
import { NextStepCard } from "./record/record-layout";
import styles from "./opportunity-now.module.css";

export type Teammate = { id: string; label: string };
export type StageMove = { fromStageId?: string | null; toStageId?: string | null; changedAt?: string | null; changedByName?: string | null };

function shortDate(value: string | null | undefined, locale: string, timeZone: string) {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone }).format(new Date(value));
}

/** The step's label with its values ("Move to {stage}"). */
export function useStepText() {
  const t = useT();
  return (step: NowStep, key: "title" | "short" = "title") => t(step[key], step.values);
}

/** The follow-up date as a chip; past dates are overdue. */
export function DueChip({ at }: { at: string | null | undefined }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  // The moment the chip first rendered: due dates are days, so this does not need to tick.
  const [now] = useState(() => Date.now());
  if (!at || Number.isNaN(Date.parse(at))) return null;
  const overdue = Date.parse(at) < now;
  const date = shortDate(at, locale, timeZone);
  return <Badge tone={overdue ? "danger" : "neutral"}>{overdue ? t("Overdue · {date}", { date }) : t("Due {date}", { date })}</Badge>;
}

/**
 * The pending next follow-up at the top of the action card: what it is, when it is due (red once overdue),
 * Complete and Reschedule. With none booked, a quiet Book a follow-up when the flow needs one.
 */
export function FollowUpRow({ title, due, onComplete, onReschedule, onBook }: {
  title?: string; due?: string | null; onComplete?: () => void; onReschedule?: () => void; onBook?: () => void;
}) {
  const t = useT();
  if (!title) return onBook ? <div className={styles.followUp} data-empty="">
    <span className={styles.check} aria-hidden="true"><CalendarPlus size={16} /></span>
    <span className={styles.rowText}><span className={styles.rowLabel}>{t("No follow-up booked")}</span></span>
    <Button size="compact" variant="quiet" onPress={onBook}>{t("Book a follow-up")}</Button>
  </div> : null;
  return <div className={styles.followUp}>
    <span className={styles.check} aria-hidden="true"><CalendarClock size={16} /></span>
    <span className={styles.rowText}><span className={styles.rowLabel}>{title}</span><DueChip at={due} /></span>
    <span className={styles.followUpActions}>
      {onReschedule ? <Button size="compact" variant="quiet" onPress={onReschedule}>{t("Reschedule")}</Button> : null}
      {onComplete ? <Button size="compact" variant="secondary" onPress={onComplete}><Check aria-hidden="true" size={14} />{t("Complete")}</Button> : null}
    </span>
  </div>;
}

/** The owner and a popover to hand the job to a teammate. */
export function ReassignPopover({ owner, people, onReassign }: { owner: Teammate | null; people: Teammate[]; onReassign: (membershipId: string) => Promise<void> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [failure, setFailure] = useState("");
  const pick = async (id: string) => {
    if (id === owner?.id) { setOpen(false); return; }
    setSaving(id); setFailure("");
    try { await onReassign(id); setOpen(false); } catch (error) { setFailure(error instanceof Error ? error.message : t("Could not save.")); } finally { setSaving(null); }
  };
  return <DialogTrigger isOpen={open} onOpenChange={setOpen}>
    <Button size="compact" variant="quiet">{t("Reassign")}</Button>
    <PopoverSurface>
      <Dialog aria-label={t("Reassign")} className={styles.people}>
        <ul>{people.map((person) => <li key={person.id}>
          <AriaButton className={styles.person} aria-current={person.id === owner?.id || undefined} isDisabled={Boolean(saving)} onPress={() => void pick(person.id)}>
            <span aria-hidden="true"><Avatar name={person.label} seed={person.id} size="sm" /></span>
            <span className={styles.personName}>{person.label}</span>
            {person.id === owner?.id ? <Check aria-hidden="true" size={14} /> : null}
          </AriaButton>
        </li>)}</ul>
        {failure ? <p className={styles.failure} role="alert">{failure}</p> : null}
      </Dialog>
    </PopoverSurface>
  </DialogTrigger>;
}

/**
 * What the next column needs, all at once: each requirement ✓ done (with its value, or who and when) or ○ missing
 * with the one action that resolves it. The first missing one is the step now; who does it sits on top and the pending follow-up leads the list.
 * When nothing is missing, one primary button moves on. After Won or Lost the block names the one next step.
 */
export function NextActions({ plan, checklist, owner, people, followUp, busy, onAct, onRow, onReassign, detail }: {
  plan: NowPlan; checklist: Checklist | null; owner: Teammate | null; people: Teammate[]; busy: boolean;
  /** The pending follow-up row, shown above the checklist. */
  followUp?: ReactNode;
  onAct: (step: NowStep) => void; onRow: (row: ChecklistRow) => void; onReassign?: (membershipId: string) => Promise<void>;
  /** The value a row shows: a done fact, or where a missing one stands. */
  detail?: (row: ChecklistRow) => string | null;
}) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const text = useStepText();
  const now = plan.now;
  if (!now && !checklist && !followUp) return null;
  const rows = checklist?.rows ?? [];
  const first = rows.find((row) => row.state === "missing") ?? null;
  const ready = !first;
  const title = checklist ? t("To move to {stage}", { stage: checklist.column }) : now ? text(now) : "";
  const why = checklist ? checklist.why : plan.why;
  const then = plan.then.filter((step) => step.id !== "advance");
  const rowDetail = (row: ChecklistRow) => detail?.(row)
    ?? (row.state === "done" ? [row.doneBy, shortDate(row.doneAt, locale, timeZone)].filter(Boolean).join(" · ") || null : null);
  return <div className={styles.nowBlock}>
    <NextStepCard title={title} why={why ? t(why.key, why.values) : null} status={plan.status} meta={<>
      {owner ? <span className={styles.assignee}><span aria-hidden="true"><Avatar name={owner.label} seed={owner.id} size="sm" /></span><span>{owner.label}</span></span>
        : <span className={styles.assignee}>{t("Unassigned")}</span>}
      {onReassign && people.length ? <ReassignPopover owner={owner} people={people} onReassign={onReassign} /> : null}
      {ready && now ? <span className={styles.primary}><Button size="compact" variant="primary" isLoading={busy} onPress={() => onAct(now)}>{text(now, "short")}</Button></span> : null}
    </>}>
      {followUp}
      {rows.length ? <ul className={styles.checklist} aria-label={title}>{rows.map((row) => {
        const label = translateKnown(t, row.label);
        const value = rowDetail(row);
        return <li key={row.id} data-state={row.state} data-now={row === first || undefined}>
          <span className={styles.check} aria-hidden="true">{row.state === "done" ? <CircleCheck size={16} /> : <Circle size={16} />}</span>
          <span className={styles.rowText}>
            <span className={styles.rowLabel}>{label}<span className="wd-visually-hidden"> · {row.state === "done" ? t("Done") : t("Missing")}</span></span>
            {value ? <span className={styles.rowValue}>{value}</span> : null}
          </span>
          {row.state === "missing" && row.action ? <Button aria-label={`${t(row.action)} · ${label}`} size="compact" variant={row === first ? "primary" : "secondary"} isLoading={busy && row === first} onPress={() => onRow(row)}>{t(row.action)}</Button> : null}
        </li>;
      })}</ul> : null}
    </NextStepCard>
    {then.length ? <p className={styles.then}>{t("Then:")} {then.map((step) => text(step)).join(" · ")}</p> : null}
  </div>;
}

type DotInfo = { state: "done" | "current" | "upcoming"; heading: string; lines: string[]; by: string | null };

/**
 * One progress line for the flow's columns: ✓ done, ● now, ○ next. A done dot names who moved it on and when;
 * any dot opens what that step needs.
 */
export function ProgressLine({ flow, status, history }: { flow: OpportunityFlowView; status: string; history: StageMove[] }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const steps = flow.steps ?? [];
  if (!steps.length) return null;
  const nextIndex = steps.findIndex((step) => step.stageId === flow.next?.stageId);
  const missing = groupRequirements(flow.missing).map((step) => t(step.title, step.values));
  const toWon = groupRequirements(flow.toWon).map((step) => t(step.title, step.values));
  const info = (index: number): DotInfo => {
    const step = steps[index];
    if (step.state === "done") {
      const move = history.filter((entry) => entry.fromStageId === step.stageId && entry.changedAt).sort((a, b) => String(b.changedAt).localeCompare(String(a.changedAt)))[0];
      const date = shortDate(move?.changedAt, locale, timeZone);
      return { state: "done", heading: step.name, lines: [date ? t("Done · {date}", { date }) : t("Done")], by: move?.changedByName ?? null };
    }
    if (step.state === "current") return { state: "current", heading: step.name, lines: [status === "open" ? t("Here now") : t("Done")], by: null };
    const needs = index === nextIndex ? missing : index === steps.length - 1 && step.step === "won" ? toWon : null;
    if (needs) return { state: "upcoming", heading: t("To move to {stage}", { stage: step.name }), lines: needs.length ? needs : [t("Ready")], by: null };
    return { state: "upcoming", heading: step.name, lines: [index > 0 ? t("After {stage}", { stage: steps[index - 1].name }) : t("Not started")], by: null };
  };
  return <ol className={styles.line} aria-label={t("Progress")} style={{ "--steps": steps.length } as CSSProperties}>
    {steps.map((step, index) => {
      const detail = info(index);
      const dot = <DialogTrigger>
        <AriaButton className={styles.dot} aria-current={step.state === "current" ? "step" : undefined}>
          <span className={styles.mark} aria-hidden="true">{step.state === "done" ? <Check size={10} strokeWidth={3} /> : null}</span>
          <span className={styles.dotLabel}>{step.name}{step.optional ? <small>{t("optional")}</small> : null}</span>
        </AriaButton>
        <PopoverSurface>
          <Dialog aria-label={detail.heading} className={styles.dotPanel}>
            <Heading slot="title" className={styles.dotHeading}>{detail.heading}</Heading>
            {detail.by ? <span className={styles.assignee}><span aria-hidden="true"><Avatar name={detail.by} seed={detail.by} size="sm" /></span><span>{detail.by}</span></span> : null}
            <ul>{detail.lines.map((line) => <li key={line}>{line}</li>)}</ul>
          </Dialog>
        </PopoverSurface>
      </DialogTrigger>;
      return <li key={step.stageId} data-state={step.state}>
        {step.state === "done" ? <TooltipBubble content={<span className={styles.tip}>{detail.by ? <Avatar name={detail.by} seed={detail.by} size="sm" /> : null}{[detail.by, ...detail.lines].filter(Boolean).join(" · ")}</span>}>{dot}</TooltipBubble> : dot}
      </li>;
    })}
  </ol>;
}

