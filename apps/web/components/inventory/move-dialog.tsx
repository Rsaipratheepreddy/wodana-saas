"use client";

import { useMemo, useState } from "react";
import { DataGrid, EmptyState, FormDialog, FormRow, InlineNotice, QuantityInput, SelectField, TextInput, VisuallyHidden, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { InventoryApi } from "@/lib/inventory/client";
import type { StockRow, StockState, TransferState } from "@/lib/inventory/types";
import { quantityText } from "../purchasing/order-labels";
import styles from "./inventory.module.css";

const keyOf = (row: StockRow) => `${row.itemId}:${row.projectId ?? ""}`;
/** The dialog has no pager: every line of the place shows on one page (at least the grid's usual page). */
const PAGE = 25;

/** Moves stock from one place to another: it leaves now and counts at the other place once received there. */
export function MoveDialog({ api, state, row, onClose, onSent }: { api: InventoryApi; state: StockState; row: StockRow | null; onClose: () => void; onSent: (next: TransferState) => void }) {
  const t = useT();
  const [id] = useState(() => crypto.randomUUID());
  const [from, setFrom] = useState<string | null>(row?.locationId ?? null);
  const [to, setTo] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>(row ? { [keyOf(row)]: quantityText(row.onHand) } : {});
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const here = useMemo(() => state.rows.filter((item) => item.locationId === from), [state.rows, from]);
  const chosen = here.filter((item) => Number(amounts[keyOf(item)] ?? 0) > 0);
  const over = here.find((item) => Number(amounts[keyOf(item)] ?? 0) > Number(item.onHand));
  const destination = state.locations.find((location) => location.id === to);
  const wrongSite = destination?.kind === "site" ? chosen.find((item) => item.projectId && item.projectId !== destination.projectId) : undefined;
  // What's at the place: each item with what's on hand and how much moves (exact decimal text, shown in a number field).
  const columns: DataGridColumn<StockRow>[] = [
    { id: "item", header: t("Item"), size: 220, enableSorting: false, accessorFn: (item) => item.itemName, meta: { renderCell: (item) => <span className={styles.nameCell}><span>{item.itemName}</span>
      <small>{item.projectReference ?? t("Free stock")}</small></span> } },
    { id: "onHand", header: t("On hand"), size: 120, enableSorting: false, accessorFn: (item) => Number(item.onHand), meta: { align: "end", renderCell: (item) =>
      <span className={styles.number}>{`${quantityText(item.onHand)} ${item.unit}`.trim()}</span> } },
    { id: "move", header: t("Move"), size: 160, enableSorting: false, accessorFn: (item) => amounts[keyOf(item)] ?? "", meta: { align: "end", interactive: true, renderCell: (item) => {
      const amount = amounts[keyOf(item)] ?? "";
      return <QuantityInput label={<VisuallyHidden>{t("Move of {item}", { item: `${item.itemName} ${item.projectReference ?? ""}`.trim() })}</VisuallyHidden>} unit={item.unit} minValue={0}
        formatOptions={{ maximumFractionDigits: 4 }} value={amount === "" ? Number.NaN : Number(amount)}
        onChange={(next) => setAmounts((current) => ({ ...current, [keyOf(item)]: Number.isFinite(next) ? String(next) : "" }))} />;
    } } },
  ];
  const send = async () => {
    setBusy(true); setError("");
    try {
      onSent(await api.send({ id, fromLocationId: from, toLocationId: to, note: note.trim(), lines: chosen.map((item) => ({ itemId: item.itemId, projectId: item.projectId, quantity: amounts[keyOf(item)] })) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(false); }
  };
  return <FormDialog size="lg" title={t("Move stock")} onClose={onClose} error={error || undefined} isSubmitting={busy} isSubmitDisabled={!from || !to || from === to || !chosen.length || Boolean(over) || Boolean(wrongSite)} submitLabel={t("Move")} onSubmit={() => send()}>
      <FormRow>
        <SelectField label={t("From")} isRequired selectedKey={from} onSelectionChange={(key) => { setFrom(key === null ? null : String(key)); setAmounts({}); }}
          items={state.locations.filter((location) => state.rows.some((item) => item.locationId === location.id)).map((location) => ({ id: location.id, label: location.name }))} />
        <SelectField label={t("To")} isRequired selectedKey={to} onSelectionChange={(key) => setTo(key === null ? null : String(key))}
          items={state.locations.filter((location) => location.id !== from).map((location) => ({ id: location.id, label: location.name }))} />
      </FormRow>
      {!from ? null : !here.length ? <EmptyState illustration={null} title={t("Nothing in stock here")} />
        : <DataGrid<StockRow> key={from} ariaLabel={t("What to move")} data={here} getRowId={keyOf} columns={columns} pageSize={Math.max(PAGE, here.length)}
          showToolbar={false} showFooter={false} selectable={false} rowNumbers={false} pinFirstColumn={false} wrapText />}
      {over ? <InlineNotice tone="error" message={t("Only {quantity} of {item} here.", { quantity: `${quantityText(over.onHand)} ${over.unit}`.trim(), item: over.itemName })} /> : null}
      {wrongSite ? <InlineNotice tone="error" message={t("{item} is for {project}; it can't go to another project's site.", { item: wrongSite.itemName, project: wrongSite.projectReference ?? "" })} /> : null}
      <TextInput label={t("Note")} value={note} onChange={setNote} />
  </FormDialog>;
}
