import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { needsNotIn, readNeeds, readOrderLines } from "../purchasing/orders";
import { outstanding } from "../purchasing/receiving";
import { OPEN, readItems, type WorkItem } from "./project-work";
import { readCalendar, workdays } from "./work-calendar";

type Db = Pick<PoolClient, "query">;

/** What holds a project up, each counted from the record that causes it and linked to its filtered list. */
export type BlockerKey =
  | "late_work" | "blocked_work" | "materials_not_in" | "late_to_order" | "late_orders" | "work_orders_waiting"
  | "reports_missing" | "client_decisions" | "critical_snags" | "funds_short";
export type Blocker = { key: BlockerKey; count: number; items: string[]; href: string };

/** A decision the client still owes: the material list, a handover pack, a variation, or a request they raised. */
export type ClientDecision = { kind: "materials" | "drawings" | "handover" | "variation"; label: string; since: string | null; href: string };

export type ProjectSignals = {
  today: string;
  work: { open: number; late: number; blocked: number; ready: number; openSnags: number; criticalSnags: number; clientRequests: number };
  lateOrders: Array<{ id: string; number: string; supplier: string; due: string }>;
  reportsMissing: string[];
  decisions: ClientDecision[];
  blockers: Blocker[];
  /** Per stage: the planned span of its work and how much of it is still open. */
  stagePlan: Record<string, { start: string | null; end: string | null; open: number; total: number }>;
  /** When the plan's open work ends (the latest due date of open work). */
  planEnd: string | null;
};

const MAX_ITEMS = 3;
const label = (item: Pick<WorkItem, "number" | "title">) => `#${item.number} ${item.title}`;

/**
 * Reads a project's delivery signals from the records: late and blocked work, materials not in, what
 * should have been ordered, late orders, work orders waiting, missing site reports and decisions the
 * client owes. Everything is read, nothing is changed; used by the project Overview and the weekly summary.
 */
