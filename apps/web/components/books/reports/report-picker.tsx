"use client";

import type { ReactNode } from "react";
import { parseDate } from "@internationalized/date";
import { Button, DateRangeField, SelectField } from "@/design-system";
import {
  LEDGER_REPORT_LABELS, LEDGER_REPORTS, PERIOD_LABELS, periodPresets, presetOf, presetPeriod,
  type LedgerReportCode, type LedgerScope, type PeriodPreset,
} from "@/lib/books/reports-client";
import { useLedgerT } from "./ledger-format";
import styles from "./ledger.module.css";

/** What the picker needs of a company: its today and the month its financial year starts (region pack or Ledger settings). */
type PickerCompany = { id: string; name: string; today: string; fiscalYearStartMonth: number };

/**
 * The toolbar of a Ledger view: the report (on Reports), the company (when there is more than one), the period as
 * presets of the company's calendar and financial year or custom dates, any view-specific choices (comparison,
 * basis), and the export and print actions at the inline end. Balance-style reports read the end date.
 */
export function ReportPicker({ report, onReport, reports = LEDGER_REPORTS, entities, entity, scope, onScope, pointInTime = false, children, actions }: {
  report?: LedgerReportCode; onReport?: (report: LedgerReportCode) => void;
  /** The reports offered (fewer when the company keeps no Ledger). */
  reports?: readonly LedgerReportCode[];
  entities: PickerCompany[]; entity: PickerCompany | null; scope: LedgerScope; onScope: (next: Partial<LedgerScope>) => void;
  /** The report is at a date (balance sheet, ageing): the period's end is what counts. */
  pointInTime?: boolean;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const t = useLedgerT();
  const today = entity?.today ?? new Date().toISOString().slice(0, 10);
  const fiscal = entity?.fiscalYearStartMonth ?? 1;
  const presets = periodPresets(fiscal);
  const preset: PeriodPreset = scope.from && scope.to ? presetOf(scope.from, scope.to, today, fiscal) : "year";
  let range = null;
  try { range = scope.from && scope.to ? { start: parseDate(scope.from), end: parseDate(scope.to) } : null; } catch { range = null; }
  return <div className={`${styles.picker} ${styles.noPrint}`} role="group" aria-label={t("Report options")}>
    {report && onReport ? <SelectField accent="neutral" label={t("Report")} items={reports.map((id) => ({ id, label: t(LEDGER_REPORT_LABELS[id]) }))}
      selectedKey={report} onSelectionChange={(value) => value && onReport(String(value) as LedgerReportCode)} /> : null}
    {entities.length > 1 ? <SelectField accent="neutral" label={t("Company")} items={entities.map((item) => ({ id: item.id, label: item.name }))}
      selectedKey={entity?.id ?? ""} onSelectionChange={(value) => value && onScope({ entity: String(value), from: "", to: "" })} /> : null}
    <SelectField accent="neutral" label={pointInTime ? t("As at") : t("Period")} items={presets.map((id) => ({ id, label: t(PERIOD_LABELS[id]) }))} selectedKey={preset}
      onSelectionChange={(value) => {
        const next = String(value ?? "year") as PeriodPreset;
        if (next === "custom") onScope({ from: scope.from || presetPeriod("year", today, fiscal).from, to: scope.to || today });
        else onScope(presetPeriod(next, today, fiscal));
      }} />
    {preset === "custom" ? <DateRangeField label={t("Dates")} value={range} onChange={(value) => value && onScope({ from: value.start.toString(), to: value.end.toString() })} /> : null}
    {children}
    {actions ? <div className={styles.pickerActions}>{actions}</div> : null}
  </div>;
}

/** Export (the server's CSV, the same exact figures) and Print (the page laid out for paper, saved as PDF from the print dialog). */
export function ReportActions({ csvHref }: { csvHref?: string | null }) {
  const t = useLedgerT();
  return <>
    {csvHref ? <a className="wd-button" data-size="compact" data-variant="quiet" href={csvHref} download>{t("Export CSV")}</a> : null}
    <Button size="compact" variant="quiet" onPress={() => window.print()}>{t("Print")}</Button>
  </>;
}
