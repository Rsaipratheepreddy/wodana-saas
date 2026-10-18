"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DataGrid, EmptyState, ErrorState, IconMenuButton, Kanban, NoResultsState, RecordName, SegmentedControl, Skeleton, ToolbarSearch, type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { financeRequestsApi } from "@/lib/finance-requests/client";
import { REQUEST_STATUSES, type FinanceRequest, type FinanceRequestsBoard, type RequestKind, type RequestStatus } from "@/lib/finance-requests/types";
import { useProjectFormat } from "../project-core/format";
import { RequestStatusLabel, useKindLabels, useStatusLabels } from "./finance-request-labels";
import { RequestForm } from "./request-form";
import { RequestSettings } from "./request-settings";
import { RequestSheet } from "./request-sheet";
import styles from "./finance-requests.module.css";

type View = "list" | "board";
const OPEN: RequestStatus[] = ["new", "in_progress", "needs_info"];

/**
 * Finance › Requests (PLM-107): invoice, refund and payable requests, as a list or a board by status. Finance
 * sees every request and works them; everyone else sees their own and where each stands.
 */
export function FinanceRequests({ workspaceId, openId, onOpen, raising, onRaised }: {
  workspaceId: string; openId: string | null; onOpen: (id: string | null) => void; raising: boolean; onRaised: () => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const kinds = useKindLabels();
  const statuses = useStatusLabels();
  const api = useMemo(() => financeRequestsApi(workspaceId), [workspaceId]);
  const [board, setBoard] = useState<FinanceRequestsBoard | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("list");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<RequestKind | undefined>();
  const [status, setStatus] = useState<RequestStatus | undefined>();
  const [settings, setSettings] = useState(false);
  const load = useCallback(async () => {
    try { setBoard(await api.board()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Requests didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const needle = search.trim().toLocaleLowerCase();
  const rows = (board?.requests ?? []).filter((request) => (!kind || request.kind === kind) && (!status || request.status === status)
    && (!needle || [request.reference, request.clientName, request.supplierName, request.requesterName, request.projectReference, request.opportunityReference, request.financeReference]
      .filter(Boolean).join(" ").toLocaleLowerCase().includes(needle)))
    // Open requests first, the oldest waiting at the top; then the closed ones, newest first.
    .sort((a, b) => Number(OPEN.includes(b.status)) - Number(OPEN.includes(a.status))
      || (OPEN.includes(a.status) ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)));
  const amount = (request: FinanceRequest) => format.money(request.kind === "payable" && request.payNow ? request.payNow : request.total, request.currency);
  const who = (request: FinanceRequest) => (request.kind === "payable" ? request.supplierName : request.clientName) ?? "";
  const detail = (request: FinanceRequest) => [request.reference, kinds[request.kind], request.projectReference ?? request.opportunityReference].filter(Boolean).join(" · ");
  const flag = (request: FinanceRequest) => (request.approvalStatus === "pending" ? t("Waiting for approval") : request.invoicePending && request.status !== "rejected" ? t("Invoice pending") : null);

  const columns: DataGridColumn<FinanceRequest>[] = [
    { id: "request", header: t("Request"), accessorFn: (row) => who(row), size: 300, meta: { primary: true, renderCell: (row) => <RecordName title={who(row)} detail={detail(row)} /> } },
    { id: "requester", header: t("Requested by"), accessorFn: (row) => row.requesterName, size: 180, meta: { mobileHidden: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.requesterName}</span><small>{format.when(row.createdAt)}</small></span> } },
    { id: "amount", header: t("Amount"), accessorFn: (row) => Number(row.total), size: 150, meta: { align: "end", renderCell: (row) => <span className={styles.money}>{amount(row)}</span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, size: 180, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <RequestStatusLabel status={row.status} />{flag(row) ? <small>{flag(row)}</small> : null}</span> } },
  ];

  if (error && !board) return <ErrorState description={error} onRetry={() => void load()} />;
  const switcher = <SegmentedControl label={t("View")} value={view} onChange={(value) => setView(value as View)} options={[{ id: "list", label: t("List") }, { id: "board", label: t("Board") }]} />;
  const more = board?.canManage ? <IconMenuButton ariaLabel={t("Request actions")} items={[{ id: "settings", label: t("Settings") }]} onAction={() => setSettings(true)} /> : null;
  const empty = needle || kind || status ? <NoResultsState onClear={() => { setSearch(""); setKind(undefined); setStatus(undefined); }} />
    : <EmptyState title={t("No requests yet")} description={t("Ask Finance for an invoice, a refund or a supplier payment.")} />;
  return <>
    {view === "list" ? <DataGrid<FinanceRequest> ariaLabel={t("Finance requests")} columns={columns} data={rows} getRowId={(row) => row.id} isLoading={!board}
      onRowAction={(row) => onOpen(row.id)} onSearchChange={setSearch} searchValue={search} searchLabel={t("Search requests")} rowNumbers={false}
      toolbarLeading={switcher} toolbarActions={more}
      filters={[
        { id: "kind", label: t("Kind"), value: kind, onChange: (value) => setKind(value as RequestKind | undefined), options: (["invoice", "refund", "payable"] as const).map((id) => ({ id, label: kinds[id] })) },
        { id: "status", label: t("Status"), value: status, onChange: (value) => setStatus(value as RequestStatus | undefined), options: REQUEST_STATUSES.map((id) => ({ id, label: statuses[id] })) },
      ]}
      emptyContent={empty} />
      : <>
        <div className={styles.actions}>{switcher}<span className={styles.spacer} /><ToolbarSearch label={t("Search requests")} value={search} onChange={setSearch} />{more}</div>
        {!board ? <Skeleton shape="rows" lines={4} /> : !rows.length ? empty
          : <Kanban<FinanceRequest> label={t("Finance requests")} columns={REQUEST_STATUSES.map((id) => ({ id, label: statuses[id], items: rows.filter((row) => row.status === id) }))}
            getId={(row) => row.id} getLabel={(row) => `${row.reference} ${who(row)}`} onItemAction={(row) => onOpen(row.id)}
            renderItem={(row) => <div className={styles.card}><strong>{who(row)}</strong><span className={styles.money}>{amount(row)}</span>
              <small>{[detail(row), row.requesterName, flag(row)].filter(Boolean).join(" · ")}</small></div>} />}
      </>}
    {openId ? <RequestSheet api={api} id={openId} onChanged={() => void load()} onClose={() => onOpen(null)} /> : null}
    {raising ? <RequestForm api={api} onClose={onRaised} onSaved={(saved) => { onRaised(); void load(); onOpen(saved.request.id); }} /> : null}
    {settings ? <RequestSettings api={api} onClose={() => setSettings(false)} /> : null}
  </>;
}
