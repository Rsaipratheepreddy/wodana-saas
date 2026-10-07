"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ledgerHref, type Money, type ProjectPnl } from "@wodana/contracts";
import { DataGrid, EmptyState, ErrorState, MenuButton, NoResultsState, RecordName, Skeleton, useDesignSystem, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { useProjectFormat } from "../project-core/format";
import styles from "./projects-profit.module.css";

/** A project's costs by type (the shared ProjectPnl costs, plus goods sold from stock). */
export type ProfitCosts = ProjectPnl["costs"] & { cogs: Money };
export type ProfitFigures = {
  revenue: Money; costs: ProfitCosts; totalCost: Money;
  /** Null when the person sees the project's costs but not its margin. */
  profit: Money | null; marginPercent: string | null;
  quotedValue: Money | null; quoteCurrency: string | null; quotedCost: Money | null; quotedMarginPercent: string | null;
  /** Actual margin less the quoted margin, in percentage points. */
  marginVsQuote: string | null;
  /** Ordered and not yet received or billed, in `committedCurrency`. */
  committed: Money; committedCurrency: string;
};
type Links = { project: string; journals: string };
export type ProjectPnlState =
  | { enabled: false; projectId: string; reference: string; name: string; company: { id: string; name: string } | null }
  | (ProfitFigures & {
      enabled: true; projectId: string; reference: string; name: string; clientName: string; status: string; company: { id: string; name: string };
      currency: string; asOf: string; marginHidden: boolean; links: Links;
      reconciliation: { moneySpent: Money; moneyCurrency: string; uncosted: number; difference: Money | null; matches: boolean | null };
    });
export type ProjectsProfitRow = ProfitFigures & { projectId: string; reference: string; name: string; clientName: string; status: string; links: Links };
export type ProjectsProfitState =
  | { enabled: false; companies: Array<{ id: string; name: string }>; rows: [] }
  | { enabled: true; companies: Array<{ id: string; name: string }>; company: { id: string; name: string }; currency: string; from: string | null; to: string;
      marginHidden: boolean; rows: ProjectsProfitRow[] };

export class ProfitRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function read<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ProfitRequestError(typeof data?.message === "string" ? data.message : "Project profit didn't load.", response.status);
  return data as T;
}

/** The Ledger's project profit API for one workspace (read only). */
export function projectProfitApi(workspaceId: string) {
  const path = (value: string, query: Record<string, string | undefined> = {}) =>
    `/api/books/projects/${value}?${new URLSearchParams({ workspaceId, ...Object.fromEntries(Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1]))) })}`;
  return {
    pnl: (projectId: string) => read<ProjectPnlState>(path(`${encodeURIComponent(projectId)}/pnl`)),
    grid: (scope: { entity?: string; from?: string; to?: string } = {}) => read<ProjectsProfitState>(path("profit", scope)),
  };
}

/** One project's P&L from the Ledger, or null while it loads, when the Ledger is off for its company or the person can't read it. */
export function useProjectPnl(workspaceId: string, projectId: string) {
  const [state, setState] = useState<Extract<ProjectPnlState, { enabled: true }> | null>(null);
  useEffect(() => {
    let live = true;
    projectProfitApi(workspaceId).pnl(projectId).then((value) => { if (live) setState(value.enabled ? value : null); }, () => { if (live) setState(null); });
    return () => { live = false; };
  }, [workspaceId, projectId]);
  return state;
}

/** Percent and percentage-point text in the person's locale. */
export function usePercent() {
  const { locale } = useDesignSystem();
  return useMemo(() => ({
    percent: (value: string) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(Number(value) / 100),
    points: (value: string) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2, signDisplay: "exceptZero" }).format(Number(value)),
  }), [locale]);
}

const COSTS: Array<{ id: keyof ProfitCosts; label: MessageKey; priority?: "medium" | "low" }> = [
  { id: "materials", label: tKey("Materials") }, { id: "subcontract", label: tKey("Subcontract") }, { id: "labour", label: tKey("Labour") },
  { id: "siteExpenses", label: tKey("Site expenses"), priority: "medium" }, { id: "priceVariance", label: tKey("Price variance"), priority: "low" },
  { id: "other", label: tKey("Other"), priority: "low" }, { id: "cogs", label: tKey("Goods sold"), priority: "low" },
];

/**
 * The Projects profit grid (the Ledger's project P&L for one company and period): revenue, costs by type, profit,
 * margin, margin against the quote and committed spend per project; sortable, opening the project and its journals.
 * The Ledger area passes its company and period; without a company the first one with the Ledger on is shown.
 */
