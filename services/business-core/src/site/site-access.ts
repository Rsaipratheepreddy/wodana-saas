import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { tellClients, tellStaff } from "../client-portal/portal-notices";
import { noticeWork } from "../project-core/project-notices";
import { workEvent } from "../project-core/project-work";
import { orderEvent, readOrderLines } from "../purchasing/orders";
import { outstanding } from "../purchasing/receiving";

type Db = Pick<PoolClient, "query">;

export type SiteAccessStatus = "waiting" | "confirmed" | "move_asked" | "rescheduled" | "cancelled";
/** An open request about site access: the delivery day, what's coming, and the client's answer. */
export type SiteAccess = {
  id: string; orderId: string; orderNumber: string; projectId: string; date: string; items: string; status: "waiting" | "confirmed" | "move_asked";
  /** Who answered (a client contact, or someone of the team for them) and, when asked to move, why and which day suits. */
  answeredBy: string | null; answeredAt: string | null; clientReason: string | null; clientDate: string | null;
  /** When this day replaced another the team moved: why, and whether the new delivery is charged. */
  movedFrom: string | null; moveReason: string | null; chargeable: boolean;
  version: number;
};

const OPEN = ["waiting", "confirmed", "move_asked"];
const RECEIVABLE = ["sent", "confirmed", "partly_received"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function today(db: Db, workspaceId: string) {
  return (await db.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`,
    [workspaceId])).rows[0].today;
}

/** A day the way the workspace writes it ("3 Oct 2026"). */
async function dayText(db: Db, workspaceId: string, day: string) {
  const locale = (await db.query<{ locale: string | null }>(`SELECT default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.locale ?? "en";
  try { return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${day}T00:00:00Z`)); }
  catch { return day; }
}

/** Who meets deliveries on a project's site: its site supervisors, else its managers (memberships and users). */
async function siteLeads(db: Db, workspaceId: string, projectId: string) {
  const rows = (await db.query<{ membershipId: string; userId: string; supervisor: boolean }>(
    `SELECT membership.id AS "membershipId", membership.user_id AS "userId", 'site_supervisor' = ANY(assignment.role_keys) AS supervisor
       FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND ('site_supervisor' = ANY(assignment.role_keys) OR assignment.is_manager)
      ORDER BY assignment.id`, [workspaceId, projectId])).rows;
  const supervisors = rows.filter((row) => row.supervisor);
  return { assignee: (supervisors[0] ?? rows[0])?.membershipId ?? null, people: [...new Set(rows.map((row) => row.userId))] };
}

/** For each project an order delivers to on site: the first day its lines still to come are due, and what they are. */
async function dueByProject(db: Db, workspaceId: string, orderId: string) {
  const due = new Map<string, { date: string | null; items: string[] }>();
  for (const line of await readOrderLines(db as PoolClient, workspaceId, orderId)) {
    if (!line.projectId || outstanding(line).cmp(0) <= 0) continue;
    const entry = due.get(line.projectId) ?? { date: null, items: [] };
    if (line.due && (!entry.date || line.due < entry.date)) entry.date = line.due;
    entry.items.push(line.description);
    due.set(line.projectId, entry);
  }
  return due;
}

type Row = { id: string; orderId: string; projectId: string; date: string; status: SiteAccessStatus; taskId: string | null; version: number; items: string };
const ROW = `id, order_id AS "orderId", project_id AS "projectId", delivery_date::text AS date, status, task_id AS "taskId", version, items`;

async function openRequest(db: Db, workspaceId: string, orderId: string, projectId: string) {
  return (await db.query<Row>(`SELECT ${ROW} FROM site_access_requests WHERE workspace_id = $1 AND order_id = $2 AND project_id = $3 AND status = ANY($4::text[]) FOR UPDATE`,
    [workspaceId, orderId, projectId, OPEN])).rows[0];
}

/**
 * The supervisor's task to meet a delivery: moved to the new day while it's still open, else a new one given to the
 * project's site supervisor (or its manager), due on the delivery day.
 */
async function meetTask(db: Db, workspaceId: string, input: { projectId: string; orderNumber: string; date: string; items: string; taskId: string | null; actorId: string }) {
  const title = `Meet delivery ${input.orderNumber} on site`;
  const description = `${input.items}\n\nThe client is asked to confirm site access for the day.`.slice(0, 10000);
  if (input.taskId) {
    const moved = (await db.query<{ id: string; number: number; assignee: string | null; was: string | null }>(
      `UPDATE work_items item SET due_date = $3, description = $4, version = item.version + 1, updated_at = now()
        FROM (SELECT due_date FROM work_items WHERE workspace_id = $1 AND id = $2) previous
        WHERE item.workspace_id = $1 AND item.id = $2 AND item.status NOT IN ('done', 'cancelled')
        RETURNING item.id, item.number, item.assignee_membership_id AS assignee, previous.due_date::text AS was`, [workspaceId, input.taskId, input.date, description])).rows[0];
    if (moved) {
      if (moved.was !== input.date) {
        await workEvent(db, workspaceId, moved.id, "moved", { from: moved.was, to: input.date }, input.actorId);
        if (moved.assignee) await noticeWork(db, { workspaceId, projectId: input.projectId, key: `${moved.id}:${input.date}`, actorUserId: input.actorId,
          notice: { code: "work.moved", item: { id: moved.id, number: moved.number, title, dueDate: input.date }, note: "", memberships: [moved.assignee] } });
      }
      return moved.id;
    }
  }
  const { assignee } = await siteLeads(db, workspaceId, input.projectId);
  await db.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, input.projectId]);
  const number = (await db.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM work_items WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, input.projectId])).rows[0].next;
  const id = randomUUID();
  await db.query(
    `INSERT INTO work_items (id, workspace_id, project_id, number, type, title, description, priority, assignee_membership_id, due_date, created_by)
     VALUES ($1, $2, $3, $4, 'task', $5, $6, 'high', $7, $8, $9)`, [id, workspaceId, input.projectId, number, title, description, assignee, input.date, input.actorId]);
  await workEvent(db, workspaceId, id, "created", { type: "task", source: "site_access" }, input.actorId);
  if (assignee) await noticeWork(db, { workspaceId, projectId: input.projectId, key: id, actorUserId: input.actorId,
    notice: { code: "work.assigned", item: { id, number, title, dueDate: input.date }, memberships: [assignee] } });
  return id;
}

/** Asks the project's client contacts in the portal (and by email) to confirm site access for the day. */
async function askClient(db: Db, workspaceId: string, requestId: string, projectId: string, date: string, note: string) {
  const caseId = (await db.query<{ caseId: string }>(`SELECT case_id AS "caseId" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0].caseId;
  return tellClients(db, { workspaceId, caseId, event: "site_access", recordId: requestId, title: await dayText(db, workspaceId, date), note });
}

/**
 * D-29. Once a supplier says when an order arrives on site (its confirmation, or a new date when it's chased), each
 * running project it delivers to asks its client to confirm site access for that day, and the site supervisor gets a
 * task to meet it. A new day replaces the request (the client is asked again and the task moves); the same day
 * changes nothing. Days already past are not asked about.
 */
export async function askSiteAccess(db: Db, workspaceId: string, orderId: string, actorUserId: string) {
  const order = (await db.query<{ number: string; deliverTo: string; status: string }>(
    `SELECT number, deliver_to AS "deliverTo", status FROM purchase_orders WHERE workspace_id = $1 AND id = $2`, [workspaceId, orderId])).rows[0];
  if (!order || order.deliverTo !== "site" || !RECEIVABLE.includes(order.status)) return 0;
  const day = await today(db, workspaceId);
  const due = await dueByProject(db, workspaceId, orderId);
  // A project with nothing more coming on the order (its lines cancelled) isn't asked about any more.
  await closeSiteAccess(db, workspaceId, orderId, actorUserId, [...due.keys()]);
  let asked = 0;
  for (const [projectId, next] of due) {
    if (!next.date || next.date < day) continue;
    const project = (await db.query<{ status: string }>(`SELECT status FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0];
    if (project?.status !== "active") continue;
    const open = await openRequest(db, workspaceId, orderId, projectId);
    if (open?.date === next.date) continue;
    const items = next.items.join(", ").slice(0, 1000);
    const id = await replace(db, workspaceId, open, { orderId, projectId, date: next.date, items, supersede: "cancelled" });
    const taskId = await meetTask(db, workspaceId, { projectId, orderNumber: order.number, date: next.date, items, taskId: open?.taskId ?? null, actorId: actorUserId });
    await db.query(`UPDATE site_access_requests SET task_id = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, taskId]);
    await askClient(db, workspaceId, id, projectId, next.date, items);
    asked += 1;
  }
  return asked;
}

/** Closes the open request (if any) and opens the new day's in its place; the old one points at the new one. */
async function replace(db: Db, workspaceId: string, open: Row | undefined,
  input: { orderId: string; projectId: string; date: string; items: string; supersede: "cancelled" | "rescheduled"; reason?: string; chargeable?: boolean; userId?: string }) {
  if (open) await db.query(
    `UPDATE site_access_requests SET status = $3, reschedule_reason = $4, chargeable = $5, rescheduled_by = $6, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND id = $2`, [workspaceId, open.id, input.supersede, input.reason ?? null, input.chargeable ?? false, input.userId ?? null]);
  const id = randomUUID();
  await db.query(
    `INSERT INTO site_access_requests (id, workspace_id, project_id, order_id, delivery_date, items, task_id, chargeable) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, workspaceId, input.projectId, input.orderId, input.date, input.items, open?.taskId ?? null, input.chargeable ?? false]);
  if (open) await db.query(`UPDATE site_access_requests SET replaced_by = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, open.id, id]);
  return id;
}

/**
 * An order cancelled or closed: nothing more is coming, so its open requests close and their tasks are cancelled
 * (except for the projects in `keep`, which still have goods to come).
 */
export async function closeSiteAccess(db: Db, workspaceId: string, orderId: string, actorUserId: string, keep: string[] = []) {
  const closed = (await db.query<{ taskId: string | null }>(
    `UPDATE site_access_requests SET status = 'cancelled', version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND order_id = $2 AND status = ANY($3::text[]) AND NOT (project_id = ANY($4::uuid[])) RETURNING task_id AS "taskId"`,
    [workspaceId, orderId, OPEN, keep])).rows;
  for (const { taskId } of closed) {
    if (!taskId) continue;
    const cancelled = await db.query(`UPDATE work_items SET status = 'cancelled', version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2 AND status NOT IN ('done', 'cancelled')`,
      [workspaceId, taskId]);
    if (cancelled.rowCount) await workEvent(db, workspaceId, taskId, "cancelled", { reason: "Nothing more is coming on this order." }, actorUserId);
  }
  return closed.length;
}

/** The open requests on a project's site deliveries, by order (for the team's Deliveries). */
export async function readSiteAccess(db: Db, workspaceId: string, projectId: string): Promise<SiteAccess[]> {
  return (await db.query<SiteAccess>(
    `SELECT request.id, request.order_id AS "orderId", purchase.number AS "orderNumber", request.project_id AS "projectId", request.delivery_date::text AS date, request.items, request.status,
            coalesce(grant_row.confirmed_name, grant_row.name, person.display_name) AS "answeredBy", request.answered_at AS "answeredAt",
            request.client_reason AS "clientReason", request.client_date::text AS "clientDate",
            previous.delivery_date::text AS "movedFrom", previous.reschedule_reason AS "moveReason", coalesce(previous.chargeable, false) AS chargeable, request.version
       FROM site_access_requests request
       JOIN purchase_orders purchase ON purchase.workspace_id = request.workspace_id AND purchase.id = request.order_id
       LEFT JOIN client_portal_grants grant_row ON grant_row.id = request.answered_by_grant
       LEFT JOIN users person ON person.id = request.answered_by_user
       LEFT JOIN site_access_requests previous ON previous.workspace_id = request.workspace_id AND previous.replaced_by = request.id AND previous.status = 'rescheduled'
      WHERE request.workspace_id = $1 AND request.project_id = $2 AND request.status = ANY($3::text[])
      ORDER BY request.delivery_date, purchase.number`, [workspaceId, projectId, OPEN])).rows
    .map((row) => ({ ...row, answeredAt: row.answeredAt ? new Date(row.answeredAt).toISOString() : null }));
}

/** What the client sees: deliveries from today on, with the day, what's coming and their answer so far. */
export async function readClientSiteAccess(db: Db, workspaceId: string, projectId: string, day: string) {
  return (await readSiteAccess(db, workspaceId, projectId)).filter((row) => row.date >= day)
    .map((row) => ({ id: row.id, date: row.date, items: row.items, status: row.status, clientReason: row.clientReason, clientDate: row.clientDate,
      movedFrom: row.movedFrom, moveReason: row.moveReason, chargeable: row.chargeable, version: row.version }));
}

function version(value: unknown, current: number) {
  if (value === undefined || value === null || Number(value) !== current) throw new ConflictException("This delivery changed. Reload to see its day.");
}

function optionalDate(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label}: choose a date.`);
  return value;
}

function reasonOf(value: unknown, missing: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new BadRequestException(missing);
  if (text.length > 500) throw new BadRequestException("Keep it under 500 characters.");
  return text;
}

async function lockRequest(db: Db, workspaceId: string, projectId: string, requestId: unknown) {
  const id = typeof requestId === "string" ? requestId : "";
  const row = /^[0-9a-f-]{36}$/i.test(id) ? (await db.query<Row>(
    `SELECT ${ROW} FROM site_access_requests WHERE workspace_id = $1 AND id = $2 AND project_id = $3 FOR UPDATE`, [workspaceId, id, projectId])).rows[0] : undefined;
  if (!row) throw new NotFoundException("This delivery isn't on the project.");
  return row;
}

async function staffFacts(db: Db, workspaceId: string, projectId: string) {
  return (await db.query<{ title: string; clientName: string }>(
    `SELECT project.reference || ' · ' || project.name AS title, coalesce(party.display_name, opportunity.title) AS "clientName"
       FROM delivery_projects project
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
      WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, projectId])).rows[0] ?? { title: "", clientName: "" };
}

