"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CircleAlert, Play, Redo2, Undo2, X } from "lucide-react";
import {
  Avatar, Button, ConfirmationDialog, IconButton, NoAccessState, TooltipBubble, useToast,
} from "@/design-system";
import { CrmRequestError, crmRequest } from "@/lib/crm/client";
import {
  QUESTION_LABELS, insertBranch, insertStep, locate, moveStep, problemsFor, removeNode, roleName, updateBranch, updateStep,
  checkMeta, type AnswerOptions, type FlowCheck, type FlowDefinition, type FlowDetail, type FlowProblem,
  type FlowValidationError, type RoleOption,
} from "@/lib/flows/flow-model";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { FlowCanvas } from "./flow-canvas";
import { TypeDot } from "./enquiry-type-colors";
import { BranchIcon, CHECK_ICONS } from "./flow-icons";
import { BRANCH, FlowPalette } from "./flow-palette";
import { FlowProperties } from "./flow-properties";
import { answerLabel, deadlineText, doneWhen } from "./flow-text";
import styles from "./flows.module.css";

type Draft = { name: string; definition: FlowDefinition };
type History = { past: Draft[]; present: Draft; future: Draft[]; tag: string | null };
const LIMIT = 100;

export type FlowBuilderProps = {
  answerOptions: AnswerOptions; canManage: boolean; columnNames: Record<string, string>; flow: FlowDetail | null;
  roles: RoleOption[]; workspaceId: string;
};

/** Enquiry types › a type (plan §5a, F3): the builder for its steps. The draft stays in the browser until it is published as a new version. */
export function FlowBuilder(props: FlowBuilderProps) {
  const t = useT();
  if (!props.canManage || !props.flow) return <NoAccessState area={t("Enquiry types")} />;
  return <ReactFlowProvider><Builder {...props} flow={props.flow} /></ReactFlowProvider>;
}

