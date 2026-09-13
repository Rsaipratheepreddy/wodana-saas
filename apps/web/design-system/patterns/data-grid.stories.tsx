"use client";

import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Badge } from "../components/status";
import { Button } from "../components/actions";
import { PropertyRow } from "../components/forms";
import { DataGrid, type DataGridColumn } from "./data-grid";

type Row = { id: string; project: string; owner: string; stage: string; value: number; status: "active" | "risk" };
const seed: Row[] = Array.from({ length: 180 }, (_, index) => ({ id: `P-${index + 1}`, project: index % 2 ? `Palm Villa ${index + 1}` : `Residence ${index + 1}`, owner: index % 3 ? "Diya Nair" : "Kabir Arora", stage: index % 2 ? "Design" : "Production", value: 120_000 + index * 3_500, status: index % 7 ? "active" : "risk" }));

function Example() {
  const [rows, setRows] = useState(seed);
  const [view, setView] = useState("all");
  const columns = useMemo<DataGridColumn<Row>[]>(() => [
    { accessorKey: "project", header: "Project", size: 240, meta: { primary: true } },
    { accessorKey: "owner", header: "Owner", size: 160 },
    { accessorKey: "stage", header: "Stage", size: 160, meta: { editable: true } },
    { accessorKey: "value", header: "Value", size: 130, meta: { align: "end" }, cell: ({ row }) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(row.original.value) },
    { accessorKey: "status", header: "Status", size: 110, cell: ({ row }) => <Badge tone={row.original.status === "risk" ? "danger" : "success"}>{row.original.status}</Badge> },
  ], []);
  const visibleRows = view === "risk" ? rows.filter((row) => row.status === "risk") : rows;
  return <DataGrid ariaLabel="Projects" bulkActions={(selected) => <Button onPress={() => setRows((items) => items.map((item) => selected.some((row) => row.id === item.id) ? { ...item, owner: "Diya Nair" } : item))} size="compact">Assign {selected.length} to me</Button>} columns={columns} data={visibleRows} getInspectorTitle={(row) => row.project} getRowId={(row) => row.id} onCellUpdate={(row, column, value) => setRows((items) => items.map((item) => item.id === row.id ? { ...item, [column]: value } : item))} onViewChange={setView} persistKey="storybook-grid" renderInspector={(row) => <><PropertyRow label="Project">{row.project}</PropertyRow><PropertyRow label="Stage">{row.stage}</PropertyRow></>} renderSubtable={(row) => <span>Tasks for {row.project}</span>} savedViews={[{ id: "all", label: "All projects" }, { id: "risk", label: "At risk" }]} selectedView={view} />;
}

function LargeDatasetExample() {
  const rows = useMemo<Row[]>(() => Array.from({ length: 10_000 }, (_, index) => ({ id: `PX-${index + 1}`, project: `Interior project ${index + 1}`, owner: index % 2 ? "Diya Nair" : "Kabir Arora", stage: index % 3 ? "Design" : "Production", value: 75_000 + index * 125, status: index % 11 ? "active" : "risk" })), []);
  const columns = useMemo<DataGridColumn<Row>[]>(() => [
    { accessorKey: "project", header: "Project", size: 260, meta: { primary: true } },
    { accessorKey: "owner", header: "Owner", size: 160 },
    { accessorKey: "stage", header: "Stage", size: 140 },
    { accessorKey: "value", header: "Value", size: 130, meta: { align: "end" } },
  ], []);
  return <DataGrid ariaLabel="Ten thousand projects" columns={columns} data={rows} getRowId={(row) => row.id} pageSize={10_000} virtualizeAfter={100} />;
}

const meta = { title: "Design system/DataGrid", component: Example, tags: ["autodocs"], parameters: { docs: { description: { component: "Composable enterprise grid with views, filtering, sorting, selection, resizing, inline editing, subtables, virtualization, and a fixed inspector." } } } } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { render: () => <Example /> };
export const TenThousandRows: Story = {
  render: () => <LargeDatasetExample />,
  parameters: { docs: { description: { story: "A 10,000-record dataset uses row virtualization while retaining table semantics, sorting, selection, and keyboard editing." } } },
};
