"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { DataGrid, EmptyState, ErrorState, InlineNotice, InspectorSheet, Skeleton, type DataGridColumn } from "@/design-system";
import {
  AGEING_LABELS, ledgerPaths, type AgeingReport, type BalanceSheetReport, type GeneralLedgerReport, type LedgerApi, type LedgerScope, type ProfitAndLossReport,
  type StatementSection, type TrialBalanceReport, type VatBox, type VatBoxLine, type VatReport, type VatReviewItem,
} from "@/lib/books/reports-client";
import { useLedgerFormat, useLedgerT, type LedgerFormat, type LedgerT } from "./ledger-format";
import { useLoad } from "./use-load";
import styles from "./ledger.module.css";

/**
 * The company reports as tables (DataGrid: CSV export from its toolbar, print from the page). Every account opens
 * its ledger, every journal its sheet and every journal's record its own page (report → account → journal → source).
 * Reports keep their own order: columns don't sort.
 */

const GRID = { rowNumbers: false, selectable: false, pageSize: 2000, pinFirstColumn: true } as const;

function moneyColumn<T>(id: string, header: string, get: (row: T) => string | null | undefined, format: LedgerFormat, blankZero = false): DataGridColumn<T> {
  return {
    id, header, accessorFn: (row) => get(row) ?? "", enableSorting: false, size: 150,
    meta: { align: "end", renderCell: (row) => <span className={styles.money}>{blankZero ? format.amountOrBlank(get(row)) : format.amount(get(row))}</span> },
  };
}

function AccountLink({ accountId, code, name, scope }: { accountId: string | null; code: string | null; name: string; scope: LedgerScope }) {
  const label = [code, name].filter(Boolean).join(" ");
  return accountId ? <Link className={styles.link} href={ledgerPaths.account(accountId, scope)}>{label}</Link> : <span>{label}</span>;
}

export function JournalLink({ journalId, number, scope }: { journalId: string; number: string; scope: LedgerScope }) {
  return <Link className={styles.link} href={ledgerPaths.journal(journalId, scope)}>{number}</Link>;
}

/** The record a journal came from (its own page), or its label when it has none. */
export function SourceLink({ href, label }: { href: string; label: string }) {
  return href ? <Link className={styles.link} href={href}>{label || href}</Link> : <span>{label}</span>;
}

// ---------------------------------------------------------------------------------------------------------------
// Trial balance.

type TbRow = TrialBalanceReport["rows"][number] & { kind: "account" | "total" };

export function TrialBalanceView({ report, scope }: { report: TrialBalanceReport; scope: LedgerScope }) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const rows: TbRow[] = [...report.rows.map((row) => ({ ...row, kind: "account" as const })),
    { accountId: "__total", code: "", name: t("Total"), type: "asset", subtype: "", ...report.totals, kind: "total" }];
  const columns = useMemo<DataGridColumn<TbRow>[]>(() => [
    { id: "account", header: t("Account"), accessorFn: (row) => `${row.code} ${row.name}`.trim(), enableSorting: false, size: 320,
      meta: { primary: true, interactive: true, renderCell: (row) => row.kind === "total" ? <span className={styles.row} data-kind="total">{row.name}</span>
        : <AccountLink accountId={row.accountId || null} code={row.code} name={row.name} scope={scope} /> } },
    moneyColumn<TbRow>("opening", t("Opening"), (row) => row.opening, format),
    moneyColumn<TbRow>("debit", t("Debit"), (row) => row.debit, format, true),
    moneyColumn<TbRow>("credit", t("Credit"), (row) => row.credit, format, true),
    moneyColumn<TbRow>("closing", t("Closing"), (row) => row.closing, format),
  ], [t, format, scope]);
  return <div className={styles.stack}>
    {!report.balanced ? <InlineNotice tone="error" message={t("The trial balance doesn't balance. Check the journals that need attention.")} /> : null}
    <DataGrid<TbRow> {...GRID} ariaLabel={t("Trial balance")} columns={columns} data={rows} getRowId={(row) => row.accountId || row.code}
      exportFileName={`${report.entity.code}-trial-balance-${report.scope.from}-${report.scope.to}.csv`} emptyContent={<EmptyState title={t("No journals in this period")} />} />
  </div>;
}

