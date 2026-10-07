"use client";

import { parseDate } from "@internationalized/date";
import { DateRangeField, SelectField } from "@/design-system";
import {
  LEDGER_REPORT_LABELS, LEDGER_REPORTS, PERIOD_LABELS, PERIOD_PRESETS, presetOf, presetPeriod,
  type LedgerReportCode, type LedgerScope, type PeriodPreset, type ReportEntity,
} from "@/lib/books/reports-client";
import { useLedgerT } from "./ledger-format";
import styles from "./ledger.module.css";

/**
 * What a Ledger view reads: the report (on Reports), the company (when there is more than one) and the period,
 * as presets of the company's calendar and financial year or custom dates. Balance-style reports read the end date.
 */
export function ReportPicker({ report, onReport, entities, entity, scope, onScope, pointInTime = false }: {
  report?: LedgerReportCode; onReport?: (report: LedgerReportCode) => void;
  entities: ReportEntity[]; entity: ReportEntity | null; scope: LedgerScope; onScope: (next: Partial<LedgerScope>) => void;
  /** The report is at a date (balance sheet, ageing): the period's end is what counts. */
  pointInTime?: boolean;
}) {
  const t = useLedgerT();
  const today = entity?.today ?? new Date().toISOString().slice(0, 10);
  const fiscal = entity?.fiscalYearStartMonth ?? 1;
  const preset: PeriodPreset = scope.from && scope.to ? presetOf(scope.from, scope.to, today, fiscal) : "year";
  let range = null;
  try { range = scope.from && scope.to ? { start: parseDate(scope.from), end: parseDate(scope.to) } : null; } catch { range = null; }
  return <div className={`${styles.picker} ${styles.noPrint}`} role="group" aria-label={t("Report options")}>
    {report && onReport ? <SelectField accent="neutral" label={t("Report")} items={LEDGER_REPORTS.map((id) => ({ id, label: t(LEDGER_REPORT_LABELS[id]) }))}
      selectedKey={report} onSelectionChange={(value) => value && onReport(String(value) as LedgerReportCode)} /> : null}
    {entities.length > 1 ? <SelectField accent="neutral" label={t("Company")} items={entities.map((item) => ({ id: item.id, label: item.name }))}
      selectedKey={entity?.id ?? ""} onSelectionChange={(value) => value && onScope({ entity: String(value), from: "", to: "" })} /> : null}
    <SelectField accent="neutral" label={pointInTime ? t("As at") : t("Period")} items={PERIOD_PRESETS.map((id) => ({ id, label: t(PERIOD_LABELS[id]) }))} selectedKey={preset}
      onSelectionChange={(value) => {
        const next = String(value ?? "year") as PeriodPreset;
        if (next === "custom") onScope({ from: scope.from || presetPeriod("year", today, fiscal).from, to: scope.to || today });
        else onScope(presetPeriod(next, today, fiscal));
      }} />
    {preset === "custom" ? <DateRangeField label={t("Dates")} value={range} onChange={(value) => value && onScope({ from: value.start.toString(), to: value.end.toString() })} /> : null}
  </div>;
}
