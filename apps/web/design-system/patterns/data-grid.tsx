"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type CSSProperties,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type ExpandedState,
  type PaginationState,
  type Row,
  type RowSelectionState,
  type SortingState,
  type Table,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Hash, X } from "lucide-react";
import { IconButton } from "../components/actions";
import { Checkbox } from "../components/forms";
import { InspectorSheet } from "../components/overlays";
import { Badge, EmptyState, ErrorState, Skeleton } from "../components/status";
import { Pagination } from "../components/navigation";
import { DataGridToolbar } from "./data-grid-toolbar";

export type CellEditorContext<T> = { columnId: string; row: T; value: unknown };
export type DataGridColumnMeta<T> = {
  /** Render controlled fields without changing their React component identity on each edit. */
  renderCell?: (row: T) => ReactNode;
  align?: "start" | "center" | "end";
  editable?: boolean;
  editor?: (context: CellEditorContext<T>) => ReactNode;
  mobileHidden?: boolean;
  primary?: boolean;
  headerIcon?: ReactNode;
  filterOptions?: { id: string; label: string }[];
  validate?: (value: string, row: T) => string | undefined;
};
export type DataGridColumn<T> = ColumnDef<T, unknown> & { meta?: DataGridColumnMeta<T> };
export type SavedView = { id: string; label: string };

export type DataGridProps<T> = {
  appearance?: "card" | "flush";
  ariaLabel: string;
  bulkActions?: (rows: T[]) => ReactNode;
  columns: DataGridColumn<T>[];
  data: T[];
  emptyDescription?: string;
  emptyTitle?: string;
  error?: string | null;
  exportFileName?: string;
  getInspectorTitle?: (row: T) => string;
  getRowId: (row: T) => string;
  getRowDragHandlers?: (row: T) => Pick<HTMLAttributes<HTMLTableRowElement>, "onDragOver" | "onDrop">;
  getSubRows?: (row: T) => T[] | undefined;
  isLoading?: boolean;
  isInspectorDirty?: boolean;
  manualPagination?: boolean;
  onCellUpdate?: (row: T, columnId: string, value: string) => void | Promise<void>;
  onExport?: (rows: T[]) => void;
  onPageChange?: (page: number) => void;
  page?: number;
  onRowAction?: (row: T) => void;
  pageCount?: number;
  pageSize?: number;
  persistKey?: string;
  renderInspector?: (row: T, close: () => void) => ReactNode;
  renderSubtable?: (row: T) => ReactNode;
  selectable?: boolean;
  showFooter?: boolean;
  showToolbar?: boolean;
  toolbarActions?: ReactNode;
  footerActions?: ReactNode;
  searchLabel?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  rowNumbers?: boolean;
  pinFirstColumn?: boolean;
  hasMoreRows?: boolean;
  totalRowCount?: number;
  initialColumnVisibility?: VisibilityState;
  savedViews?: SavedView[];
  selectedView?: string;
  onViewChange?: (view: string) => void;
  virtualizeAfter?: number;
};

function updateUrlState(key: string, value: object) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set(key, btoa(encodeURIComponent(JSON.stringify(value))));
  window.history.replaceState(null, "", url);
}

function readUrlState<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const value = new URL(window.location.href).searchParams.get(key);
    return value ? JSON.parse(decodeURIComponent(atob(value))) as T : fallback;
  } catch { return fallback; }
}

function downloadCsv<T>(table: Table<T>, rows: Row<T>[], fileName: string) {
  const columns = table.getVisibleLeafColumns().filter((column) => !column.id.startsWith("__"));
  const quote = (value: unknown) => { const text = String(value ?? ""); return `"${(/^[=+@\-\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`; };
  const csv = [
    columns.map((column) => quote(typeof column.columnDef.header === "string" ? column.columnDef.header : column.id)).join(","),
    ...rows.map((row) => columns.map((column) => quote(row.getValue(column.id))).join(",")),
  ].join("\n");
  const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  anchor.click();
  URL.revokeObjectURL(href);
}

