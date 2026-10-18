"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  Button, Callout, DataGrid, EmptyState, FactTiles, ErrorState, InlineNotice, InspectorSheet, Skeleton, StatementTable, type DataGridColumn, type StatementColumnHead, type StatementLine,
} from "@/design-system";
import {
  AGEING_LABELS, ledgerPaths, type AgeingReport, type BalanceSheetReport, type GeneralLedgerReport, type LedgerApi, type LedgerScope, type StatementSection,
  type TrialBalanceReport, type TrialBalanceRow, type VatBox, type VatBoxLine, type VatReport, type VatReviewItem,
} from "@/lib/books/reports-client";
import { tKey } from "@/lib/i18n/keys";
import { useLedgerFormat, useLedgerT, type LedgerFormat, type LedgerT } from "./ledger-format";
import { useLoad } from "./use-load";
import styles from "./ledger.module.css";

/**
 * The company reports as statements (StatementTable: headings, indented accounts, totals over a rule, results under
 * a double rule, tabular figures) and the lists behind them (DataGrid). Every account opens its ledger, every
 * journal its sheet and every journal's record its own page (report → account → journal → source). CSV comes from
 * the server (the picker's Export) and print lays the page out for paper.
 */

function moneyColumn<T>(id: string, header: string, get: (row: T) => string | null | undefined, format: LedgerFormat, blankZero = false): DataGridColumn<T> {
  return {
    id, header, accessorFn: (row) => get(row) ?? "", enableSorting: false, size: 150,
    meta: { align: "end", renderCell: (row) => <span className={styles.money}>{blankZero ? format.amountOrBlank(get(row)) : format.amount(get(row))}</span> },
  };
}

function AccountLink({ accountId, name, scope }: { accountId: string | null; name: string; scope: LedgerScope }) {
  return accountId ? <Link href={ledgerPaths.account(accountId, scope)}>{name}</Link> : <span>{name}</span>;
}

export function JournalLink({ journalId, number, scope }: { journalId: string; number: string; scope: LedgerScope }) {
  return <Link className={styles.link} href={ledgerPaths.journal(journalId, scope)}>{number}</Link>;
}

/** The record a journal came from (its own page), or its label when it has none. */
export function SourceLink({ href, label }: { href: string; label: string }) {
  return href ? <Link className={styles.link} href={href}>{label || href}</Link> : <span>{label}</span>;
}

const figures = (format: LedgerFormat, values: Array<string | null | undefined>) => ({
  values: values.map((value) => (value === null || value === undefined ? null : format.figure(value))),
  negative: values.map((value) => format.negative(value)),
});

// ---------------------------------------------------------------------------------------------------------------
// Trial balance.

const TYPE_ORDER = ["asset", "liability", "equity", "income", "expense"] as const;

function typeHeading(t: LedgerT, type: TrialBalanceRow["type"]) {
  switch (type) {
    case "asset": return t("Assets");
    case "liability": return t("Liabilities");
    case "equity": return t("Equity");
    case "income": return t("Income");
    case "expense": return t("Expenses");
    default: return String(type);
  }
}

