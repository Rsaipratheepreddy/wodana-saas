import { tKey, type MessageKey } from "@/lib/i18n/keys";

/**
 * Management dashboards (PLM-134): what business-core returns and how the web asks for it. The figures are computed
 * server-side; the web only lays them out, so a figure and the records it opens always agree.
 */
export type Unit = "count" | "money" | "percent" | "hours" | "days";
export type TargetResult = { target: string; percent: string | null; gap: string; tone: "success" | "warning" | "danger" };
export type ChartCategory = { key: string; label: string };
export type ChartSeries = { id: string; label: string };
export type Chart =
  | { type: "columns"; dimension: string; seriesDimension?: string; categories: ChartCategory[]; series: ChartSeries[]; values: string[][]; unit: Unit }
  | { type: "lines"; dimension: string; categories: ChartCategory[]; series: ChartSeries[]; values: Array<Array<string | null>>; unit: Unit }
  | { type: "bars"; dimension: string; items: Array<{ key: string; label: string; value: string; count: number; amount?: string | null; target?: TargetResult | null }>; unit: Unit }
  | { type: "donut"; dimension: string; items: Array<{ key: string; label: string; value: string; count: number; amount: string | null }>; unit: Unit }
  | { type: "funnel"; dimension: string; items: Array<{ key: string; label: string; value: string; rate: string | null }> }
  | { type: "gauge"; percent: string | null; target: string | null }
  | { type: "list"; bucket: string };

export type Kpi = {
  code: string; unit: Unit; value: string | null; count: number; amount?: string | null; targetable: boolean;
  target?: TargetResult | null; targetHidden?: boolean; chart?: Chart;
  notes?: { otherCurrency?: number; taxIncluded?: number; amountsIncludeTax?: boolean; target?: string };
  extra?: Record<string, string | number | null>;
};
export type Dashboard = { dashboard: DashboardId; currency: string; timeZone: string; from: string; to: string; generatedAt: string; kpis: Kpi[] };
export type ReportRecord = {
  id: string; kind: string; reference: string | null; title: string; client: string | null; owner: string | null; ownerId: string | null;
  at: string | null; amount: string | null; measure: string | null; detail: string | null; href: string;
};
export type Option = { id: string; label: string };
export type FilterOptions = {
  accountManagers: Option[]; enquiryTypes: Option[]; packages: Option[]; clientTypes: Option[]; sources: Option[];
  channels: Record<string, Option[]>; regions: Option[]; entities: Option[]; countryCode: string | null;
};
export type TargetKpi = { code: string; unit: Unit; direction: "higher" | "lower"; additive: boolean; perMember: boolean };
export type TargetRow = { id: string; kpi: string; month: string; membershipId: string | null; target: string; version: number };
export type TargetsPayload = { year: number; kpis: TargetKpi[]; targets: TargetRow[]; accountManagers: Option[] };

export const DASHBOARDS = ["owner-overview", "sales-pipeline", "lead-response", "design-projects"] as const;
export type DashboardId = (typeof DASHBOARDS)[number];
export const DASHBOARD_LABELS: Record<DashboardId, MessageKey> = {
  "owner-overview": tKey("Owner overview"), "sales-pipeline": tKey("Sales and pipeline"), "lead-response": tKey("Lead response"), "design-projects": tKey("Design projects"),
};

/** The filter bar, as kept in the address (so a view can be shared and reloaded). */
export type Filters = {
  from: string; to: string; accountManager: string; enquiryType: string; package: string; clientType: string;
  source: string; channel: string; region: string; entity: string;
};
export const FILTER_KEYS = ["accountManager", "enquiryType", "package", "clientType", "source", "channel", "region", "entity"] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Reads the filters from the address; the period defaults to this month to date (the server decides "today"). */
export function filtersFrom(params: URLSearchParams): Filters {
  const read = (key: string) => (params.get(key) ?? "").slice(0, 100);
  return {
    from: DATE.test(read("from")) ? read("from") : "", to: DATE.test(read("to")) ? read("to") : "",
    accountManager: read("accountManager"), enquiryType: read("enquiryType"), package: read("package"), clientType: read("clientType"),
    source: read("source"), channel: read("channel"), region: read("region"), entity: read("entity"),
  };
}

export function filtersQuery(filters: Filters): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  return query;
}

export class ReportRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function request<T>(workspaceId: string, path: string, query: URLSearchParams, init: RequestInit = {}): Promise<T> {
  const search = new URLSearchParams(query);
  search.set("workspaceId", workspaceId);
  const response = await fetch(`/api/workspace/reports/${path}?${search}`, { cache: "no-store", headers: { "content-type": "application/json" }, ...init });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new ReportRequestError(result?.message ?? tKey("The report could not be loaded."), response.status);
  return result as T;
}

export const reportsApi = (workspaceId: string) => ({
  dashboard: (id: DashboardId, filters: Filters, signal?: AbortSignal) => request<Dashboard>(workspaceId, id, filtersQuery(filters), { signal }),
  records: (id: DashboardId, filters: Filters, kpi: string, bucket: string, signal?: AbortSignal) => {
    const query = filtersQuery(filters);
    query.set("kpi", kpi);
    if (bucket) query.set("bucket", bucket);
    return request<{ total: number; truncated: boolean; currency: string; records: ReportRecord[] }>(workspaceId, `${id}/records`, query, { signal });
  },
  options: (signal?: AbortSignal) => request<FilterOptions>(workspaceId, "options", new URLSearchParams(), { signal }),
  targets: (year: number, signal?: AbortSignal) => request<TargetsPayload>(workspaceId, "targets", new URLSearchParams({ year: String(year) }), { signal }),
  saveTargets: (body: { commandId: string; changes: Array<{ kpi: string; month: string; membershipId: string | null; target: string | null; version: number | null }> }) =>
    request<{ applied: boolean; changed: number }>(workspaceId, "targets", new URLSearchParams(), { method: "PUT", body: JSON.stringify(body) }),
});

/** A spreadsheet-safe CSV (Excel opens it): every cell quoted, formulas neutralised, UTF-8 with a byte-order mark. */
export function toCsv(header: string[], rows: Array<Array<string | number | null | undefined>>) {
  const quote = (value: unknown) => { const text = String(value ?? ""); return `"${(/^[=+@\-\t\r]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`; };
  return `﻿${[header, ...rows].map((row) => row.map(quote).join(",")).join("\r\n")}`;
}

export function downloadCsv(fileName: string, csv: string) {
  const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  anchor.click();
  URL.revokeObjectURL(href);
}
