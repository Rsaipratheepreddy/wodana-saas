"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useState } from "react";
import Link from "next/link";
import { Avatar, Badge, DataGrid, type DataGridColumn } from "@/design-system";
import { projectStatusText, type PortfolioRow } from "./project-portfolio";
import styles from "./client-projects.module.css";

export function ClientProjects({ rows }: { rows: PortfolioRow[] }) {
  const t = useT();
  const [search, setSearch] = useState("");
  const columns: DataGridColumn<PortfolioRow>[] = [
    { accessorKey: "customer", header: t("Client"), meta: { renderCell: row => <span className={styles.client}><Avatar name={row.customer} size="sm" /><strong>{row.customer}</strong></span> } },
    { accessorKey: "name", header: t("Project") },
    { accessorKey: "manager", header: t("Owner"), meta: { renderCell: row => row.manager || t("Unassigned") } },
    { accessorKey: "phase", header: t("Status"), meta: { renderCell: row => <Badge tone={row.phase === "completed" ? "success" : "info"}>{projectStatusText(t, row.phase)}</Badge> } },
    { id: "actions", header: t("Actions"), meta: { renderCell: row => <Link className={styles.action} href={`/workspace/projects/${row.id}/overview?view=client-updates`}>{t("Client updates →")}</Link> } },
  ];
  const filtered = rows.filter(row => `${row.customer} ${row.name} ${row.manager ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  return <section className={styles.page} aria-label={t("Clients")}>
    <DataGrid ariaLabel={t("Client projects")} columns={columns} data={filtered} gridLines getRowId={row => row.id}
      searchLabel={t("Search clients and projects")} searchValue={search} onSearchChange={setSearch}
      emptyTitle={rows.length ? t("No matching clients") : t("No client projects yet")}
      emptyDescription={rows.length ? t("Try a client or project name.") : t("Projects appear here once execution is set up.")}
      persistKey="client-projects" rowNumbers={false} pageSize={25} />
  </section>;
}
