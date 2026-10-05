"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useState } from "react";
import Link from "next/link";
import { Badge, DataGrid, EmptyState, NoResultsState, OwnerCell, PageShell, RecordName, type DataGridColumn } from "@/design-system";
import { projectStatusText, type PortfolioRow } from "./project-portfolio";
import styles from "./client-projects.module.css";

/** Clients: each client's project, its owner and status, and the way into the client updates. */
export function ClientProjects({ rows }: { rows: PortfolioRow[] }) {
  const t = useT();
  const [search, setSearch] = useState("");
  const columns: DataGridColumn<PortfolioRow>[] = [
    { id: "customer", header: t("Client"), accessorFn: row => `${row.customer} ${row.name} ${row.reference}`, size: 280, meta: { primary: true,
      renderCell: row => <RecordName title={row.customer} detail={[row.name, row.reference].filter(Boolean).join(" · ")} /> } },
    { accessorKey: "manager", header: t("Owner"), size: 160, meta: { priority: "low", renderCell: row => <OwnerCell fallback={t("Unassigned")} person={row.manager} /> } },
    { accessorKey: "phase", header: t("Status"), size: 130, meta: { renderCell: row => <Badge tone={row.phase === "completed" ? "success" : "info"}>{projectStatusText(t, row.phase)}</Badge> } },
    { id: "actions", header: t("Actions"), size: 160, enableSorting: false, meta: { interactive: true, renderCell: row => <Link className={styles.action} href={`/workspace/projects/${row.id}/overview?view=client-updates`}>{t("Client updates")}</Link> } },
  ];
  const query = search.trim().toLowerCase();
  const filtered = rows.filter(row => `${row.customer} ${row.name} ${row.reference} ${row.manager ?? ""}`.toLowerCase().includes(query));
  return <PageShell title={t("Clients")}>
    <DataGrid ariaLabel={t("Client projects")} columns={columns} data={filtered} getRowId={row => row.id}
      searchLabel={t("Search clients and projects")} searchValue={search} onSearchChange={setSearch}
      emptyContent={query ? <NoResultsState onClear={() => setSearch("")} />
        : <EmptyState title={t("No client projects yet")} description={t("Projects appear here once execution is set up.")}
            action={<Link className={styles.action} href="/workspace/projects">{t("Open projects")}</Link>} />}
      persistKey="client-projects" rowNumbers={false} selectable={false} pageSize={25} />
  </PageShell>;
}
