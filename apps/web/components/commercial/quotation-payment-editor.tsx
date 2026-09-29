'use client';
import { useT } from "@/lib/i18n/i18n-provider";
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { Quote, PaymentTerm } from '@/lib/commercial/types';
import { money, quoteTotals, paymentMilestoneAmounts, roundMoney } from '@/lib/commercial/client';
import { Button, Checkbox, DataGrid, type DataGridColumn, IconButton, PercentageInput, TextInput, useDesignSystem, VisuallyHidden } from '@/design-system';
import s from './quotation-payment-editor.module.css';

/** The quotation's payment milestones: title, when it's due, its share, and what it must be paid before. */
export function QuotationPaymentEditor({ quote, onChange, readOnly }: { quote: Quote; onChange: (quote: Quote) => void; readOnly: boolean }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const terms = quote.paymentTerms, total = quoteTotals(quote).total, amounts = paymentMilestoneAmounts(total, terms, quote.currency);
  const percent = roundMoney(terms.reduce((sum, term) => sum + term.percent, 0)), allocated = roundMoney(amounts.reduce((sum, value) => sum + value, 0));
  const update = (rows: PaymentTerm[]) => { if (!readOnly) onChange({ ...quote, paymentTerms: rows }); };
  const patch = (id: string, changes: Partial<PaymentTerm>) => update(terms.map(term => term.id === id ? { ...term, ...changes } : term));
  const indexOf = (id: string) => terms.findIndex((term) => term.id === id);
  const move = (index: number, direction: number) => { const next = [...terms], target = index + direction; if (target < 0 || target >= terms.length) return; [next[index], next[target]] = [next[target], next[index]]; update(next); };
  const hidden = (text: string) => <VisuallyHidden>{text}</VisuallyHidden>;
  const columns: DataGridColumn<PaymentTerm>[] = [
    { id: "title", header: t("Milestone"), size: 220, accessorFn: (term) => term.title, meta: { renderCell: (term) => readOnly ? term.title :
      <TextInput label={hidden(t("Milestone {number} title", { number: indexOf(term.id) + 1 }))} maxLength={160} placeholder={t("e.g. Advance")} value={term.title} onChange={(title) => patch(term.id, { title })} /> } },
    { id: "trigger", header: t("Payment due"), size: 220, accessorFn: (term) => term.trigger, meta: { renderCell: (term) => readOnly ? term.trigger :
      <TextInput label={hidden(t("Milestone {number} trigger", { number: indexOf(term.id) + 1 }))} maxLength={300} placeholder={t("e.g. On acceptance")} value={term.trigger} onChange={(trigger) => patch(term.id, { trigger })} /> } },
    { id: "percent", header: t("Share"), size: 110, accessorFn: (term) => term.percent, meta: { align: "end", renderCell: (term) => readOnly ? `${term.percent}%` :
      <PercentageInput label={hidden(t("Milestone {number} percentage", { number: indexOf(term.id) + 1 }))} formatOptions={{ maximumFractionDigits: 2 }} value={term.percent} onChange={(value) => patch(term.id, { percent: Number.isFinite(value) ? value : 0 })} /> } },
    { id: "amount", header: t("Amount"), size: 130, accessorFn: (term) => amounts[indexOf(term.id)], meta: { align: "end", renderCell: (term) => money(amounts[indexOf(term.id)], quote.currency, locale) } },
    { id: "release", header: t("Before release"), size: 120, accessorFn: (term) => term.requiredForRelease, meta: { renderCell: (term) =>
      <Checkbox aria-label={t("Milestone {number} required before release", { number: indexOf(term.id) + 1 })} isDisabled={readOnly} isSelected={term.requiredForRelease} onChange={(requiredForRelease) => patch(term.id, { requiredForRelease })} /> } },
    { id: "production", header: t("Before production"), size: 130, accessorFn: (term) => term.requiredForProduction === true, meta: { renderCell: (term) =>
      <Checkbox aria-label={t("Milestone {number} required before production", { number: indexOf(term.id) + 1 })} isDisabled={readOnly} isSelected={term.requiredForProduction ?? false} onChange={(requiredForProduction) => patch(term.id, { requiredForProduction })} /> } },
    ...(readOnly ? [] : [{ id: "actions", header: "", size: 110, enableSorting: false, meta: { renderCell: (term: PaymentTerm) => {
      const index = indexOf(term.id);
      return <div className={s.actions}>
        <IconButton aria-label={t("Move milestone {number} up", { number: index + 1 })} isDisabled={index === 0} size="compact" variant="quiet" onPress={() => move(index, -1)}><ArrowUp aria-hidden="true" size={13} /></IconButton>
        <IconButton aria-label={t("Move milestone {number} down", { number: index + 1 })} isDisabled={index === terms.length - 1} size="compact" variant="quiet" onPress={() => move(index, 1)}><ArrowDown aria-hidden="true" size={13} /></IconButton>
        <IconButton aria-label={t("Remove milestone {number}", { number: index + 1 })} size="compact" variant="quiet" onPress={() => update(terms.filter(row => row.id !== term.id))}><Trash2 aria-hidden="true" size={13} /></IconButton>
      </div>;
    } } }]),
  ];
  return <div className={s.editor}>
    <div className={s.overview}><span>{t("Quotation total")}{" "}<strong>{money(total, quote.currency, locale)}</strong></span><span>{t("Allocated")}{" "}<strong>{percent.toFixed(2)}%</strong></span><span>{t("Remaining")}{" "}<strong>{money(total - allocated, quote.currency, locale)}</strong></span></div>
    <DataGrid ariaLabel={t("Payment milestones")} data={terms} getRowId={(term) => term.id} columns={columns} emptyTitle={t("Add your first payment milestone.")}
      showToolbar={false} showFooter={false} selectable={false} pinFirstColumn={false} />
    <footer className={s.footer}>
      {!readOnly && <Button size="compact" variant="quiet" isDisabled={terms.length >= 20} onPress={() => update([...terms, { id: crypto.randomUUID(), title: t('New milestone'), trigger: '', percent: Math.max(0, roundMoney(100 - percent)), requiredForRelease: false, requiredForProduction: false }])}><Plus aria-hidden="true" size={14} />{t("Add milestone")}</Button>}
      <span role="status" data-complete={percent === 100}>{percent === 100 ? t('100% allocated') : percent > 100 ? t('{percent}% over allocated', { percent: (percent - 100).toFixed(2) }) : t('{percent}% left to allocate', { percent: (100 - percent).toFixed(2) })}</span>
    </footer>
  </div>;
}
