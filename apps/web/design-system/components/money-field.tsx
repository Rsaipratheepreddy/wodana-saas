"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FieldError, Group, Input, Label, Text, TextField } from "react-aria-components";
import { CircleAlert } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";
import { minorUnits, toMinor } from "@/lib/money-exact";
import { useDesignSystem } from "../foundations/provider";
import { useFormFieldContext } from "./form-context";

/** A locale's group and decimal separators ("1,234.5" or "1.234,5"). */
export function numberSeparators(locale: string) {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  return { group: parts.find((part) => part.type === "group")?.value ?? ",", decimal: parts.find((part) => part.type === "decimal")?.value ?? "." };
}

const LOCAL_DIGITS = /[٠-٩۰-۹]/g;
const asciiDigits = (text: string) => text.replace(LOCAL_DIGITS, (digit) => String(digit.charCodeAt(0) % 16 % 10));

type Parsed = { amount: string; shown: string };

/**
 * Reads what a person typed into an exact decimal ("1250000.5", never through a float) and writes it back
 * grouped the locale's way ("1,250,000.5", "12,50,000.5" in India). A decimal separator being typed stays
 * visible; fraction digits stop at the currency's minor units.
 */
export function parseMoneyText(raw: string, locale: string, places: number, allowNegative = false): Parsed {
  const { decimal, group } = numberSeparators(locale);
  const text = asciiDigits(raw).trim();
  const negative = allowNegative && text.startsWith("-");
  // "." is also a decimal point where the locale doesn't group with it.
  const decimals = new Set([decimal, ...(group === "." ? [] : ["."])]);
  let whole = ""; let fraction: string | null = null;
  for (const char of text) {
    if (/\d/.test(char)) { if (fraction === null) whole += char; else if (fraction.length < places) fraction += char; }
    else if (decimals.has(char) && fraction === null && places > 0) fraction = "";
  }
  whole = whole.replace(/^0+(?=\d)/, "");
  if (!whole && fraction !== null) whole = "0";
  const grouped = whole ? new Intl.NumberFormat(locale, { useGrouping: true, maximumFractionDigits: 0 }).format(BigInt(whole)) : "";
  const sign = negative ? "-" : "";
  const shown = `${sign}${grouped}${fraction !== null ? `${decimal}${fraction}` : ""}`;
  const amount = whole ? `${sign}${whole}${fraction ? `.${fraction}` : ""}` : "";
  return { amount, shown };
}

/** Where the caret belongs after regrouping: after the same number of digits (and separators) as before. */
function caretAfter(shown: string, significantBefore: number, decimal: string) {
  if (significantBefore <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < shown.length; index += 1) {
    if (/\d/.test(shown[index]) || shown[index] === decimal || shown[index] === "-") seen += 1;
    if (seen === significantBefore) return index + 1;
  }
  return shown.length;
}

export type MoneyFieldProps = {
  label: ReactNode;
  /** The amount as an exact decimal string ("1250.5"), or "" when empty. */
  value: string;
  onChange: (amount: string) => void;
  /** The workspace region's currency unless the record has its own. */
  currency?: string;
  description?: ReactNode;
  errorMessage?: ReactNode;
  isRequired?: boolean;
  isDisabled?: boolean;
  isReadOnly?: boolean;
  autoFocus?: boolean;
  allowNegative?: boolean;
  /** Smallest accepted amount, as a decimal string. */
  min?: string;
  max?: string;
  name?: string;
  placeholder?: string;
  "aria-label"?: string;
  onBlur?: () => void;
};

/**
 * The money field: the currency sits in the field, the amount is grouped as it is typed, and the value is
 * an exact decimal string for the server's numeric columns.
 */
export function MoneyField({ allowNegative = false, autoFocus, currency: currencyProp, description, errorMessage, isDisabled, isReadOnly, isRequired, label, max, min, name, onBlur, onChange, placeholder, value, ...aria }: MoneyFieldProps) {
  const t = useT();
  const { currency: regionCurrency, locale } = useDesignSystem();
  const currency = currencyProp || regionCurrency;
  const places = minorUnits(currency);
  const decimal = numberSeparators(locale).decimal;
  const form = useFormFieldContext();
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const format = useMemo(() => (amount: string) => parseMoneyText(amount.replace(".", decimal), locale, places, allowNegative).shown, [allowNegative, decimal, locale, places]);
  // What the field shows, and the amount it stands for: a new amount from outside resets the text.
  const [shown, setShown] = useState({ text: format(value), amount: value });
  if (shown.amount !== value) setShown({ text: format(value), amount: value });

  useLayoutEffect(() => {
    if (caret.current === null || !input.current || document.activeElement !== input.current) return;
    input.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  const type = (raw: string) => {
    const at = input.current?.selectionStart ?? raw.length;
    const significant = [...asciiDigits(raw.slice(0, at))].filter((char) => /\d/.test(char) || char === decimal || char === "." || char === "-").length;
    const next = parseMoneyText(raw, locale, places, allowNegative);
    caret.current = caretAfter(next.shown, significant, decimal);
    setShown({ text: next.shown, amount: next.amount });
    if (next.amount !== value) onChange(next.amount);
  };

  const validate = () => {
    if (!value) return null;
    if (min !== undefined && toMinor(value, currency) < toMinor(min, currency)) return t("At least {amount}", { amount: format(min) });
    if (max !== undefined && toMinor(value, currency) > toMinor(max, currency)) return t("At most {amount}", { amount: format(max) });
    return null;
  };

  return <TextField {...aria} autoFocus={autoFocus} className="wd-field wd-money-field" isDisabled={isDisabled} isReadOnly={isReadOnly} isRequired={isRequired}
    onBlur={() => { setShown({ text: format(value), amount: value }); onBlur?.(); }} onChange={type} validate={validate} value={shown.text}>
    <Label className="wd-field-label" data-optional={form?.markers === "optional" && !isRequired ? t("Optional") : undefined}>{label}</Label>
    <Group className="wd-input-group wd-focus-frame">
      <span className="wd-input-affix" data-side="start">{currency}</span>
      <Input className="wd-input wd-money-input" inputMode="decimal" placeholder={placeholder ?? format(places ? `0.${"0".repeat(places)}` : "0")} ref={input} />
    </Group>
    {name ? <input name={name} type="hidden" value={value} /> : null}
    {description ? <Text className="wd-field-help" slot="description">{description}</Text> : null}
    <FieldError className="wd-field-error">{({ validationDetails, validationErrors }) => <><CircleAlert aria-hidden="true" size={14} />{errorMessage ?? (validationDetails?.valueMissing ? t("Required") : validationErrors.join(" ") || t("Check this field"))}</>}</FieldError>
  </TextField>;
}
