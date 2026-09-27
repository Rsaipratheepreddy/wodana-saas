"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, DataGrid, EmptyState, ErrorState, NoResultsState, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { InventoryApi } from "@/lib/inventory/client";
import type { MovementKind, MovementRow } from "@/lib/inventory/types";
import { useProjectFormat } from "../project-core/format";
import { orderNumber } from "../factory/factory-labels";
import { quantityText } from "../purchasing/order-labels";
import { multiplyExact } from "@/lib/purchasing/amounts";

/** A movement's worth: its quantity at its cost, exactly. */
const movementValue = (quantity: string, unitCost: string) => multiplyExact(quantity, unitCost);
import styles from "./inventory.module.css";

/** Every change to stock, newest first: what moved, where, for whom, why, and who did it. The ledger never changes. */
export function History({ api, itemId, onClearItem, refreshKey }: { api: InventoryApi; itemId: string | null; onClearItem: () => void; refreshKey: number }) {
  const t = useT();
  const format = useProjectFormat();
  const [rows, setRows] = useState<MovementRow[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const load = useCallback(async () => {
    try { setRows((await api.movements({ itemId: itemId ?? undefined })).movements); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("History didn't load.")); }
  }, [api, itemId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, refreshKey]);
  const kinds = useMemo(() => ({ receive: t("Delivered"), issue: t("Issued"), return: t("Taken back"), transfer_out: t("Moved out"), transfer_in: t("Moved in"),
    allocate: t("Reserved"), release: t("Released"), adjust: t("Corrected"), supplier_return: t("Returned to supplier"), reverse: t("Delivery reversed"), produce: t("Made") } satisfies Record<MovementKind, string>), [t]);
  const source = useCallback((row: MovementRow) => [
    row.receiptNumber ? t("{order}, delivery {number}", { order: row.orderNumber ?? "", number: row.receiptNumber }) : row.orderNumber ?? "",
    row.transferNumber ? t("Move {number}", { number: row.transferNumber }) : "", row.returnNumber ? t("Return {number}", { number: row.returnNumber }) : "", row.workOrderNumber ? orderNumber(row.workOrderNumber) : "",
    row.workOrderNumber ? "" : row.reason,
  ].filter(Boolean).join(" · "), [t]);
  const shown = (rows ?? []).filter((row) => !search.trim() || `${row.itemName} ${row.locationName} ${row.projectReference ?? ""} ${row.forProjectReference ?? ""} ${row.reason}`
    .toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const columns = useMemo<DataGridColumn<MovementRow>[]>(() => [
    { id: "when", header: t("Date"), accessorFn: (row) => row.movedOn, size: 130, meta: { renderCell: (row) => format.day(row.movedOn) } },
    { id: "item", header: t("Item"), accessorFn: (row) => row.itemName, size: 220, meta: { primary: true } },
    { id: "change", header: t("Change"), accessorFn: (row) => Number(row.quantity), size: 170, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <span className={styles.number} data-sign={Number(row.quantity) < 0 ? "out" : "in"}>{`${Number(row.quantity) > 0 ? "+" : ""}${quantityText(row.quantity)} ${row.unit}`.trim()}</span>
      <small>{kinds[row.kind]}</small></span> } },
    { id: "value", header: t("Value"), accessorFn: (row) => (row.unitCost ? Number(row.quantity) * Number(row.unitCost) : 0), size: 130, meta: { align: "end", mobileHidden: true,
      renderCell: (row) => (row.unitCost && row.currency ? <span className={styles.number}>{format.money(movementValue(row.quantity, row.unitCost), row.currency)}</span> : "—") } },
    { id: "place", header: t("Place"), accessorFn: (row) => row.locationName, size: 160 },
    { id: "for", header: t("For"), accessorFn: (row) => row.forProjectReference ?? row.projectReference ?? "", size: 130, meta: { renderCell: (row) => row.forProjectReference ?? row.projectReference ?? <span className={styles.muted}>{t("Free stock")}</span> } },
    { id: "source", header: t("From"), accessorFn: (row) => source(row), size: 240, meta: { mobileHidden: true, renderCell: (row) => source(row) } },
    { id: "by", header: t("By"), accessorFn: (row) => row.byName, size: 140, meta: { mobileHidden: true } },
  ], [t, format, kinds, source]);
  if (error && !rows) return <ErrorState description={error} onRetry={() => void load()} />;
  return <DataGrid<MovementRow> appearance="flush" ariaLabel={t("History")} columns={columns} data={shown} getRowId={(row) => row.id} isLoading={!rows}
    onSearchChange={setSearch} searchValue={search} searchLabel={t("Search history")} rowNumbers={false} selectable={false} wrapText
    toolbarLeading={itemId ? <Button size="compact" variant="quiet" onPress={onClearItem}>{t("Show every item")}</Button> : undefined}
    emptyContent={search.trim() ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t("No stock changes yet")} />} />;
}