// ---------------------------------------------------------------------------------------------------------------
// P&L and balance sheet.

type StatementRow = { id: string; kind: "section" | "line" | "total" | "result"; depth: number; name: string; code: string | null; accountId: string | null; amount: string | null };

function sectionLabel(t: LedgerT, section: Pick<StatementSection, "key" | "label">) {
  switch (section.key) {
    case "revenue": return t("Revenue");
    case "cost_of_sales": return t("Cost of sales");
    case "operating_expenses": return t("Operating expenses");
    case "other_income": return t("Other income");
    case "other_expenses": return t("Other expenses");
    case "assets": return t("Assets");
    case "current_assets": return t("Current assets");
    case "non_current_assets": return t("Non-current assets");
    case "liabilities": return t("Liabilities");
    case "current_liabilities": return t("Current liabilities");
    case "non_current_liabilities": return t("Non-current liabilities");
    case "equity": return t("Equity");
    default: return t(section.label);
  }
}

export function flattenStatement(t: LedgerT, sections: readonly StatementSection[], depth = 0): StatementRow[] {
  return sections.flatMap((section) => {
    const label = sectionLabel(t, section);
    return [
      { id: `${section.key}:head`, kind: "section" as const, depth, name: label, code: null, accountId: null, amount: null },
      ...section.lines.map((line, index) => ({ id: `${section.key}:${line.accountId ?? index}`, kind: "line" as const, depth: depth + 1,
        name: line.accountId ? line.name : t(line.name), code: line.code, accountId: line.accountId, amount: line.amount })),
      ...flattenStatement(t, section.sections, depth + 1),
      { id: `${section.key}:total`, kind: "total" as const, depth, name: t("Total {section}", { section: label.toLocaleLowerCase() }), code: null, accountId: null, amount: section.total },
    ];
  });
}

function StatementGrid({ label, rows, scope, fileName }: { label: string; rows: StatementRow[]; scope: LedgerScope; fileName: string }) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const columns = useMemo<DataGridColumn<StatementRow>[]>(() => [
    { id: "line", header: t("Account"), accessorFn: (row) => [row.code, row.name].filter(Boolean).join(" "), enableSorting: false, size: 380,
      meta: { primary: true, interactive: true, renderCell: (row) => <span className={styles.row} data-kind={row.kind} data-depth={row.depth}>
        {row.kind === "line" ? <AccountLink accountId={row.accountId} code={row.code} name={row.name} scope={scope} /> : row.name}</span> } },
    moneyColumn<StatementRow>("amount", t("Amount"), (row) => row.amount, format),
  ], [t, format, scope]);
  return <DataGrid<StatementRow> {...GRID} ariaLabel={label} columns={columns} data={rows} getRowId={(row) => row.id} exportFileName={fileName} />;
}

export function ProfitAndLossView({ report, scope }: { report: ProfitAndLossReport; scope: LedgerScope }) {
  const t = useLedgerT();
  const [revenue, cost, operating, otherIncome, otherExpenses] = report.sections;
  const flat = (section: StatementSection | undefined) => (section ? flattenStatement(t, [section]) : []);
  const result = (id: string, name: string, amount: string): StatementRow => ({ id, kind: "result", depth: 0, name, code: null, accountId: null, amount });
  const rows = [
    ...flat(revenue), ...flat(cost), result("gross", t("Gross profit"), report.totals.grossProfit),
    ...flat(operating), result("operating", t("Operating profit"), report.totals.operatingProfit),
    ...flat(otherIncome), ...flat(otherExpenses), result("net", t("Net profit"), report.totals.netProfit),
  ];
  return <StatementGrid label={t("Profit and loss")} rows={rows} scope={scope} fileName={`${report.entity.code}-profit-and-loss-${report.scope.from}-${report.scope.to}.csv`} />;
}

