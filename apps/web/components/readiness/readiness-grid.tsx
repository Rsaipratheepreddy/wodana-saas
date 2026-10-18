"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Badge, DataGrid, type DataGridColumn, type SavedView } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { CellState, ReadinessCell, ReadinessColumn } from "@/lib/readiness/types";
import styles from "./readiness.module.css";

/** Where a cell leads: a page (and tab) to fill it, or a view on this page. */
export type CellTarget = { href: string } | { onPress: () => void } | null;
type Row = { id: string; cells: Partial<Record<ReadinessColumn, ReadinessCell>>; missing: number };

/** The words for the readiness columns, states and notes. */
export function useReadinessLabels() {
  const t = useT();
  return useMemo(() => {
    const column: Record<ReadinessColumn, string> = {
      picture: t("Picture"), size: t("Size"), price: t("Price"), drawing: t("Technical drawing"), materials: t("Materials"), labour: t("Trades & hours"),
      selection: t("Material selection"), purchase: t("Purchase"), production: t("Production"), delivery: t("Installation"),
    };
    const state: Record<CellState, string> = { done: t("Done"), missing: t("Missing"), waiting: t("In progress"), not_needed: t("Not needed") };
    const notes: Record<string, string> = {
      from_sheet: t("From sheet"), from_quote: t("From quotation"), components: t("Components"), material_list: t("Material list"), in_review: t("In review"),
      catalogue_drawing: t("Catalogue drawing"), approved: t("Approved"), uploaded: t("Uploaded"), site_checked: t("Site checked"), design_checked: t("Matches the design"), sent: t("Sent to client"),
      changes_requested: t("Changes requested"), signed_off: t("Signed off"), ordered: t("Ordered"), received: t("Received"), installed: t("Installed"),
      scheduled: t("Scheduled"), in_production: t("In production"), on_hold: t("On hold"), ready: t("Ready"), part_installed: t("Part installed"), not_installed: t("Not installed"),
      // PLM-150: a made item at its design inspection, or with snags the factory fixes.
      inspection_due: t("Waiting for inspection"), inspection_snags: t("Snags to fix"),
    };
    return { column, state, note: (value?: string) => (value ? notes[value] ?? null : null) };
  }, [t]);
}

/** One cell: a check (with where it came from), a Missing chip that opens the place to fill it, in progress, or not needed. */
export function ReadinessCellView({ cell, label, target }: { cell: ReadinessCell | undefined; label: string; target: CellTarget }) {
  const t = useT();
  const words = useReadinessLabels();
  if (!cell) return null;
  const note = words.note(cell.note);
  if (cell.state === "not_needed") return <span className={styles.notNeeded}>{words.state.not_needed}</span>;
  if (cell.state === "done") return <span className={styles.done} title={cell.detail}>
    <Check aria-hidden="true" size={14} />{note ? <span>{note}</span> : <span className="wd-visually-hidden">{words.state.done}</span>}
  </span>;
  const chip = <Badge tone={cell.state === "missing" ? "danger" : "warning"}>{cell.state === "missing" ? words.state.missing : note ?? words.state.waiting}</Badge>;
  const name = cell.state === "missing" ? t("Fill {column}", { column: label }) : t("Open {column}", { column: label });
  if (!target) return <span title={cell.detail}>{chip}</span>;
  if ("href" in target) return <Link aria-label={name} className={styles.chip} href={target.href} title={name}>{chip}</Link>;
  return <button aria-label={name} className={styles.chip} onClick={target.onPress} title={name} type="button">{chip}</button>;
}

/**
 * A readiness table: the record's own columns, then one column per readiness column with its missing count, a
 * "Missing anything" filter and a filter per column. Search is the page's.
 */
export function ReadinessGrid<R extends Row>({ ariaLabel, rows, columns, leading, target, searchLabel, searchValue, onSearchChange, emptyContent, isLoading,
  savedViews, selectedView, onViewChange, menuActions, onMenuAction, onRowAction, exportFileName }: {
  ariaLabel: string; rows: R[]; columns: ReadinessColumn[]; leading: DataGridColumn<R>[]; target: (row: R, column: ReadinessColumn) => CellTarget;
  searchLabel: string; searchValue: string; onSearchChange: (value: string) => void; emptyContent: ReactNode; isLoading?: boolean;
  savedViews?: SavedView[]; selectedView?: string; onViewChange?: (view: string) => void; menuActions?: Array<{ id: string; label: string }>; onMenuAction?: (id: string) => void;
  onRowAction?: (row: R) => void; exportFileName?: string;
}) {
  const t = useT();
  const words = useReadinessLabels();
  const [onlyMissing, setOnlyMissing] = useState(false);
  const counts = useMemo(() => Object.fromEntries(columns.map((column) => [column, rows.filter((row) => row.cells[column]?.state === "missing").length])) as Record<ReadinessColumn, number>,
    [columns, rows]);
  const anything = rows.filter((row) => row.missing > 0).length;
  const shown = onlyMissing ? rows.filter((row) => row.missing > 0) : rows;
  const stateOptions = useMemo(() => (["missing", "waiting", "done", "not_needed"] as CellState[]).map((id) => ({ id, label: words.state[id] })), [words]);
  const gridColumns = useMemo<DataGridColumn<R>[]>(() => [
    ...leading,
    ...columns.map((column): DataGridColumn<R> => {
      const label = words.column[column];
      return {
        id: column, header: counts[column] ? t("{column} ({count})", { column: label, count: counts[column] }) : label, size: 132,
        accessorFn: (row) => row.cells[column]?.state ?? "",
        meta: { interactive: true, filterOptions: stateOptions, renderCell: (row) => <ReadinessCellView cell={row.cells[column]} label={label} target={target(row, column)} /> },
      };
    }),
  ], [columns, counts, leading, stateOptions, t, target, words]);

  return <DataGrid<R>
    ariaLabel={ariaLabel}
    columns={gridColumns}
    data={shown}
    emptyContent={emptyContent}
    exportFileName={exportFileName}
    filters={[{ id: "missing", label: t("Missing"), value: onlyMissing ? "any" : undefined, onChange: (value) => setOnlyMissing(value === "any"),
      options: [{ id: "any", label: t("Missing anything ({count})", { count: anything }) }] }]}
    getRowId={(row) => row.id}
    isLoading={isLoading}
    menuActions={menuActions}
    onMenuAction={onMenuAction}
    onRowAction={onRowAction}
    onSearchChange={onSearchChange}
    onViewChange={onViewChange}
    rowNumbers={false}
    savedViews={savedViews}
    searchLabel={searchLabel}
    searchValue={searchValue}
    selectable={false}
    selectedView={selectedView}
    wrapText
  />;
}
