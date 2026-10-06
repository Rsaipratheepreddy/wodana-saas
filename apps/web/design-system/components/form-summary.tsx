"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";
import { fieldName, focusField, inDocumentOrder, revealById, visibleControl, type FormControl } from "../foundations/blocked-save-alert";

type Problem = { control: FormControl; name: string };

/**
 * The fields a blocked save needs, named at the top of the form. Each name takes the person to its field;
 * the summary shrinks as fields are fixed and goes once they all are.
 */
export function FormErrorSummary({ problems }: { problems: Problem[] }) {
  const t = useT();
  const unique = problems.filter((problem, index) => problems.findIndex((other) => other.name === problem.name) === index);
  if (!unique.length) return null;
  return <div className="wd-form-summary" role="alert">
    <CircleAlert aria-hidden="true" size={16} />
    <div>
      <strong>{unique.length === 1 ? t("Check 1 field") : t("Check {count} fields", { count: unique.length })}</strong>
      <ul>{unique.map((problem) => <li key={problem.name}><button aria-label={t("Go to {field}", { field: problem.name || t("Unnamed field") })} onClick={() => focusField(problem.control)} type="button">{problem.name || t("Unnamed field")}</button></li>)}</ul>
    </div>
  </div>;
}

/** One thing a refused save needs: the field (`key`, the control's `name`) and what to do. The server sends the same shape as `missing`. */
export type SaveProblem = { key: string; label: string };

/** The problems a refused save names (`{ message, missing: [{ key, label }] }`), or none. */
export function readSaveProblems(body: unknown): SaveProblem[] {
  const missing = body && typeof body === "object" ? (body as { missing?: unknown }).missing : undefined;
  return Array.isArray(missing) ? missing.filter((item): item is SaveProblem => Boolean(item) && typeof item === "object"
    && typeof (item as SaveProblem).key === "string" && typeof (item as SaveProblem).label === "string") : [];
}

/**
 * The id of the visible control a problem belongs to: the field named `key` in the same form (its own control, a
 * dropdown's button), else the field or control marked `data-problem-key`.
 */
export function problemFieldId(from: HTMLElement | null, key: string): string | null {
  const form = from?.closest("form");
  const named = form?.elements.namedItem(key);
  const control = named instanceof RadioNodeList ? named[0] : named;
  if (control instanceof HTMLElement && "validity" in control) return visibleControl(control).id;
  const marked = (form ?? document).querySelector<HTMLElement>(`[data-problem-key="${CSS.escape(key)}"]`);
  if (!marked) return null;
  // A focusable section (a list of choices) is reached as itself; a wrapper around a field, through its control.
  const inner = marked.hasAttribute("tabindex") ? null : marked.matches("input, select, textarea") ? marked : marked.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea");
  if (inner) return visibleControl(inner).id;
  // A problem that isn't a form field (a card, a section) is reached as itself.
  if (!marked.id) marked.id = `wd-problem-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return marked.id;
}

/**
 * PLM-092: every problem a save found, in one box at the top of the form. Each one names what to do and takes the
 * person to its field; the fields themselves are marked by their own `isInvalid`/`errorMessage`.
 */
export function ProblemSummary({ actions, onSelect, problems, title }: {
  problems: Array<SaveProblem & { text?: string }>; title?: string; actions?: ReactNode;
  /** Where a problem isn't a form field (a table cell, a card): the page takes the person to it. */
  onSelect?: (key: string) => void;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  if (!problems.length) return null;
  return <div className="wd-form-summary" ref={box} role="alert">
    <CircleAlert aria-hidden="true" size={16} />
    <div>
      <strong>{title ?? (problems.length === 1 ? t("Check 1 field") : t("Check {count} fields", { count: problems.length }))}</strong>
      <ul data-layout="list">{problems.map((problem) => <li key={problem.key}><button data-problem-target={problem.key} onClick={() => { if (onSelect) { onSelect(problem.key); return; } const id = problemFieldId(box.current, problem.key); if (id) revealById(id); }} type="button">{problem.text ?? problem.label}</button></li>)}</ul>
      {actions}
    </div>
  </div>;
}

/** Collects the invalid events of one blocked submit and keeps the summary in step with the fields. */
export function useErrorSummary() {
  const [problems, setProblems] = useState<Problem[]>([]);
  const pending = useRef<FormControl[] | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const onInvalidCapture = useCallback((event: FormEvent<HTMLFormElement>) => {
    const control = event.target as FormControl;
    if (!("validity" in control)) return;
    // The summary replaces the browser's bubble and the page-wide alert.
    event.preventDefault();
    if (!pending.current) {
      pending.current = [];
      // One blocked submit fires an invalid event per field: gather them, then report once.
      window.setTimeout(() => {
        const controls = inDocumentOrder(pending.current ?? []);
        pending.current = null;
        if (!controls.length) return;
        setProblems(controls.map((item) => ({ control: item, name: fieldName(item) })));
        focusField(controls[0]);
      }, 0);
    }
    pending.current.push(control);
  }, []);

  // After an edit, drop the fields that are now fine (a dropdown settles after its popover closes).
  const recheck = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setProblems((current) => {
      const left = current.filter((problem) => problem.control.isConnected && !problem.control.validity.valid);
      return left.length === current.length ? current : left;
    }), 0);
  }, []);

  const clear = useCallback(() => setProblems([]), []);
  return { onInvalidCapture, recheck, clear, problems, node: <FormErrorSummary problems={problems} /> };
}