export function BalanceSheetView({ report, scope }: { report: BalanceSheetReport; scope: LedgerScope }) {
  const t = useLedgerT();
  const [assets, liabilities, equity] = report.sections;
  const rows = [...flattenStatement(t, [assets, liabilities, equity].filter(Boolean)),
    { id: "total", kind: "result" as const, depth: 0, name: t("Total liabilities and equity"), code: null, accountId: null, amount: report.totals.liabilitiesAndEquity }];
  return <div className={styles.stack}>
    {!report.balanced ? <InlineNotice tone="error" message={t("Assets and liabilities with equity differ. Check the journals that need attention.")} /> : null}
    <StatementGrid label={t("Balance sheet")} rows={rows} scope={scope} fileName={`${report.entity.code}-balance-sheet-${report.scope.to}.csv`} />
  </div>;
}

// ---------------------------------------------------------------------------------------------------------------
// VAT.

function reviewReason(t: LedgerT, reason: VatReviewItem["reason"]) {
  switch (reason) {
    case "zero_rate": return t("Zero rated or exempt: check the evidence");
    case "advance_split": return t("Tax on an advance, worked out from the amount received");
    case "foreign_supplier_without_reverse_charge": return t("Supplier abroad without reverse charge");
    case "missing_region": return t("No region: not in a box");
    default: return String(reason);
  }
}

export function VatView({ report, scope, api }: { report: VatReport; scope: LedgerScope; api: LedgerApi }) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const [open, setOpen] = useState<VatBox | null>(null);
  const boxColumns = useMemo<DataGridColumn<VatBox>[]>(() => [
    { id: "box", header: t("Box"), accessorFn: (row) => row.box, enableSorting: false, size: 80, meta: { primary: true } },
    { id: "label", header: t("Description"), accessorFn: (row) => row.label, enableSorting: false, size: 380,
      meta: { renderCell: (row) => <span className={styles.row} data-kind={row.computed ? "total" : "line"}>{t(row.label)}</span> } },
    moneyColumn<VatBox>("amount", t("Amount"), (row) => row.amount, format),
    moneyColumn<VatBox>("vat", t("VAT"), (row) => row.vat, format),
    moneyColumn<VatBox>("adjustment", t("Adjustment"), (row) => row.adjustment, format),
  ], [t, format]);
  const reviewColumns = useMemo<DataGridColumn<VatReviewItem>[]>(() => [
    { id: "journal", header: t("Journal"), accessorFn: (row) => row.journalNumber, enableSorting: false, size: 170,
      meta: { primary: true, interactive: true, renderCell: (row) => <JournalLink journalId={row.journalId} number={row.journalNumber} scope={scope} /> } },
    { id: "reason", header: t("Check"), accessorFn: (row) => reviewReason(t, row.reason), enableSorting: false, size: 320,
      meta: { renderCell: (row) => <span className={styles.cell}><span>{reviewReason(t, row.reason)}</span>
        <small>{[row.partyName, row.taxCode, row.accountCode ? `${row.accountCode} ${row.accountName ?? ""}`.trim() : null].filter(Boolean).join(" · ")}</small></span> } },
    { id: "date", header: t("Date"), accessorFn: (row) => row.journalDate, enableSorting: false, size: 130, meta: { renderCell: (row) => format.day(row.journalDate) } },
    { id: "source", header: t("Record"), accessorFn: (row) => row.sourceLabel, enableSorting: false, size: 220,
      meta: { interactive: true, renderCell: (row) => <SourceLink href={row.sourceHref} label={row.sourceLabel} /> } },
    moneyColumn<VatReviewItem>("amount", t("Amount"), (row) => row.amount, format),
  ], [t, format, scope]);
  if (!report.layout) return <EmptyState title={t("This company's chart has no tax return")} />;
  return <div className={styles.stack}>
    <DataGrid<VatBox> {...GRID} ariaLabel={t(report.layout.name)} columns={boxColumns} data={report.boxes} getRowId={(row) => row.box}
      onRowAction={(row) => { if (!row.computed) setOpen(row); }} exportFileName={`${report.entity.code}-vat-${report.scope.from}-${report.scope.to}.csv`} />
    {report.review.length ? <section className={styles.stack} aria-label={t("To review")}>
      <h2 className={styles.subhead}>{t("To review")}</h2>
      <DataGrid<VatReviewItem> {...GRID} ariaLabel={t("To review")} columns={reviewColumns} data={report.review} getRowId={(row) => `${row.reason}:${row.journalId}:${row.taxCode ?? ""}:${row.amount}`}
        exportFileName={`${report.entity.code}-vat-review-${report.scope.from}-${report.scope.to}.csv`} />
    </section> : null}
    {open ? <VatBoxSheet api={api} scope={scope} box={open} onClose={() => setOpen(null)} /> : null}
  </div>;
}

