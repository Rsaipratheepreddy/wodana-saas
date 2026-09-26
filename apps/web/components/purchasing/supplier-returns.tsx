"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, ControlledModalDialog, DataGrid, EmptyState, ErrorState, InlineNotice, InspectorSheet, NoResultsState, Skeleton, TextAreaField, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PurchasingApi } from "@/lib/purchasing/client";
import { addExact } from "@/lib/purchasing/amounts";
import type { SupplierReturnRow, SupplierReturnState } from "@/lib/purchasing/types";
import { useProjectFormat } from "../project-core/format";
import { quantityText, useOrderLabels } from "./order-labels";
import styles from "./purchasing.module.css";

/** A return's state as a dot and a word: waiting for the supplier to collect, gone back, or cancelled. */
export function ReturnStatus({ row }: { row: Pick<SupplierReturnRow, "status"> }) {
  const t = useT();
  const label = row.status === "open" ? t("Waiting for pickup") : row.status === "sent" ? t("Gone back") : t("Cancelled");
  return <span className={styles.orderStatus} data-status={row.status === "open" ? "pending_approval" : row.status === "sent" ? "confirmed" : "cancelled"}>{label}</span>;
}

/** Goods going back to suppliers, the ones waiting for pickup first. A row opens the return. */
export function SupplierReturns({ api, rows, search, onSearch, toolbar, onOpen }: {
  api: PurchasingApi; rows: SupplierReturnRow[] | null; search: string; onSearch: (value: string) => void; toolbar: React.ReactNode; onOpen: (id: string) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  void api;
  const columns = useMemo<DataGridColumn<SupplierReturnRow>[]>(() => [
    { id: "number", header: t("Return"), accessorFn: (row) => row.number, size: 220, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{t("Return {number}", { number: row.number })}</span><small>{`${row.orderNumber} · ${row.supplierName}`}</small></span> } },
    { id: "outcome", header: t("Supplier"), accessorFn: (row) => row.outcome, size: 170, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.outcome === "replace" ? t("Replaces them") : t("Credits them")}</span>
      {row.credit ? <small>{format.money(row.credit, row.currency)}</small> : null}</span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, size: 170, meta: { renderCell: (row) => <ReturnStatus row={row} /> } },
    { id: "raised", header: t("Raised"), accessorFn: (row) => row.createdAt, size: 170, meta: { mobileHidden: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{format.when(row.createdAt)}</span><small>{row.createdByName}</small></span> } },
  ], [t, format]);
  const shown = (rows ?? []).filter((row) => !search.trim() || `${row.number} ${row.orderNumber} ${row.supplierName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <DataGrid<SupplierReturnRow> appearance="flush" ariaLabel={t("Returns")} columns={columns} data={shown} getRowId={(row) => row.id} isLoading={!rows} onRowAction={(row) => onOpen(row.id)}
    onSearchChange={onSearch} searchValue={search} searchLabel={t("Search deliveries")} toolbarLeading={toolbar} rowNumbers={false} selectable={false} wrapText
    emptyContent={search.trim() ? <NoResultsState onClear={() => onSearch("")} /> : <EmptyState title={t("No returns")} description={t("Return goods to the supplier from a delivery.")} />} />;
}

/** One return: what goes back and why; the supplier collecting it (accepted goods leave stock), or cancelling it before. */
export function ReturnSheet({ api, returnId, onChanged, onClose, onOpenOrder }: { api: PurchasingApi; returnId: string; onChanged: () => void; onClose: () => void; onOpenOrder: (orderId: string) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const labels = useOrderLabels();
  const [state, setState] = useState<SupplierReturnState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const load = useCallback(async () => {
    try { setState(await api.supplierReturn(returnId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The return didn't load.")); }
  }, [api, returnId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const run = async (action: string, input: Record<string, unknown> = {}) => {
    if (!state) return false;
    setBusy(true); setNotice("");
    try { setState(await api.returnCommand(returnId, state.return.version, action, input)); onChanged(); return true; }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); if (cause instanceof Error && "status" in cause && cause.status === 409) await load(); return false; }
    finally { setBusy(false); }
  };
  const row = state?.return;
  return <InspectorSheet isOpen size="lg" title={row ? t("Return {number}", { number: row.number }) : t("Return")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={state && (state.canSendThis || state.canCancelThis) ? <div className="wd-dialog-actions">
      {state.canCancelThis ? <Button variant="quiet" onPress={() => setCancelling(true)}>{t("Cancel return")}</Button> : null}<span className={styles.spacer} />
      {state.canSendThis ? <Button variant="primary" isLoading={busy} onPress={() => void run("sent")}>{t("Collected by the supplier")}</Button> : null}
    </div> : null}>
    {error && !state ? <ErrorState description={error} onRetry={() => void load()} /> : !state || !row ? <Skeleton lines={6} /> : <div className={styles.sheet}>
      <div className={styles.approvalRow}>
        <ReturnStatus row={row} />
        <span className={styles.muted}>{`${row.supplierName} · ${row.outcome === "replace" ? t("Replaces them") : t("Credits them")}`}</span>
        <Button size="compact" variant="quiet" onPress={() => onOpenOrder(row.orderId)}>{row.orderNumber}</Button>
      </div>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      {state.delivery && state.delivery !== "sent" ? <InlineNotice tone="info" message={t("The email didn't go. Send the return note to the supplier yourself.")} /> : null}
      {row.status === "cancelled" ? <InlineNotice tone="info" message={t("Cancelled: {reason}", { reason: row.cancelReason ?? "" })} /> : null}
      <dl className={styles.facts}>
        <div><dt>{t("From")}</dt><dd>{row.locationName}</dd></div>
        <div><dt>{t("Raised")}</dt><dd>{[format.when(row.createdAt), row.createdByName].join(" · ")}</dd></div>
        {row.sentOn ? <div><dt>{t("Collected")}</dt><dd>{[format.day(row.sentOn), row.sentByName].join(" · ")}</dd></div> : null}
        {row.credit ? <div><dt>{t("Credit due")}</dt><dd>{format.money(row.credit, row.currency)}</dd></div> : null}
      </dl>
      <section className={styles.part} aria-label={t("Lines")}>
        <div className={styles.receiveLines} role="table" aria-label={t("Lines")} data-columns="3">
          <div role="row" className={styles.receiveHead}><span role="columnheader">{t("Item")}</span><span role="columnheader">{t("Quantity")}</span><span role="columnheader">{t("Credit")}</span></div>
          {state.lines.map((line) => <div role="row" key={line.id} className={styles.receiveLine}>
            <span role="cell" className={styles.nameCell}><span>{line.description}</span>
              <small>{[labels.rejectKind[line.reasonKind], line.reason].join(": ")}</small>
              <small>{[line.source === "rejected" ? t("Rejected at delivery") : t("Accepted, found wrong later"), t("Delivery {number}", { number: line.receiptNumber })].join(" · ")}</small></span>
            <span role="cell" className={styles.money}>{`${quantityText(line.quantity)} ${line.unit}`.trim()}</span>
            <span role="cell" className={styles.money}>{line.creditAmount ? format.money(addExact(line.creditAmount, line.creditTax), row.currency) : "—"}</span>
          </div>)}
        </div>
      </section>
      {row.note ? <p className={styles.dialogText}>{row.note}</p> : null}
    </div>}
    {cancelling ? <CancelReturn onClose={() => setCancelling(false)} onSave={async (reason) => { if (await run("cancel", { reason })) setCancelling(false); }} /> : null}
  </InspectorSheet>;
}

function CancelReturn({ onClose, onSave }: { onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Cancel return")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Back")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!reason.trim()} onPress={async () => { setBusy(true); await onSave(reason.trim()); setBusy(false); }}>{t("Cancel return")}</Button></div>}>
    <TextAreaField label={t("Why it's cancelled")} isRequired value={reason} onChange={setReason} />
  </ControlledModalDialog>;
}
