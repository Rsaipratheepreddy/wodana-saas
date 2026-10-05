"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useState, type ReactNode } from "react";
import type { Table } from "@tanstack/react-table";
import { Download, Filter, MoreHorizontal, Rows3, X } from "lucide-react";
import { Dialog, DialogTrigger, Popover } from "react-aria-components";
import { Button, IconButton } from "../components/actions";
import { Checkbox, SearchInput, SelectField, TextInput } from "../components/forms";
import type { DataGridColumnMeta, SavedView } from "./data-grid";
import { useDesignSystem, usePortalThemeAttributes } from "../foundations/provider";

/** A filter that is not a column (e.g. Active / On hold): it is offered under "Filter" and shown as a chip once used. */
export type ToolbarFilter = { id: string; label: string; options: Array<{ id: string; label: string }>; value?: string; onChange: (value: string | undefined) => void };

type FilterTarget = { id: string; label: string; options?: Array<{ id: string; label: string }>; value: string | undefined; set: (value: string | undefined) => void };

/**
 * The toolbar above every list (§5c D1): the view switch or tabs at the start; at the end a search icon that
 * opens when used, "Filter" (each filter in use becomes a removable chip) and ⋯ (sort, columns, export).
 * Nothing else: page actions belong in the page header.
 */
/** The one search of every toolbar (§5c D1): a search icon until it is focused or holds text, then a compact field. */
export function ToolbarSearch({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const t = useT();
  return <form className="wd-record-search" data-collapsible="" data-open={value ? true : undefined} onSubmit={event => event.preventDefault()}>
    <SearchInput label={label} placeholder={t("Search…")} value={value} onChange={onChange} />
  </form>;
}

export function DataGridToolbar<T>({ compact = false, leading, title, table, views, activeView, onViewChange, searchLabel, searchValue, onSearchChange, actions, onExport, hasMoreRows, filters = [], menuActions = [], onMenuAction, onResetColumns, onSaveColumnDefault }: {
  compact?: boolean; /** Replaces the title/view switch at the start, e.g. list tabs. */ leading?: ReactNode; title?: string; table: Table<T>; views: SavedView[]; activeView?: string; onViewChange: (id: string) => void;
  searchLabel: string; actions?: ReactNode; onExport: () => void; hasMoreRows?: boolean; totalRowCount?: number;
  searchValue?: string; onSearchChange?: (value: string) => void; filters?: ToolbarFilter[];
  /** The page's secondary actions (import, review…), listed first in the ⋯ menu so a list has one ⋯, never two. */
  menuActions?: Array<{ id: string; label: string }>; onMenuAction?: (id: string) => void;
  /** Back to the columns everyone starts with (the workspace default when the list has one). */
  onResetColumns?: () => void;
  /** Only for people who manage the module: the current columns become the default for everyone. */
  onSaveColumnDefault?: () => Promise<void>;
}) {
  const t = useT();
  const { portalContainer, direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  const columns = table.getAllLeafColumns().filter(column => !column.id.startsWith('__'));
  const header = (column: (typeof columns)[number]) => String(column.columnDef.header);
  const targets: FilterTarget[] = [
    ...filters.map(filter => ({ id: `filter:${filter.id}`, label: filter.label, options: filter.options, value: filter.value, set: filter.onChange })),
    ...columns.filter(column => column.getCanFilter() && typeof column.columnDef.header === 'string').map(column => ({
      id: column.id, label: header(column), options: (column.columnDef.meta as DataGridColumnMeta<T> | undefined)?.filterOptions,
      value: column.getFilterValue() === undefined ? undefined : String(column.getFilterValue()), set: (value: string | undefined) => column.setFilterValue(value),
    })),
  ];
  const sortable = columns.filter(column => column.getCanSort() && typeof column.columnDef.header === 'string');
  const [targetId, setTargetId] = useState('');
  const [defaultState, setDefaultState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const saveColumnDefault = async () => {
    if (!onSaveColumnDefault) return;
    setDefaultState('saving');
    try { await onSaveColumnDefault(); setDefaultState('saved'); } catch { setDefaultState('failed'); }
  };
  const target = targets.find(item => item.id === targetId) ?? targets[0];
  const active = targets.filter(item => item.value !== undefined && item.value !== '');
  const sort = table.getState().sorting[0];
  const exportLabel = table.getSelectedRowModel().rows.length ? t("Export selected rows") : t("Export filtered rows");
  const valueLabel = (item: FilterTarget) => item.options?.find(option => option.id === item.value)?.label ?? item.value;
  const viewSwitch = views.length ? <SelectField label={t("Table view")} selectedKey={activeView} onSelectionChange={key => key && onViewChange(String(key))} items={views} /> : null;
  const search = searchValue ?? String(table.getState().globalFilter ?? '');

  return <header className="wd-grid-toolbar wd-record-toolbar" data-compact={compact || undefined} data-leading={leading ? true : undefined}>
    {leading ? <div className="wd-grid-leading">{leading}</div> : title ? <strong className="wd-grid-title">{title}</strong> : null}
    {active.length ? <div aria-label={t("Filters in use")} className="wd-filter-chips" role="group">{active.map(item => <span className="wd-filter-chip" key={item.id}>
      <span><span className="wd-filter-chip-label">{item.label}</span> {valueLabel(item)}</span>
      <IconButton aria-label={t("Remove filter {name}", { name: item.label })} onPress={() => item.set(undefined)} size="compact"><X size={12} /></IconButton>
    </span>)}</div> : null}
    <div className="wd-record-tools">
      <div className="wd-record-controls">
        {leading ? null : viewSwitch}
        {hasMoreRows ? <span className="wd-record-count" title={t("Load more to include older records.")}><Rows3 size={14} />{t("{count} loaded", { count: table.getFilteredRowModel().rows.length })}</span> : null}
        <ToolbarSearch label={searchLabel} value={search} onChange={value => onSearchChange ? onSearchChange(value) : table.setGlobalFilter(value)} />
        {targets.length ? <DialogTrigger>
          <Button variant="quiet" size="compact" aria-label={t("Filter")}><Filter size={14} /><span>{t("Filter")}</span></Button>
          <Popover {...portalTheme} UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-record-panel" dir={direction} placement="bottom end"><Dialog aria-label={t("Filter records")}>{({ close }) => <>
            <header><strong>{t("Filter records")}</strong><IconButton aria-label={t("Close filters")} onPress={close} size="compact"><X size={14} /></IconButton></header>
            <SelectField label={t("Column")} items={targets.map(item => ({ id: item.id, label: item.label }))} selectedKey={target?.id} onSelectionChange={key => key && setTargetId(String(key))} />
            {target?.options ? <SelectField label={t("Filter by {column}", { column: target.label.toLowerCase() })} selectedKey={target.value ?? '__all'} items={[{ id: '__all', label: t("All values") }, ...target.options]} onSelectionChange={key => target.set(key === '__all' ? undefined : String(key))} />
              : target ? <TextInput label={t("Contains")} value={target.value ?? ''} onChange={value => target.set(value || undefined)} placeholder={t("Enter a value…")} /> : null}
            <footer><Button size="compact" variant="quiet" isDisabled={!active.length} onPress={() => active.forEach(item => item.set(undefined))}>{t("Clear filters")}</Button><Button size="compact" onPress={close}>{t("Done")}</Button></footer>
          </>}</Dialog></Popover>
        </DialogTrigger> : null}
        {leading ? viewSwitch : null}
        <DialogTrigger>
          <IconButton aria-label={t("Table options")} size="compact"><MoreHorizontal size={16} /></IconButton>
          <Popover {...portalTheme} UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-record-panel wd-table-options" dir={direction} placement="bottom end"><Dialog aria-label={t("Table options")}>{({ close }) => <>
            {menuActions.length ? <section className="wd-record-menu-actions">{menuActions.map(item => <Button key={item.id} size="compact" variant="quiet" onPress={() => { close(); onMenuAction?.(item.id); }}>{item.label}</Button>)}</section> : null}
            {sortable.length ? <section>
              <strong>{t("Sort")}</strong>
              <SelectField label={t("Sort by")} items={[{ id: '__none', label: t("Default order") }, ...sortable.map(column => ({ id: column.id, label: header(column) }))]} selectedKey={sort?.id ?? '__none'} onSelectionChange={key => table.setSorting(key === '__none' ? [] : [{ id: String(key), desc: false }])} />
              {sort ? <SelectField label={t("Direction")} items={[{ id: 'asc', label: t("Ascending") }, { id: 'desc', label: t("Descending") }]} selectedKey={sort.desc ? 'desc' : 'asc'} onSelectionChange={key => table.setSorting([{ ...sort, desc: key === 'desc' }])} /> : null}
            </section> : null}
            <section aria-label={t("Visible columns")}>
              <strong>{t("Columns")}</strong>
              {columns.map(column => <Checkbox key={column.id} isDisabled={!column.getCanHide() || Boolean((column.columnDef.meta as DataGridColumnMeta<T> | undefined)?.primary)} isSelected={column.getIsVisible()} onChange={value => { setDefaultState('idle'); column.toggleVisibility(value); }}>{typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id}</Checkbox>)}
              <Button size="compact" variant="quiet" onPress={() => { setDefaultState('idle'); if (onResetColumns) onResetColumns(); else table.resetColumnVisibility(); }}>{t("Reset columns")}</Button>
              {onSaveColumnDefault ? <Button size="compact" variant="quiet" intent="write" isLoading={defaultState === 'saving'} onPress={() => void saveColumnDefault()}>{t("Save as the default for everyone")}</Button> : null}
              {defaultState === 'saved' ? <p className="wd-record-filter-summary" role="status">{t("Saved as the default for everyone")}</p> : defaultState === 'failed' ? <p className="wd-record-filter-summary" role="alert">{t("The default could not be saved. Reload and try again.")}</p> : null}
            </section>
            <footer><Button size="compact" variant="quiet" onPress={onExport} aria-label={exportLabel}><Download size={14} aria-hidden="true" /><span>{t("Export")}</span></Button></footer>
          </>}</Dialog></Popover>
        </DialogTrigger>
      </div>
    </div>
    {actions ? <div className="wd-record-actions">{actions}</div> : null}
  </header>;
}
