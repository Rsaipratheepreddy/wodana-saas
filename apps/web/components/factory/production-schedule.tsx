"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, DataGrid, EmptyState, ErrorState, NoResultsState, StateChip, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { FactoryApi } from "@/lib/factory/client";
import type { ProductionRow, ProductionState, ProductionWindow } from "@/lib/factory/types";
import { Cell } from "../operations/ops";
import { useProjectFormat } from "../project-core/format";
import { PRODUCTION_TONE, useProductionStepLabel } from "./factory-labels";

/** A window's dates in words: "3 Oct – 17 Oct", "Since 3 Oct", or nothing. */
export function useWindowText() {
  const t = useT();
  const format = useProjectFormat();
  return useCallback((window: ProductionWindow, running = false) => {
    if (window.start && window.end) return t("{from} – {to}", { from: format.short(window.start), to: format.short(window.end) });
    if (window.start) return running ? t("Since {date}", { date: format.short(window.start) }) : t("From {date}", { date: format.short(window.start) });
    return "";
  }, [t, format]);
}

/**
 * PLM-063: production project by project, as the factory works it: each project's step (read from its work orders),
 * when it was planned to run and when it actually ran, and whether it's late or past the firm's own target. A row
 * opens the project's work orders.
 */
export function ProductionSchedule({ api, refreshKey, onOpenProject }: { api: FactoryApi; refreshKey: number; onOpenProject: (projectId: string) => void }) {
  const t = useT();
  const stepLabel = useProductionStepLabel();
  const windowText = useWindowText();
  const [state, setState] = useState<ProductionState | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const load = useCallback(async () => {
    try { setState(await api.production()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The schedule didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, refreshKey]);
  const days = useCallback((count: number | null) => (count === null ? null : count === 1 ? t("1 day") : t("{count} days", { count })), [t]);

  const columns = useMemo<DataGridColumn<ProductionRow>[]>(() => [
    { id: "project", header: t("Project"), accessorFn: (row) => row.reference, size: 260, meta: { primary: true, renderCell: (row) =>
      <Cell title={`${row.reference} · ${row.name}`} meta={row.clientName} /> } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.step?.kind ?? "", size: 200, meta: { renderCell: (row) =>
      <Cell title={row.step ? <Badge tone={PRODUCTION_TONE[row.step.kind]}>{stepLabel(row.step)}</Badge> : <StateChip state="upcoming" label={t("Not scheduled")} />}
        meta={row.held ? t("On hold") : row.orders ? t("{ready} of {count} work orders ready", { ready: row.ready, count: row.orders }) : t("No work orders yet")}
        tone={row.held ? "warning" : undefined} /> } },
    { id: "planned", header: t("Planned"), accessorFn: (row) => row.planned.start ?? "", size: 190, meta: { mobileHidden: true, renderCell: (row) =>
      <Cell title={windowText(row.planned) || "—"} meta={days(row.planned.days)} /> } },
    { id: "actual", header: t("Actual"), accessorFn: (row) => row.actual.start ?? "", size: 220, meta: { renderCell: (row) => {
      const flags = [row.late ? t("Late") : "", row.overTarget && state?.targetWeeks ? t("Over the {weeks}-week target", { weeks: state.targetWeeks }) : ""].filter(Boolean);
      return <Cell title={windowText(row.actual, row.step?.kind !== "ready") || t("Not started")} meta={[days(row.actual.days), ...flags].filter(Boolean).join(" · ") || null}
        tone={flags.length ? "danger" : undefined} />;
    } } },
  ], [t, stepLabel, windowText, days, state?.targetWeeks]);

  if (error && !state) return <ErrorState description={error} onRetry={() => void load()} />;
  const needle = search.trim().toLocaleLowerCase();
  const rows = (state?.projects ?? []).filter((row) => !needle || `${row.reference} ${row.name} ${row.clientName}`.toLocaleLowerCase().includes(needle))
    // Late first, then by when each is planned to finish.
    .sort((a, b) => Number(b.late) - Number(a.late) || (a.planned.end ?? "9999").localeCompare(b.planned.end ?? "9999") || a.reference.localeCompare(b.reference));
  return <DataGrid<ProductionRow> ariaLabel={t("Production by project")} columns={columns} data={rows} getRowId={(row) => row.projectId} isLoading={!state}
    onRowAction={(row) => onOpenProject(row.projectId)} onSearchChange={setSearch} searchValue={search} searchLabel={t("Search projects")} rowNumbers={false} wrapText
    emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t("Nothing in production")} description={t("Projects with work made in the factory show here.")} />} />;
}
