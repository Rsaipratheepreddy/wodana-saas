"use client";

import { useState } from "react";
import Link from "next/link";
import { Avatar, Badge, DataGrid, type DataGridColumn } from "@/design-system";
import type { PortfolioRow } from "./project-portfolio";
import styles from "./client-projects.module.css";

export function ClientProjects({ rows }: { rows: PortfolioRow[] }) {
  const [search, setSearch] = useState("");
  const columns: DataGridColumn<PortfolioRow>[] = [
    { accessorKey: "customer", header: "Client", meta: { renderCell: row => <span className={styles.client}><Avatar name={row.customer} size="sm" /><strong>{row.customer}</strong></span> } },
    { accessorKey: "name", header: "Project" },
    { accessorKey: "manager", header: "Owner", meta: { renderCell: row => row.manager || "Unassigned" } },
    { accessorKey: "phase", header: "Status", meta: { renderCell: row => <Badge tone={row.phase === "completed" ? "success" : "info"}>{row.phase === "active" ? "In progress" : row.phase.replaceAll("_", " ")}</Badge> } },
    { id: "actions", header: "Actions", meta: { renderCell: row => <Link className={styles.action} href={`/workspace/projects/${row.id}/overview?view=client-updates`}>Client updates →</Link> } },
  ];
  const filtered = rows.filter(row => `${row.customer} ${row.name} ${row.manager ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  return <section className={styles.page} aria-label="Clients">
    <DataGrid ariaLabel="Client projects" columns={columns} data={filtered} gridLines getRowId={row => row.id}
      searchLabel="Search clients and projects" searchValue={search} onSearchChange={setSearch}
      emptyTitle={rows.length ? "No matching clients" : "No client projects yet"}
      emptyDescription={rows.length ? "Try a client or project name." : "Projects appear here once execution is set up."}
      persistKey="client-projects" rowNumbers={false} pageSize={25} />
  </section>;
}