export function TrialBalanceView({ report, scope }: { report: TrialBalanceReport; scope: LedgerScope }) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const columns: StatementColumnHead[] = [
    { key: "opening", label: t("Opening") }, { key: "debit", label: t("Debit") }, { key: "credit", label: t("Credit") }, { key: "closing", label: t("Closing") }];
  const lines = useMemo(() => {
    const out: StatementLine[] = [];
    for (const type of TYPE_ORDER) {
      const rows = report.rows.filter((row) => row.type === type);
      if (!rows.length) continue;
      const heading = typeHeading(t, type);
      out.push({ key: `${type}:head`, kind: "heading", label: heading, values: [null, null, null, null] });
      for (const row of rows) out.push({ key: row.accountId || row.code, kind: "line", depth: 1, code: row.code,
        label: <AccountLink accountId={row.accountId || null} name={row.name} scope={scope} />, ...figures(format, [row.opening, row.debit, row.credit, row.closing]) });
      const sum = (pick: (row: TrialBalanceRow) => string) => rows.reduce((total, row) => addText(total, pick(row)), "0.0000");
      out.push({ key: `${type}:total`, kind: "subtotal", label: t("Total {section}", { section: heading.toLocaleLowerCase() }),
        ...figures(format, [sum((row) => row.opening), sum((row) => row.debit), sum((row) => row.credit), sum((row) => row.closing)]) });
    }
    out.push({ key: "total", kind: "result", label: t("Total"), ...figures(format, [report.totals.opening, report.totals.debit, report.totals.credit, report.totals.closing]) });
    return out;
  }, [report, scope, t, format]);
  return <div className={styles.stack}>
    {!report.balanced ? <InlineNotice tone="error" message={t("The trial balance doesn't balance. Check the journals that need attention.")} /> : null}
    {report.rows.length ? <StatementTable label={t("Trial balance")} labelHeader={t("Account")} columns={columns} lines={lines} />
      : <EmptyState title={t("No journals in this period")} description={t("Choose another period")} />}
  </div>;
}

