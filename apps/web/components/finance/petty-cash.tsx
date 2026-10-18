"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApprovalStamp, Button, DataGrid, EditableFieldList, EmptyState, ErrorState, FactRow, InlineNotice, InspectorSheet, ListTabs, NoResultsState, RecordName, ReviewFiles, TextInput, type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { pettyCashApi, type PettyCashApi } from "@/lib/petty-cash/client";
import type { PettyCashClaim, PettyCashPayables } from "@/lib/petty-cash/types";
import { ClaimStatusLabel, useCategoryLabels } from "../petty-cash/petty-cash-labels";
import { useProjectFormat } from "../project-core/format";
import styles from "./finance.module.css";

type Show = "open" | "all";

/** Petty cash for the people who pay: approved claims to reimburse (oldest decision first), and those reimbursed. */
export function PettyCash({ workspaceId, openId, onOpen }: { workspaceId: string; openId: string | null; onOpen: (id: string | null) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const api = useMemo(() => pettyCashApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<PettyCashPayables | null>(null);
  const [error, setError] = useState("");
  const [show, setShow] = useState<Show>("open");
  const [search, setSearch] = useState("");
  const load = useCallback(async () => {
    try { setState(await api.payables()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Petty cash didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const needle = search.trim().toLocaleLowerCase();
  const rows = (state?.claims ?? []).filter((claim) => (show === "all" || claim.status === "approved")
    && (!needle || `${claim.reference} ${claim.description} ${claim.claimedByName} ${claim.projectReference}`.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => (show === "open" ? (a.decidedAt ?? "").localeCompare(b.decidedAt ?? "") : 0));
  const columns = useMemo<DataGridColumn<PettyCashClaim>[]>(() => [
    { id: "claim", header: t("Claim"), accessorFn: (row) => row.description, size: 300, meta: { primary: true, renderCell: (row) => <RecordName title={row.description} detail={[row.reference, format.day(row.spentOn), `${row.projectReference} · ${row.projectName}`].join(" · ")} /> } },
    { id: "claimant", header: t("Pay to"), accessorFn: (row) => row.claimedByName, size: 200, meta: { mobileHidden: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.claimedByName}</span>{row.decidedByName ? <small>{t("Approved by {name}", { name: row.decidedByName })}</small> : null}</span> } },
    { id: "amount", header: t("Amount"), accessorFn: (row) => Number(row.amount), size: 150, meta: { align: "end", renderCell: (row) => <span className={styles.money}>{format.money(row.amount, row.currency)}</span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, size: 150, meta: { renderCell: (row) => <ClaimStatusLabel status={row.status} /> } },
  ], [t, format]);
  if (error && !state) return <ErrorState description={error} onRetry={() => void load()} />;
  const open = state?.claims.find((claim) => claim.id === openId) ?? null;
  return <>
    <DataGrid<PettyCashClaim> ariaLabel={t("Petty cash")} columns={columns} data={rows} getRowId={(row) => row.id} isLoading={!state} onRowAction={(row) => onOpen(row.id)}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search claims")} rowNumbers={false}
      toolbarLeading={<ListTabs label={t("Show")} value={show} onChange={setShow} items={[{ id: "open", label: t("To reimburse") }, { id: "all", label: t("All") }]} />}
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={show === "open" ? t("Nothing to reimburse") : t("No petty cash yet")} />} />
    {state && open ? <ReimburseSheet api={api} claim={open} canReimburse={state.canReimburse} onChanged={setState} onClose={() => onOpen(null)} /> : null}
  </>;
}

/** One approved claim: what it was for and its receipt; paid back to its claimant with the payment's reference. */
function ReimburseSheet({ api, claim, canReimburse, onChanged, onClose }: {
  api: PettyCashApi; claim: PettyCashClaim; canReimburse: boolean; onChanged: (state: PettyCashPayables) => void; onClose: () => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const categories = useCategoryLabels();
  const [reference, setReference] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const paying = canReimburse && claim.status === "approved";
  return <InspectorSheet isOpen size="md" title={`${claim.reference} · ${claim.claimedByName}`} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={paying ? <div className="wd-dialog-actions"><span className={styles.spacer} />
      <Button variant="primary" isLoading={busy} onPress={async () => {
        setBusy(true); setNotice("");
        try { onChanged(await api.reimburse({ claimId: claim.id, version: claim.version, reference: reference.trim() })); }
        catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); }
        setBusy(false);
      }}>{t("Reimburse")}</Button></div> : null}>
    <div className={styles.sheet}>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      <EditableFieldList>
        <FactRow label={t("Status")}><ClaimStatusLabel status={claim.status} /></FactRow>
        <FactRow label={t("Amount")}><span className={styles.money}>{format.money(claim.amount, claim.currency)}</span></FactRow>
        <FactRow label={t("What for")}>{claim.description}</FactRow>
        <FactRow label={t("Project")}>{`${claim.projectReference} · ${claim.projectName}`}</FactRow>
        <FactRow label={t("Spent on")}>{format.day(claim.spentOn)}</FactRow>
        <FactRow label={t("Kind")}>{categories[claim.category]}</FactRow>
        {claim.reimbursedAt ? <FactRow label={t("Reimbursed")}>{[format.when(claim.reimbursedAt), claim.reimbursedByName, claim.reimbursementReference].filter(Boolean).join(" · ")}</FactRow> : null}
      </EditableFieldList>
      {claim.decidedByName ? <div><ApprovalStamp approvedBy={claim.decidedByName} date={claim.decidedAt ? format.when(claim.decidedAt) : "—"} /></div> : null}
      <ReviewFiles label={t("Receipt")} files={claim.receiptName ? [{ id: claim.id, name: claim.receiptName, href: api.receiptUrl(claim.id) }] : []}
        empty={<span className={styles.muted}>{t("None: {reason}", { reason: claim.noReceiptReason })}</span>} />
      {paying ? <TextInput label={t("Reference")} value={reference} onChange={setReference} /> : null}
    </div>
  </InspectorSheet>;
}
