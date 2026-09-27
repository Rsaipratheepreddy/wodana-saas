"use client";
import { useRef, useState } from "react";
import { useT } from "@/lib/i18n/i18n-provider";
import q from "./quotation-line-fields.module.css";

/** A blank or partially typed amount must never silently become a saved zero. */
export function QuotationNumberInput({
  value,
  onChange,
  label,
  min = 0,
  max = 1e8,
  money = false,
  onEditStart,
  onCancel,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  min?: number;
  max?: number;
  money?: boolean;
  onEditStart?: () => void;
  onCancel?: () => void;
}) {
  const t = useT();
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
  return (
    <input
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
      onBlur={commit}
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
}
