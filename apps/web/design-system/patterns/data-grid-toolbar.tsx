"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useState, type ReactNode } from "react";
import type { Table } from "@tanstack/react-table";
import { ArrowDownWideNarrow, Columns3, Download, Filter, Rows3, Table2, X } from "lucide-react";
import { Dialog, DialogTrigger, Popover } from "react-aria-components";
import { Button, IconButton } from "../components/actions";
import { Checkbox, SearchInput, SelectField, TextInput } from "../components/forms";
import type { DataGridColumnMeta, SavedView } from "./data-grid";
import { useDesignSystem, usePortalThemeAttributes } from "../foundations/provider";

export function DataGridToolbar<T>({ compact = false, leading, title, table, views, activeView, onViewChange, searchLabel, searchValue, onSearchChange, actions, onExport, hasMoreRows }: {
  compact?: boolean; /** Replaces the title/view switch at the start, e.g. list tabs. */ leading?: ReactNode; title?: string; table: Table<T>; views: SavedView[]; activeView?: string; onViewChange: (id: string) => void;
  searchLabel: string; actions?: ReactNode; onExport: () => void; hasMoreRows?: boolean; totalRowCount?: number;
  searchValue?: string; onSearchChange?: (value: string) => void;
}) {
  const t = useT();
  const { portalContainer, direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  const columns = table.getAllLeafColumns().filter(column => !column.id.startsWith('__'));
  const filterable = columns.filter(column => column.getCanFilter() && typeof column.columnDef.header === 'string');
  const sortable = columns.filter(column => column.getCanSort() && typeof column.columnDef.header === 'string');
  const [filterId, setFilterId] = useState('');
  const filterColumn = filterable.find(column => column.id === filterId) ?? filterable[0];
  const options = (filterColumn?.columnDef.meta as DataGridColumnMeta<T> | undefined)?.filterOptions;
  const filters = table.getState().columnFilters;
  const sort = table.getState().sorting[0];
  const columnItems = (items: typeof columns) => items.map(column => ({ id: column.id, label: String(column.columnDef.header) }));
  return <header className="wd-grid-toolbar wd-record-toolbar" data-compact={compact || undefined} data-leading={leading ? true : undefined}>
    {leading ? <div className="wd-grid-leading">{leading}</div> : title ? <strong className="wd-grid-title">{title}</strong> : null}
    <div className="wd-record-tools">
      <div className="wd-record-controls">
      {leading ? null : views.length ? <SelectField label={t("Table view")} selectedKey={activeView} onSelectionChange={key => key && onViewChange(String(key))} items={views} /> : !compact ? <span className="wd-record-view"><Table2 size={14} />{t("Table view")}</span> : null}
      <DialogTrigger>
        <Button variant="quiet" size="compact" aria-label={t("Manage columns")}><Columns3 size={14} /><span>{t("Configure columns")}</span></Button>
        <Popover {...portalTheme} UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-column-popover" dir={direction} placement="bottom start"><Dialog aria-label={t("Visible columns")} className="wd-column-menu">
          <strong>{t("Columns")}</strong>
          {columns.map(column => <Checkbox key={column.id} isDisabled={!column.getCanHide()} isSelected={column.getIsVisible()} onChange={column.toggleVisibility}>{typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id}</Checkbox>)}
          <Button size="compact" variant="quiet" onPress={() => table.resetColumnVisibility()}>{t("Reset columns")}</Button>
        </Dialog></Popover>
      </DialogTrigger>
      {hasMoreRows ? <span className="wd-record-count" title={t("Load more to include older records.")}><Rows3 size={14} />{t("{count} loaded", { count: table.getFilteredRowModel().rows.length })}</span> : null}
      <DialogTrigger>
        <Button variant="quiet" size="compact" aria-label={t("Filter")} isDisabled={!filterable.length}><Filter size={14} /><span>{filters.length ? (filters.length === 1 ? t("1 filter") : t("{count} filters", { count: filters.length })) : t("Filter")}</span></Button>
        <Popover {...portalTheme} UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-record-panel" dir={direction} placement="bottom start"><Dialog aria-label={t("Filter records")}>{({ close }) => <>
          <header><strong>{t("Filter records")}</strong><IconButton aria-label={t("Close filters")} onPress={close} size="compact"><X size={14} /></IconButton></header>
          <SelectField label={t("Column")} items={columnItems(filterable)} selectedKey={filterColumn?.id} onSelectionChange={key => key && setFilterId(String(key))} />
          {options ? <SelectField label={t("Filter by {column}", { column: String(filterColumn?.columnDef.header).toLowerCase() })} selectedKey={String(filterColumn?.getFilterValue() ?? '__all')} items={[{ id: '__all', label: t("All values") }, ...options]} onSelectionChange={key => filterColumn?.setFilterValue(key === '__all' ? undefined : String(key))} /> : <TextInput label={t("Contains")} value={String(filterColumn?.getFilterValue() ?? '')} onChange={value => filterColumn?.setFilterValue(value || undefined)} placeholder={t("Enter a value…")} />}
          {filters.length > 1 && <p className="wd-record-filter-summary">{filters.map(filter => `${table.getColumn(filter.id)?.columnDef.header}: ${filter.value}`).join(' · ')}</p>}
          <footer><Button size="compact" variant="quiet" isDisabled={!filters.length} onPress={() => table.resetColumnFilters()}>{t("Clear filters")}</Button><Button size="compact" onPress={close}>{t("Done")}</Button></footer>
        </>}</Dialog></Popover>
      </DialogTrigger>
      <DialogTrigger>
        <Button variant="quiet" size="compact" aria-label={t("Sort")} isDisabled={!sortable.length}><ArrowDownWideNarrow size={14} /><span>{t("Sort")}{sort ? ` · ${table.getState().sorting.length}` : ''}</span></Button>
        <Popover {...portalTheme} UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-record-panel" dir={direction} placement="bottom start"><Dialog aria-label={t("Sort records")}>{({ close }) => <>
          <header><strong>{t("Sort records")}</strong><IconButton aria-label={t("Close sorting")} onPress={close} size="compact"><X size={14} /></IconButton></header>
          <SelectField label={t("Sort by")} items={[{ id: '__none', label: t("Default order") }, ...columnItems(sortable)]} selectedKey={sort?.id ?? '__none'} onSelectionChange={key => table.setSorting(key === '__none' ? [] : [{ id: String(key), desc: false }])} />
          <SelectField label={t("Direction")} items={[{ id: 'asc', label: t("Ascending") }, { id: 'desc', label: t("Descending") }]} isDisabled={!sort} selectedKey={sort?.desc ? 'desc' : 'asc'} onSelectionChange={key => sort && table.setSorting([{ ...sort, desc: key === 'desc' }])} />
          <footer><Button variant="quiet" size="compact" isDisabled={!sort} onPress={() => table.resetSorting()}>{t("Clear sort")}</Button><Button size="compact" onPress={close}>{t("Done")}</Button></footer>
        </>}</Dialog></Popover>
      </DialogTrigger>
      </div>
      <form className="wd-record-search" onSubmit={event => event.preventDefault()}>
        <SearchInput label={searchLabel} placeholder={t("Search…")} value={searchValue ?? String(table.getState().globalFilter ?? '')} onChange={value => onSearchChange ? onSearchChange(value) : table.setGlobalFilter(value)} />
      </form>
    </div>
    <div className="wd-record-actions"><Button size="compact" variant="quiet" onPress={onExport} aria-label={table.getSelectedRowModel().rows.length ? t("Export selected rows") : t("Export filtered rows")}><Download size={14} aria-hidden="true"/><span>{t("Export")}</span></Button>{actions}</div>
  </header>;
}