function EditableCell<T>({ columnId, display, meta, onOpen, onUpdate, row, value }: { columnId: string; display: ReactNode; meta?: DataGridColumnMeta<T>; onOpen?: () => void; onUpdate?: DataGridProps<T>["onCellUpdate"]; row: T; value: unknown }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const commitPhase=useRef<"idle"|"saving"|"closed">("idle");
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);
  const commit = async () => {
    if(commitPhase.current==='closed')return true;
    if(commitPhase.current==='saving')return false;
    const nextError = meta?.validate?.(draft, row);
    if (nextError) { setError(nextError); return false; }
    try {
      commitPhase.current='saving';
      await onUpdate?.(row, columnId, draft);
      commitPhase.current='closed';
      setError(undefined);
      setEditing(false);
      return true;
    } catch (cause) {
      commitPhase.current='idle';
      setError(cause instanceof Error && cause.message ? cause.message : "Could not save this value");
      return false;
    }
  };
  const cancel = () => { if(commitPhase.current==='saving')return;commitPhase.current='closed';setDraft(String(value ?? "")); setError(undefined); setEditing(false); };
  const keyDown = async (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
    if (event.key === "Enter") { event.preventDefault(); await commit(); }
    if (event.key === "Tab") { if (!(await commit())) event.preventDefault(); }
  };
  if (!meta?.editable || !editing) return <button className="wd-grid-value" data-primary={meta?.primary || undefined} onClick={(event) => { event.stopPropagation(); if (meta?.editable) { commitPhase.current="idle";setDraft(String(value ?? "")); setEditing(true); } else if (meta?.primary) onOpen?.(); }} onKeyDown={(event) => { if (meta?.editable && event.key === "Enter") { event.stopPropagation(); commitPhase.current="idle";setDraft(String(value ?? "")); setEditing(true); } }} type="button">{display}</button>;
  if (meta.editor) return <>{meta.editor({ columnId, row, value })}</>;
  return <span className="wd-cell-editor" data-invalid={Boolean(error)}><input aria-invalid={Boolean(error)} aria-label={`Edit ${columnId}`} onBlur={() => void commit()} onChange={(event) => setDraft(event.target.value)} onClick={(event) => event.stopPropagation()} onKeyDown={keyDown} ref={input} value={draft} />{error ? <small role="alert">{error}</small> : null}</span>;
}

function SortIcon({ direction }: { direction: false | "asc" | "desc" }) {
  return direction === "asc" ? <ArrowUp size={13} /> : direction === "desc" ? <ArrowDown size={13} /> : <ArrowUpDown size={13} />;
}

