"use client";

import Link from "next/link";
import { useMemo } from "react";
import { DataGrid, ErrorState, InspectorSheet, Skeleton, type DataGridColumn } from "@/design-system";
import { ledgerPaths, type JournalDetail, type JournalLine, type LedgerApi, type LedgerScope } from "@/lib/books/reports-client";
import { LedgerRegion, useLedgerFormat, useLedgerT, type LedgerT } from "./reports/ledger-format";
import { SourceLink } from "./reports/report-views";
import { useLoad } from "./reports/use-load";
import { fromUnits, lineTotals } from "./journals/journal-amounts";
import styles from "./reports/ledger.module.css";

export function journalKindLabel(t: LedgerT, kind: string) {
  switch (kind) {
    case "auto": return t("Posted from a record");
    case "manual": return t("Manual journal");
    case "opening": return t("Opening balance");
    case "reversal": return t("Reversal");
    default: return kind;
  }
}

/** What a journal records, in a few words: the event of the record it was posted from, else its kind. */
export function journalEventLabel(t: LedgerT, journal: { kind: string; sourceType: string; sourceEvent: string }) {
  if (journal.kind !== "auto") return journalKindLabel(t, journal.kind);
  switch (`${journal.sourceType}:${journal.sourceEvent}`) {
    case "client_invoice:issued": return t("Invoice issued");
    case "client_credit_note:issued": return t("Credit note issued");
    case "receipt:verified": return t("Client payment received");
    case "receipt:reversed": return t("Client payment reversed");
    case "supplier_bill:approved": return t("Supplier bill approved");
    case "supplier_bill:cancelled": return t("Supplier bill cancelled");
    case "supplier_payment:paid": return t("Supplier paid");
    case "supplier_payment:reversed": return t("Supplier payment reversed");
    case "goods_receipt:received": return t("Services received");
    case "goods_receipt:reversed": return t("Delivery reversed");
    case "stock_batch:moved": return t("Stock moved");
    case "petty_cash:approved": return t("Petty cash approved");
    case "petty_cash:reimbursed": return t("Petty cash repaid");
    case "labour:costed": case "labour:recosted": return t("Labour costed");
    default: return journalKindLabel(t, journal.kind);
  }
}

/**
 * One posted journal: its number, dates, the record it came from (opens that record's own page), its reversal and
 * its lines, each account opening its ledger. Journals never change; a correction is a reversal, linked both ways.
 */
export function JournalSheet({ api, journalId, scope, onClose }: { api: LedgerApi; journalId: string; scope: LedgerScope; onClose: () => void }) {
  const t = useLedgerT();
  const load = useLoad(journalId, (signal) => api.journal(journalId, signal));
  const detail = load.data;
  return <InspectorSheet isOpen size="lg" title={detail?.journal.number ?? t("Journal")} onOpenChange={(value) => { if (!value) onClose(); }}>
    {load.error ? <ErrorState title={t("This journal didn't load")} description={t(load.error)} onRetry={load.reload} />
      : !detail ? <Skeleton shape="facts" lines={8} />
      : <LedgerRegion entity={detail.entity}><JournalBody detail={detail} scope={{ ...scope, entity: detail.entity.id }} /></LedgerRegion>}
  </InspectorSheet>;
}

function JournalBody({ detail, scope }: { detail: JournalDetail; scope: LedgerScope }) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const { journal } = detail;
  const columns = useMemo<DataGridColumn<JournalLine>[]>(() => [
    { id: "account", header: t("Account"), accessorFn: (row) => `${row.accountCode} ${row.accountName}`, enableSorting: false, size: 260,
      meta: { primary: true, interactive: true, renderCell: (row) => row.id === TOTAL_ID ? <span className={styles.row} data-kind="total">{row.accountName}</span> : <span className={styles.cell}>
        <Link className={styles.link} href={ledgerPaths.account(row.accountId, scope)}>{`${row.accountCode} ${row.accountName}`}</Link>
        <small>{[row.description, row.partyName, row.projectName, row.taxCode ? [row.taxCode, row.taxRegion].filter(Boolean).join(" ") : null].filter(Boolean).join(" · ")}</small>
      </span> } },
    { id: "debit", header: t("Debit"), accessorFn: (row) => row.debit, enableSorting: false, size: 140,
      meta: { align: "end", renderCell: (row) => <span className={styles.money}>{format.amountOrBlank(row.debit)}</span> } },
    { id: "credit", header: t("Credit"), accessorFn: (row) => row.credit, enableSorting: false, size: 140,
      meta: { align: "end", renderCell: (row) => <span className={styles.money}>{format.amountOrBlank(row.credit)}</span> } },
  ], [t, format, scope]);
  return <div className={styles.sheet}>
    <dl className={styles.facts}>
      <div><dt>{t("Date")}</dt><dd>{format.day(journal.journalDate)}{journal.late ? ` · ${t("Happened {date}, after the books were locked", { date: format.day(journal.eventDate) })}` : ""}</dd></div>
      <div><dt>{t("Kind")}</dt><dd>{journalEventLabel(t, journal)}</dd></div>
      {journal.sourceLabel || journal.sourceHref ? <div><dt>{t("Record")}</dt><dd><SourceLink href={journal.sourceHref} label={journal.sourceLabel} /></dd></div> : null}
      {journal.description && journal.description !== journal.sourceLabel ? <div><dt>{t("Description")}</dt><dd>{journal.description}</dd></div> : null}
      <div><dt>{t("Total")}</dt><dd className={styles.money}>{format.money(journal.total)}</dd></div>
      {journal.currency !== journal.functionalCurrency ? <div><dt>{t("Rate")}</dt><dd>{`1 ${journal.currency} = ${journal.rate} ${journal.functionalCurrency}`}</dd></div> : null}
      {journal.reversesJournalId ? <div><dt>{t("Reverses")}</dt><dd><Link className={styles.link} href={ledgerPaths.journal(journal.reversesJournalId, scope)}>{t("The journal it reverses")}</Link></dd></div> : null}
      {journal.reversedByJournalId ? <div><dt>{t("Reversed by")}</dt><dd><Link className={styles.link} href={ledgerPaths.journal(journal.reversedByJournalId, scope)}>{t("The reversal")}</Link></dd></div> : null}
      {journal.postedByName ? <div><dt>{t("Posted by")}</dt><dd>{journal.postedByName}</dd></div> : null}
    </dl>
    <DataGrid<JournalLine> rowNumbers={false} selectable={false} pageSize={500} ariaLabel={t("Journal lines")} columns={columns} data={[...detail.lines, totalLine(t, detail)]} getRowId={(row) => row.id}
      showToolbar={false} totalRowCount={detail.lines.length}
      exportFileName={`${journal.number}.csv`} />
  </div>;
}

const TOTAL_ID = "__total";

/** The journal's totals as a last line: Σ debit and Σ credit (always equal: the database refuses a journal that isn't). */
function totalLine(t: LedgerT, detail: JournalDetail): JournalLine {
  const { debit, credit } = lineTotals(detail.lines);
  return { id: TOTAL_ID, position: Number.MAX_SAFE_INTEGER, accountId: "", accountCode: "", accountName: t("Total"), debit: fromUnits(debit), credit: fromUnits(credit),
    docAmount: null, description: "", projectId: null, projectName: null, partyType: null, partyId: null, partyName: null, taxCode: null, taxBase: null, taxRegion: null };
}
