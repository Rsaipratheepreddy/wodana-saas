import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { loadLeadOptions } from "../crm/leads/lead-options";
import { DESIGN_PROJECTS } from "./design-projects";
import { FINANCE } from "./finance";
import { LEAD_RESPONSE } from "./lead-response";
import { OWNER_OVERVIEW } from "./owner-overview";
import { PRODUCTION_DELIVERY } from "./production-delivery";
import { type KpiSpec, type ReportContext, reportContext } from "./report-context";
import { type Dashboard, type Kpi, type RecordRow, change, matchBucket, parseBucket, recordRow } from "./report-kit";
import { localDate, parseFilters, previousPeriod } from "./report-scope";
import { SALES_PIPELINE } from "./sales-pipeline";
import { MARKETING, MARKETING_READ, STOCK, STOCK_READ } from "./stock-marketing";

type Db = Pick<PoolClient, "query">;
type Can = (permission: string) => boolean;

/**
 * Management dashboards (PLM-134), each one read endpoint computing its KPIs server-side over the business tables in
 * the member's tenant transaction: Overview (the landing), Sales and marketing (lead response and the marketing
 * figures belong to the same funnel, so they are one tab), Design, Production and delivery, Finance and Stock and
 * marketing. Every KPI a dashboard knows can be opened (its records); the layout says which are shown.
 */
export const DASHBOARDS: Record<string, KpiSpec[]> = {
  "owner-overview": OWNER_OVERVIEW,
  "sales-pipeline": [...SALES_PIPELINE, ...LEAD_RESPONSE, ...MARKETING],
  "design-projects": DESIGN_PROJECTS,
  "production-delivery": PRODUCTION_DELIVERY,
  finance: FINANCE,
  stock: STOCK,
};

/**
 * One calm page per dashboard: at most four figures for the period (each against the period before, each opening its
 * records), its charts, and its lists — at most one "needs attention" list, and the KPIs that are lists themselves
 * (their first five, each opening its record). What a dashboard knows beyond this stays reachable through the records.
 */
export type Layout = { tiles: string[]; charts: string[]; attention: string | null; lists?: string[] };
/**
 * Dashboards 5–7 show every KPI of Palm's Management Dashboards tab (PLM-131/132/133) with its graph: the figures with a
 * target or a red tile as tiles, the rest as charts, and the KPIs that are lists ("Payables due", "Low stock") as lists.
 */
export const LAYOUTS: Record<string, Layout> = {
  "owner-overview": { tiles: ["sales_won", "revenue_collected", "deals_closed", "profit_margin"], charts: ["sales_won", "active_projects"], attention: "delayed_items" },
  "sales-pipeline": { tiles: ["new_leads", "conversion_funnel", "response_rate", "lost"], charts: ["new_leads", "won_by_source", "spam_by_source"], attention: "sales_attention" },
  "design-projects": { tiles: ["package_mix", "designs_approved", "design_to_proposal2_days", "design_to_proposal2_rate"], charts: ["design_stage", "designer_workload"],
    attention: "design_overdue" },
  "production-delivery": { tiles: ["late_work_orders", "ready_upcoming", "open_snags", "fo_lead_time"],
    charts: ["work_orders_status", "ready_upcoming", "bookings", "open_snags", "fo_lead_time"], attention: "production_attention" },
  finance: { tiles: ["cash_collected", "refunds", "joinery_balances_due", "payables_due"],
    charts: ["collected_invoiced", "receivables_ageing", "finance_requests_open", "refunds", "commissions"], attention: null, lists: ["joinery_balances_due", "payables_due"] },
  stock: { tiles: ["low_stock", "reserved_available", "best_sellers", "lead_source_won"],
    charts: ["reserved_available", "best_sellers", "lead_sources", "form_links", "spam_by_source"], attention: null, lists: ["low_stock"] },
};

/** Addresses of dashboards that were folded into another (kept so old links still open). */
export const MOVED: Record<string, string> = { "lead-response": "sales-pipeline", "stock-marketing": "stock" };