export function DataGrid<T>({
  appearance = "card",
  ariaLabel,
  bulkActions,
  columns,
  data,
  emptyDescription = "Create a record or adjust the current filters.",
  emptyTitle = "No records found",
  error,
  exportFileName = "wodana-export.csv",
  getRowId,
  getRowDragHandlers,
  getInspectorTitle,
  getSubRows,
  isLoading = false,
  isInspectorDirty = false,
  manualPagination = false,
  onCellUpdate,
  onExport,
  onPageChange,
  page,
  onRowAction,
  pageCount,
  pageSize = 25,
  persistKey,
  renderInspector,
  renderSubtable,
  selectable = true,
  savedViews = [],
  selectedView,
  showFooter = true,
  showToolbar = true,
  toolbarActions,
  footerActions,
  searchLabel = "Search records",
  searchValue,
  onSearchChange,
  rowNumbers = true,
  pinFirstColumn = true,
  hasMoreRows,
  totalRowCount,
  initialColumnVisibility = {},
  onViewChange,
  virtualizeAfter = 150,
}: DataGridProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [internalView, setInternalView] = useState(selectedView ?? savedViews[0]?.id);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [defaultVisibility] = useState(initialColumnVisibility);
  const [visibility, setVisibility] = useState<VisibilityState>(defaultVisibility);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize });
  const [inspected, setInspected] = useState<T | null>(null);
  const persistenceKey = persistKey ? `${persistKey}-view` : undefined;
  const hydratedPersistenceKey = useRef<string | undefined>(undefined);

  const leadingColumns = useMemo<DataGridColumn<T>[]>(() => selectable || rowNumbers ? [
    { id: "__select", size: 44, enableHiding: false, enableSorting: false, enableResizing: false,
      header: ({ table }) => selectable ? <Checkbox aria-label="Select all visible rows" isIndeterminate={table.getIsSomePageRowsSelected()} isSelected={table.getIsAllPageRowsSelected()} onChange={table.toggleAllPageRowsSelected} /> : <Hash aria-label="Row number" size={13} />,
      cell: ({ row, table }) => <span className="wd-row-index" data-selectable={selectable || undefined}>
        {rowNumbers && <span aria-hidden={selectable || undefined}>{(manualPagination ? table.getState().pagination.pageIndex * table.getState().pagination.pageSize : 0) + table.getPrePaginationRowModel().rows.findIndex(item => item.id === row.id) + 1}</span>}
        {selectable && <Checkbox aria-label={`Select row ${row.index + 1}`} isSelected={row.getIsSelected()} onChange={row.toggleSelected} />}
      </span> },
  ] : [], [selectable, rowNumbers, manualPagination]);
  const trailingColumns = useMemo<DataGridColumn<T>[]>(() => getSubRows || renderSubtable ? [
    { id: "__expand", size: 42, enableSorting: false, enableResizing: false, header: () => <span className="wd-visually-hidden">Row details</span>, cell: ({ row }: { row: Row<T> }) => row.getCanExpand() || renderSubtable ? <IconButton aria-label={row.getIsExpanded() ? "Collapse row" : "Expand row"} onPress={() => row.toggleExpanded()} size="compact">{row.getIsExpanded() ? <ChevronDown size={14} /> : <ChevronRight data-directional="true" size={14} />}</IconButton> : null },
  ] : [], [getSubRows, renderSubtable]);

  // TanStack Table intentionally exposes mutable callback references; the React compiler skips this hook.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    columns: [...leadingColumns, ...columns.map((column, index) => pinFirstColumn && index === 0 ? { ...column, enableHiding: false } : column), ...trailingColumns] as ColumnDef<T, unknown>[],
    data,
    initialState: { columnVisibility: defaultVisibility },
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    enableRowSelection: selectable,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: manualPagination ? undefined : getPaginationRowModel(),
    getRowId,
    getSortedRowModel: getSortedRowModel(),
    getSubRows,
    globalFilterFn: "includesString",
    manualPagination,
    onColumnVisibilityChange: setVisibility,
    onColumnFiltersChange: setColumnFilters,
    onExpandedChange: setExpanded,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    onRowSelectionChange: setSelection,
    onSortingChange: setSorting,
    pageCount,
    state: { columnFilters, columnVisibility: visibility, expanded, globalFilter, pagination: page === undefined ? pagination : { ...pagination, pageIndex: Math.max(0, page - 1) }, rowSelection: selection, sorting },
  });

  useEffect(() => {
    if (!persistenceKey) return;
    const saved = readUrlState(persistenceKey, { sorting: [] as SortingState, visibility: defaultVisibility });
    setSorting(saved.sorting);
    setVisibility(saved.visibility);
  }, [persistenceKey, defaultVisibility]);
  useEffect(() => {
    if (!persistenceKey) return;
    if (hydratedPersistenceKey.current !== persistenceKey) {
      hydratedPersistenceKey.current = persistenceKey;
      return;
    }
    updateUrlState(persistenceKey, { sorting, visibility });
  }, [persistenceKey, sorting, visibility]);

  const rows = table.getRowModel().rows;
  const selectedRows = table.getSelectedRowModel().flatRows.map((row) => row.original);
  const activeView = selectedView ?? internalView;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = rows.length > virtualizeAfter;
  const rowVirtualizer = useVirtualizer({ count: virtual ? rows.length : 0, getScrollElement: () => scrollRef.current, estimateSize: () => 48, overscan: 8 });
  const visibleRows = virtual ? rowVirtualizer.getVirtualItems().map((item) => ({ row: rows[item.index], virtual: item })) : rows.map((row) => ({ row, virtual: null }));
  const firstColumn = table.getVisibleLeafColumns().find(column => !column.id.startsWith('__'))?.id;
  const isPinned = (id: string) => id === '__select' || (pinFirstColumn && id === firstColumn);
  const columnStyle = (id: string, size: number): CSSProperties => ({ inlineSize: size, "--wd-record-column-size": `${size}px`, ...(isPinned(id) ? { position: 'sticky', insetInlineStart: id === '__select' ? 0 : leadingColumns.length ? 44 : 0 } : {}) } as CSSProperties);
  const exportRows = () => {
    const chosen = table.getSelectedRowModel().rows;
    const all = chosen.length ? chosen : table.getSortedRowModel().rows;
    if (onExport) onExport(all.map(row => row.original)); else downloadCsv(table, all, exportFileName);
  };
  const resolvedPageCount = Math.max(1, pageCount ?? table.getPageCount());

  const openRow = (row: T) => { if (onRowAction) onRowAction(row); else if (renderInspector) setInspected(row); };
  const rowClick = (event: React.MouseEvent, row: T) => {
    if ((event.target as HTMLElement).closest("button,input,a,select,textarea,[data-grid-interactive]")) return;
    openRow(row);
  };

  return <section className="wd-data-grid" aria-label={ariaLabel} data-appearance={appearance} data-row-numbers={rowNumbers || undefined}>
    {showToolbar ? <DataGridToolbar table={table} views={savedViews} activeView={activeView} onViewChange={id => { setInternalView(id); onViewChange?.(id); }} searchLabel={searchLabel} searchValue={searchValue} onSearchChange={onSearchChange} actions={toolbarActions} onExport={exportRows} hasMoreRows={hasMoreRows} totalRowCount={totalRowCount} /> : null}
    {selectedRows.length ? <div className="wd-bulk-bar"><strong>{selectedRows.length} selected</strong><div>{bulkActions?.(selectedRows)}</div><IconButton aria-label="Clear selection" onPress={() => setSelection({})}><X size={14} /></IconButton></div> : null}
    {error ? <ErrorState title={error} /> : isLoading ? <div aria-label={`Loading ${ariaLabel}`} className="wd-grid-loading" role="status"><Skeleton lines={6} /></div> : !rows.length ? <EmptyState description={emptyDescription} title={emptyTitle} /> : <div className="wd-table-scroll" ref={scrollRef} tabIndex={0}>
      <table aria-label={ariaLabel} className="wd-table wd-record-table" data-virtual={virtual || undefined} style={{ inlineSize: table.getCenterTotalSize(), minInlineSize: "100%" }}>
        <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => { const meta = header.column.columnDef.meta as DataGridColumnMeta<T> | undefined; return <th data-column={header.column.id} data-pinned={isPinned(header.column.id) ? (header.column.id === '__select' ? 'index' : 'primary') : undefined} aria-sort={header.column.getIsSorted() ? (header.column.getIsSorted() === 'asc' ? 'ascending' : 'descending') : undefined} data-mobile-hidden={meta?.mobileHidden || undefined} data-primary={meta?.primary || undefined} key={header.id} style={columnStyle(header.column.id, header.getSize())}>{header.column.getCanSort() ? <button className="wd-sort-button" onClick={header.column.getToggleSortingHandler()} type="button"><span>{flexRender(header.column.columnDef.header, header.getContext())}</span><SortIcon direction={header.column.getIsSorted()} /></button> : <div className="wd-column-header">{flexRender(header.column.columnDef.header, header.getContext())}</div>}{header.column.getCanResize() ? <span className="wd-resizer" data-resizing={header.column.getIsResizing() || undefined} onDoubleClick={() => header.column.resetSize()} onMouseDown={header.getResizeHandler()} onTouchStart={header.getResizeHandler()} /> : null}</th>; })}</tr>)}</thead>
        <tbody style={virtual ? { blockSize: rowVirtualizer.getTotalSize(), display: "block", position: "relative" } : undefined}>{visibleRows.map(({ row, virtual: virtualRow }) => <Fragment key={row.id}><tr {...getRowDragHandlers?.(row.original)} className="wd-table-row" data-index={virtualRow?.index} ref={virtualRow ? rowVirtualizer.measureElement : undefined} tabIndex={onRowAction || renderInspector ? 0 : undefined} data-actionable={Boolean(onRowAction || renderInspector) || undefined} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openRow(row.original); } }} data-selected={row.getIsSelected() || undefined} onClick={(event) => rowClick(event, row.original)} style={virtualRow ? { display: "table", tableLayout: "fixed", position: "absolute", transform: `translateY(${virtualRow.start}px)`, inlineSize: "100%" } : undefined}>{row.getVisibleCells().map((cell) => { const meta = cell.column.columnDef.meta as DataGridColumnMeta<T> | undefined; const content = meta?.renderCell ? meta.renderCell(row.original) : flexRender(cell.column.columnDef.cell, cell.getContext()); return <td data-align={meta?.align} data-column={cell.column.id} data-pinned={isPinned(cell.column.id) ? (cell.column.id === '__select' ? 'index' : 'primary') : undefined} data-mobile-hidden={meta?.mobileHidden || undefined} data-primary={meta?.primary || undefined} key={cell.id} onDoubleClick={(event) => event.stopPropagation()} style={columnStyle(cell.column.id, cell.column.getSize())}>{meta?.editable || (meta?.primary && (renderInspector || onRowAction)) ? <EditableCell columnId={cell.column.id} display={content} meta={meta} onOpen={() => openRow(row.original)} onUpdate={onCellUpdate} row={row.original} value={cell.getValue()} /> : content}</td>; })}</tr>{row.getIsExpanded() ? <tr className="wd-subtable-row"><td colSpan={row.getVisibleCells().length}>{renderSubtable ? renderSubtable(row.original) : null}</td></tr> : null}</Fragment>)}</tbody>
      </table>
    </div>}
    {showFooter ? <footer className="wd-grid-footer"><span>{selectedRows.length ? `${selectedRows.length} selected · ` : ""}{rows.length === (totalRowCount ?? data.length) ? `${rows.length} record${rows.length === 1 ? "" : "s"}` : `${rows.length} of ${(totalRowCount ?? data.length).toLocaleString()} shown`}</span><div className="wd-record-footer-actions">{footerActions}{resolvedPageCount > 1 ? <Pagination ariaLabel={`${ariaLabel} pagination`} onPageChange={(nextPage) => { table.setPageIndex(nextPage - 1); onPageChange?.(nextPage); }} page={Math.min(page ?? pagination.pageIndex + 1, resolvedPageCount)} pageCount={resolvedPageCount} /> : null}</div></footer> : null}
    {renderInspector && inspected ? <InspectorSheet isDirty={isInspectorDirty} isOpen onOpenChange={(open) => { if (!open) setInspected(null); }} size="md" title={getInspectorTitle?.(inspected) ?? "Record details"}>{renderInspector(inspected, () => setInspected(null))}</InspectorSheet> : null}
  </section>;
}

export function Subtable({ children, title }: { children: ReactNode; title?: string }) { return <div className="wd-subtable">{title ? <strong>{title}</strong> : null}{children}</div>; }

export function DataGridStatus({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" | "info" }) { return <Badge tone={tone}>{children}</Badge>; }
