"use client";

import { useState } from "react";
import { parseDate } from "@internationalized/date";
import { Badge, Button, DateField, FormDialog, FormRow, InlineNotice, PercentageInput, RecordTable, SelectField, SettingsSection, Switch, TextInput, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { BooksSettingsApi, LedgerSettingsView, TaxCodeView } from "@/lib/books/settings-client";
import { DIRECTION_LABELS, L, TREATMENT_LABELS } from "./ledger-labels";
import styles from "./ledger-settings.module.css";

/** Tax codes: one rate per code and direction for each period; a used code is ended and a new rate added from its day. */
export function TaxCodesTab({ api, view, onChange }: { api: BooksSettingsApi; view: LedgerSettingsView; onChange: (view: LedgerSettingsView) => void }) {
  const t = useT();
  const [editing, setEditing] = useState<{ tax: TaxCodeView | null } | null>(null);
  const columns: DataGridColumn<TaxCodeView>[] = [
    { id: "code", header: t(L.code), accessorFn: (row) => row.code, meta: { primary: true }, cell: ({ row }: { row: { original: TaxCodeView } }) => <span className={styles.code}>{row.original.code}</span> },
    { id: "name", header: t(L.name), accessorFn: (row) => row.name, cell: ({ row }: { row: { original: TaxCodeView } }) => <span className={styles.value}>{row.original.name}</span> },
    { id: "direction", header: t(L.direction), accessorFn: (row) => row.direction, cell: ({ row }: { row: { original: TaxCodeView } }) => <span>{t(DIRECTION_LABELS[row.original.direction])}</span> },
    { id: "rate", header: t(L.rate), accessorFn: (row) => row.rate, meta: { align: "end" }, cell: ({ row }: { row: { original: TaxCodeView } }) => <span className={styles.number}>{row.original.rate}%</span> },
    { id: "treatment", header: t(L.treatment), accessorFn: (row) => row.treatment, meta: { priority: "medium" }, cell: ({ row }: { row: { original: TaxCodeView } }) => <span>{t(TREATMENT_LABELS[row.original.treatment])}</span> },
    { id: "boxes", header: t(L.boxes), accessorFn: (row) => `${row.baseBox ?? ""} ${row.taxBox ?? ""}`, meta: { priority: "low" }, cell: ({ row }: { row: { original: TaxCodeView } }) =>
      <span className={styles.muted}>{[row.original.baseBox, row.original.taxBox, row.original.rcOutputBox].filter(Boolean).join(" · ")}</span> },
    { id: "effective", header: t(L.effective), accessorFn: (row) => row.effectiveFrom, cell: ({ row }: { row: { original: TaxCodeView } }) => <span className={styles.badges}>
      <span className={styles.muted}>{row.original.effectiveTo ? `${row.original.effectiveFrom} · ${row.original.effectiveTo}` : row.original.effectiveFrom}</span>
      {row.original.archived ? <Badge>{t(L.archived)}</Badge> : null}</span> },
  ];
  return <SettingsSection id="ledger-tax-codes" title={t(L.taxCodes)} actions={view.canManage ? <Button variant="primary" size="compact" onPress={() => setEditing({ tax: null })}>{t(L.addTaxCode)}</Button> : undefined}>
    <RecordTable ariaLabel={t(L.taxCodes)} data={view.taxCodes} columns={columns} getRowId={(row) => row.id} selectable={false} rowNumbers={false} wrapText
      onRowAction={view.canManage ? (row) => setEditing({ tax: row }) : undefined} />
    {editing ? <TaxCodeDialog api={api} view={view} tax={editing.tax} onClose={() => setEditing(null)} onSaved={(next) => { onChange(next); setEditing(null); }} /> : null}
  </SettingsSection>;
}

function TaxCodeDialog({ api, view, tax, onClose, onSaved }: { api: BooksSettingsApi; view: LedgerSettingsView; tax: TaxCodeView | null; onClose: () => void; onSaved: (view: LedgerSettingsView) => void }) {
  const t = useT();
  const initial = {
    code: tax?.code ?? "", name: tax?.name ?? "", direction: tax?.direction ?? "sales", rate: tax?.rate ?? "", treatment: tax?.treatment ?? "standard",
    recoverable: tax?.recoverable ?? false, baseBox: tax?.baseBox ?? "", taxBox: tax?.taxBox ?? "", rcOutputBox: tax?.rcOutputBox ?? "",
    effectiveFrom: tax?.effectiveFrom ?? view.today, effectiveTo: tax?.effectiveTo ?? null as string | null,
  };
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const locked = Boolean(tax?.used);
  const reverse = draft.treatment === "reverse_charge" || draft.treatment === "import_reverse_charge";
  const archive = async () => {
    if (!tax) return;
    setBusy(true);
    try { onSaved(await api.command(view.company.id, tax.archived ? "restore_tax_code" : "archive_tax_code", { taxCodeId: tax.id, version: tax.version })); } finally { setBusy(false); }
  };
  return <FormDialog title={tax ? t(L.editTaxCode) : t(L.addTaxCode)} submitLabel={t(L.save)} onClose={onClose} isSubmitting={busy} isDirty={JSON.stringify(draft) !== JSON.stringify(initial)}
    secondaryAction={tax ? <Button variant="quiet" onPress={() => void archive()}>{tax.archived ? t(L.restore) : t(L.archive)}</Button> : undefined}
    onSubmit={async () => {
      const input = { ...draft, recoverable: draft.direction === "purchases" && draft.recoverable, rcOutputBox: reverse ? draft.rcOutputBox : null };
      onSaved(tax ? await api.command(view.company.id, "update_tax_code", { taxCodeId: tax.id, version: tax.version, ...input })
        : await api.command(view.company.id, "add_tax_code", input));
    }}>
    {locked ? <InlineNotice tone="info" message={t(L.taxUsedHint)} /> : null}
    <FormRow>
      <TextInput label={t(L.code)} isRequired isDisabled={locked} value={draft.code} onChange={(value) => setDraft({ ...draft, code: value })} />
      <SelectField label={t(L.direction)} isDisabled={locked} selectedKey={draft.direction}
        onSelectionChange={(key) => key && setDraft({ ...draft, direction: String(key) as TaxCodeView["direction"], treatment: String(key) === "sales" && reverse ? "standard" : draft.treatment })}
        items={Object.entries(DIRECTION_LABELS).map(([id, label]) => ({ id, label: t(label) }))} />
    </FormRow>
    <TextInput label={t(L.name)} isRequired value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
    <FormRow>
      <PercentageInput label={t(L.rate)} isRequired isDisabled={locked} formatOptions={{ maximumFractionDigits: 4 }} value={draft.rate === "" ? Number.NaN : Number(draft.rate)}
        onChange={(next) => setDraft({ ...draft, rate: Number.isFinite(next) ? String(next) : "" })} />
      <SelectField label={t(L.treatment)} isDisabled={locked} selectedKey={draft.treatment} onSelectionChange={(key) => key && setDraft({ ...draft, treatment: String(key) as TaxCodeView["treatment"] })}
        items={Object.entries(TREATMENT_LABELS).filter(([id]) => draft.direction === "purchases" || (id !== "reverse_charge" && id !== "import_reverse_charge"))
          .map(([id, label]) => ({ id, label: t(label) }))} />
    </FormRow>
    {draft.direction === "purchases" ? <Switch isDisabled={locked} isSelected={draft.recoverable} onChange={(value) => setDraft({ ...draft, recoverable: value })}>{t(L.recoverable)}</Switch> : null}
    <FormRow>
      <TextInput label={t(L.baseBox)} value={draft.baseBox} onChange={(value) => setDraft({ ...draft, baseBox: value.trim() })} />
      <TextInput label={t(L.taxBox)} value={draft.taxBox} onChange={(value) => setDraft({ ...draft, taxBox: value.trim() })} />
    </FormRow>
    {reverse ? <TextInput label={t(L.outputBox)} value={draft.rcOutputBox} onChange={(value) => setDraft({ ...draft, rcOutputBox: value.trim() })} /> : null}
    <FormRow>
      <DateField label={t(L.effectiveFrom)} isRequired isDisabled={locked} value={parseDate(draft.effectiveFrom)} onChange={(value) => value && setDraft({ ...draft, effectiveFrom: value.toString() })} />
      <DateField label={t(L.effectiveTo)} value={draft.effectiveTo ? parseDate(draft.effectiveTo) : null} onChange={(value) => setDraft({ ...draft, effectiveTo: value ? value.toString() : null })} />
    </FormRow>
  </FormDialog>;
}
