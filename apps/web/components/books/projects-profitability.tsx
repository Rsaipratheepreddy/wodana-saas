"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, DataGrid, EmptyState, ErrorState, ListTabs, NoResultsState, PageShell, RecordName, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import type { Profitability, ProfitabilityRow } from "@/lib/project-core/types";
import { useFlagText } from "../project-core/project-money-summary";
import { useProjectFormat } from "../project-core/format";
import { usePercent } from "./projects-profit";
import styles from "./projects-profit.module.css";

type Show = "running" | "closed" | "all";
const negative = (value: string | null) => value !== null && value.trim().startsWith("-") && !/^-?0*(\.0*)?$/.test(value.trim());
/** Sorting reads the exact text as a number; what people see is always the exact text. */
const sortable = (value: string | null) => (value === null ? Number.NEGATIVE_INFINITY : Number(value));

/**
 * Projects › Profitability: every project the person sees the costs of, with what was agreed, invoiced and spent, the
 * margin so far and the margin expected at completion, and what needs a look (an overrun, a thin margin, a loss).
 * Read from the records that caused each figure; margins only for people who see margins. A row opens the project's Money.
 */
export function ProjectsProfitability({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const router = useRouter();
  const format = useProjectFormat();
  const { percent } = usePercent();
  const flagText = useFlagText();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<Profitability | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<Show>("running");
  const load = useCallback(async () => {
    try { setState(await api.profitability()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Profitability didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const currency = state?.currency ?? "";
  const money = useCallback((value: string | null, other?: string) => (value === null ? "—" : format.money(value, other ?? currency)), [format, currency]);
  const amount = useCallback((value: string | null, other?: string) => <span className={`${styles.number} ${negative(value) ? styles.loss : ""}`}>{money(value, other)}</span>, [money]);
  const marginHidden = state?.marginHidden ?? true;

  const columns = useMemo<DataGridColumn<ProfitabilityRow>[]>(() => [
    { id: "project", header: t("Project"), accessorFn: (row) => `${row.name} ${row.reference} ${row.clientName}`, size: 240, meta: { primary: true, interactive: true, renderCell: (row) =>
      <RecordName detail={[row.reference, row.clientName].filter(Boolean).join(" · ")} title={<Link className={styles.open} href={row.href}>{row.name}</Link>} /> } },
    { id: "contract", header: t("Contract value"), accessorFn: (row) => sortable(row.contractNet), size: 150, meta: { align: "end", renderCell: (row) => amount(row.contractNet, row.contractCurrency) } },
    { id: "revenue", header: t("Invoiced"), accessorFn: (row) => sortable(row.revenue), size: 140, meta: { align: "end", priority: "medium", renderCell: (row) => amount(row.revenue, row.contractCurrency) } },
    { id: "cost", header: t("Spent"), accessorFn: (row) => sortable(row.cost), size: 140, meta: { align: "end", renderCell: (row) => amount(row.cost) } },
    { id: "committed", header: t("Committed"), accessorFn: (row) => sortable(row.committed), size: 140, meta: { align: "end", mobileHidden: true, priority: "low", renderCell: (row) => amount(row.committed) } },
    ...(marginHidden ? [] : [
      { id: "margin", header: t("Margin"), accessorFn: (row) => sortable(row.marginPercent), size: 110, meta: { align: "end", renderCell: (row) =>
        <span className={`${styles.number} ${negative(row.marginPercent) ? styles.loss : ""}`}>{row.marginPercent === null ? "—" : percent(row.marginPercent)}</span> } },
      { id: "forecast", header: t("Forecast margin"), accessorFn: (row) => sortable(row.forecastMarginPercent), size: 160, meta: { align: "end", renderCell: (row) =>
        <span className={styles.figure}><span className={`${styles.number} ${negative(row.forecastMargin) ? styles.loss : ""}`}>{row.forecastMarginPercent === null ? "—" : percent(row.forecastMarginPercent)}</span>
          {row.forecastMargin === null ? null : <small>{money(row.forecastMargin)}</small>}</span> } },
    ] satisfies DataGridColumn<ProfitabilityRow>[]),
    { id: "flags", header: t("Needs a look"), accessorFn: (row) => row.flags.length, size: 260, meta: { priority: "medium", renderCell: (row) => row.flags.length
      ? <span className={styles.flags}>{row.flags.map((flag, index) => { const { text, tone } = flagText(flag, (value) => money(value)); return <Badge key={`${flag.code}-${index}`} tone={tone}>{text}</Badge>; })}</span>
      : <span className={styles.muted}>—</span> } },
  ], [t, amount, money, marginHidden, percent, flagText]);

  const tabs = <ListTabs label={t("Show")} value={show} onChange={(value) => setShow(value)}
    items={[{ id: "running", label: t("Running") }, { id: "closed", label: t("Closed") }, { id: "all", label: t("All") }]} />;
  if (error && !state) return <PageShell title={t("Profitability")} tabs={tabs}><ErrorState description={error} onRetry={() => void load()} /></PageShell>;
  const needle = search.trim().toLocaleLowerCase();
  const rows = (state?.rows ?? []).filter((row) => {
    const running = row.status === "active" || row.status === "on_hold";
    if (show === "running" && !running) return false;
    if (show === "closed" && running) return false;
    return !needle || `${row.name} ${row.reference} ${row.clientName}`.toLocaleLowerCase().includes(needle);
  });
  return <PageShell title={t("Profitability")} tabs={tabs}>
    <DataGrid<ProfitabilityRow> ariaLabel={t("Projects profitability")} columns={columns} data={rows} getRowId={(row) => row.projectId} isLoading={!state}
      onRowAction={(row) => router.push(row.href)} onSearchChange={setSearch} searchValue={search} searchLabel={t("Search projects")} rowNumbers={false} selectable={false} wrapText
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={show === "closed" ? t("No closed projects") : t("No running projects")} />} />
  </PageShell>;
}
