"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LeaveType } from "@wodana/contracts";
import { Badge, DataGrid, EmptyState, ErrorState, NumericInput, Switch, TextInput, type DataGridColumn, FormDialog, FormSection } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { HrmsApi } from "@/lib/hrms/api";
import { useHrmsFormat } from "./hrms-format";
import styles from "./hrms.module.css";

/** Kinds of leave: limited ones count against days a year, unlimited ones (sick, unpaid) don't; paid or not, and whether half days can be asked for. */
export function LeaveTypeSettings({ api, creating, onCreateDone }: { api: HrmsApi; creating: boolean; onCreateDone: () => void }) {
  const t = useT();
  const format = useHrmsFormat();
  const [types, setTypes] = useState<LeaveType[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const load = useCallback(async () => {
    try { setTypes(await api.leaveTypes()); setError(""); } catch (cause) { setError(format.failure(cause, t("Leave types didn't load."))); }
  }, [api, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const yes = useCallback((value: boolean) => (value ? t("Yes") : t("No")), [t]);
  const columns = useMemo<DataGridColumn<LeaveType>[]>(() => [
    { id: "name", header: t("Name"), accessorFn: (row) => row.name, size: 220, meta: { primary: true } },
    { id: "allowance", header: t("Allowance"), accessorFn: (row) => (row.limited ? row.annualDays : Infinity), size: 180,
      meta: { renderCell: (row) => (row.limited ? t("{days} a year", { days: format.days(row.annualDays) }) : t("Unlimited")) } },
    { id: "paid", header: t("Paid"), accessorFn: (row) => yes(row.paid), size: 100 },
    { id: "half", header: t("Half days"), accessorFn: (row) => yes(row.allowHalfDay), size: 110 },
    { id: "active", header: t("Active"), accessorFn: (row) => row.active, size: 120,
      meta: { renderCell: (row) => <Badge tone={row.active ? "success" : "neutral"}>{row.active ? t("Active") : t("Not in use")}</Badge> } },
  ], [t, format, yes]);
  if (error && !types) return <ErrorState description={error} onRetry={() => void load()} />;
  const saved = () => { setEditing(null); onCreateDone(); void load(); };
  return <>
    <DataGrid<LeaveType> ariaLabel={t("Leave types")} columns={columns} data={[...(types ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))}
      getRowId={(row) => row.id} isLoading={!types} onRowAction={setEditing} rowNumbers={false} selectable={false} wrapText searchLabel={t("Search leave types")}
      emptyContent={<EmptyState title={t("No leave types yet")} />} />
    {editing ? <LeaveTypeDialog key={editing.id} api={api} type={editing} onClose={() => setEditing(null)} onSaved={saved} /> : null}
    {creating ? <LeaveTypeDialog key="new" api={api} type={null} onClose={onCreateDone} onSaved={saved} /> : null}
  </>;
}

function LeaveTypeDialog({ api, type, onClose, onSaved }: { api: HrmsApi; type: LeaveType | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const format = useHrmsFormat();
  const [form, setForm] = useState({
    name: type?.name ?? "", limited: type?.limited ?? true, annualDays: type?.annualDays ?? 0, allowHalfDay: type?.allowHalfDay ?? true, paid: type?.paid ?? true, active: type?.active ?? true,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const days = form.annualDays;
  const daysValid = !form.limited || (Number.isFinite(days) && days >= 0 && days <= 366 && Number.isInteger(days * 2));
  const save = async () => {
    setBusy(true); setError("");
    try {
      await api.saveLeaveType({ ...(type ? { id: type.id } : {}), version: type?.version ?? 0, name: form.name.trim(), limited: form.limited, annualDays: form.limited ? days : 0,
        allowHalfDay: form.allowHalfDay, paid: form.paid, active: form.active });
      onSaved();
    } catch (cause) { setError(format.failure(cause, t("Could not save."))); setBusy(false); }
  };
  return <FormDialog size="md" title={type ? type.name : t("New leave type")} onClose={onClose} error={error || undefined} isSubmitting={busy} isSubmitDisabled={!form.name.trim() || !daysValid} submitLabel={t("Save")} onSubmit={() => save()}>
      <FormSection>
        <TextInput label={t("Name")} isRequired value={form.name} onChange={(value) => set("name", value)} maxLength={100} />
        <Switch isSelected={form.paid} onChange={(value) => set("paid", value)}>{t("Paid")}</Switch>
        <Switch isSelected={form.active} onChange={(value) => set("active", value)}>{t("Active")}</Switch>
      </FormSection>
      <FormSection title={t("Allowance")}>
        <Switch isSelected={form.limited} onChange={(value) => set("limited", value)}>{t("Limited")}</Switch>
        {form.limited ? <NumericInput label={t("Days a year")} isRequired minValue={0} maxValue={366} step={0.5} value={days} onChange={(value) => set("annualDays", value)}
          isInvalid={!daysValid} errorMessage={!daysValid ? t("Use whole or half days.") : undefined} /> : null}
        <Switch isSelected={form.allowHalfDay} onChange={(value) => set("allowHalfDay", value)}>{t("Half days")}</Switch>
      </FormSection>
  </FormDialog>;
}
