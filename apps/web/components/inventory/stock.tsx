"use client";

import { useMemo, useState } from "react";
import { Button, ControlledModalDialog, DataGrid, EmptyState, ErrorState, InlineNotice, MenuButton, NoResultsState, SegmentedControl, TextAreaField, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { InventoryApi } from "@/lib/inventory/client";
import type { PendingAdjustment, StockRow, StockState, TransferState } from "@/lib/inventory/types";
import { addExact } from "@/lib/purchasing/amounts";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "../purchasing/order-labels";
import { MoveDialog } from "./move-dialog";
import { StockChangeDialog, type ChangeMode } from "./stock-change-dialog";
import styles from "./inventory.module.css";

type Owner = "all" | "free" | "projects";

/**
 * Stock: each item at each place, for a project or free, with what's on hand. A row's actions issue it,
 * reserve or release it, move it or count it; stock that isn't in the system yet is added with its origin.
 */
export function Stock({ api, state, error, onReload, onChanged, onMoved, onHistory }: {
  api: InventoryApi; state: StockState | null; error: string; onReload: () => void; onChanged: (next: StockState) => void; onMoved: (next: TransferState) => void;
  onHistory: (itemId: string) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [search, setSearch] = useState("");
  const [refusing, setRefusing] = useState<PendingAdjustment | null>(null);
  const [notice, setNotice] = useState("");
  const decide = async (request: PendingAdjustment, action: "approve" | "reject", note = "") => {
    setNotice("");
    try { onChanged(await api.decideAdjustment(request.id, action, note)); return true; } catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); return false; }
  };
  const [owner, setOwner] = useState<Owner>("all");
  const [place, setPlace] = useState<string | null>(null);
  const [change, setChange] = useState<{ mode: ChangeMode; row: StockRow | null } | null>(null);
  const [moving, setMoving] = useState<{ row: StockRow | null } | null>(null);
  const rows = useMemo(() => (state?.rows ?? []).filter((row) => (owner === "all" || (owner === "free") === !row.projectId) && (!place || row.locationId === place)
    && (!search.trim() || `${row.itemName} ${row.itemCode} ${row.projectReference ?? ""} ${row.projectName ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))), [state, owner, place, search]);
  const columns = useMemo<DataGridColumn<StockRow>[]>(() => [
    { id: "item", header: t("Item"), accessorFn: (row) => row.itemName, size: 260, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.itemName}</span>{row.itemCode ? <small>{row.itemCode}</small> : null}</span> } },
    { id: "place", header: t("Place"), accessorFn: (row) => row.locationName, size: 180 },
    { id: "for", header: t("For"), accessorFn: (row) => row.projectReference ?? "", size: 200, meta: { renderCell: (row) => row.projectReference
      ? <span className={styles.nameCell}><span>{row.projectReference}</span><small>{row.projectName}</small></span> : <span className={styles.muted}>{t("Free stock")}</span> } },
    { id: "onHand", header: t("On hand"), accessorFn: (row) => Number(row.onHand), size: 130, meta: { align: "end", renderCell: (row) => <span className={styles.number}>{`${quantityText(row.onHand)} ${row.unit}`.trim()}</span> } },
    { id: "value", header: t("Value"), accessorFn: (row) => Number(row.value), size: 150, meta: { align: "end", mobileHidden: true, renderCell: (row) => <span className={styles.nameCell}>
      <span className={styles.number}>{format.money(row.value, row.currency)}</span>
      {row.averageCost ? <small>{t("{price} each", { price: format.money(row.averageCost, row.currency) })}</small> : null}</span> } },
    { id: "actions", header: "", accessorFn: () => "", size: 120, meta: { align: "end", renderCell: (row) => state && (state.canManage || state.canAdjust) ? <MenuButton size="compact" label={t("Actions")}
      onAction={(id) => (id === "history" ? onHistory(row.itemId) : id === "move" ? setMoving({ row }) : setChange({ mode: id as ChangeMode, row }))}
      items={[
        ...(state.canManage ? [{ id: "issue", label: t("Issue to a project") }, row.projectId ? { id: "release", label: t("Release to free stock") } : { id: "allocate", label: t("Reserve for a project") },
          { id: "move", label: t("Move") }, { id: "return", label: t("Take back from a project") }] : []),
        ...(state.canAdjust ? [{ id: "count", label: t("Count") }] : []),
        { id: "history", label: t("History") },
      ]} /> : null } },
  ], [t, state, onHistory, format]);
  const total = rows.length ? addExact(...rows.map((row) => row.value)) : "0";

  if (error && !state) return <ErrorState description={error} onRetry={onReload} />;
  const placeName = state?.locations.find((location) => location.id === place)?.name;
  return <>
    {notice ? <InlineNotice tone="error" message={notice} /> : null}
    {state?.pendingAdjustments.length ? <section className={styles.pending} aria-label={t("Corrections waiting for approval")}>
      <h3 className={styles.subhead}>{t("Corrections waiting for approval")}</h3>
      <ul className={styles.places}>{state.pendingAdjustments.map((request) => <li key={request.id}>
        <span className={styles.nameCell}><span>{`${request.itemName} · ${request.locationName}${request.projectReference ? ` · ${request.projectReference}` : ""}`}</span>
          <small>{t("Counted {counted} ({difference}), worth {value}: {reason} — {name}", { counted: `${quantityText(request.counted)} ${request.unit}`.trim(),
            difference: `${Number(request.difference) > 0 ? "+" : ""}${quantityText(request.difference)}`, value: format.money(request.value, state.currency),
            reason: request.reason, name: request.requestedByName })}</small></span>
        {state.canAdjust && request.requestedBy !== state.me ? <span className={styles.filters}>
          <Button size="compact" variant="primary" onPress={() => void decide(request, "approve")}>{t("Approve")}</Button>
          <Button size="compact" variant="quiet" onPress={() => setRefusing(request)}>{t("Refuse")}</Button></span> : <small className={styles.muted}>{t("Someone else approves it.")}</small>}
      </li>)}</ul>
    </section> : null}
    <DataGrid<StockRow> ariaLabel={t("Stock")} columns={columns} data={rows} getRowId={(row) => `${row.itemId}:${row.locationId}:${row.projectId ?? ""}`} isLoading={!state}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search stock")} rowNumbers={false} selectable={false} wrapText
      toolbarLeading={<div className={styles.filters}>
        <SegmentedControl label={t("Show")} value={owner} onChange={(value) => setOwner(value as Owner)}
          options={[{ id: "all", label: t("All") }, { id: "free", label: t("Free stock") }, { id: "projects", label: t("For projects") }]} />
        <MenuButton size="compact" label={placeName ?? t("Every place")} onAction={(id) => setPlace(id === "any" ? null : id)}
          items={[{ id: "any", label: t("Every place") }, ...(state?.locations ?? []).map((location) => ({ id: location.id, label: location.name }))]} />
      </div>}
      toolbarActions={<div className={styles.filters}>
        {rows.length && state ? <span className={styles.muted}>{t("Worth {value}", { value: format.money(total, state.currency) })}</span> : null}
        {state?.canAdjust ? <Button size="compact" onPress={() => setChange({ mode: "add", row: null })}>{t("Add stock")}</Button> : null}</div>}
      emptyContent={search.trim() || place || owner !== "all" ? <NoResultsState onClear={() => { setSearch(""); setPlace(null); setOwner("all"); }} />
        : <EmptyState title={t("Nothing in stock")} description={t("Deliveries add stock where they arrive.")} />} />
    {change && state ? <StockChangeDialog api={api} state={state} mode={change.mode} row={change.row} onClose={() => setChange(null)} onDone={(next) => { setChange(null); onChanged(next); }} /> : null}
    {refusing ? <RefuseDialog onClose={() => setRefusing(null)} onSave={async (note) => { if (await decide(refusing, "reject", note)) setRefusing(null); }} /> : null}
    {moving && state ? <MoveDialog api={api} state={state} row={moving.row} onClose={() => setMoving(null)} onSent={(next) => { setMoving(null); onMoved(next); }} /> : null}
  </>;
}

function RefuseDialog({ onClose, onSave }: { onClose: () => void; onSave: (note: string) => Promise<void> }) {
  const t = useT();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Refuse the correction")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Back")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!note.trim()} onPress={async () => { setBusy(true); await onSave(note.trim()); setBusy(false); }}>{t("Refuse")}</Button></div>}>
    <TextAreaField label={t("Why it's refused")} isRequired value={note} onChange={setNote} />
  </ControlledModalDialog>;
}