export async function readSignals(db: Db, workspaceId: string, project: { id: string; caseId: string; status: string }): Promise<ProjectSignals> {
  const base = `/workspace/projects/${project.id}`;
  const today = (await db.query<{ today: string }>(
    `SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
  const items = await readItems(db, workspaceId, project.id);
  const open = items.filter((item) => OPEN(item.status));
  const late = open.filter((item) => item.dueDate && item.dueDate < today).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  // Waiting on a predecessor or on a blocker issue (a blocker holds its item up through a link).
  const blocked = open.filter((item) => item.blockedBy.length > 0);
  const ready = open.filter((item) => item.status === "todo" && !blocked.includes(item) && (!item.startDate || item.startDate <= today));
  const snags = open.filter((item) => item.type === "snag");
  const critical = snags.filter((item) => item.severity === "critical");
  const requests = open.filter((item) => item.type === "client_request");

  // Materials: open work that needs its package's materials, still waiting for some.
  const needing = open.filter((item) => item.needsMaterials);
  const needs = needing.length || ["active", "on_hold"].includes(project.status) ? await readNeeds(db, workspaceId, false, project.id) : [];
  const waiting = needing.filter((item) => needsNotIn(needs, item.packageId).length > 0);
  const lateToOrder = needs.filter((need) => !need.blocked && need.orderBy && need.orderBy < today && need.remaining !== null && Dec.of(need.remaining).cmp(0) > 0);

  // Orders still owed goods that were due before today.
  const orderIds = (await db.query<{ id: string }>(
    `SELECT DISTINCT purchase.id FROM purchase_orders purchase JOIN purchase_order_lines line ON line.workspace_id = purchase.workspace_id AND line.order_id = purchase.id
      WHERE purchase.workspace_id = $1 AND line.project_id = $2 AND purchase.status IN ('sent', 'confirmed', 'partly_received')
        AND coalesce(line.promised_date, purchase.promised_date, purchase.expected_date) < $3::date`, [workspaceId, project.id, today])).rows.map((row) => row.id);
  const lateOrders: ProjectSignals["lateOrders"] = [];
  for (const id of orderIds) {
    const lines = (await readOrderLines(db, workspaceId, id)).filter((line) => line.due && line.due < today && outstanding(line).cmp(0) > 0);
    if (!lines.length) continue;
    const order = (await db.query<{ number: string; supplier: string }>(
      `SELECT purchase.number, vendor.display_name AS supplier FROM purchase_orders purchase JOIN workspace_vendors vendor ON vendor.workspace_id = purchase.workspace_id AND vendor.id = purchase.vendor_id
        WHERE purchase.workspace_id = $1 AND purchase.id = $2`, [workspaceId, id])).rows[0];
    lateOrders.push({ id, number: order?.number ?? "", supplier: order?.supplier ?? "", due: lines.map((line) => line.due!).sort()[0] });
  }
  lateOrders.sort((a, b) => a.due.localeCompare(b.due));

  // Factory work orders not released yet, or stopped.
  const workOrders = (await db.query<{ number: number; title: string; status: string }>(
    `SELECT number, title, status FROM work_orders WHERE workspace_id = $1 AND project_id = $2 AND status IN ('planned', 'on_hold') ORDER BY number`, [workspaceId, project.id])).rows;

  // Site reports missing: worked days in the last week (before today) while site work ran, with no report submitted.
  const site = (await db.query<{ started: string | null; finished: string | null }>(
    `SELECT site_started_on::text AS started, site_finished_on::text AS finished FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, project.id])).rows[0];
  const reportsMissing: string[] = [];
  if (site?.started && project.status === "active") {
    const calendar = workdays(await readCalendar(db, workspaceId));
    const reported = new Set((await db.query<{ day: string }>(
      `SELECT DISTINCT report_date::text AS day FROM site_reports WHERE workspace_id = $1 AND project_id = $2 AND status IN ('submitted', 'approved') AND report_date >= $3::date - 7`,
      [workspaceId, project.id, today])).rows.map((row) => row.day));
    for (let back = 7; back >= 1; back--) {
      const day = new Date(Date.parse(`${today}T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
      if (day < site.started || (site.finished && day > site.finished) || !calendar.isWorking(day)) continue;
      if (!reported.has(day)) reportsMissing.push(day);
    }
  }

  const decisions = await readClientDecisions(db, workspaceId, project, base);

  const blockers: Blocker[] = [
    { key: "late_work" as const, count: late.length, items: late.slice(0, MAX_ITEMS).map(label), href: `${base}/plan?filter=late` },
    { key: "blocked_work" as const, count: blocked.length, items: blocked.slice(0, MAX_ITEMS).map(label), href: `${base}/plan?filter=blocked` },
    { key: "materials_not_in" as const, count: waiting.length, items: waiting.slice(0, MAX_ITEMS).map(label), href: `${base}/plan?filter=materials` },
    { key: "late_to_order" as const, count: lateToOrder.length, items: lateToOrder.slice(0, MAX_ITEMS).map((need) => need.title), href: `/workspace/purchasing?project=${project.id}` },
    { key: "late_orders" as const, count: lateOrders.length, items: lateOrders.slice(0, MAX_ITEMS).map((order) => `${order.number} · ${order.supplier}`),
      href: lateOrders.length === 1 ? `/workspace/purchasing/orders?order=${lateOrders[0].id}` : `/workspace/purchasing/orders?project=${project.id}` },
    { key: "work_orders_waiting" as const, count: workOrders.length, items: workOrders.slice(0, MAX_ITEMS).map((order) => `WO-${order.number} ${order.title}`),
      href: `/workspace/factory?project=${project.id}` },
    { key: "reports_missing" as const, count: reportsMissing.length, items: reportsMissing.slice(-MAX_ITEMS), href: `${base}/site` },
    { key: "client_decisions" as const, count: decisions.length + requests.length, items: [...decisions.map((decision) => decision.label), ...requests.map(label)].slice(0, MAX_ITEMS),
      href: decisions[0]?.href ?? `${base}/plan?filter=requests` },
    { key: "critical_snags" as const, count: critical.length, items: critical.slice(0, MAX_ITEMS).map(label), href: `${base}/plan?filter=snags` },
  ].filter((blocker) => blocker.count > 0);

  const stagePlan: ProjectSignals["stagePlan"] = {};
  for (const item of items) {
    if (!item.stageId || item.status === "cancelled") continue;
    const entry = stagePlan[item.stageId] ?? { start: null, end: null, open: 0, total: 0 };
    const start = item.startDate ?? item.dueDate, end = item.dueDate ?? item.startDate;
    if (start && (!entry.start || start < entry.start)) entry.start = start;
    if (end && (!entry.end || end > entry.end)) entry.end = end;
    entry.total += 1;
    if (OPEN(item.status)) entry.open += 1;
    stagePlan[item.stageId] = entry;
  }
  const planEnd = open.map((item) => item.dueDate ?? item.startDate).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

  return {
    today,
    work: { open: open.length, late: late.length, blocked: blocked.length, ready: ready.length, openSnags: snags.length, criticalSnags: critical.length, clientRequests: requests.length },
    lateOrders, reportsMissing, decisions, blockers, stagePlan, planEnd,
  };
}

/** Decisions waiting on the client: the material list and the drawings sent, handover packs issued, variations sent. */
async function readClientDecisions(db: Db, workspaceId: string, project: { id: string; caseId: string }, base: string): Promise<ClientDecision[]> {
  const decisions: ClientDecision[] = [];
  const materials = (await db.query<{ number: number; sentAt: string; status: string }>(
    `SELECT number, sent_at AS "sentAt", status FROM project_material_revisions WHERE workspace_id = $1 AND project_id = $2 ORDER BY number DESC LIMIT 1`, [workspaceId, project.id])).rows[0];
  if (materials?.status === "sent")
    decisions.push({ kind: "materials", label: `Material list R${materials.number}`, since: new Date(materials.sentAt).toISOString(), href: `${base}/scope?view=materials` });
  const drawings = (await db.query<{ number: number; sentAt: string; status: string }>(
    `SELECT number, sent_at AS "sentAt", status FROM project_drawing_revisions WHERE workspace_id = $1 AND project_id = $2 ORDER BY number DESC LIMIT 1`, [workspaceId, project.id])).rows[0];
  if (drawings?.status === "sent")
    decisions.push({ kind: "drawings", label: `Drawings R${drawings.number}`, since: new Date(drawings.sentAt).toISOString(), href: `${base}/scope?view=drawings` });
  const packs = (await db.query<{ revision: number; title: string; issuedAt: string }>(
    `SELECT revision, title, issued_at AS "issuedAt" FROM handover_packs WHERE workspace_id = $1 AND project_id = $2 AND status = 'issued' ORDER BY revision`, [workspaceId, project.id])).rows;
  for (const pack of packs) decisions.push({ kind: "handover", label: `${pack.title} (R${pack.revision})`, since: new Date(pack.issuedAt).toISOString(), href: `${base}/handover` });
  const variations = (await db.query<{ number: number; title: string; sentAt: string | null }>(
    `SELECT number, title, updated_at AS "sentAt" FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND kind = 'variation' AND status IN ('issued', 'sent') ORDER BY number`,
    [workspaceId, project.caseId])).rows;
  for (const variation of variations)
    decisions.push({ kind: "variation", label: variation.title || `Variation V${variation.number}`, since: variation.sentAt ? new Date(variation.sentAt).toISOString() : null, href: `${base}/scope?view=changes` });
  return decisions;
}
