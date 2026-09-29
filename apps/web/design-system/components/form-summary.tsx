"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CircleAlert } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";
import { fieldName, focusField, inDocumentOrder, type FormControl } from "../foundations/blocked-save-alert";

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
