import type { ReactNode } from "react";
import styles from "./ui.module.css";

export type DataColumn<Row> = {
  align?: "start" | "end";
  header: string;
  key: string;
  render: (row: Row) => ReactNode;
};

export function DataTable<Row>({
  caption,
  columns,
  getRowKey,
  rows,
}: {
  caption: string;
  columns: DataColumn<Row>[];
  getRowKey: (row: Row) => string;
  rows: Row[];
}) {
  return (
    <div className={styles.tableWrap}>
      <table data-record-table="" className={styles.table}>
        <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{caption}</caption>
        <thead>
          <tr>{columns.map((column) => <th className={column.align === "end" ? styles.number : undefined} key={column.key} scope="col">{column.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((column) => <td className={column.align === "end" ? styles.number : undefined} key={column.key}>{column.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const tableText = {
  primary: styles.tablePrimary,
  secondary: styles.tableSecondary,
};
