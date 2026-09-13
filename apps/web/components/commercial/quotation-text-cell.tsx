"use client";
import { useRef, useState } from "react";

/** Valid edits reach Save immediately; a focus session remains one undo step. */
export function QuotationTextCell({
  label,
  value,
  onChange,
  readOnly = false,
  max = 240,
  required = false,
  multiline = false,
  placeholder,
  autoFocus = false,
  onEditStart,
  onCancel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  max?: number;
  required?: boolean;
  multiline?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  onEditStart?: () => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const starting = useRef(value);
  const props = {
    "aria-label": label,
    "aria-invalid": invalid || undefined,
    maxLength: max,
    readOnly,
    placeholder,
    autoFocus,
    title: invalid
      ? "This field is required. Enter a value or press Escape to restore it."
      : value || label,
    value: draft ?? value,
    onFocus: () => {
      starting.current = value;
      onEditStart?.();
      setInvalid(false);
    },
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      const next = event.target.value;
      setDraft(next);
      setInvalid(required && !next.trim());
      if (!required || next.trim()) onChange(next);
    },
    onBlur: () => {
      if (draft !== null && (!required || draft.trim())) onChange(draft.trim());
      else if (draft !== null) {
        if (onCancel) onCancel();
        else onChange(starting.current);
      }
      setDraft(null);
      setInvalid(false);
    },
    onKeyDown: (
      event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (onCancel) onCancel();
        else onChange(starting.current);
        setDraft(null);
        setInvalid(false);
      }
      if (event.key === "Enter" && !multiline) {
        event.preventDefault();
        event.currentTarget.blur();
      }
    },
  };
  return multiline ? (
    <textarea className="wd-textarea" {...props} rows={2} />
  ) : (
    <input className="wd-input" {...props} />
  );
}
