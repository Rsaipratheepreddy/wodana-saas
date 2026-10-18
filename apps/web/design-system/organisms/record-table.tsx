"use client";

import { DataGrid, type DataGridProps } from "../patterns/data-grid";

/** A read-only list in the shared table frame: DataGrid without column lines. */
export function RecordTable<T>(props: Omit<DataGridProps<T>, "gridLines">) {
  return <DataGrid {...props} />;
}
