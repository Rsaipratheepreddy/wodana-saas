"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HrmsBootstrap, PayrollMonth } from "@wodana/contracts";
import { DataGrid, EmptyState, ErrorState, SegmentedControl, useDesignSystem, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { HrmsApi, PayrollKind } from "@/lib/hrms/api";
import { addMonths } from "@/lib/hrms/time";
import { PeriodStepper, download } from "./hrms-controls";
import { useHrmsFormat } from "./hrms-format";
import styles from "./hrms.module.css";

type Employee = PayrollMonth["people"][number];
type Worker = PayrollMonth["workers"][number];

/**
 * The month's payroll inputs for HR: per employee the days and hours worked, overtime, paid and unpaid
 * leave and days away; per crew worker the days, overtime and what they come to at their fixed rates. Each
 * list goes to the payroll provider as a CSV.
 */
export function PayrollTab({ api, boot }: { api: HrmsApi; boot: HrmsBootstrap }) {
  const t = useT();
  const format = useHrmsFormat();
  const { locale } = useDesignSystem();
  const thisMonth = format.today(boot.workspace.timezone).slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [view, setView] = useState<PayrollKind>("employees");
  const [data, setData] = useState<PayrollMonth | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setData(await api.payroll(month)); setError(""); } catch (cause) { setError(format.failure(cause, t("Payroll didn't load."))); }
  }, [api, month, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const current = data?.month === month ? data : null;
  const count = useCallback((value: number) => <span className={styles.number}>{format.number(value)}</span>, [format]);
  const money = useCallback((amounts: Worker["amounts"]) => amounts.map((item) => {
    try { return new Intl.NumberFormat(locale, { style: "currency", currency: item.currency }).format(Number(item.amount)); } catch { return `${item.currency} ${item.amount}`; }
  }).join(" + "), [locale]);
  const employeeColumns = useMemo<DataGridColumn<Employee>[]>(() => [
    { id: "name", header: t("Name"), accessorFn: (row) => row.name, size: 220, meta: { primary: true,
      renderCell: (row) => <span className={styles.nameCell}><span>{row.name}</span><small>{[row.employeeCode, row.designation].filter(Boolean).join(" · ")}</small></span> } },
    { id: "department", header: t("Department"), accessorFn: (row) => row.department, size: 150, meta: { mobileHidden: true } },
    { id: "scheduled", header: t("Working days"), accessorFn: (row) => row.scheduledDays, size: 120, meta: { align: "end", mobileHidden: true, renderCell: (row) => count(row.scheduledDays) } },
    { id: "worked", header: t("Days worked"), accessorFn: (row) => row.workedDays, size: 120, meta: { align: "end", renderCell: (row) => count(row.workedDays) } },
    { id: "hours", header: t("Hours worked"), accessorFn: (row) => row.workedHours, size: 120, meta: { align: "end", mobileHidden: true, renderCell: (row) => count(row.workedHours) } },
    { id: "overtime", header: t("Overtime hours"), accessorFn: (row) => row.overtimeHours, size: 130, meta: { align: "end", renderCell: (row) => count(row.overtimeHours) } },
    { id: "paid", header: t("Paid leave"), accessorFn: (row) => row.paidLeaveDays, size: 110, meta: { align: "end", mobileHidden: true, renderCell: (row) => count(row.paidLeaveDays) } },
    { id: "unpaid", header: t("Unpaid leave"), accessorFn: (row) => row.unpaidLeaveDays, size: 120, meta: { align: "end", renderCell: (row) => count(row.unpaidLeaveDays) } },
    { id: "absent", header: t("Days away"), accessorFn: (row) => row.absentDays, size: 110, meta: { align: "end", renderCell: (row) => count(row.absentDays) } },
    { id: "review", header: t("To review"), accessorFn: (row) => row.toReview, size: 110, meta: { align: "end", mobileHidden: true, renderCell: (row) => count(row.toReview) } },
  ], [t, count]);
  const workerColumns = useMemo<DataGridColumn<Worker>[]>(() => [
    { id: "name", header: t("Name"), accessorFn: (row) => row.name, size: 220, meta: { primary: true,
      renderCell: (row) => <span className={styles.nameCell}><span>{row.name}</span>{row.workerCode ? <small>{row.workerCode}</small> : null}</span> } },
    { id: "trade", header: t("Trade"), accessorFn: (row) => row.trade, size: 180, meta: { mobileHidden: true,
      renderCell: (row) => <span className={styles.nameCell}><span>{row.trade}</span>{row.crew ? <small>{row.crew}</small> : null}</span> } },
    { id: "days", header: t("Days"), accessorFn: (row) => row.days, size: 100, meta: { align: "end", renderCell: (row) => count(row.days) } },
    { id: "overtime", header: t("Overtime hours"), accessorFn: (row) => row.overtimeHours, size: 130, meta: { align: "end", renderCell: (row) => count(row.overtimeHours) } },
    { id: "amount", header: t("Amount"), accessorFn: (row) => row.amounts.map((item) => item.amount).join(), size: 180, meta: { align: "end",
      renderCell: (row) => <span className={styles.number}>{money(row.amounts)}</span> } },
    { id: "uncosted", header: t("Days without a rate"), accessorFn: (row) => row.uncosted, size: 150, meta: { align: "end", mobileHidden: true,
      renderCell: (row) => (row.uncosted ? count(row.uncosted) : null) } },
  ], [t, count, money]);
  const monthLabel = new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00Z`));
  const tools = <div className={styles.toolbar}>
    <SegmentedControl label={t("Show")} value={view} onChange={(value) => setView(value as PayrollKind)}
      options={[{ id: "employees", label: t("Employees") }, { id: "workers", label: t("Crew workers") }]} />
    <PeriodStepper label={monthLabel} previousLabel={t("Previous month")} nextLabel={t("Next month")} canNext={month < thisMonth}
      onPrevious={() => setMonth(addMonths(month, -1))} onNext={() => setMonth(addMonths(month, 1))} />
  </div>;
  if (error && !current) return <>{tools}<ErrorState description={error} onRetry={() => void load()} /></>;
  const exportList = () => download(api.payrollExportUrl(month, view));
  return view === "employees"
    ? <DataGrid<Employee> ariaLabel={t("Employees")} columns={employeeColumns} data={current?.people ?? []} getRowId={(row) => row.membershipId} isLoading={!current}
        rowNumbers={false} selectable={false} wrapText searchLabel={t("Search people")} toolbarLeading={tools} onExport={exportList}
        emptyContent={<EmptyState title={t("No one on payroll this month")} />} />
    : <DataGrid<Worker> ariaLabel={t("Crew workers")} columns={workerColumns} data={current?.workers ?? []} getRowId={(row) => row.workerId} isLoading={!current}
        rowNumbers={false} selectable={false} wrapText searchLabel={t("Search workers")} toolbarLeading={tools} onExport={exportList}
        emptyContent={<EmptyState title={t("No crew days this month")} />} />;
}
