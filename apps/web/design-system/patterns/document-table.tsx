import type { ReactNode } from "react";

export type DocumentColumn<T> = {
  id: string;
  header: ReactNode;
  /** Amounts and quantities sit at the inline end. */
  align?: "start" | "end";
  cell: (row: T) => ReactNode;
};
export type DocumentGroup<T> = { key: string; title?: ReactNode; total?: ReactNode; rows: T[]; tone?: "muted" };
export type DocumentSummaryRow = { key: string; label: ReactNode; value: ReactNode; emphasis?: boolean };

/**
 * The one table for documents people print or read as a record (a sealed scope, an invoice, a gate list):
 * a header row, optional groups with their subtotal, and a summary (subtotal, tax, total) at the end. Lists
 * people work in use DataGrid / RecordTable instead.
 */
export function DocumentTable<T>({ className, columns, getRowKey, groups, label, rows, summary }: {
  label: string;
  columns: DocumentColumn<T>[];
  getRowKey: (row: T, index: number) => string;
  rows?: T[];
  groups?: DocumentGroup<T>[];
  summary?: DocumentSummaryRow[];
  className?: string;
}) {
  const span = columns.length;
  const body = (items: T[]) => items.map((row, index) => <tr key={getRowKey(row, index)}>
    {columns.map((column) => <td data-align={column.align} key={column.id}>{column.cell(row)}</td>)}
  </tr>);
  return <table aria-label={label} className={["wd-document-table", className].filter(Boolean).join(" ")}>
    <thead><tr>{columns.map((column) => <th data-align={column.align} key={column.id} scope="col">{column.header}</th>)}</tr></thead>
    {groups ? groups.map((group) => <tbody data-tone={group.tone} key={group.key}>
      {group.title !== undefined ? <tr className="wd-document-group">
        <th colSpan={group.total !== undefined ? span - 1 : span} scope="rowgroup">{group.title}</th>
        {group.total !== undefined ? <td data-align="end">{group.total}</td> : null}
      </tr> : null}
      {body(group.rows)}
    </tbody>) : <tbody>{body(rows ?? [])}</tbody>}
    {summary?.length ? <tfoot>{summary.map((row) => <tr data-emphasis={row.emphasis || undefined} key={row.key}>
      <th colSpan={span - 1} scope="row">{row.label}</th><td data-align="end">{row.value}</td>
    </tr>)}</tfoot> : null}
  </table>;
}
