"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { Button as AriaButton, Dialog, DialogTrigger, Heading } from "react-aria-components";
import { Check, ChevronDown } from "lucide-react";
import { Avatar, Badge, Button, PopoverSurface, TooltipBubble, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { groupRequirements, type NowPlan, type NowStep } from "@/lib/crm/now-step";
import type { OpportunityFlowView } from "@/lib/crm/opportunity-flow";
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
 * The one thing to do now: the step as a verb, one line of why, who does it, when, and one primary button.
 * Other needs before the same column fold under "N more"; the next two steps follow greyed.
 */
export function NowCard({ plan, owner, people, due, busy, onAct, onReassign, children }: {
  plan: NowPlan; owner: Teammate | null; people: Teammate[]; due: string | null; busy: boolean;
  onAct: (step: NowStep) => void; onReassign?: (membershipId: string) => Promise<void>; children?: ReactNode;
}) {
  const t = useT();
  const text = useStepText();
  const [expanded, setExpanded] = useState(false);
  const titleId = useId();
  const now = plan.now;
  if (!now) return null;
  return <div className={styles.nowBlock}>
    <section className={styles.now} aria-labelledby={titleId} data-status={plan.status}>
      <div className={styles.nowMain}>
        <h3 id={titleId}>{text(now)}</h3>
        {plan.why ? <p className={styles.why}>{t(plan.why.key, plan.why.values)}</p> : null}
      </div>
      <div className={styles.nowMeta}>
        {owner ? <span className={styles.assignee}><span aria-hidden="true"><Avatar name={owner.label} seed={owner.id} size="sm" /></span><span>{owner.label}</span></span>
          : <span className={styles.assignee}>{t("Unassigned")}</span>}
        {onReassign && people.length ? <ReassignPopover owner={owner} people={people} onReassign={onReassign} /> : null}
        {plan.status === "open" ? <DueChip at={due} /> : null}
        <span className={styles.primary}><Button size="compact" variant="primary" isLoading={busy} onPress={() => onAct(now)}>{text(now, "short")}</Button></span>
      </div>
      {plan.more.length ? <div className={styles.more}>
        <button type="button" className={styles.moreToggle} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {t("{count} more before {stage}", { count: plan.more.length, stage: plan.column ?? "" })}<ChevronDown aria-hidden="true" size={13} />
        </button>
        {expanded ? <ul className={styles.moreList}>{plan.more.map((step) => <li key={step.id}>
          <span>{text(step)}</span>
          <Button size="compact" variant="quiet" onPress={() => onAct(step)}>{text(step, "short")}</Button>
        </li>)}</ul> : null}
      </div> : null}
      {children}
    </section>
    {plan.then.length ? <p className={styles.then}>{t("Then:")} {plan.then.map((step) => text(step)).join(" · ")}</p> : null}
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

