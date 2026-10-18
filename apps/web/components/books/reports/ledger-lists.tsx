"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { DataGrid, EmptyState, ErrorState, NoResultsState, RecordName, type DataGridColumn } from "@/design-system";
import { ledgerPaths, type AccountBalance, type AccountsList, type JournalList, type JournalSummary, type LedgerScope } from "@/lib/books/reports-client";
import { journalEventLabel } from "../journal-sheet";
import { useLedgerFormat, useLedgerT, type LedgerT } from "./ledger-format";
import { SourceLink } from "./report-views";
import styles from "./ledger.module.css";

/** The company's journals in the period, newest first; each opens its sheet. */
export function JournalsList({ list, error, scope, search, onSearch, onRetry, onOpen, toolbarLeading, onImportOpening }: {
  list: JournalList | null; error: string | null; scope: LedgerScope; search: string; onSearch: (value: string) => void; onRetry: () => void; onOpen: (journalId: string) => void;
  toolbarLeading?: ReactNode; /** The menu's "Import opening balances", for people who post journals. */ onImportOpening?: () => void;
}) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const columns = useMemo<DataGridColumn<JournalSummary>[]>(() => [
    { id: "journal", header: t("Journal"), accessorFn: (row) => row.number, size: 220,
      meta: { primary: true, renderCell: (row) => <RecordName title={row.number} detail={journalEventLabel(t, row)} /> } },
    { id: "date", header: t("Date"), accessorFn: (row) => row.journalDate, size: 130, meta: { renderCell: (row) => format.day(row.journalDate) } },
    { id: "source", header: t("Record"), accessorFn: (row) => row.sourceLabel, size: 260,
      meta: { interactive: true, renderCell: (row) => <span className={styles.cell}><SourceLink href={row.sourceHref} label={row.sourceLabel} />
        {row.description && row.description !== row.sourceLabel ? <small>{row.description}</small> : null}</span> } },
    { id: "total", header: t("Total"), accessorFn: (row) => row.total, size: 160,
      meta: { align: "end", renderCell: (row) => <span className={styles.money}>{format.amount(row.total)}</span> } },
  ], [t, format]);
  if (error && !list) return <ErrorState title={t("The journals didn't load")} description={t(error)} onRetry={onRetry} />;
  return <DataGrid<JournalSummary> gridKey="ledger.journals" ariaLabel={t("Journals")} columns={columns} data={list?.journals ?? []} getRowId={(row) => row.id}
    isLoading={!list} onRowAction={(row) => onOpen(row.id)} rowNumbers={false} selectable={false} pageSize={50}
    searchValue={search} onSearchChange={onSearch} searchLabel={t("Search journals")} totalRowCount={list?.total} toolbarLeading={toolbarLeading}
    menuActions={onImportOpening ? [{ id: "import-opening", label: t("Import opening balances") }] : undefined}
    onMenuAction={(id) => { if (id === "import-opening") onImportOpening?.(); }}
    exportFileName={`journals-${scope.from || "start"}-${scope.to || "today"}.csv`}
    emptyContent={search ? <NoResultsState onClear={() => onSearch("")} /> : <EmptyState title={t("No journals in this period")} />} />;
}

function typeLabel(t: LedgerT, type: AccountBalance["type"]) {
  switch (type) {
    case "asset": return t("Asset");
    case "liability": return t("Liability");
    case "equity": return t("Equity");
    case "income": return t("Income");
    case "expense": return t("Expense");
    default: return type;
  }
}

/** The company's chart of accounts with each account's balance for the period; each opens its ledger. */
export function AccountsTable({ list, error, scope, onRetry }: { list: AccountsList | null; error: string | null; scope: LedgerScope; onRetry: () => void }) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const [search, setSearch] = useState("");
  const needle = search.trim().toLocaleLowerCase();
  const rows = (list?.accounts ?? []).filter((row) => !needle || `${row.code} ${row.name}`.toLocaleLowerCase().includes(needle));
  const columns = useMemo<DataGridColumn<AccountBalance>[]>(() => [
    { id: "account", header: t("Account"), accessorFn: (row) => `${row.code} ${row.name}`, size: 320,
      meta: { primary: true, interactive: true, renderCell: (row) => <span className={styles.cell}>
        <Link className={styles.link} href={ledgerPaths.account(row.accountId, scope)}>{`${row.code} ${row.name}`}</Link>
        {row.archived ? <small>{t("Archived")}</small> : null}</span> } },
    { id: "type", header: t("Type"), accessorFn: (row) => typeLabel(t, row.type), size: 130 },
    { id: "opening", header: t("Opening"), accessorFn: (row) => row.opening, size: 150, enableSorting: false,
      meta: { align: "end", mobileHidden: true, renderCell: (row) => <span className={styles.money}>{format.amount(row.opening)}</span> } },
    { id: "closing", header: t("Balance"), accessorFn: (row) => row.closing, size: 160, enableSorting: false,
      meta: { align: "end", renderCell: (row) => <span className={styles.money}>{format.amount(row.closing)}</span> } },
  ], [t, format, scope]);
  if (error && !list) return <ErrorState title={t("The accounts didn't load")} description={t(error)} onRetry={onRetry} />;
  return <DataGrid<AccountBalance> gridKey="ledger.accounts" ariaLabel={t("Accounts")} columns={columns} data={rows} getRowId={(row) => row.accountId}
    isLoading={!list} rowNumbers={false} selectable={false} pageSize={500} searchValue={search} onSearchChange={setSearch} searchLabel={t("Search accounts")}
    exportFileName={`accounts-${list?.scope.to ?? "today"}.csv`}
    emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t("No accounts yet")} />} />;
}