/** Exact sum of two decimal texts (4 places), for subtotals laid out on the screen. */
function addText(left: string, right: string) {
  const units = (value: string) => {
    const match = /^(-)?(\d+)(?:\.(\d{1,4}))?$/.exec(value.trim());
    if (!match) return 0n;
    const amount = BigInt(match[2]) * 10_000n + BigInt((match[3] ?? "").padEnd(4, "0"));
    return match[1] ? -amount : amount;
  };
  const total = units(left) + units(right);
  const negative = total < 0n;
  const abs = negative ? -total : total;
  return `${negative ? "-" : ""}${abs / 10_000n}.${String(abs % 10_000n).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Balance sheet.

function sectionLabel(t: LedgerT, section: Pick<StatementSection, "key" | "label">) {
  switch (section.key) {
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

/** A balance sheet section: its heading, its sub-sections (opening to their accounts) and its total. */
function balanceSectionLines(t: LedgerT, format: LedgerFormat, scope: LedgerScope, section: StatementSection): StatementLine[] {
  const label = sectionLabel(t, section);
  const accountLine = (line: StatementSection["lines"][number], depth: number, index: number): StatementLine => ({
    key: `${section.key}:${line.accountId ?? index}`, kind: "line", depth, code: line.code,
    label: line.accountId ? <AccountLink accountId={line.accountId} name={line.name} scope={scope} /> : t(line.name), ...figures(format, [line.amount]) });
  return [
    { key: `${section.key}:head`, kind: "heading", label, values: [null] },
    ...section.sections.filter((child) => child.lines.length || child.total !== "0.0000").map((child) => ({
      key: child.key, kind: "line" as const, depth: 1, label: sectionLabel(t, child), ...figures(format, [child.total]),
      children: child.lines.map((line, index) => ({ ...accountLine(line, 2, index), key: `${child.key}:${line.accountId ?? index}` })),
    })),
    ...section.lines.map((line, index) => accountLine(line, 1, index)),
    { key: `${section.key}:total`, kind: "subtotal", label: t("Total {section}", { section: label.toLocaleLowerCase() }), ...figures(format, [section.total]) },
  ];
}

export function BalanceSheetView({ report, scope }: { report: BalanceSheetReport; scope: LedgerScope }) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const [assets, liabilities, equity] = report.sections;
  const lines: StatementLine[] = [
    ...[assets, liabilities, equity].filter(Boolean).flatMap((section) => balanceSectionLines(t, format, scope, section)),
    { key: "total", kind: "result", label: t("Total liabilities and equity"), ...figures(format, [report.totals.liabilitiesAndEquity]) },
  ];
  return <div className={styles.stack}>
    {!report.balanced ? <InlineNotice tone="error" message={t("Assets and liabilities with equity differ. Check the journals that need attention.")} /> : null}
    <StatementTable label={t("Balance sheet")} columns={[{ key: "amount", label: t("As at {date}", { date: format.day(report.scope.to) }) }]} lines={lines}
      defaultOpen={["current_assets", "non_current_assets", "current_liabilities", "non_current_liabilities"]} />
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

/**
 * Tax lines the return can't place for want of a region (neither the line nor the company has one): they're in no box,
 * so the boxes and the tax due leave them out. Said where the figures are read, with the way to fix it.
 */
export function MissingRegionNotice({ lines, label }: { lines: number; label: string | null }) {
  const t = useLedgerT();
  const region = label ? t(label) : t("Region");
  return <Callout tone="warning" title={lines === 1 ? t("1 tax line has no {region}", { region }) : t("{count} tax lines have no {region}", { count: lines, region })}
    actions={<Link className="wd-button" data-size="compact" data-variant="secondary" href={ledgerPaths.settings()}>{t("Set the {region}", { region })}</Link>}>
    {t("They're in no box, so the tax due leaves them out.")}
  </Callout>;
}

const VAT_SECTIONS: ReadonlyArray<readonly [VatBox["section"], string]> = [["sales", tKey("Sales")], ["purchases", tKey("Purchases")], ["net", tKey("Net tax")]];

export function VatView({ report, scope, api }: { report: VatReport; scope: LedgerScope; api: LedgerApi }) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const [open, setOpen] = useState<VatBox | null>(null);
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
  const unplaced = report.review.filter((item) => item.reason === "missing_region").length;
  const lines: StatementLine[] = VAT_SECTIONS.flatMap(([section, heading]) => {
    const boxes = report.boxes.filter((box) => box.section === section);
    if (!boxes.length) return [];
    return [{ key: `${section}:head`, kind: "heading" as const, label: t(heading), values: [null, null, null] },
      ...boxes.map((box): StatementLine => ({
        key: box.box, kind: box.box === "14" ? "result" : box.computed ? "subtotal" : "line", depth: box.computed ? 0 : 1, code: box.box,
        label: box.computed ? t(box.label) : <Button size="compact" variant="quiet" onPress={() => setOpen(box)}>{t(box.label)}</Button>,
        ...figures(format, [box.amount, box.vat, box.adjustment]),
      }))];
  });
  return <div className={styles.stack}>
    {unplaced ? <MissingRegionNotice lines={unplaced} label={report.layout.regionLabel} /> : null}
    <StatementTable label={t(report.layout.name)} labelHeader={t("Box")} lines={lines}
      columns={[{ key: "amount", label: t("Amount") }, { key: "vat", label: t("VAT") }, { key: "adjustment", label: t("Adjustment") }]} />
    {report.review.length ? <section className={styles.stack} aria-label={t("To review")}>
      <h2 className={styles.subhead}>{t("To review")}</h2>
      <DataGrid<VatReviewItem> rowNumbers={false} selectable={false} pageSize={500} ariaLabel={t("To review")} columns={reviewColumns} data={report.review}
        getRowId={(row) => `${row.reason}:${row.journalId}:${row.taxCode ?? ""}:${row.amount}`} exportFileName={`${report.entity.code}-vat-review-${report.scope.from}-${report.scope.to}.csv`} />
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
      : <DataGrid<VatBoxLine> rowNumbers={false} selectable={false} pageSize={2000} ariaLabel={t("Box {box}", { box: box.box })} columns={columns} data={lines.data?.lines ?? []}
        getRowId={(row) => row.lineId} isLoading={!lines.data} emptyContent={<EmptyState title={t("No lines in this box")} />} />}
  </InspectorSheet>;
}

// ---------------------------------------------------------------------------------------------------------------
// Ageing.

export function AgeingView({ report, scope }: { report: AgeingReport; scope: LedgerScope }) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const columns: StatementColumnHead[] = [...AGEING_LABELS.map(([bucket, label]) => ({ key: bucket, label: t(label) })), { key: "total", label: t("Total") }];
  const blank = AGEING_LABELS.map(() => null);
  const lines: StatementLine[] = [
    ...report.rows.map((row): StatementLine => ({ key: `${row.partyType}:${row.partyId}`, kind: "line", label: row.partyName || t("Unnamed"),
      ...figures(format, [...AGEING_LABELS.map(([bucket]) => row.buckets[bucket]), row.total]) })),
    { key: "total", kind: "subtotal", label: t("Total"), ...figures(format, [...AGEING_LABELS.map(([bucket]) => report.totals[bucket]), report.totals.total]) },
    ...(report.unlinked !== "0.0000" ? [{ key: "unlinked", kind: "line" as const, label: t("Not linked to a party"), values: [...blank, format.figure(report.unlinked)] }] : []),
    ...(report.control ? [{ key: "control", kind: "result" as const, code: report.control.code,
      label: <Link href={ledgerPaths.account(report.control.accountId, scope)}>{report.control.name}</Link>, values: [...blank, format.figure(report.control.balance)] }] : []),
  ];
  return <div className={styles.stack}>
    {!report.reconciled ? <InlineNotice tone="error" message={t("The parties don't add up to the control account.")} /> : null}
    {report.rows.length || report.unlinked !== "0.0000"
      ? <StatementTable label={report.side === "receivable" ? t("Receivables ageing") : t("Payables ageing")}
          labelHeader={report.side === "receivable" ? t("Client") : t("Supplier")} columns={columns} lines={lines} />
      : <EmptyState title={report.side === "receivable" ? t("Clients owe nothing") : t("Nothing is owed to suppliers")} />}
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
      meta: { renderCell: (row) => <span className={styles.cell}><span className={styles.row} data-kind={row.kind === "line" ? "line" : "total"}>
        {row.kind === "line" && row.description === row.sourceLabel ? <SourceLink href={row.sourceHref} label={row.sourceLabel} /> : row.description}</span>
        {row.partyName ? <small>{row.partyName}</small> : null}</span> } },
    { id: "source", header: t("Record"), accessorFn: (row) => row.sourceLabel, enableSorting: false, size: 200,
      meta: { interactive: true, renderCell: (row) => (row.kind === "line" && row.description !== row.sourceLabel ? <SourceLink href={row.sourceHref} label={row.sourceLabel} /> : null) } },
    moneyColumn<LedgerGridRow>("debit", t("Debit"), (row) => row.debit, format, true),
    moneyColumn<LedgerGridRow>("credit", t("Credit"), (row) => row.credit, format, true),
    moneyColumn<LedgerGridRow>("balance", t("Balance"), (row) => row.balance, format),
  ], [t, format, scope]);
  return <div className={styles.stack}>
    <FactTiles label={t("General ledger")} items={[
      { id: "account", label: t("Account"), value: `${report.account.code} ${report.account.name}` },
      { id: "opening", label: t("Opening"), value: format.money(report.opening) },
      { id: "closing", label: t("Closing"), value: format.money(report.closing) },
    ]} />
    <DataGrid<LedgerGridRow> rowNumbers={false} selectable={false} pageSize={2000} ariaLabel={t("General ledger")} columns={columns} data={rows} getRowId={(row) => row.lineId}
      exportFileName={`${report.entity.code}-general-ledger-${report.account.code}-${report.scope.from}-${report.scope.to}.csv`}
      emptyContent={<EmptyState title={t("No journals in this period")} />} />
  </div>;
}

/** The standard states around a report body. */
export function ReportState({ loading, error, onRetry, children }: { loading: boolean; error: string | null; onRetry: () => void; children: ReactNode }) {
  const t = useLedgerT();
  if (error) return <ErrorState title={t("This report didn't load")} description={t(error)} onRetry={onRetry} />;
  if (loading) return <Skeleton shape="rows" lines={10} />;
  return <>{children}</>;
}