function Builder({ answerOptions, columnNames, flow, roles, workspaceId }: FlowBuilderProps & { flow: FlowDetail }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [baseline, setBaseline] = useState<Draft>({ name: flow.name, definition: flow.selected.definition });
  const [version, setVersion] = useState(flow.selected.version);
  const [history, setHistory] = useState<History>({ past: [], present: baseline, future: [], tag: null });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; at: number } | null>(null);
  const [problems, setProblems] = useState<FlowProblem[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const { definition, name } = history.present;
  // The enquiry type these steps belong to (older responses carry only the flow's name).
  const type = flow.enquiryType ?? { code: flow.code, label: flow.name, color: null };
  const dirty = name !== baseline.name || JSON.stringify(definition) !== JSON.stringify(baseline.definition);
  const problemIds = useMemo(() => new Set((problems ?? []).flatMap((problem) => problem.nodeId ? [problem.nodeId] : [])), [problems]);
  const selected = selectedId && locate(definition, selectedId) ? selectedId : null;

  /** Every edit goes through here: one undo step, except typing in one field, which is one step until another edit. */
  const commit = useCallback((next: Partial<Draft>, tag: string | null = null) => {
    setHistory((current) => {
      const present = { ...current.present, ...next };
      if (tag && current.tag === tag) return { ...current, present, future: [] };
      return { past: [...current.past, current.present].slice(-LIMIT), present, future: [], tag };
    });
  }, []);
  const undo = useCallback(() => setHistory((current) => current.past.length
    ? { past: current.past.slice(0, -1), present: current.past.at(-1)!, future: [current.present, ...current.future], tag: null } : current), []);
  const redo = useCallback(() => setHistory((current) => current.future.length
    ? { past: [...current.past, current.present], present: current.future[0], future: current.future.slice(1), tag: null } : current), []);

  const back = "/workspace/enquiry-types";
  /** Back to Enquiry types, asking first when there are unpublished changes. */
  const leave = useCallback(() => { if (dirty) setLeaving(back); else router.push(back); }, [dirty, router]);

  // Undo and redo anywhere on the page, except while typing in a field (the field keeps its own undo). Esc clears the
  // selection, and with nothing selected (and no dialog or menu open) returns to Enquiry types.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true'], [role='combobox']")) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if (mod && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
      else if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector("[role='dialog'], [role='alertdialog'], .wd-popover")) {
        if (selectedId) setSelectedId(null);
        else leave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, leave, selectedId]);

  // Unpublished changes are lost on leaving: the browser asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const select = (id: string | null, withFocus = false) => {
    setSelectedId(id);
    if (id && withFocus) setFocus({ id, at: Date.now() });
  };

  function add(component: string, afterId: string | null = selected) {
    if (component === BRANCH) {
      const result = insertBranch(definition, afterId, answerOptions);
      if (!result) { toast.push({ tone: "info", title: t("Choose a step"), message: t("A branch follows one step on the main line.") }); return; }
      commit({ definition: result.definition });
      select(result.id, true);
      return;
    }
    const check = component as FlowCheck;
    const result = insertStep(definition, afterId, check, t(checkMeta(check).step));
    commit({ definition: result.definition });
    select(result.id, true);
  }

  function remove(id: string) {
    const next = removeNode(definition, id);
    if (next === definition) return;
    commit({ definition: next });
    setSelectedId(null);
  }

  const canBranch = (() => {
    const at = selected ? locate(definition, selected) : null;
    if (!selected) return insertBranch(definition, null, answerOptions) !== null;
    return at?.kind === "main" && insertBranch(definition, selected, answerOptions) !== null;
  })();

  async function publish() {
    setPublishing(true);
    try {
      const check = await crmRequest<{ valid: boolean; errors: FlowValidationError[] }>(workspaceId, "flows/validate", "POST", { definition });
      if (!check.valid) {
        const found = problemsFor(check.errors, definition);
        setProblems(found);
        const first = found.find((problem) => problem.nodeId)?.nodeId;
        if (first) select(first, true);
        return;
      }
      const published = await crmRequest<{ version: number; created: boolean }>(workspaceId, `flows/${flow.id}/versions`, "POST", { expectedVersion: version, definition });
      setProblems(null);
      setBaseline({ name, definition });
      setVersion(published.version);
      toast.push({ tone: "success", title: t("Version {version} published", { version: published.version }), message: type.label });
      router.refresh();
    } catch (error) {
      const message = error instanceof CrmRequestError || error instanceof Error ? error.message : t("Please try again.");
      toast.push({ tone: "danger", title: t("Not published"), message: translateKnown(t, message) });
    } finally {
      setPublishing(false);
    }
  }

  const previewButton = <Button intent="read" isDisabled><Play aria-hidden="true" size={15} />{t("Preview")}</Button>;
  return <div className={styles.builder}>
    <header className={styles.topBar}>
      <Link aria-label={t("Back to Enquiry types")} className={styles.backLink} href={back}
        onClick={(event) => { if (dirty) { event.preventDefault(); setLeaving(back); } }}><ArrowLeft aria-hidden="true" size={16} /></Link>
      <div className={styles.title}>
        <h1><TypeDot code={type.code} color={type.color} />{type.label}</h1>
      </div>
      <span className={styles.spacer} />
      <div className={styles.actions}>
        <span className={styles.versionTag}>{t("Version {version}", { version })}</span>
        <IconButton aria-label={t("Undo")} isDisabled={!history.past.length} onPress={undo}><Undo2 size={16} /></IconButton>
        <IconButton aria-label={t("Redo")} isDisabled={!history.future.length} onPress={redo}><Redo2 size={16} /></IconButton>
        <TooltipBubble content={t("Coming next")}>{previewButton}</TooltipBubble>
        <Button isDisabled={!dirty} isLoading={publishing} onPress={() => void publish()} variant="primary">{t("Publish changes")}</Button>
      </div>
    </header>
    <div className={styles.workArea}>
      <FlowPalette canBranch={canBranch} onAdd={(component) => add(component)} />
      <div className={styles.canvasArea}>
        <FlowCanvas answerOptions={answerOptions} columnNames={columnNames} definition={definition} focusId={focus}
          onDrop={(component, afterId) => add(component, afterId)} onRemove={remove} onSelect={(id) => select(id)}
          problems={problemIds} roles={roles} selectedId={selected} />
        {problems?.length ? <section aria-label={t("Problems")} className={styles.problems}>
          <header><CircleAlert aria-hidden="true" size={16} /><strong>{t("Fix these to publish")}</strong><span className={styles.spacer} />
            <IconButton aria-label={t("Close")} onPress={() => setProblems(null)}><X size={15} /></IconButton></header>
          <ul>{problems.map((problem, index) => {
            const at = problem.nodeId ? locate(definition, problem.nodeId) : null;
            const label = at?.kind === "branch" ? t(QUESTION_LABELS[at.branch.question]) : at ? at.step.name : t("All steps");
            return <li key={`${problem.path}-${index}`}>
              <button className={styles.problemRow} disabled={!at} onClick={() => { if (problem.nodeId) select(problem.nodeId, true); }} type="button">
                <strong>{label}</strong><span>{translateKnown(t, problem.message)}</span>
              </button>
            </li>;
          })}</ul>
        </section> : null}
      </div>
      <aside aria-label={t("Properties")} className={styles.inspector}>
        {selected ? <FlowProperties answerOptions={answerOptions} columnNames={columnNames} definition={definition} problems={problems ?? []} roles={roles} selectedId={selected}
          onBranchChange={(key, patch) => commit({ definition: updateBranch(definition, key, patch, answerOptions) })}
          onMove={(key, step) => { commit({ definition: moveStep(definition, key, step) }); setFocus({ id: key, at: Date.now() }); }}
          onRemove={remove}
          onStepChange={(key, patch, field) => commit({ definition: updateStep(definition, key, patch) }, field === "name" || field === "deadline" ? `${key}:${field}` : null)} />
          : <p className={styles.inspectorEmpty}>{t("Select a card")}</p>}
      </aside>
    </div>
    <FlowStepsList answerOptions={answerOptions} definition={definition} roles={roles} />
    {leaving ? <ConfirmationDialog body={t("Your changes are not published. Leave and lose them?")} confirmLabel={t("Leave")} isOpen
      onConfirm={() => { const to = leaving; setLeaving(null); setBaseline(history.present); router.push(to); }} onOpenChange={(open) => { if (!open) setLeaving(null); }}
      title={t("Leave without publishing?")} /> : null}
  </div>;
}

