"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, DataGrid, EmptyState, ErrorState, NoResultsState, type DataGridColumn, TypeChip } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { InventoryApi } from "@/lib/inventory/client";
import type { MovementKind, MovementRow } from "@/lib/inventory/types";
import { multiplyExact } from "@/lib/purchasing/amounts";
import { Cell, ProjectFilterChip } from "../operations/ops";
import { useProjectFormat } from "../project-core/format";
import { orderNumber } from "../factory/factory-labels";
import { quantityText } from "../purchasing/order-labels";
import styles from "./inventory.module.css";

/** A movement's worth: its quantity at its cost, exactly. */
const movementValue = (quantity: string, unitCost: string) => multiplyExact(quantity, unitCost);
type Kind = "all" | "in" | "out" | "moves" | "reserved" | "corrections" | "made";
const GROUPS: Record<Exclude<Kind, "all">, MovementKind[]> = {
  in: ["receive", "return"], out: ["issue", "supplier_return", "reverse"], moves: ["transfer_out", "transfer_in"], reserved: ["allocate", "release"], corrections: ["adjust"], made: ["produce"],
};

/** The chip colour of each kind: in green, out amber, moves blue, reserved purple, corrections red, made teal. */
const KIND_HUE = Object.fromEntries(([["in", 3], ["out", 4], ["moves", 1], ["reserved", 2], ["corrections", 5], ["made", 6]] as const)
  .flatMap(([group, hue]) => GROUPS[group].map((kind) => [kind, hue]))) as Record<MovementKind, 1 | 2 | 3 | 4 | 5 | 6>;

/** Every change to stock, newest first: what moved, where, for whom, why, and who did it. The ledger never changes. */
export function History({ api, itemId, onClearItem, refreshKey, projectId = null, onProject = () => undefined }: {
  api: InventoryApi; itemId: string | null; onClearItem: () => void; refreshKey: number; projectId?: string | null; onProject?: (projectId: string | null) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [rows, setRows] = useState<MovementRow[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const load = useCallback(async () => {
    try { setRows((await api.movements({ itemId: itemId ?? undefined, projectId: projectId ?? undefined })).movements); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("History didn't load.")); }
  }, [api, itemId, projectId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, refreshKey]);
  const kinds = useMemo(() => ({ receive: t("Delivered"), issue: t("Issued"), return: t("Taken back"), transfer_out: t("Moved out"), transfer_in: t("Moved in"),
    allocate: t("Reserved"), release: t("Released"), adjust: t("Corrected"), supplier_return: t("Returned to supplier"), reverse: t("Delivery reversed"), produce: t("Made") } satisfies Record<MovementKind, string>), [t]);
  const source = useCallback((row: MovementRow) => [
    row.receiptNumber ? t("{order}, delivery {number}", { order: row.orderNumber ?? "", number: row.receiptNumber }) : row.orderNumber ?? "",
    row.transferNumber ? t("Move {number}", { number: row.transferNumber }) : "", row.returnNumber ? t("Return {number}", { number: row.returnNumber }) : "", row.workOrderNumber ? orderNumber(row.workOrderNumber) : "",
    row.workOrderNumber ? "" : row.reason,
  ].filter(Boolean).join(" · "), [t]);
  const needle = search.trim().toLocaleLowerCase();
  const searched = (rows ?? []).filter((row) => !needle || `${row.itemName} ${row.locationName} ${row.projectReference ?? ""} ${row.forProjectReference ?? ""} ${row.reason}`
    .toLocaleLowerCase().includes(needle));
  const shown = kind === "all" ? searched : searched.filter((row) => GROUPS[kind].includes(row.kind));
  const columns = useMemo<DataGridColumn<MovementRow>[]>(() => [
    { id: "when", header: t("Date"), accessorFn: (row) => row.movedOn, size: 130, meta: { renderCell: (row) => format.day(row.movedOn) } },
    { id: "item", header: t("Item"), accessorFn: (row) => row.itemName, size: 220, meta: { primary: true } },
    { id: "change", header: t("Change"), accessorFn: (row) => Number(row.quantity), size: 170, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <span className={styles.number} data-sign={Number(row.quantity) < 0 ? "out" : "in"}>{`${Number(row.quantity) > 0 ? "+" : ""}${quantityText(row.quantity)} ${row.unit}`.trim()}</span>
      <span><TypeChip hue={KIND_HUE[row.kind]}>{kinds[row.kind]}</TypeChip></span></span> } },
    { id: "value", header: t("Value"), accessorFn: (row) => (row.unitCost ? movementValue(row.quantity, row.unitCost) : "0"), size: 130, meta: { align: "end", mobileHidden: true,
      renderCell: (row) => (row.unitCost && row.currency ? <span className={styles.number}>{format.money(movementValue(row.quantity, row.unitCost), row.currency)}</span> : "—") } },
    { id: "place", header: t("Place"), accessorFn: (row) => row.locationName, size: 160 },
    { id: "for", header: t("For"), accessorFn: (row) => row.forProjectReference ?? row.projectReference ?? "", size: 130, meta: { renderCell: (row) => row.forProjectReference ?? row.projectReference
      ?? <span className={styles.muted}>{t("Free stock")}</span> } },
    { id: "source", header: t("From"), accessorFn: (row) => source(row), size: 240, meta: { mobileHidden: true, renderCell: (row) => <Cell title={source(row) || "—"} meta={row.byName} /> } },
  ], [t, format, kinds, source]);
  if (error && !rows) return <ErrorState description={error} onRetry={() => void load()} />;
  const reference = projectId ? (rows ?? []).find((row) => row.forProjectReference || row.projectReference) : undefined;
  return <DataGrid<MovementRow> ariaLabel={t("History")} columns={columns} data={shown} getRowId={(row) => row.id} isLoading={!rows}
    onSearchChange={setSearch} searchValue={search} searchLabel={t("Search history")} rowNumbers={false} selectable={false} wrapText
    filters={[{ id: "kind", label: t("Kind"), value: kind === "all" ? undefined : kind, onChange: (value) => setKind((value as Kind | undefined) ?? "all"),
      options: [{ id: "in", label: t("In") }, { id: "out", label: t("Out") }, { id: "moves", label: t("Moves") }, { id: "reserved", label: t("Reserved") },
        { id: "corrections", label: t("Corrections") }, { id: "made", label: t("Made") }] }]}
    toolbarLeading={projectId || itemId ? <div className={styles.filters}>
      <ProjectFilterChip project={projectId ? { id: projectId, reference: reference?.forProjectReference ?? reference?.projectReference ?? t("This project") } : null} onClear={() => onProject(null)} />
      {itemId ? <Button size="compact" variant="quiet" onPress={onClearItem}>{t("Show every item")}</Button> : null}
    </div> : undefined}
    emptyContent={needle || kind !== "all" ? <NoResultsState onClear={() => { setSearch(""); setKind("all"); }} /> : <EmptyState title={t("No stock changes yet")} />} />;
}
