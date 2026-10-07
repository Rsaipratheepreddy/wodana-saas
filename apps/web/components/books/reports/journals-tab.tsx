"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DataGrid, EmptyState, ErrorState, InspectorSheet, ListTabs, RecordName, Tag, type DataGridColumn } from "@/design-system";
import { ledgerPaths, type LedgerApi, type LedgerScope, type ReportEntity } from "@/lib/books/reports-client";
import { manualJournalsApi, type ManualJournalRow } from "@/lib/books/settings-client";
import { ManualJournalEditor, OpeningBalanceImport } from "../journals";
import { LedgerRegion, useLedgerFormat, useLedgerT, type LedgerT } from "./ledger-format";
import { JournalsList } from "./ledger-lists";
import { ReportPicker } from "./report-picker";
import { useLoad } from "./use-load";
import styles from "./ledger.module.css";

export type JournalsView = "posted" | "manual";
/** What the Journals tab has open: the editor for a new or existing manual journal, or the opening balance import. */
export type JournalsSheet = { kind: "editor"; journalId: string | null } | { kind: "opening" } | null;

function manualStatus(t: LedgerT, status: ManualJournalRow["status"]) {
  switch (status) {
    case "draft": return t("Draft");
    case "submitted": return t("Waiting for approval");
    case "returned": return t("Sent back");
    case "approved": return t("Posted");
    case "cancelled": return t("Cancelled");
    default: return String(status);
  }
}

/**
 * Journals: what is posted (from records, manual and opening journals, reversals), filtered to one project when
 * project profit links here, and the manual journals being prepared or approved (A2's editor and opening import).
 */
export function JournalsTab({ api, workspaceId, canPost, scope, entities, project, view, sheet, onScope, onView, onSheet, onClearProject, onOpen }: {
  api: LedgerApi; workspaceId: string; canPost: boolean; scope: LedgerScope; entities: ReportEntity[]; project: string; view: JournalsView; sheet: JournalsSheet;
  onScope: (next: Partial<LedgerScope>) => void; onView: (view: JournalsView) => void; onSheet: (sheet: JournalsSheet) => void; onClearProject: () => void;
  onOpen: (journalId: string) => void;
}) {
  const t = useLedgerT();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  const posted = useLoad(view === "posted" ? `journals|${scope.entity}|${scope.from}|${scope.to}|${query}|${project}|${version}` : null,
    (signal) => api.journals(scope, query, project, signal));
  const entity = entities.find((item) => item.id === (scope.entity || posted.stale?.entity.id)) ?? posted.stale?.entity ?? entities[0] ?? null;
  const manualApi = useMemo(() => manualJournalsApi(workspaceId), [workspaceId]);
  const manual = useLoad(view === "manual" && entity ? `manual|${entity.id}|${version}` : null, () => manualApi.list(entity!.id));
  const shown: LedgerScope = { entity: scope.entity || entity?.id || "", from: scope.from || posted.stale?.scope.from || "", to: scope.to || posted.stale?.scope.to || "" };
  const tabs = <ListTabs<JournalsView> label={t("Show")} value={view} onChange={onView} items={[{ id: "posted", label: t("Posted") }, { id: "manual", label: t("Manual journals") }]} />;
  const done = () => setVersion((value) => value + 1);
  return <LedgerRegion entity={entity}>
    {view === "posted" ? <ReportPicker entities={entities} entity={entity} scope={shown} onScope={onScope} /> : null}
    {project && view === "posted" ? <div className={styles.picker}><Tag onRemove={onClearProject}>{t("One project's journals")}</Tag></div> : null}
    {view === "posted"
      ? <JournalsList list={posted.data ?? (posted.loading ? null : posted.stale)} error={posted.error} scope={shown} search={search} onSearch={setSearch} onRetry={posted.reload}
          onOpen={onOpen} toolbarLeading={tabs} onImportOpening={canPost && entity ? () => onSheet({ kind: "opening" }) : undefined} />
      : <ManualJournals rows={manual.data?.journals ?? null} error={manual.error} onRetry={manual.reload} scope={shown} toolbarLeading={tabs}
          onOpen={(journalId) => onSheet({ kind: "editor", journalId })} onImportOpening={canPost && entity ? () => onSheet({ kind: "opening" }) : undefined} />}
    {sheet && entity ? <InspectorSheet isOpen size="lg" title={sheet.kind === "opening" ? t("Import opening balances") : t("Manual journal")}
      onOpenChange={(open) => { if (!open) { onSheet(null); done(); } }}>
      {sheet.kind === "opening"
        ? <OpeningBalanceImport workspaceId={workspaceId} legalEntityId={entity.id} onDone={() => { onSheet(null); onView("manual"); done(); }} />
        : <ManualJournalEditor workspaceId={workspaceId} legalEntityId={entity.id} journalId={sheet.journalId} onDone={done} />}
    </InspectorSheet> : null}
  </LedgerRegion>;
}

const IMPORT = "import-opening";

function ManualJournals({ rows, error, onRetry, scope, toolbarLeading, onOpen, onImportOpening }: {
  rows: ManualJournalRow[] | null; error: string | null; onRetry: () => void; scope: LedgerScope; toolbarLeading: ReactNode;
  onOpen: (journalId: string) => void; onImportOpening?: () => void;
}) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const columns = useMemo<DataGridColumn<ManualJournalRow>[]>(() => [
    { id: "reference", header: t("Journal"), accessorFn: (row) => row.reference, size: 200,
      meta: { primary: true, renderCell: (row) => <RecordName title={row.reference} detail={row.kind === "opening" ? t("Opening balance") : row.memo || null} /> } },
    { id: "date", header: t("Date"), accessorFn: (row) => row.journalDate, size: 130, meta: { renderCell: (row) => format.day(row.journalDate) } },
    { id: "status", header: t("Status"), accessorFn: (row) => manualStatus(t, row.status), size: 190,
      meta: { interactive: true, renderCell: (row) => <span className={styles.cell}><span>{manualStatus(t, row.status)}</span>
        {row.postedJournalId && row.postedNumber ? <Link className={styles.link} href={ledgerPaths.journal(row.postedJournalId, scope)}>{row.postedNumber}</Link>
          : <small>{row.preparedByName}</small>}</span> } },
    { id: "total", header: t("Total"), accessorFn: (row) => row.debit, size: 160,
      meta: { align: "end", renderCell: (row) => <span className={styles.money}>{format.amount(row.debit)}</span> } },
  ], [t, format, scope]);
  if (error && !rows) return <ErrorState title={t("The journals didn't load")} description={t(error)} onRetry={onRetry} />;
  return <DataGrid<ManualJournalRow> gridKey="ledger.manual-journals" ariaLabel={t("Manual journals")} columns={columns} data={rows ?? []} getRowId={(row) => row.id}
    isLoading={!rows} onRowAction={(row) => onOpen(row.id)} rowNumbers={false} selectable={false} pageSize={50} toolbarLeading={toolbarLeading}
    menuActions={onImportOpening ? [{ id: IMPORT, label: t("Import opening balances") }] : undefined} onMenuAction={(id) => { if (id === IMPORT) onImportOpening?.(); }}
    emptyContent={<EmptyState title={t("No manual journals yet")} />} />;
}