/** The phone view: the steps as a read-only list of steps, branches with their answers' steps. */
export function FlowStepsList({ answerOptions, definition, roles }: { answerOptions: AnswerOptions; definition: FlowDefinition; roles: RoleOption[] }) {
  const t = useT();
  const card = (step: FlowDefinition["steps"][number]) => {
    const Icon = CHECK_ICONS[step.check];
    const who = roleName(step.role, roles);
    const deadline = deadlineText(step.deadline, t);
    return <li className={styles.listStep} key={step.key}>
      <span aria-hidden="true" className={styles.cardIcon}><Icon size={15} /></span>
      <span className={styles.listText}>
        <strong>{step.name}</strong>
        <span className={styles.cardWho}><Avatar name={who} roles={[step.role]} seed={step.role} size="sm" /><span>{who}</span></span>
        <small>{[doneWhen(step, t), deadline, step.optional ? t("Optional") : null, step.clientVisible ? t("Client sees it") : null].filter(Boolean).join(" · ")}</small>
      </span>
    </li>;
  };
  return <ol aria-label={t("Steps")} className={styles.stepsList}>
    {definition.steps.flatMap((step) => {
      const branch = definition.branches.find((item) => item.after === step.key);
      if (!branch) return [card(step)];
      return [card(step), <li className={styles.listBranch} key={branch.key}>
        <span className={styles.listBranchTitle}><BranchIcon aria-hidden="true" size={15} />{t(QUESTION_LABELS[branch.question])}</span>
        <ul>{branch.answers.map((answer) => {
          const label = answerLabel(branch.question, answer.value, answerOptions, t);
          return <li key={answer.value}><span className={styles.listAnswer}>{label.letter ? <b>{label.letter}</b> : null}{label.label}</span>
            {answer.steps.length ? <ol className={styles.stepsListNested}>{answer.steps.map(card)}</ol> : null}</li>;
        })}</ul>
      </li>];
    })}
  </ol>;
}
