"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useState, type KeyboardEvent } from "react";
import { CornerDownLeft, Sparkles } from "lucide-react";
import { Badge, useDesignSystem } from "@/design-system";
import { money, newLine, quoteTotals } from "@/lib/commercial/client";
import { describeQuickLine, parseQuickLine } from "@/lib/commercial/quick-line";
import type { Quote, QuoteLine } from "@/lib/commercial/types";
import s from "./quotation-pulse.module.css";

export type PulseFilter = "all" | "unpriced" | "manual" | "optional" | "linked";

export function lineNeedsPrice(line: QuoteLine) { return !(line.rate > 0); }
export function lineIsManual(line: QuoteLine) { return !line.scopeId && !(line.catalogLinks?.length) && !line.catalogPrice && !line.manualReason; }

export function pulseFilterPredicate(filter: PulseFilter): ((line: QuoteLine) => boolean) | undefined {
  if (filter === "unpriced") return lineNeedsPrice;
  if (filter === "manual") return lineIsManual;
  if (filter === "optional") return (line) => Boolean(line.optional);
  if (filter === "linked") return (line) => Boolean(line.scopeId);
  return undefined;
}

/**
 * The quote pulse answers "is this quotation ready?" at a glance and turns
 * every number into a working filter on the sheet below it.
 */
export function QuotationPulse({ quote, canViewCosts, filter, onFilter }: {
  quote: Quote;
  canViewCosts: boolean;
  filter: PulseFilter;
  onFilter: (filter: PulseFilter) => void;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  const totals = quoteTotals(quote);
  const unpriced = quote.lines.filter(lineNeedsPrice).length;
  const manual = quote.lines.filter(lineIsManual).length;
  const optional = quote.lines.filter((line) => line.optional).length;
  const linked = quote.lines.filter((line) => line.scopeId).length;
  const ready = quote.lines.length > 0 && unpriced === 0 && manual === 0;
  const chips: { id: PulseFilter; label: string; value: number; tone?: "attention" | "danger" | "success" }[] = [
    { id: "all", label: t("Items"), value: quote.lines.length },
    { id: "unpriced", label: t("Unpriced"), value: unpriced, tone: unpriced ? "danger" : "success" },
    { id: "manual", label: t("Needs source or reason"), value: manual, tone: manual ? "attention" : undefined },
    { id: "linked", label: t("Linked to scope"), value: linked },
    { id: "optional", label: t("Optional"), value: optional },
  ];
  return <div aria-label={t("Quotation pulse")} className={s.pulse} role="group">
    <div className={s.chips}>
      {chips.map((chip) => <button aria-pressed={filter === chip.id} className={s.chip} data-tone={chip.value ? chip.tone : undefined} key={chip.id} onClick={() => onFilter(filter === chip.id ? "all" : chip.id)} type="button">
        <strong>{chip.value}</strong><span>{chip.label}</span>
      </button>)}
      <Badge tone={ready ? "success" : "warning"}>{t(ready ? "Ready to review" : unpriced ? "Pricing incomplete" : manual ? "Evidence needed" : "In progress")}</Badge>
    </div>
    <dl className={s.money}>
      <div><dt>{t("Subtotal")}</dt><dd>{money(totals.subtotal, quote.currency, locale)}</dd></div>
      {quote.discount ? <div><dt>{t("Discount")}</dt><dd>−{money(quote.discount, quote.currency, locale)}</dd></div> : null}
      <div><dt>{t("Tax {rate}%", { rate: quote.taxRate })}</dt><dd>{money(totals.tax, quote.currency, locale)}</dd></div>
      <div className={s.total}><dt>{t("Total")}</dt><dd>{money(totals.total, quote.currency, locale)}</dd></div>
      {canViewCosts ? <div data-tone={totals.margin < 15 ? "danger" : totals.margin < 30 ? "attention" : "success"}><dt>{t("Margin")}</dt><dd>{totals.margin.toFixed(1)}%</dd></div> : null}
    </dl>
  </div>;
}

/**
 * Spreadsheet-fast entry: one sentence becomes a structured line. The preview
 * shows exactly how it will be recorded before Enter commits it.
 */
export function QuotationQuickAdd({ quote, rooms, disabled, onAdd }: {
  quote: Quote;
  rooms: string[];
  disabled: boolean;
  onAdd: (line: QuoteLine) => void;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [text, setText] = useState("");
  const draft = parseQuickLine(text, rooms);
  const commit = () => {
    if (!draft || disabled) return;
    const base = newLine(draft.room ?? rooms[0] ?? t("General"));
    onAdd({
      ...base,
      title: draft.title,
      quantity: draft.quantity,
      unit: draft.unit,
      material: draft.material,
      finish: draft.finish,
      rate: draft.rate ?? 0,
      dimensions: draft.dimensions,
      optional: draft.optional || undefined,
    });
    setText("");
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") { event.preventDefault(); commit(); }
    if (event.key === "Escape") setText("");
  };
  return <div className={s.quickAdd} data-disabled={disabled || undefined}>
    <label className={s.quickInput}>
      <Sparkles aria-hidden="true" size={15} />
      <input aria-label={t("Quick add line")} disabled={disabled} onChange={(event) => setText(event.target.value)} onKeyDown={keyDown} placeholder={t('Type a line, e.g. "{room}: 2 wardrobes 2400x2600 oak veneer 18500"', { room: rooms[0] ?? t("Living room") })} value={text} />
      <button aria-label={t("Add line")} className={s.quickSubmit} disabled={!draft || disabled} onClick={commit} type="button"><CornerDownLeft aria-hidden="true" size={14} />{t("Add")}</button>
    </label>
    {draft ? <ol aria-label={t("Line preview")} className={s.preview}>{describeQuickLine(draft, quote.currency, { t, locale }).map((part, index) => <li data-unpriced={part === t("Unpriced") || undefined} key={`${part}-${index}`}>{part}</li>)}</ol> : <p className={s.hint}>{t("Room, quantity, item, size, material and price are recognised from plain text. Nothing is saved until you press Enter.")}</p>}
  </div>;
}
