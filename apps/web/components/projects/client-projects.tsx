"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, DataGrid, EmptyState, ErrorState, NoResultsState, OwnerCell, PageShell, RecordName, type DataGridColumn, type StatusTone } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Translate } from "@/lib/i18n/keys";
import { projectApi } from "@/lib/project-core/client";
import type { ProjectRow } from "@/lib/project-core/types";

/** A project's name without the client's name in front ("Mariam Al Suwaidi · Villa 27 furniture" → "Villa 27 furniture"). */
export function projectName(row: Pick<ProjectRow, "name" | "clientName">) {
  const prefix = `${row.clientName} · `;
  return row.clientName && row.name.startsWith(prefix) ? row.name.slice(prefix.length) : row.name;
}

/** Where the client's project really is: the stage it is in while it runs, else on hold, handed over or cancelled. */
export function clientStatus(t: Translate, row: Pick<ProjectRow, "status" | "stage">): { label: string; tone: StatusTone } {
  if (row.status === "completed") return { label: t("Handed over"), tone: "success" };
  if (row.status === "cancelled" || row.status === "archived") return { label: t("Cancelled"), tone: "neutral" };
  if (row.status === "on_hold") return { label: t("On hold"), tone: "warning" };
  return { label: row.stage?.name ?? t("In project"), tone: "info" };
}

/** Clients: each client's project, who leads it, where it really is, and the way into its client updates. */
export function ClientProjects({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const router = useRouter();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const load = useCallback(async () => {
    try { setRows((await api.list()).projects); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Clients didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const columns: DataGridColumn<ProjectRow>[] = [
    { id: "customer", header: t("Client"), accessorFn: (row) => `${row.clientName} ${row.name} ${row.reference}`, size: 280, meta: { primary: true,
      renderCell: (row) => <RecordName title={row.clientName} detail={[projectName(row), row.reference].filter(Boolean).join(" · ")} /> } },
    { id: "lead", header: t("Owner"), accessorFn: (row) => row.lead ?? "", size: 160, meta: { priority: "low", renderCell: (row) => <OwnerCell fallback={t("Unassigned")} person={row.lead} /> } },
    { id: "status", header: t("Status"), accessorFn: (row) => clientStatus(t, row).label, size: 190, meta: { renderCell: (row) => {
      const status = clientStatus(t, row);
      return <Badge tone={status.tone}>{status.label}</Badge>;
    } } },
    { id: "actions", header: t("Actions"), size: 160, enableSorting: false, meta: { align: "end", interactive: true, renderCell: (row) =>
      <Link className="wd-button" data-size="compact" data-variant="secondary" href={`/workspace/projects/${row.id}/updates`}>{t("Client updates")}</Link> } },
  ];
  const query = search.trim().toLocaleLowerCase();
  const filtered = (rows ?? []).filter((row) => `${row.clientName} ${row.name} ${row.reference} ${row.lead ?? ""}`.toLocaleLowerCase().includes(query));

  if (error && !rows) return <PageShell title={t("Clients")}><ErrorState description={error} onRetry={() => void load()} /></PageShell>;
  return <PageShell title={t("Clients")}>
    <DataGrid ariaLabel={t("Client projects")} columns={columns} data={filtered} getRowId={(row) => row.id} isLoading={!rows}
      onRowAction={(row) => router.push(`/workspace/projects/${row.id}`)}
      searchLabel={t("Search clients and projects")} searchValue={search} onSearchChange={setSearch}
      emptyContent={query ? <NoResultsState onClear={() => setSearch("")} />
        : <EmptyState title={t("No client projects yet")} description={t("Clients appear here when a won deal becomes a project.")}
            action={<Link className="wd-button" data-size="compact" data-variant="secondary" href="/workspace/crm/opportunities">{t("Open pipeline")}</Link>} />}
      persistKey="client-projects" rowNumbers={false} selectable={false} pageSize={25} />
  </PageShell>;
}
