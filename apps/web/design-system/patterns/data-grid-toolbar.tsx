"use client";

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
      {leading ? null : views.length ? <SelectField label="Table view" selectedKey={activeView} onSelectionChange={key => key && onViewChange(String(key))} items={views} /> : !compact ? <span className="wd-record-view"><Table2 size={14} />Table view</span> : null}
      <DialogTrigger>
        <Button variant="quiet" size="compact" aria-label="Manage columns"><Columns3 size={14} /><span>Configure columns</span></Button>
        <Popover {...portalTheme} UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-column-popover" dir={direction} placement="bottom start"><Dialog aria-label="Visible columns" className="wd-column-menu">
          <strong>Columns</strong>
          {columns.map(column => <Checkbox key={column.id} isDisabled={!column.getCanHide()} isSelected={column.getIsVisible()} onChange={column.toggleVisibility}>{typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id}</Checkbox>)}
          <Button size="compact" variant="quiet" onPress={() => table.resetColumnVisibility()}>Reset columns</Button>
        </Dialog></Popover>
      </DialogTrigger>
      {hasMoreRows ? <span className="wd-record-count" title="Load more to include older records."><Rows3 size={14} />{table.getFilteredRowModel().rows.length} loaded</span> : null}
      <DialogTrigger>
        <Button variant="quiet" size="compact" aria-label="Filter" isDisabled={!filterable.length}><Filter size={14} /><span>{filters.length ? `${filters.length} filter${filters.length === 1 ? '' : 's'}` : 'Filter'}</span></Button>
        <Popover {...portalTheme} UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-record-panel" dir={direction} placement="bottom start"><Dialog aria-label="Filter records">{({ close }) => <>
          <header><strong>Filter records</strong><IconButton aria-label="Close filters" onPress={close} size="compact"><X size={14} /></IconButton></header>
          <SelectField label="Column" items={columnItems(filterable)} selectedKey={filterColumn?.id} onSelectionChange={key => key && setFilterId(String(key))} />
          {options ? <SelectField label={`Filter by ${String(filterColumn?.columnDef.header).toLowerCase()}`} selectedKey={String(filterColumn?.getFilterValue() ?? '__all')} items={[{ id: '__all', label: 'All values' }, ...options]} onSelectionChange={key => filterColumn?.setFilterValue(key === '__all' ? undefined : String(key))} /> : <TextInput label="Contains" value={String(filterColumn?.getFilterValue() ?? '')} onChange={value => filterColumn?.setFilterValue(value || undefined)} placeholder="Enter a value…" />}
          {filters.length > 1 && <p className="wd-record-filter-summary">{filters.map(filter => `${table.getColumn(filter.id)?.columnDef.header}: ${filter.value}`).join(' · ')}</p>}
          <footer><Button size="compact" variant="quiet" isDisabled={!filters.length} onPress={() => table.resetColumnFilters()}>Clear filters</Button><Button size="compact" onPress={close}>Done</Button></footer>
        </>}</Dialog></Popover>
      </DialogTrigger>
      <DialogTrigger>
        <Button variant="quiet" size="compact" aria-label="Sort" isDisabled={!sortable.length}><ArrowDownWideNarrow size={14} /><span>Sort{sort ? ` · ${table.getState().sorting.length}` : ''}</span></Button>
        <Popover {...portalTheme} UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-record-panel" dir={direction} placement="bottom start"><Dialog aria-label="Sort records">{({ close }) => <>
          <header><strong>Sort records</strong><IconButton aria-label="Close sorting" onPress={close} size="compact"><X size={14} /></IconButton></header>
          <SelectField label="Sort by" items={[{ id: '__none', label: 'Default order' }, ...columnItems(sortable)]} selectedKey={sort?.id ?? '__none'} onSelectionChange={key => table.setSorting(key === '__none' ? [] : [{ id: String(key), desc: false }])} />
          <SelectField label="Direction" items={[{ id: 'asc', label: 'Ascending' }, { id: 'desc', label: 'Descending' }]} isDisabled={!sort} selectedKey={sort?.desc ? 'desc' : 'asc'} onSelectionChange={key => sort && table.setSorting([{ ...sort, desc: key === 'desc' }])} />
          <footer><Button variant="quiet" size="compact" isDisabled={!sort} onPress={() => table.resetSorting()}>Clear sort</Button><Button size="compact" onPress={close}>Done</Button></footer>
        </>}</Dialog></Popover>
      </DialogTrigger>
      </div>
      <form className="wd-record-search" onSubmit={event => event.preventDefault()}>
        <SearchInput label={searchLabel} placeholder="Search…" value={searchValue ?? String(table.getState().globalFilter ?? '')} onChange={value => onSearchChange ? onSearchChange(value) : table.setGlobalFilter(value)} />
      </form>
    </div>
    <div className="wd-record-actions"><Button size="compact" variant="quiet" onPress={onExport} aria-label={table.getSelectedRowModel().rows.length ? 'Export selected rows' : 'Export filtered rows'}><Download size={14} aria-hidden="true"/><span>Export</span></Button>{actions}</div>
  </header>;
}
