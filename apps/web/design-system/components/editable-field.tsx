"use client";

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { Check, CircleAlert, LoaderCircle, Lock, PenLine } from "lucide-react";
import { parseDate, type DateValue } from "@internationalized/date";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { useReadOnlyReason } from "../foundations/read-only";
import { Button } from "./actions";
import { FormFieldContext } from "./form-context";
import { isVersionConflict } from "./form-kit";
import { DateField, SelectField, TextAreaField, TextInput, type SelectItem } from "./forms";
import { MoneyField } from "./money-field";
import { PhoneField } from "./phone-field";

export type EditableFieldKind = "text" | "multiline" | "email" | "url" | "tel" | "money" | "date" | "select" | "phone";

export type EditableFieldProps = {
  label: string;
  /** The saved value as text ("" when empty): a date as YYYY-MM-DD, money as a decimal string, a choice as its id. */
  value: string;
  /** How the value reads (a formatted date, an amount with its currency, a name). Defaults to the value. */
  display?: ReactNode;
  kind?: EditableFieldKind;
  /** The choices of a "select". */
  items?: SelectItem[];
  currency?: string;
  /** A phone's country code (ISO, e.g. "AE"); a changed one comes back with the save. */
  countryCode?: string;
  /**
   * Saves through the module's own update command with the record's version. Throw to keep the new value
   * in the field with the reason; a 409 says someone else changed the record and offers Reload.
   */
  onSave: (next: string, extra: { countryCode: string }) => unknown;
  /** Loads the latest record after a version conflict. */
  onReload?: () => void;
  /** Whether this person may change it; false shows plain text (so does a read-only page). */
  canEdit?: boolean;
  /** Why this person may not change it (who can): shown as a lock beside the value, its reason on hover and to screen readers. */
  lockedReason?: string;
  isRequired?: boolean;
  validate?: (next: string) => string | null | undefined;
  maxLength?: number;
  /** Shown instead of an empty value while it can be edited. */
  placeholder?: string;
  /** The record's title: the value is its heading (the host styles it) and the label is for screen readers only. */
  heading?: "h1" | "h2" | "h3";
};

type Mode = "idle" | "editing" | "saving" | "saved" | "error";

/**
 * A record detail value that edits in place. Clicking it turns it into its field; Enter or leaving the
 * field saves, Esc cancels. A small tick confirms the save; a failure keeps the new value with the reason
 * and Retry; a version conflict offers Reload. People who may not change it, and read-only pages (viewing
 * as someone), see plain text.
 */
