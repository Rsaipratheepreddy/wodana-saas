"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Checkbox } from "../components/forms";

export type GroupedTableColumn<T> = {
  id: string;
  label: string;
  /** Numbers and amounts sit at the inline end with tabular figures. */
  align?: "start" | "end";
  mobileHidden?: boolean;
  mobileWidth?: string;
  render: (row: T) => ReactNode;
  width?: string;
};

export type GroupedTableSection<T> = {
  emptyMessage: string;
  /** Text shown in the group row under a column, e.g. a package total. */
  headerLabels?: Record<string, string>;
  id: string;
  label: string;
  rows: T[];
};

/**
 * One header row of real column names, then a group row per section (name, count, optional per-column
 * summaries) above its rows. Groups collapse; rows and groups can be selected.
 */
export function GroupedTable<T>({
  ariaLabel,
  columns,
  getRowId,
  getRowLabel,
  onSelectionChange,
  sections,
  selectedIds,
  selectable = true,
  collapsible = true,
  groupRows = true,
  appearance = "plain",
  onRowAction,
  onSectionAction,
}: {
  ariaLabel: string;
  columns: GroupedTableColumn<T>[];
  getRowId: (row: T) => string;
  getRowLabel?: (row: T) => string;
  onSelectionChange?: (ids: Set<string>) => void;
  sections: GroupedTableSection<T>[];
  selectedIds?: Set<string>;
  selectable?: boolean;
  /** Group rows toggle their rows open and closed. */
  collapsible?: boolean;
  /** Without group rows the sections run together under the one header (a single-section list). */
  groupRows?: boolean;
  appearance?: "plain" | "enclosed";
  /** Opens a row (click, Enter or Space), like DataGrid rows. */
  onRowAction?: (row: T) => void;
  /** Makes each section's name a button, e.g. to edit the group. */
  onSectionAction?: (sectionId: string) => void;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  selectedIds ??= new Set();
  const setRowSelected = (id: string, selected: boolean) => {
    const next = new Set(selectedIds);
    if (selected) next.add(id);
    else next.delete(id);
    onSelectionChange?.(next);
  };
  const selectMany = (ids: string[], selected: boolean) => {
    const next = new Set(selectedIds);
    ids.forEach((id) => selected ? next.add(id) : next.delete(id));
    onSelectionChange?.(next);
  };
  const allIds = sections.flatMap((section) => section.rows.map(getRowId));
  const allSelected = allIds.filter((id) => selectedIds.has(id)).length;
  const span = columns.length + (selectable ? 1 : 0);

  return <div className="wd-grouped-table-scroll" data-appearance={appearance} data-selectable={selectable} tabIndex={0}><table aria-label={ariaLabel} className="wd-grouped-table wd-record-table"><colgroup>{selectable ? <col className="wd-grouped-select-column" /> : null}{columns.map((column) => <col data-mobile-hidden={column.mobileHidden || undefined} key={column.id} style={{ "--wd-grouped-column-width": column.width ?? "auto", "--wd-grouped-column-mobile-width": column.mobileWidth ?? "auto" } as CSSProperties} />)}</colgroup>
    <thead><tr>
      {selectable ? <th scope="col"><Checkbox aria-label={t("Select all")} isIndeterminate={allSelected > 0 && allSelected < allIds.length} isSelected={Boolean(allIds.length) && allSelected === allIds.length} onChange={(selected) => selectMany(allIds, selected)} /></th> : null}
      {columns.map((column) => <th scope="col" data-align={column.align} data-mobile-hidden={column.mobileHidden || undefined} key={column.id}>{column.label}</th>)}
    </tr></thead>
    {sections.map((section) => {
      const rowIds = section.rows.map(getRowId);
      const selectedCount = rowIds.filter((id) => selectedIds.has(id)).length;
      const closed = groupRows && collapsed.has(section.id);
      const summary = Boolean(section.headerLabels);
      const name = onSectionAction ? <button className="wd-grouped-table-section-button" onClick={() => onSectionAction(section.id)} type="button">{section.label}</button> : <span className="wd-grouped-table-section-label">{section.label}</span>;
      return <tbody key={section.id}>
        {groupRows ? <tr className="wd-grouped-table-heading" data-collapsed={closed || undefined}>
          {selectable ? <th scope="row"><Checkbox aria-label={t("Select all {name}", { name: section.label.toLowerCase() })} isIndeterminate={selectedCount > 0 && selectedCount < rowIds.length} isSelected={Boolean(rowIds.length) && selectedCount === rowIds.length} onChange={(selected) => selectMany(rowIds, selected)} /></th> : null}
          <th scope="colgroup" colSpan={summary ? 1 : columns.length}><span className="wd-grouped-table-section">
            {collapsible ? <button aria-expanded={!closed} aria-label={t(closed ? "Expand {name}" : "Collapse {name}", { name: section.label })} className="wd-grouped-table-toggle" onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(section.id)) next.delete(section.id); else next.add(section.id); return next; })} type="button">{closed ? <ChevronRight aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />}</button> : null}
            {name}
            <span className="wd-grouped-table-section-count">{section.rows.length}</span>
          </span></th>
          {summary ? columns.slice(1).map((column) => <th scope="colgroup" data-align={column.align} data-mobile-hidden={column.mobileHidden || undefined} key={column.id}>{section.headerLabels?.[column.id] ?? ""}</th>) : null}
        </tr> : null}
        {closed ? null : section.rows.length ? section.rows.map((row) => {
          const id = getRowId(row);
          return <tr className="wd-grouped-table-row" data-selected={selectedIds.has(id) || undefined} key={id}
            data-actionable={onRowAction ? true : undefined} tabIndex={onRowAction ? 0 : undefined}
            onClick={onRowAction ? (event) => { if (!(event.target as HTMLElement).closest("button,input,a,select,textarea,[role=checkbox],label")) onRowAction(row); } : undefined}
            onKeyDown={onRowAction ? (event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onRowAction(row); } } : undefined}>
            {selectable ? <td><Checkbox aria-label={t("Select {name}", { name: getRowLabel?.(row) ?? id })} isSelected={selectedIds.has(id)} onChange={(selected) => setRowSelected(id, selected)} /></td> : null}
            {columns.map((column) => <td data-align={column.align} data-mobile-hidden={column.mobileHidden || undefined} key={column.id}>{column.render(row)}</td>)}
          </tr>;
        }) : <tr className="wd-grouped-table-empty"><td colSpan={span}>{section.emptyMessage}</td></tr>}
      </tbody>;
    })}</table></div>;
}
