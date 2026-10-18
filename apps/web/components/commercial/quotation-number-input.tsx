"use client";
import { useId, useRef, useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n/i18n-provider";
import q from "./quotation-line-fields.module.css";

/**
 * A blank or partially typed amount must never silently become a saved zero. It wears the shared input frame (and,
 * with `showLabel`, the shared field label) so it matches every other field.
 */
export function QuotationNumberInput({
  value,
  onChange,
  label,
  min = 0,
  max = 1e8,
  money = false,
  onEditStart,
  onCancel,
  prefix,
  showLabel = false,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  min?: number;
  max?: number;
  money?: boolean;
  onEditStart?: () => void;
  onCancel?: () => void;
  /** Shown at the start of the field, e.g. the currency. */
  prefix?: ReactNode;
  /** Shows the label above the field, as the shared fields do; otherwise the label is for assistive technology only. */
  showLabel?: boolean;
}) {
  const t = useT();
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const startingValue = useRef(value);
  const format = (n: number) => (money ? n.toFixed(2) : String(n));
  const parse = (text: string) => {
    const parsed = Number(text);
    return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) &&
      Number.isFinite(parsed) &&
      parsed >= min &&
      parsed <= max
      ? parsed
      : null;
  };
  const normalized = (n: number) =>
    money ? Math.round((n + Number.EPSILON) * 100) / 100 : n;
  const commit = () => {
    if (draft === null) return;
    const parsed = parse(draft);
    setError(parsed === null);
    if (parsed === null && onCancel) onCancel();
    else onChange(parsed === null ? startingValue.current : normalized(parsed));
    setDraft(null);
  };
  const input = (
    <input
      id={id}
      className={`wd-input ${q.numericInput}`}
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={error || undefined}
      title={
        error
          ? t("Enter a number between {min} and {max}. Your previous value was kept.", { min, max })
          : label
      }
      value={draft ?? format(value)}
      onFocus={(event) => {
        setFocused(true);
        startingValue.current = value;
        onEditStart?.();
        setError(false);
        event.currentTarget.select();
      }}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        const parsed = parse(text);
        if (parsed !== null) onChange(normalized(parsed));
      }}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          if (onCancel) onCancel();
          else onChange(startingValue.current);
          setDraft(null);
          setError(false);
        }
      }}
    />
  );
  const frame = (
    <span className={`wd-input-group wd-focus-frame ${q.numberFrame}`} data-focus-within={focused || undefined} data-invalid={error || undefined}>
      {prefix ? <span className="wd-input-affix" data-side="start">{prefix}</span> : null}
      {input}
    </span>
  );
  return showLabel ? <div className="wd-field"><label className="wd-field-label" htmlFor={id}>{label}</label>{frame}</div> : frame;
}
