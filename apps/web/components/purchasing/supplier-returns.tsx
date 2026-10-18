"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, DataGrid, EditableFieldList, EmptyState, ErrorState, FactRow, InlineNotice, InspectorSheet, NoResultsState, ReasonDialog, Skeleton, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PurchasingApi } from "@/lib/purchasing/client";
import { addExact } from "@/lib/purchasing/amounts";
import type { SupplierReturnLine, SupplierReturnRow, SupplierReturnState } from "@/lib/purchasing/types";
import { useProjectFormat } from "../project-core/format";
import { quantityText, useOrderLabels } from "./order-labels";
import styles from "./purchasing.module.css";

/** A return's state as a dot and a word: waiting for the supplier to collect, gone back, or cancelled. */
export function ReturnStatus({ row }: { row: Pick<SupplierReturnRow, "status"> }) {
  const t = useT();
  const label = row.status === "open" ? t("Waiting for pickup") : row.status === "sent" ? t("Gone back") : t("Cancelled");
  return <Badge tone={row.status === "open" ? "warning" : row.status === "sent" ? "success" : "neutral"}>{label}</Badge>;
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
  return <DataGrid<SupplierReturnRow> ariaLabel={t("Returns")} columns={columns} data={shown} getRowId={(row) => row.id} isLoading={!rows} onRowAction={(row) => onOpen(row.id)}
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
  const run = async (action: string, input: Record<string, unknown> = {}, inDialog = false) => {
    if (!state) return false;
    setBusy(true); setNotice("");
    try { setState(await api.returnCommand(returnId, state.return.version, action, input)); onChanged(); return true; }
    catch (cause) {
      if (cause instanceof Error && "status" in cause && cause.status === 409) await load();
      if (inDialog) throw cause;
      setNotice(cause instanceof Error ? cause.message : t("Could not save.")); return false;
    }
    finally { setBusy(false); }
  };
  const row = state?.return;
  const lineColumns: DataGridColumn<SupplierReturnLine>[] = [
    { id: "item", header: t("Item"), size: 260, accessorFn: (line) => line.description, meta: { renderCell: (line) => <span className={styles.nameCell}><span>{line.description}</span>
      <small>{[labels.rejectKind[line.reasonKind], line.reason].join(": ")}</small>
      <small>{[line.source === "rejected" ? t("Rejected at delivery") : t("Accepted, found wrong later"), t("Delivery {number}", { number: line.receiptNumber })].join(" · ")}</small></span> } },
    { id: "quantity", header: t("Quantity"), size: 120, accessorFn: (line) => Number(line.quantity), meta: { align: "end", renderCell: (line) => <span className={styles.money}>{`${quantityText(line.quantity)} ${line.unit}`.trim()}</span> } },
    { id: "credit", header: t("Credit"), size: 140, accessorFn: (line) => Number(line.creditAmount ?? 0), meta: { align: "end", renderCell: (line) =>
      <span className={styles.money}>{line.creditAmount && row ? format.money(addExact(line.creditAmount, line.creditTax), row.currency) : "—"}</span> } },
  ];
  return <InspectorSheet isOpen size="lg" title={row ? t("Return {number}", { number: row.number }) : t("Return")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={state && (state.canSendThis || state.canCancelThis) ? <div className="wd-dialog-actions">
      {state.canCancelThis ? <Button variant="quiet" onPress={() => setCancelling(true)}>{t("Cancel return")}</Button> : null}<span className={styles.spacer} />
      {state.canSendThis ? <Button variant="primary" isLoading={busy} onPress={() => void run("sent")}>{t("Collected by the supplier")}</Button> : null}
    </div> : null}>
    {error && !state ? <ErrorState description={error} onRetry={() => void load()} /> : !state || !row ? <Skeleton lines={6} shape="facts" /> : <div className={styles.sheet}>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      {state.delivery && state.delivery !== "sent" ? <InlineNotice tone="info" message={t("The email didn't go. Send the return note to the supplier yourself.")} /> : null}
      {row.status === "cancelled" ? <InlineNotice tone="info" message={t("Cancelled: {reason}", { reason: row.cancelReason ?? "" })} /> : null}
      <EditableFieldList>
        <FactRow label={t("Status")}><ReturnStatus row={row} /></FactRow>
        <FactRow label={t("Supplier")}>{`${row.supplierName} · ${row.outcome === "replace" ? t("Replaces them") : t("Credits them")}`}</FactRow>
        <FactRow label={t("Order")}><Button size="compact" variant="quiet" onPress={() => onOpenOrder(row.orderId)}>{row.orderNumber}</Button></FactRow>
        <FactRow label={t("From")}>{row.locationName}</FactRow>
        <FactRow label={t("Raised")}>{[format.when(row.createdAt), row.createdByName].join(" · ")}</FactRow>
        {row.sentOn ? <FactRow label={t("Collected")}>{[format.day(row.sentOn), row.sentByName].join(" · ")}</FactRow> : null}
        {row.credit ? <FactRow label={t("Credit due")}>{format.money(row.credit, row.currency)}</FactRow> : null}
        {row.note ? <FactRow label={t("Note")}>{row.note}</FactRow> : null}
      </EditableFieldList>
      <section className={styles.part} aria-label={t("Lines")}>
        <DataGrid ariaLabel={t("Lines")} data={state.lines} getRowId={(line) => line.id} columns={lineColumns}
          showToolbar={false} showFooter={false} selectable={false} rowNumbers={false} pinFirstColumn={false} wrapText />
      </section>
    </div>}
    {cancelling ? <CancelReturn onClose={() => setCancelling(false)} onSave={async (reason) => { await run("cancel", { reason }, true); setCancelling(false); }} /> : null}
  </InspectorSheet>;
}

function CancelReturn({ onClose, onSave }: { onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const t = useT();
  return <ReasonDialog title={t("Cancel return")} label={t("Why it's cancelled")} confirmLabel={t("Cancel return")} confirmVariant="danger" onConfirm={onSave} onClose={onClose} />;
}