/** The journal lines behind one box. */
function VatBoxSheet({ api, scope, box, onClose }: { api: LedgerApi; scope: LedgerScope; box: VatBox; onClose: () => void }) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const lines = useLoad(`${box.box}|${scope.entity}|${scope.from}|${scope.to}`, (signal) => api.report<VatReport>("vat", scope, { box: box.box }, signal));
  const columns = useMemo<DataGridColumn<VatBoxLine>[]>(() => [
    { id: "journal", header: t("Journal"), accessorFn: (row) => row.journalNumber, enableSorting: false, size: 170,
      meta: { primary: true, interactive: true, renderCell: (row) => <JournalLink journalId={row.journalId} number={row.journalNumber} scope={scope} /> } },
    { id: "date", header: t("Date"), accessorFn: (row) => row.journalDate, enableSorting: false, size: 130, meta: { renderCell: (row) => format.day(row.journalDate) } },
    { id: "source", header: t("Record"), accessorFn: (row) => row.sourceLabel, enableSorting: false, size: 220,
      meta: { interactive: true, renderCell: (row) => <SourceLink href={row.sourceHref} label={row.sourceLabel} /> } },
    moneyColumn<VatBoxLine>("amount", t("Amount"), (row) => row.amount, format),
    moneyColumn<VatBoxLine>("vat", t("VAT"), (row) => row.vat, format),
  ], [t, format, scope]);
  return <InspectorSheet isOpen size="lg" title={t("Box {box}", { box: box.box })} description={t(box.label)} onOpenChange={(value) => { if (!value) onClose(); }}>
    {lines.error ? <ErrorState description={lines.error} onRetry={lines.reload} />
      : <DataGrid<VatBoxLine> {...GRID} ariaLabel={t("Box {box}", { box: box.box })} columns={columns} data={lines.data?.lines ?? []} getRowId={(row) => row.lineId}
        isLoading={!lines.data} emptyContent={<EmptyState title={t("No lines in this box")} />} />}
  </InspectorSheet>;
}

// ---------------------------------------------------------------------------------------------------------------
// Ageing.

type AgeingGridRow = { id: string; kind: "party" | "total" | "unlinked" | "control"; name: string; accountId: string | null; buckets: Record<string, string | null>; total: string };

export function AgeingView({ report, scope }: { report: AgeingReport; scope: LedgerScope }) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const blank = Object.fromEntries(AGEING_LABELS.map(([bucket]) => [bucket, null]));
  const rows: AgeingGridRow[] = [
    ...report.rows.map((row) => ({ id: `${row.partyType}:${row.partyId}`, kind: "party" as const, name: row.partyName || t("Unnamed"), accountId: null, buckets: row.buckets, total: row.total })),
    { id: "total", kind: "total", name: t("Total"), accountId: null, buckets: report.totals, total: report.totals.total },
    ...(report.unlinked !== "0.0000" ? [{ id: "unlinked", kind: "unlinked" as const, name: t("Not linked to a party"), accountId: null, buckets: blank, total: report.unlinked }] : []),
    ...(report.control ? [{ id: "control", kind: "control" as const, name: `${report.control.code} ${report.control.name}`, accountId: report.control.accountId, buckets: blank,
      total: report.control.balance }] : []),
  ];
  const columns = useMemo<DataGridColumn<AgeingGridRow>[]>(() => [
    { id: "party", header: report.side === "receivable" ? t("Client") : t("Supplier"), accessorFn: (row) => row.name, enableSorting: false, size: 280,
      meta: { primary: true, interactive: true, renderCell: (row) => <span className={styles.row} data-kind={row.kind === "party" ? "line" : "total"}>
        {row.accountId ? <Link className={styles.link} href={ledgerPaths.account(row.accountId, scope)}>{row.name}</Link> : row.name}</span> } },
    ...AGEING_LABELS.map(([bucket, label]) => moneyColumn<AgeingGridRow>(bucket, t(label), (row) => row.buckets[bucket], format, true)),
    moneyColumn<AgeingGridRow>("total", t("Total"), (row) => row.total, format),
  ], [t, format, scope, report.side]);
  return <div className={styles.stack}>
    {!report.reconciled ? <InlineNotice tone="error" message={t("The parties don't add up to the control account.")} /> : null}
    <DataGrid<AgeingGridRow> {...GRID} ariaLabel={report.side === "receivable" ? t("Receivables ageing") : t("Payables ageing")} columns={columns} data={rows}
      getRowId={(row) => row.id} exportFileName={`${report.entity.code}-${report.report}-${report.scope.to}.csv`} />
  </div>;
}

