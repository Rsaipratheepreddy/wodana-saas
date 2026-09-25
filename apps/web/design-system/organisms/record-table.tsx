"use client";

import { DataGrid, type DataGridProps } from "../patterns/data-grid";

/** The product's default compact, enclosed record-table composition. */
export function RecordTable<T>(props: Omit<DataGridProps<T>, "appearance" | "gridLines">) {
  return <DataGrid appearance="contained" {...props} />;
}
