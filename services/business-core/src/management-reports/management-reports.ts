import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { loadLeadOptions } from "../crm/leads/lead-options";
import { DESIGN_PROJECTS } from "./design-projects";
import { LEAD_RESPONSE } from "./lead-response";
import { OWNER_OVERVIEW } from "./owner-overview";
import { type KpiSpec, reportContext } from "./report-context";
import { type Dashboard, matchBucket, parseBucket, recordRow } from "./report-kit";
import { localDate, parseFilters } from "./report-scope";
import { SALES_PIPELINE } from "./sales-pipeline";

type Db = Pick<PoolClient, "query">;

/**
 * Management dashboards (PLM-134): the go-live four, each one read endpoint computing its KPIs server-side over the
 * business tables in the member's tenant transaction. Phase 2 (production and delivery, finance) and phase 3 (stock
 * and marketing) are added here as their KPIs are built.
 */
export const DASHBOARDS: Record<string, KpiSpec[]> = {
  "owner-overview": OWNER_OVERVIEW,
  "sales-pipeline": SALES_PIPELINE,
  "lead-response": LEAD_RESPONSE,
  "design-projects": DESIGN_PROJECTS,
};

function dashboardSpecs(name: string) {
  const specs = DASHBOARDS[name];
  if (!specs) throw new NotFoundException("Unknown dashboard");
  return specs;
}

async function workspaceZone(db: Db, workspaceId: string) {
  return (await db.query<{ tz: string }>(`SELECT COALESCE(NULLIF(btrim(default_timezone), ''), 'UTC') AS tz FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.tz ?? "UTC";
}

/** One dashboard's KPIs for the filter bar's period and filters. */
export async function readDashboard(db: Db, workspaceId: string, name: string, query: Record<string, unknown>, now = new Date()): Promise<Dashboard> {
  const specs = dashboardSpecs(name);
  const timeZone = await workspaceZone(db, workspaceId);
  const filters = parseFilters(query, localDate(now, timeZone));
  const ctx = await reportContext(db, workspaceId, filters, now);
  const kpis = [];
  for (const spec of specs) kpis.push(await spec.build(ctx, await spec.facts(ctx)));
  return { dashboard: name, currency: ctx.currency, timeZone: ctx.timeZone, from: filters.from, to: filters.to, generatedAt: now.toISOString(), kpis };
}

const MAX_RECORDS = 2000;

/** The records behind one figure or bar: the same facts the KPI counted, narrowed to the bucket clicked. */
export async function readRecords(db: Db, workspaceId: string, name: string, query: Record<string, unknown>, now = new Date()) {
  const spec = dashboardSpecs(name).find((item) => item.code === query.kpi);
  if (!spec) throw new BadRequestException("Unknown KPI");
  if (query.bucket !== undefined && (typeof query.bucket !== "string" || query.bucket.length > 600)) throw new BadRequestException("Invalid bucket");
  const timeZone = await workspaceZone(db, workspaceId);
  const filters = parseFilters(query, localDate(now, timeZone));
  const ctx = await reportContext(db, workspaceId, filters, now);
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