/**
 * The client's answer in the portal: confirmed (someone lets the team in that day), or asked to move with why and
 * the day that suits. Version-checked; confirming what's already confirmed changes nothing. The site supervisor and the
 * project manager hear it in the app, and by email when a move is asked.
 */
export async function answerSiteAccess(db: Db, workspaceId: string, input: { projectId: string; grantId: string; name: string; body: Record<string, unknown> }) {
  const request = await lockRequest(db, workspaceId, input.projectId, input.body.requestId);
  const decision = input.body.decision;
  if (decision !== "confirm" && decision !== "move") throw new BadRequestException("Confirm the day or ask to move it.");
  if (decision === "confirm" && request.status === "confirmed") return { request, changed: false, decision };
  version(input.body.version, request.version);
  if (!OPEN.includes(request.status)) throw new ConflictException("This delivery was moved. Reload to see its new day.");
  const day = await today(db, workspaceId);
  if (request.date < day) throw new ConflictException("This delivery day has passed.");
  const when = await dayText(db, workspaceId, request.date);
  let note: string;
  let audit: Record<string, unknown>;
  if (decision === "confirm") {
    await db.query(`UPDATE site_access_requests SET status = 'confirmed', answered_by_grant = $3, answered_by_user = NULL, answered_at = now(), client_reason = NULL, client_date = NULL,
      version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, request.id, input.grantId]);
    note = `Site access confirmed for ${when}: ${request.items}`;
    audit = { decision, date: request.date };
  } else {
    const reason = reasonOf(input.body.reason, "Say why the day doesn't work.");
    const preferred = optionalDate(input.body.preferredDate, "Day that suits you");
    if (preferred && preferred < day) throw new BadRequestException("Choose a day from today on.");
    await db.query(`UPDATE site_access_requests SET status = 'move_asked', answered_by_grant = $3, answered_by_user = NULL, answered_at = now(), client_reason = $4, client_date = $5,
      version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, request.id, input.grantId, reason, preferred]);
    note = [`${when}: ${request.items}`, `Why: ${reason}`, preferred ? `Suits them: ${await dayText(db, workspaceId, preferred)}` : ""].filter(Boolean).join("\n");
    audit = { decision, date: request.date, reason, preferred };
  }
  const facts = await staffFacts(db, workspaceId, input.projectId);
  const { people } = await siteLeads(db, workspaceId, input.projectId);
  const code = decision === "confirm" ? "site.access_confirmed" : "site.access_move_asked";
  await tellStaff(db, { workspaceId, recipients: people, code, variables: { title: facts.title, clientName: facts.clientName, actor: input.name, note: note.slice(0, 480) },
    deepLink: `/workspace/projects/${input.projectId}/site?view=deliveries`, key: `${request.id}:${request.version + 1}`, email: decision === "move" });
  return { request, changed: true, decision, audit };
}

