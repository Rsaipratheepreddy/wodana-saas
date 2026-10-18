"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PaymentTerm } from "@/lib/commercial/types";
import { money, paymentMilestoneAmounts, roundMoney } from "@/lib/commercial/client";
import {
  Badge,
  Button,
  Checkbox,
  DataGrid,
  type DataGridColumn,
  IconButton,
  PercentageInput,
  TextInput,
  useDesignSystem,
  VisuallyHidden,
} from "@/design-system";
import s from "./payment-milestones-editor.module.css";

/** A payment schedule holds at most this many milestones (the server's limit). */
const MAX_MILESTONES = 20;

/**
 * Payment milestones as one editable table: the title, when it falls due, its share (and amount, when the
 * schedule belongs to a quotation) and what it must be paid before. Quotation payment terms and reusable
 * payment schedules both use it.
 */
export function PaymentMilestonesEditor({
  ariaLabel,
  currency,
  emptyDescription,
  milestones,
  onChange,
  readOnly,
  total,
}: {
  ariaLabel: string;
  milestones: PaymentTerm[];
  onChange: (milestones: PaymentTerm[]) => void;
  readOnly: boolean;
  /** The quotation total the shares split. Without one (a reusable schedule) amounts are not shown. */
  total?: number;
  /** The quotation's currency; the workspace currency when not given. */
  currency?: string;
  emptyDescription?: string;
}) {
  const t = useT();
  const region = useDesignSystem();
  const [drag, setDrag] = useState<string | null>(null);
  const code = currency ?? region.currency;
  const amounts = total === undefined ? [] : paymentMilestoneAmounts(total, milestones, code);
  const percent = roundMoney(milestones.reduce((sum, row) => sum + row.percent, 0));
  const allocated = roundMoney(amounts.reduce((sum, value) => sum + value, 0));

  const update = (rows: PaymentTerm[]) => { if (!readOnly) onChange(rows); };
  const patch = (id: string, changes: Partial<PaymentTerm>) => update(milestones.map((row) => (row.id === id ? { ...row, ...changes } : row)));
  const indexOf = (id: string) => milestones.findIndex((row) => row.id === id);
  const nameOf = (row: PaymentTerm) => row.title.trim() || t("Milestone {number}", { number: indexOf(row.id) + 1 });
  const move = (id: string, to: number) => {
    const next = [...milestones];
    const index = next.findIndex((row) => row.id === id);
    if (index < 0 || to < 0 || to >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    update(next);
  };
  const add = () => update([...milestones, {
    id: crypto.randomUUID(),
    title: t("New milestone"),
    trigger: "",
    percent: Math.max(0, roundMoney(100 - percent)),
    requiredForRelease: false,
    requiredForProduction: false,
  }]);
  const hidden = (text: string) => <VisuallyHidden>{text}</VisuallyHidden>;

  const columns: DataGridColumn<PaymentTerm>[] = [
    {
      id: "title",
      header: t("Milestone"),
      size: 220,
      accessorFn: (row) => row.title,
      meta: { renderCell: (row) => readOnly ? row.title : (
        <TextInput label={hidden(t("Milestone {number} title", { number: indexOf(row.id) + 1 }))} maxLength={160} onChange={(title) => patch(row.id, { title })} placeholder={t("e.g. Advance")} value={row.title} />
      ) },
    },
    {
      id: "trigger",
      header: t("Payment due"),
      size: 220,
      accessorFn: (row) => row.trigger,
      meta: { renderCell: (row) => readOnly ? row.trigger : (
        <TextInput label={hidden(t("Milestone {number} trigger", { number: indexOf(row.id) + 1 }))} maxLength={300} onChange={(trigger) => patch(row.id, { trigger })} placeholder={t("e.g. On acceptance")} value={row.trigger} />
      ) },
    },
    {
      id: "percent",
      header: t("Percentage"),
      size: 120,
      accessorFn: (row) => row.percent,
      meta: { align: "end", renderCell: (row) => readOnly ? `${row.percent}%` : (
        <PercentageInput
          formatOptions={{ maximumFractionDigits: 2 }}
          label={hidden(t("Milestone {number} percentage", { number: indexOf(row.id) + 1 }))}
          minValue={0.01}
          onChange={(value) => patch(row.id, { percent: Number.isFinite(value) ? value : 0 })}
          value={row.percent}
        />
      ) },
    },
    ...(total !== undefined ? [{
      id: "amount",
      header: t("Amount"),
      size: 130,
      accessorFn: (row: PaymentTerm) => amounts[indexOf(row.id)],
      meta: { align: "end" as const, renderCell: (row: PaymentTerm) => money(amounts[indexOf(row.id)], code, region.locale) },
    }] : []),
    {
      id: "release",
      header: t("Before release"),
      size: 120,
      accessorFn: (row) => row.requiredForRelease,
      meta: { renderCell: (row) => readOnly ? (row.requiredForRelease ? t("Required") : "—") : (
        <Checkbox aria-label={t("Milestone {number} required before release", { number: indexOf(row.id) + 1 })} isSelected={row.requiredForRelease} onChange={(requiredForRelease) => patch(row.id, { requiredForRelease })} />
      ) },
    },
    {
      id: "production",
      header: t("Before production"),
      size: 130,
      accessorFn: (row) => row.requiredForProduction === true,
      meta: { renderCell: (row) => readOnly ? (row.requiredForProduction ? t("Required") : "—") : (
        <Checkbox aria-label={t("Milestone {number} required before production", { number: indexOf(row.id) + 1 })} isSelected={row.requiredForProduction === true} onChange={(requiredForProduction) => patch(row.id, { requiredForProduction })} />
      ) },
    },
    {
      // Falls due the day the client accepts the full handover (explicit, never read from the trigger text).
      id: "handover",
      header: t("At handover"),
      size: 120,
      accessorFn: (row) => row.dueAtHandover === true,
      meta: { renderCell: (row) => readOnly ? (row.dueAtHandover ? t("At handover") : "—") : (
        <Checkbox aria-label={t("Milestone {number} due at handover", { number: indexOf(row.id) + 1 })} isSelected={row.dueAtHandover === true} onChange={(dueAtHandover) => patch(row.id, { dueAtHandover })} />
      ) },
    },
    ...(readOnly ? [] : [{
      id: "actions",
      header: () => hidden(t("Actions")),
      size: 150,
      enableSorting: false,
      meta: { renderCell: (row: PaymentTerm) => {
        const index = indexOf(row.id), name = nameOf(row);
        return <div className={s.actions}>
          <span
            className={s.handle}
            draggable
            onDragEnd={() => setDrag(null)}
            onDragStart={(event) => { setDrag(row.id); event.dataTransfer.setData("text/plain", row.id); }}
            title={t("Drag to reorder")}
          ><GripVertical aria-hidden="true" size={16} /></span>
          <IconButton aria-label={t("Move {name} up", { name })} isDisabled={index === 0} onPress={() => move(row.id, index - 1)} size="compact"><ArrowUp aria-hidden="true" size={13} /></IconButton>
          <IconButton aria-label={t("Move {name} down", { name })} isDisabled={index === milestones.length - 1} onPress={() => move(row.id, index + 1)} size="compact"><ArrowDown aria-hidden="true" size={13} /></IconButton>
          <IconButton aria-label={t("Remove milestone {number}", { number: index + 1 })} onPress={() => update(milestones.filter((item) => item.id !== row.id))} size="compact"><Trash2 aria-hidden="true" size={13} /></IconButton>
        </div>;
      } },
    }]),
  ];

  return <div className={s.editor}>
    {total !== undefined ? (
      <div className={s.overview}>
        <span>{t("Quotation total")}{" "}<strong>{money(total, code, region.locale)}</strong></span>
        <span>{t("Allocated")}{" "}<strong>{percent.toFixed(2)}%</strong></span>
        <span>{t("Remaining")}{" "}<strong>{money(total - allocated, code, region.locale)}</strong></span>
      </div>
    ) : null}
    <DataGrid
      ariaLabel={ariaLabel}
      columns={columns}
      data={milestones}
      emptyDescription={emptyDescription}
      emptyTitle={t("Add your first payment milestone.")}
      getRowDragHandlers={readOnly ? undefined : (row) => ({
        onDragOver: (event) => { if (drag) event.preventDefault(); },
        onDrop: (event) => {
          if (!drag) return;
          event.preventDefault();
          move(drag, indexOf(row.id));
          setDrag(null);
        },
      })}
      getRowId={(row) => row.id}
      pinFirstColumn={false}
      selectable={false}
      showFooter={false}
      showToolbar={false}
    />
    <footer className={s.footer}>
      {!readOnly ? (
        <Button intent="write" isDisabled={milestones.length >= MAX_MILESTONES} onPress={add} size="compact" variant="quiet">
          <Plus aria-hidden="true" size={14} />{t("Add milestone")}
        </Button>
      ) : null}
      <Badge role="status" tone={percent === 100 ? "success" : percent > 100 ? "danger" : "neutral"}>
        {percent === 100
          ? t("100% allocated")
          : percent > 100
            ? t("{percent}% over allocated", { percent: (percent - 100).toFixed(2) })
            : t("{percent}% left to allocate", { percent: (100 - percent).toFixed(2) })}
      </Badge>
    </footer>
  </div>;
}