export function ProjectsProfit({ workspaceId, entity, from, to, toolbarLeading }: { workspaceId: string; entity?: string; from?: string; to?: string; toolbarLeading?: ReactNode }) {
  const t = useT();
  const format = useProjectFormat();
  const { percent, points } = usePercent();
  const api = useMemo(() => projectProfitApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<ProjectsProfitState | null>(null);
  const [error, setError] = useState("");
  const [company, setCompany] = useState<string | undefined>(entity);
  const [search, setSearch] = useState("");
  const chosen = entity ?? company;
  const load = useCallback(async () => {
    try { setState(await api.grid({ entity: chosen, from, to })); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t(tKey("Project profit didn't load."))); }
  }, [api, chosen, from, to, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const marginHidden = state?.enabled ? state.marginHidden : true;
  const currency = state?.enabled ? state.currency : "";
  const money = useCallback((value: string | null, other?: string) => (value === null ? "—" : format.money(value, other ?? currency)), [format, currency]);
  const amount = useCallback((value: string | null, other?: string) => <span className={`${styles.number} ${value !== null && value.startsWith("-") ? styles.loss : ""}`}>{money(value, other)}</span>, [money]);
  const columns = useMemo<DataGridColumn<ProjectsProfitRow>[]>(() => [
    { id: "project", header: t("Project"), accessorFn: (row) => `${row.reference} ${row.name}`, size: 240, meta: { primary: true, interactive: true, renderCell: (row) =>
      <RecordName detail={[row.reference, row.clientName].filter(Boolean).join(" · ")} title={<Link className={styles.open} href={row.links.project}>{row.name}</Link>} /> } },
    { id: "revenue", header: t(tKey("Revenue")), accessorFn: (row) => Number(row.revenue), size: 140, meta: { align: "end", renderCell: (row) => amount(row.revenue) } },
    ...COSTS.map((cost): DataGridColumn<ProjectsProfitRow> => ({ id: cost.id, header: t(cost.label), accessorFn: (row) => Number(row.costs[cost.id]), size: 130,
      meta: { align: "end", mobileHidden: true, priority: cost.priority, renderCell: (row) => amount(row.costs[cost.id]) } })),
    { id: "totalCost", header: t(tKey("Total cost")), accessorFn: (row) => Number(row.totalCost), size: 140, meta: { align: "end", renderCell: (row) => amount(row.totalCost) } },
    ...(marginHidden ? [] : [
      { id: "profit", header: t(tKey("Profit")), accessorFn: (row) => Number(row.profit ?? 0), size: 140, meta: { align: "end", renderCell: (row) => amount(row.profit) } },
      { id: "margin", header: t("Margin"), accessorFn: (row) => (row.marginPercent === null ? Number.NEGATIVE_INFINITY : Number(row.marginPercent)), size: 100,
        meta: { align: "end", renderCell: (row) => <span className={`${styles.number} ${row.marginPercent?.startsWith("-") ? styles.loss : ""}`}>{row.marginPercent === null ? "—" : percent(row.marginPercent)}</span> } },
      { id: "vsQuote", header: t(tKey("Margin vs quote")), accessorFn: (row) => (row.marginVsQuote === null ? Number.NEGATIVE_INFINITY : Number(row.marginVsQuote)), size: 130,
        meta: { align: "end", priority: "medium", renderCell: (row) => <span className={`${styles.number} ${row.marginVsQuote?.startsWith("-") ? styles.loss : ""}`}>
          {row.marginVsQuote === null ? "—" : t(tKey("{points} pts"), { points: points(row.marginVsQuote) })}</span> } },
    ] satisfies DataGridColumn<ProjectsProfitRow>[]),
    { id: "committed", header: t("Committed"), accessorFn: (row) => Number(row.committed), size: 140, meta: { align: "end", priority: "medium", renderCell: (row) => amount(row.committed, row.committedCurrency) } },
    { id: "journals", header: t(tKey("Journals")), enableSorting: false, size: 110, meta: { interactive: true, renderCell: (row) =>
      <Link className={styles.open} href={row.links.journals} aria-label={t(tKey("Journals for {project}"), { project: row.name })}>{t(tKey("Journals"))}</Link> } },
  ], [t, amount, marginHidden, percent, points]);

  if (error && !state) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!state) return <Skeleton lines={8} shape="rows" />;
  if (!state.enabled)
    return <EmptyState title={t(tKey("The Ledger isn't on yet"))} action={<Link className={styles.open} href={ledgerHref.settings()}>{t(tKey("Set up the Ledger"))}</Link>} />;
  const needle = search.trim().toLocaleLowerCase();
  const rows = state.rows.filter((row) => !needle || `${row.name} ${row.reference} ${row.clientName}`.toLocaleLowerCase().includes(needle));
  const picker = !entity && state.companies.length > 1
    ? <MenuButton size="compact" label={state.company.name} onAction={(id) => setCompany(id)} items={state.companies.map((item) => ({ id: item.id, label: item.name }))} /> : null;
  return <DataGrid<ProjectsProfitRow> ariaLabel={t(tKey("Projects profit"))} columns={columns} data={rows} getRowId={(row) => row.projectId} rowNumbers={false}
    onSearchChange={setSearch} searchValue={search} searchLabel={t("Search projects")} toolbarLeading={<>{toolbarLeading}{picker}</>}
    emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t(tKey("No project has revenue or costs in the Ledger for this period"))} />} />;
}