/**
 * The team's side (D-29): the client confirmed by phone (recorded for them), or the delivery moves to a new day with a
 * reason — the order's lines for this project are promised for that day, the client is asked about the new day, the
 * supervisor's task moves and the buyer hears it to tell the supplier. A move the client caused may be charged.
 */
export async function arrangeSiteAccess(db: Db, workspaceId: string, projectId: string, userId: string, requestId: string, body: Record<string, unknown>) {
  const request = await lockRequest(db, workspaceId, projectId, requestId);
  version(body.version, request.version);
  if (!OPEN.includes(request.status)) throw new ConflictException("This delivery was moved. Reload to see its new day.");
  const action = body.action;
  if (action === "confirm") {
    if (request.status === "confirmed") throw new ConflictException("The client already confirmed this day.");
    await db.query(`UPDATE site_access_requests SET status = 'confirmed', answered_by_user = $3, answered_by_grant = NULL, answered_at = now(), version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND id = $2`, [workspaceId, request.id, userId]);
    return { id: request.id, audit: { action, date: request.date } };
  }
  if (action !== "reschedule") throw new BadRequestException("This action isn't available.");
  const date = optionalDate(body.date, "New day");
  if (!date) throw new BadRequestException("Choose the new delivery day.");
  if (date < await today(db, workspaceId)) throw new BadRequestException("Choose a day from today on.");
  if (date === request.date) throw new BadRequestException("Choose a different day.");
  const reason = reasonOf(body.reason, "Say why the delivery moves.");
  const chargeable = body.chargeable === true;
  const order = (await db.query<{ number: string; createdBy: string; vendor: string }>(
    `SELECT purchase.number, purchase.created_by AS "createdBy", vendor.display_name AS vendor FROM purchase_orders purchase
       JOIN workspace_vendors vendor ON vendor.workspace_id = purchase.workspace_id AND vendor.id = purchase.vendor_id
      WHERE purchase.workspace_id = $1 AND purchase.id = $2`, [workspaceId, request.orderId])).rows[0];
  const id = await replace(db, workspaceId, request, { orderId: request.orderId, projectId, date, items: request.items, supersede: "rescheduled", reason, chargeable, userId });
  // What's still to come for this project on the order is now promised for the new day.
  for (const line of await readOrderLines(db as PoolClient, workspaceId, request.orderId))
    if (line.projectId === projectId && outstanding(line).cmp(0) > 0)
      await db.query(`UPDATE purchase_order_lines SET promised_date = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, line.id, date]);
  const reference = (await db.query<{ reference: string }>(`SELECT reference FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0].reference;
  await orderEvent(db, workspaceId, request.orderId, "delivery_moved", { project: reference, from: request.date, to: date, reason, chargeable }, userId);
  const taskId = await meetTask(db, workspaceId, { projectId, orderNumber: order.number, date, items: request.items, taskId: request.taskId, actorId: userId });
  await db.query(`UPDATE site_access_requests SET task_id = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, taskId]);
  const when = await dayText(db, workspaceId, date);
  await askClient(db, workspaceId, id, projectId, date, [`${request.items}`, `Moved from ${await dayText(db, workspaceId, request.date)}: ${reason}`,
    chargeable ? "The new delivery is charged." : ""].filter(Boolean).join(". ").slice(0, 480));
  const facts = await staffFacts(db, workspaceId, projectId);
  const { people } = await siteLeads(db, workspaceId, projectId);
  await tellStaff(db, { workspaceId, recipients: [...new Set([order.createdBy, ...people])], code: "site.delivery_moved", except: userId,
    variables: { title: facts.title, clientName: facts.clientName, actor: "", note: `${order.number} · ${order.vendor}: now ${when}. ${reason}${chargeable ? " (charged)" : ""}`.slice(0, 480) },
    deepLink: `/workspace/projects/${projectId}/site?view=deliveries`, key: id });
  return { id, audit: { action, from: request.date, to: date, reason, chargeable } };
}