/**
 * What a dashboard needs beyond opening the dashboards (reports.management.view): any one of its area's own read
 * permissions, so nobody reads through a dashboard what the area itself wouldn't show them. Owners and administrators
 * hold every permission.
 */
export const DASHBOARD_ACCESS: Record<string, string[]> = {
  "production-delivery": ["factory.view", "factory.manage", "projects.view", "projects.manage", "logistics.manage"],
  finance: ["payables.view", "receivables.view", "accounting.manage"],
  // Stock and marketing: its figures are stock's or marketing's (purchases stay reachable through the records).
  stock: [...STOCK_READ, ...MARKETING_READ],
};

/** Every permission a dashboard or one of its figures asks for (read once per request). */
export const REPORT_PERMISSIONS = [...new Set([...Object.values(DASHBOARD_ACCESS).flat(),
  ...Object.values(DASHBOARDS).flat().flatMap((spec) => spec.requires ?? [])])];

/** A dashboard's name as it is now (an old address opens the dashboard it moved into). */
export const dashboardName = (name: string) => MOVED[name] ?? name;

function dashboardSpecs(name: string) {
  const specs = DASHBOARDS[dashboardName(name)];
  if (!specs) throw new NotFoundException("Unknown dashboard");
  return specs;
}

async function workspaceZone(db: Db, workspaceId: string) {
  return (await db.query<{ tz: string }>(`SELECT COALESCE(NULLIF(btrim(default_timezone), ''), 'UTC') AS tz FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.tz ?? "UTC";
}

/** A KPI the member may see (some need a permission beyond the dashboard's, e.g. margins). */
const visible = (spec: KpiSpec, can: Can) => !spec.requires || spec.requires.some(can);

export const ATTENTION_ROWS = 5;

/**
 * One dashboard for the filter bar's period and filters: the layout's figures, charts and attention list (`"all"`
 * reads every KPI the dashboard knows, for checks). A figure shown as a tile is also read for the span just before
 * (`previousPeriod`), with the same filters, so the change is like for like.
 */
export async function readDashboard(db: Db, workspaceId: string, requested: string, query: Record<string, unknown>, now = new Date(), can: Can = () => true,
  scope: "layout" | "all" = "layout"): Promise<Dashboard> {
  const name = dashboardName(requested);
  const all = dashboardSpecs(name).filter((spec) => visible(spec, can));
  const layout = LAYOUTS[name];
  const listed = layout.lists ?? [];
  const shown = new Set([...layout.tiles, ...layout.charts, ...listed, ...(layout.attention ? [layout.attention] : [])]);
  const specs = scope === "all" ? all : all.filter((spec) => shown.has(spec.code));
  const timeZone = await workspaceZone(db, workspaceId);
  const filters = parseFilters(query, localDate(now, timeZone));
  const ctx = await reportContext(db, workspaceId, filters, now, can);
  const before = previousPeriod(filters.from, filters.to);
  let earlier: ReportContext | null = null;
  const kpis: Kpi[] = [];
  let attention: Dashboard["attention"] = null;
  const lists = new Map<string, NonNullable<Dashboard["lists"]>[number]>();
  for (const spec of specs) {
    const facts = await spec.facts(ctx);
    const kpi = await spec.build(ctx, facts);
    if (spec.compare && (scope === "all" || layout.tiles.includes(spec.code))) {
      earlier ??= await reportContext(db, workspaceId, { ...filters, ...before }, now, can);
      const then = await spec.build(earlier, await spec.facts(earlier));
      kpi.previous = { ...before, value: then.value, change: change(kpi.value, then.value), better: spec.compare };
    }
    const first = () => ({ kpi: spec.code, total: facts.length, records: facts.slice(0, ATTENTION_ROWS).map(recordRow) as RecordRow[] });
    if (spec.code === layout.attention) attention = first();
    if (listed.includes(spec.code)) lists.set(spec.code, first());
    kpis.push(kpi);
  }
  const visibleCodes = new Set(kpis.map((kpi) => kpi.code));
  const shownLists = listed.filter((code) => visibleCodes.has(code));
  return {
    dashboard: name, currency: ctx.currency, timeZone: ctx.timeZone, from: filters.from, to: filters.to, generatedAt: now.toISOString(), kpis,
    layout: { tiles: layout.tiles.filter((code) => visibleCodes.has(code)), charts: layout.charts.filter((code) => visibleCodes.has(code)),
      attention: layout.attention && visibleCodes.has(layout.attention) ? layout.attention : null, ...(layout.lists ? { lists: shownLists } : {}) },
    attention,
    ...(layout.lists ? { lists: shownLists.map((code) => lists.get(code)!) } : {}),
  };
}

const MAX_RECORDS = 2000;

/** The records behind one figure or bar: the same facts the KPI counted, narrowed to the bucket clicked. */
export async function readRecords(db: Db, workspaceId: string, name: string, query: Record<string, unknown>, now = new Date(), can: Can = () => true) {
  const spec = dashboardSpecs(name).find((item) => item.code === query.kpi && visible(item, can));
  if (!spec) throw new BadRequestException("Unknown KPI");
  if (query.bucket !== undefined && (typeof query.bucket !== "string" || query.bucket.length > 600)) throw new BadRequestException("Invalid bucket");
  const timeZone = await workspaceZone(db, workspaceId);
  const filters = parseFilters(query, localDate(now, timeZone));
  const ctx = await reportContext(db, workspaceId, filters, now, can);
  const facts = matchBucket(await spec.facts(ctx), parseBucket(query.bucket as string | undefined));
  return {
    dashboard: name, kpi: spec.code, currency: ctx.currency, total: facts.length, truncated: facts.length > MAX_RECORDS,
    records: facts.slice(0, MAX_RECORDS).map(recordRow),
  };
}

/** What the filter bar offers: the workspace's own Account Managers, enquiry types, packages, client types, sources and channels, regions and entities. */
export async function readFilterOptions(db: Db, workspaceId: string) {
  const options = await loadLeadOptions(db as PoolClient, workspaceId);
  const members = (await db.query<{ id: string; name: string }>(
    `SELECT membership.id, COALESCE(NULLIF(btrim(account.display_name), ''), account.primary_email) AS name
       FROM workspace_memberships membership JOIN users account ON account.id = membership.user_id
      WHERE membership.workspace_id = $1 AND (membership.status = 'active'
        OR EXISTS (SELECT 1 FROM crm_opportunities o WHERE o.workspace_id = membership.workspace_id AND o.owner_membership_id = membership.id))
      ORDER BY name`, [workspaceId])).rows;
  const packages = (await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM design_packages WHERE workspace_id = $1 ORDER BY status = 'archived', position, name`, [workspaceId])).rows;
  const entities = (await db.query<{ id: string; name: string }>(
    `SELECT id, display_name AS name FROM legal_entities WHERE workspace_id = $1 ORDER BY display_name`, [workspaceId])).rows;
  const country = (await db.query<{ country: string | null }>(
    `SELECT country_code AS country FROM legal_entities WHERE workspace_id = $1 ORDER BY created_at LIMIT 1`, [workspaceId])).rows[0]?.country ?? null;
  const pick = (items: Array<{ id: string; label: string }>) => items.map((item) => ({ id: item.id, label: item.label }));
  return {
    accountManagers: members.map((member) => ({ id: member.id, label: member.name })),
    enquiryTypes: pick(options.enquiryTypes), packages: packages.map((item) => ({ id: item.id, label: item.name })),
    clientTypes: pick(options.customerTypes), sources: pick(options.sources),
    channels: Object.fromEntries(Object.entries(options.channels).map(([source, channels]) => [source, pick(channels)])),
    regions: pick(options.emirates), entities: entities.map((item) => ({ id: item.id, label: item.name })), countryCode: country,
  };
}
