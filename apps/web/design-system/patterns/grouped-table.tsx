"use client";

import { type CSSProperties, type ReactNode } from "react";
import { Checkbox } from "../components/forms";

export type GroupedTableColumn<T> = {
  id: string;
  label: string;
  mobileHidden?: boolean;
  mobileWidth?: string;
  render: (row: T) => ReactNode;
  width?: string;
};

export type GroupedTableSection<T> = {
  emptyMessage: string;
  headerLabels?: Record<string, string>;
  id: string;
  label: string;
  rows: T[];
};

export function GroupedTable<T>({
  ariaLabel,
  columns,
  getRowId,
  getRowLabel,
  onSelectionChange,
  sections,
  selectedIds,
  selectable = true,
  appearance = "plain",
}: {
  ariaLabel: string;
  columns: GroupedTableColumn<T>[];
  getRowId: (row: T) => string;
  getRowLabel?: (row: T) => string;
  onSelectionChange?: (ids: Set<string>) => void;
  sections: GroupedTableSection<T>[];
  selectedIds?: Set<string>;
  selectable?: boolean;
  appearance?: "plain" | "enclosed";
}) {
  selectedIds ??= new Set();
  const setRowSelected = (id: string, selected: boolean) => {
    const next = new Set(selectedIds);
    if (selected) next.add(id);
    else next.delete(id);
    onSelectionChange?.(next);
  };

  return <div className="wd-grouped-table-scroll" data-appearance={appearance} data-selectable={selectable} tabIndex={0}><table aria-label={ariaLabel} className="wd-grouped-table wd-record-table"><colgroup>{selectable ? <col className="wd-grouped-select-column" /> : null}{columns.map((column) => <col data-mobile-hidden={column.mobileHidden || undefined} key={column.id} style={{ "--wd-grouped-column-width": column.width ?? "auto", "--wd-grouped-column-mobile-width": column.mobileWidth ?? "auto" } as CSSProperties} />)}</colgroup>{sections.map((section) => {
    const rowIds = section.rows.map(getRowId);
    const selectedCount = rowIds.filter((id) => selectedIds.has(id)).length;
    return <tbody key={section.id}>
      <tr className="wd-grouped-table-heading">
        {selectable ? <th scope="col"><Checkbox aria-label={`Select all ${section.label.toLowerCase()}`} isIndeterminate={selectedCount > 0 && selectedCount < rowIds.length} isSelected={Boolean(rowIds.length) && selectedCount === rowIds.length} onChange={(selected) => { const next = new Set(selectedIds); rowIds.forEach((id) => selected ? next.add(id) : next.delete(id)); onSelectionChange?.(next); }} /></th> : null}
        {columns.map((column, index) => <th scope="col" data-mobile-hidden={column.mobileHidden || undefined} key={column.id}>{index === 0 ? section.label : section.headerLabels?.[column.id] ?? column.label}</th>)}
      </tr>
      {section.rows.length ? section.rows.map((row) => {
        const id = getRowId(row);
        return <tr className="wd-grouped-table-row" data-selected={selectedIds.has(id) || undefined} key={id}>
          {selectable ? <td><Checkbox aria-label={`Select ${getRowLabel?.(row) ?? id}`} isSelected={selectedIds.has(id)} onChange={(selected) => setRowSelected(id, selected)} /></td> : null}
          {columns.map((column) => <td data-mobile-hidden={column.mobileHidden || undefined} key={column.id}>{column.render(row)}</td>)}
        </tr>;
      }) : <tr className="wd-grouped-table-empty"><td colSpan={columns.length + (selectable ? 1 : 0)}>{section.emptyMessage}</td></tr>}
    </tbody>;
  })}</table></div>;
}
