"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ProjectHours as Hours } from "@wodana/contracts";
import { DataGrid, EmptyState, ErrorState, NoAccessState, NoResultsState, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { hrmsApi } from "@/lib/hrms/api";
import { HrmsError } from "@/lib/hrms/client";
import { useHrmsFormat } from "./hrms-format";
import styles from "./hrms.module.css";

type Row = Hours["rows"][number];

/** A project's approved studio hours, by person and stage, for the people who run it or see its costs. */
export function ProjectHours({ workspaceId, projectId, switcher }: { workspaceId: string; projectId: string; switcher: ReactNode }) {
  const t = useT();
  const format = useHrmsFormat();
  const api = useMemo(() => hrmsApi(workspaceId), [workspaceId]);
  const [data, setData] = useState<Hours | null>(null);
  const [error, setError] = useState<{ message: string; denied: boolean } | null>(null);
  const [search, setSearch] = useState("");
  const load = useCallback(async () => {
    try { setData(await api.projectHours(projectId)); setError(null); }
    catch (cause) { setError({ message: format.failure(cause, t("Hours didn't load.")), denied: cause instanceof HrmsError && cause.status === 403 }); }
  }, [api, projectId, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const columns = useMemo<DataGridColumn<Row>[]>(() => [
    { id: "person", header: t("Person"), accessorFn: (row) => row.name, size: 220, meta: { primary: true } },
    { id: "stage", header: t("Stage"), accessorFn: (row) => row.stageName ?? "", size: 220, meta: { renderCell: (row) => row.stageName ?? <span className={styles.muted}>{t("No stage")}</span> } },
    { id: "hours", header: t("Hours"), accessorFn: (row) => row.minutes, size: 120, meta: { align: "end", renderCell: (row) => <span className={styles.number}>{format.duration(row.minutes)}</span> } },
  ], [t, format]);
  const tools = <div className={styles.toolbar}>
    {switcher}
    {data ? <span className={styles.muted}>{t("{time} approved", { time: format.duration(data.totalMinutes) || "0m" })}</span> : null}
  </div>;
  if (error && !data) return <>{tools}{error.denied ? <NoAccessState /> : <ErrorState description={error.message} onRetry={() => void load()} />}</>;
  const needle = search.trim().toLocaleLowerCase();
  const rows = (data?.rows ?? []).filter((row) => !needle || `${row.name} ${row.stageName ?? ""}`.toLocaleLowerCase().includes(needle));
  return <DataGrid<Row> ariaLabel={t("Hours")} columns={columns} data={rows} getRowId={(row) => `${row.membershipId}:${row.stageId ?? ""}`} isLoading={!data}
    onSearchChange={setSearch} searchValue={search} searchLabel={t("Search people")} rowNumbers={false} selectable={false} wrapText toolbarLeading={tools}
    emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t("No approved hours yet")} />} />;
}