// ---------------------------------------------------------------------------------------------------------------
// General ledger (one account).

type LedgerGridRow = GeneralLedgerReport["rows"][number] & { kind: "line" | "opening" | "closing" };

export function GeneralLedgerView({ report, scope }: { report: GeneralLedgerReport; scope: LedgerScope }) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const edge = (kind: "opening" | "closing", balance: string): LedgerGridRow => ({ lineId: kind, journalId: "", journalNumber: "", journalDate: kind === "opening" ? report.scope.from : report.scope.to,
    kind, description: kind === "opening" ? t("Opening balance") : t("Closing balance"), sourceLabel: "", sourceHref: "", partyName: null,
    debit: kind === "closing" ? report.debit : "", credit: kind === "closing" ? report.credit : "", balance });
  const rows: LedgerGridRow[] = [edge("opening", report.opening), ...report.rows.map((row) => ({ ...row, kind: "line" as const })), edge("closing", report.closing)];
  const columns = useMemo<DataGridColumn<LedgerGridRow>[]>(() => [
    { id: "date", header: t("Date"), accessorFn: (row) => row.journalDate, enableSorting: false, size: 130, meta: { primary: true, renderCell: (row) => format.day(row.journalDate) } },
    { id: "journal", header: t("Journal"), accessorFn: (row) => row.journalNumber, enableSorting: false, size: 170,
      meta: { interactive: true, renderCell: (row) => row.journalId ? <JournalLink journalId={row.journalId} number={row.journalNumber} scope={scope} /> : null } },
    { id: "description", header: t("Description"), accessorFn: (row) => row.description, enableSorting: false, size: 300,
      meta: { renderCell: (row) => <span className={styles.cell}><span className={styles.row} data-kind={row.kind === "line" ? "line" : "total"}>{row.description}</span>
        {row.partyName ? <small>{row.partyName}</small> : null}</span> } },
    { id: "source", header: t("Record"), accessorFn: (row) => row.sourceLabel, enableSorting: false, size: 200,
      meta: { interactive: true, renderCell: (row) => (row.kind === "line" ? <SourceLink href={row.sourceHref} label={row.sourceLabel} /> : null) } },
    moneyColumn<LedgerGridRow>("debit", t("Debit"), (row) => row.debit, format, true),
    moneyColumn<LedgerGridRow>("credit", t("Credit"), (row) => row.credit, format, true),
    moneyColumn<LedgerGridRow>("balance", t("Balance"), (row) => row.balance, format),
  ], [t, format, scope]);
  return <div className={styles.stack}>
    <dl className={styles.summary}>
      <div><dt>{t("Account")}</dt><dd>{report.account.code} {report.account.name}</dd></div>
      <div><dt>{t("Opening")}</dt><dd>{format.money(report.opening)}</dd></div>
      <div><dt>{t("Closing")}</dt><dd>{format.money(report.closing)}</dd></div>
    </dl>
    <DataGrid<LedgerGridRow> {...GRID} ariaLabel={t("General ledger")} columns={columns} data={rows} getRowId={(row) => row.lineId}
      exportFileName={`${report.entity.code}-general-ledger-${report.account.code}-${report.scope.from}-${report.scope.to}.csv`} />
  </div>;
}

/** The standard states around a report body. */
export function ReportState({ loading, error, onRetry, children }: { loading: boolean; error: string | null; onRetry: () => void; children: ReactNode }) {
  const t = useLedgerT();
  if (error) return <ErrorState title={t("This report didn't load")} description={t(error)} onRetry={onRetry} />;
  if (loading) return <Skeleton shape="rows" lines={10} />;
  return <>{children}</>;
}