export function EditableField({ canEdit = true, countryCode = "", currency, display, heading, isRequired, items = [], kind = "text", label, lockedReason, maxLength, onReload, onSave, placeholder, validate, value }: EditableFieldProps) {
  const t = useT();
  const readOnlyReason = useReadOnlyReason();
  const editable = canEdit && !readOnlyReason;
  const [mode, setModeState] = useState<Mode>("idle");
  const modeRef = useRef<Mode>("idle");
  const setMode = (next: Mode) => { modeRef.current = next; setModeState(next); };
  const [draft, setDraft] = useState(value);
  const [country, setCountry] = useState(countryCode);
  const [problem, setProblem] = useState<{ message: string; conflict: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);
  const picking = useRef(false);
  const valueId = useId();

  useEffect(() => {
    if (mode !== "saved") return;
    const timer = window.setTimeout(() => { modeRef.current = "idle"; setModeState("idle"); }, 1600);
    return () => window.clearTimeout(timer);
  }, [mode]);
  useEffect(() => {
    if ((mode === "idle" || mode === "saved") && returnFocus.current) { returnFocus.current = false; trigger.current?.focus(); }
  }, [mode]);

  const shown = (text: string) => kind === "select" ? items.find((item) => item.id === text)?.label ?? text : text;
  const reads = display ?? (value ? shown(value) : null);

  // A fact is a dt/dd pair inside its list; a title is its heading, labelled for screen readers.
  const Label = heading ? "span" : "dt";
  const Cell = heading ? "div" : "dd";
  const Heading = heading ?? "span";
  const labelClass = heading ? "wd-visually-hidden" : "wd-editable-label";

  const lock = lockedReason && !readOnlyReason
    ? <span className="wd-editable-lock" title={lockedReason}><Lock aria-hidden="true" size={12} /><span className="wd-visually-hidden">{lockedReason}</span></span> : null;
  if (!editable) return heading ? <Heading>{reads}{lock}</Heading>
    : <div className="wd-editable" data-readonly=""><Label className={labelClass}>{label}</Label><Cell className="wd-editable-cell">{reads ?? <span className="wd-editable-empty">—</span>}{lock}</Cell></div>;

  const open = () => { setDraft(value); setCountry(countryCode); setProblem(null); setMode("editing"); };
  const cancel = () => { returnFocus.current = true; setProblem(null); setMode("idle"); };

  const commit = async (next: string, focusBack = true) => {
    if (modeRef.current === "saving") return;
    const text = kind === "multiline" ? next.replace(/\s+$/, "") : next.trim();
    if (text === value && country === countryCode) { returnFocus.current = focusBack; setProblem(null); setMode("idle"); return; }
    const invalid = validate?.(text) ?? (isRequired && !text ? t("Required") : null);
    if (invalid) { setProblem({ message: invalid, conflict: false }); setMode("editing"); return; }
    setDraft(text); setMode("saving"); setProblem(null);
    try {
      await onSave(text, { countryCode: country });
      returnFocus.current = focusBack;
      setMode("saved");
    } catch (cause) {
      const conflict = isVersionConflict(cause);
      // The server's own words when it gave any (they name the record), else a plain reason.
      const said = cause instanceof Error && cause.message ? translateKnown(t, cause.message) : "";
      setProblem({ conflict, message: said || (conflict ? t("Someone else saved a change first") : t("Could not save.")) });
      setMode("error");
    }
  };

  // Leaving the field saves, unless focus only moved into its own popover (a calendar, a country list).
  const inside = (node: Node | null) => Boolean(node && (editor.current?.contains(node) || (node instanceof Element && node.closest(".wd-popover"))));
  const blur = (event: FocusEvent<HTMLDivElement>) => {
    if (inside(event.relatedTarget as Node | null)) return;
    window.setTimeout(() => {
      if (inside(document.activeElement) || modeRef.current !== "editing") return;
      void commit(draft, false);
    }, 0);
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (event.key === "Escape") {
      // Esc in an open list closes the list first.
      if (target.closest(".wd-popover")) return;
      event.preventDefault(); event.stopPropagation(); cancel();
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || kind === "select") return;
    if (kind === "multiline" && !(event.metaKey || event.ctrlKey)) return;
    if (target.closest(".wd-popover, [role=combobox], [aria-haspopup]")) return;
    event.preventDefault();
    void commit(draft);
  };

  const field = (() => {
    switch (kind) {
      case "multiline": return <TextAreaField autoFocus label={label} maxLength={maxLength} onChange={setDraft} value={draft} />;
      case "money": return <MoneyField autoFocus currency={currency} label={label} onChange={setDraft} value={draft} />;
      // A date picked from the calendar saves at once; a typed one saves on Enter or on leaving the field.
      case "date": return <DateField autoFocus label={label} onChange={(next: DateValue | null) => { const text = next?.toString() ?? ""; setDraft(text); if (picking.current) void commit(text); }}
        onOpenChange={(isOpen) => { if (isOpen) picking.current = true; else window.setTimeout(() => { picking.current = false; }, 0); }} value={draft ? safeDate(draft) : null} />;
      case "select": return <SelectField autoFocus defaultOpen items={items} label={label} onOpenChange={(isOpen) => { if (!isOpen) window.setTimeout(() => { if (modeRef.current === "editing") cancel(); }, 0); }} onSelectionChange={(key) => { if (key !== null && key !== undefined) { setDraft(String(key)); void commit(String(key)); } }} selectedKey={draft || null} />;
      case "phone": return <PhoneField autoFocus countryCode={country} kind="any" label={label} onChange={setDraft} onCountryChange={setCountry} value={draft} />;
      default: return <TextInput autoFocus inputType={kind === "text" ? "text" : kind} label={label} maxLength={maxLength} onChange={setDraft} value={draft} />;
    }
  })();

  const editing = mode === "editing" || (mode === "error" && !problem?.conflict);
  const pending = mode === "saving" || (mode === "saved" && draft !== value);
  const button = <button aria-describedby={valueId} aria-label={t("Edit {label}", { label })} className="wd-editable-value" disabled={mode === "saving"} onClick={open} ref={trigger} type="button">
    <span id={valueId}>{pending ? shown(draft) || "—" : reads ?? <span className="wd-editable-empty">{placeholder ?? t("Add")}</span>}</span>
    {mode === "saving" ? <LoaderCircle aria-hidden="true" className="wd-spin" size={13} /> : <PenLine aria-hidden="true" className="wd-editable-pen" size={13} />}
  </button>;
  return <div className="wd-editable" data-state={mode} data-variant={heading ? "title" : undefined}>
    <Label className={labelClass}>{label}</Label>
    <Cell className="wd-editable-cell">
      {editing ? <div className="wd-editable-editor" onBlur={blur} onKeyDown={keys} ref={editor}>
        <FormFieldContext.Provider value={null}>{field}</FormFieldContext.Provider>
        {problem ? <p className="wd-editable-problem" role="alert"><CircleAlert aria-hidden="true" size={14} /><span>{problem.message}</span>
          {mode === "error" ? <Button onPress={() => void commit(draft)} size="compact" variant="quiet">{t("Retry")}</Button> : null}</p> : null}
      </div> : <>
        {/* A title stays the heading's own text (its name); a button laid over it opens the field. */}
        {heading ? <span className="wd-editable-title-hit">
          <Heading className="wd-editable-heading"><span id={valueId}>{pending ? shown(draft) || "—" : reads ?? <span className="wd-editable-empty">{placeholder ?? t("Add")}</span>}</span>
            {mode === "saving" ? <LoaderCircle aria-hidden="true" className="wd-spin" size={14} /> : <PenLine aria-hidden="true" className="wd-editable-pen" size={14} />}</Heading>
          <button aria-label={t("Edit {label}", { label })} className="wd-editable-cover" disabled={mode === "saving"} onClick={open} ref={trigger} type="button" />
        </span> : button}
        <span aria-live="polite" className="wd-editable-status">{mode === "saved" ? <><Check aria-hidden="true" className="wd-editable-tick" size={14} /><span className="wd-visually-hidden">{t("Saved")}</span></> : null}</span>
        {problem?.conflict ? <p className="wd-editable-problem" role="alert"><CircleAlert aria-hidden="true" size={14} /><span>{problem.message}</span>
          {onReload ? <Button onPress={() => { setProblem(null); setMode("idle"); onReload(); }} size="compact" variant="quiet">{t("Reload")}</Button> : null}</p> : null}
      </>}
    </Cell>
  </div>;
}

function safeDate(text: string) {
  try { return parseDate(text.slice(0, 10)); } catch { return null; }
}

/** A fact beside editable ones that changes somewhere else (a small form, a workflow step): its value and that action. */
export function FactRow({ action, children, label }: { action?: ReactNode; children: ReactNode; label: string }) {
  return <div className="wd-editable" data-readonly=""><dt className="wd-editable-label">{label}</dt><dd className="wd-editable-cell">{children}{action}</dd></div>;
}

/** A list of record facts, some editable in place. */
export function EditableFieldList({ children, className, layout = "inline" }: { children: ReactNode; className?: string; /** "stacked" puts each label above its value (a narrow panel). */ layout?: "inline" | "stacked" }) {
  return <dl className={["wd-editable-list", className].filter(Boolean).join(" ")} data-layout={layout === "stacked" ? "stacked" : undefined}>{children}</dl>;
}
