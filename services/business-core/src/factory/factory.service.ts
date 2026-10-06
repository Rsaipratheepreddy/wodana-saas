import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { InventoryService } from "../inventory/inventory.service";
import { move, stockItemFor } from "../inventory/stock";
import { notifyUserInApp } from "../notifications/default-templates";
import { productionPaid } from "../project-core/project-core.store";
import { ensurePurchasingSettings, needsNotIn, readNeeds, readOrderLines } from "../purchasing/orders";
import { OrdersService } from "../purchasing/orders.service";
import { outstanding, readLocations, resolvePlace } from "../purchasing/receiving";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { readWorkcenterRates } from "../project-core/labour-rates";
import { readCalendar } from "../project-core/work-calendar";
import { readMilestones } from "../receivables/receivables";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";
import {
  capacity, defaultHours, ensureFactorySettings, materialsShort, plain, readBatches, readToMake, readWorkcenters, readWorkOrderMaterials, readWorkOrders, workOrderNext, type WorkOrderRow,
} from "./factory";
import { orderReady, readReadyReminder, remindForReady } from "./factory-ready";
import { drawingsGate } from "../project-core/project-drawings";
import { setWorkcenterRate, workspaceDay } from "./workcenter-rates";
import { normaliseProductionSteps, parseProductionSteps, parseProductionWeeks, readProduction } from "./production-status";
import { useForProduction } from "../fulfilment/stock-reservations";
import { tellKeepInformed } from "../project-core/project-keep-informed";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^\d{1,14}(\.\d{1,4})?$/;
const VIEW = ["factory.view", "factory.manage", "factory.report", "factory.approve"];
type Notice = { code: "factory.released" | "factory.report_waiting" | "factory.check_failed" | "factory.ready" | "factory.substitution" | "factory.drawing_revised"; users: string[]; note: string; key: string };
const MATERIAL_ACTIONS = ["add_material", "set_material", "remove_material", "suggest_materials", "issue_material", "return_material", "substitute", "decide_substitution"];

/**
 * The factory: work orders for scope lines made in our factory. A line splits across work orders but
 * never beyond its quantity. A work order is released only when its checks pass; its output is
 * reported, approved by someone else and quality-checked. What passes goes into stock at the factory
 * for the project; what fails is made again, and never counts twice.
 */
@Injectable()
export class FactoryService {
  constructor(private readonly access: WorkspaceAccessService, private readonly orders: OrdersService, private readonly inventory: InventoryService,
    @Optional() private readonly storage?: BrandAssetStorageService) {}

  state(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, VIEW, async (client, user) => {
      const rights = await this.rights(client, workspaceId, user.userId);
      const settings = await ensureFactorySettings(client, workspaceId);
      const orders = await readWorkOrders(client, workspaceId);
      // What each open work order made that's still at the factory for its project (what can go to site).
      const atFactory = new Map((await client.query<{ id: string; onHand: string }>(
        `SELECT wo.id, coalesce((SELECT sum(balance.on_hand) FROM stock_balances balance
                   JOIN stock_locations place ON place.workspace_id = balance.workspace_id AND place.id = balance.location_id AND place.kind = 'factory'
                  WHERE balance.workspace_id = wo.workspace_id AND balance.project_id = wo.project_id
                    AND balance.item_id IN (SELECT made.item_id FROM stock_movements made WHERE made.workspace_id = wo.workspace_id AND made.work_order_id = wo.id AND made.kind = 'produce')), 0)::numeric(18, 4)::text AS "onHand"
           FROM work_orders wo WHERE wo.workspace_id = $1 AND wo.status IN ('in_production', 'ready')`, [workspaceId])).rows.map((row) => [row.id, row.onHand]));
      // Why each planned work order can't be released yet (the needs of a project are read once).
      const needs = new Map<string, Awaited<ReturnType<typeof readNeeds>>>();
      const canSend = rights.canManage || rights.canIssue;
      const rows = [];
      for (const order of orders) {
        const blocked = order.status === "planned" ? (await this.releaseChecks(client, workspaceId, order, settings, needs)).filter((check) => !check.passed).map((check) => ({ key: check.key, missing: check.missing })) : [];
        const next = workOrderNext(order, { blocked: blocked.length > 0, atFactory: atFactory.get(order.id) ?? "0", requireCheck: settings.requireCheck, canManage: rights.canManage,
          canReport: rights.canReport, canApprove: rights.canApprove, canSend });
        rows.push({ ...order, blocked, atFactory: atFactory.get(order.id) ?? "0", next: next.step, mine: next.mine });
      }
      return {
        toMake: await readToMake(client, workspaceId), orders: rows, workcenters: await readWorkcenters(client, workspaceId), batches: await readBatches(client, workspaceId),
        requireCheck: settings.requireCheck, today: (await workspaceDay(client, workspaceId)).today, ...rights,
      };
    });
  }

  /** The next weeks on each workcenter: the hours booked each working day, and where they pass what it can do. */
  schedule(actor: RequestActor, workspaceId: string, query: { from?: string; days?: string }) {
    return this.access.withAnyPermission(actor, workspaceId, VIEW, async (client) => {
      const today = (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
      const from = query.from && DATE.test(query.from) ? query.from : today;
      const span = Math.min(Math.max(Number(query.days) || 28, 7), 91);
      const to = new Date(Date.parse(`${from}T00:00:00Z`) + (span - 1) * 86_400_000).toISOString().slice(0, 10);
      const workcenters = await readWorkcenters(client, workspaceId);
      const orders = (await readWorkOrders(client, workspaceId)).filter((order) => ["planned", "released", "in_production", "on_hold"].includes(order.status)
        && order.plannedStart && order.plannedEnd && order.plannedStart <= to && order.plannedEnd >= from);
      return { from, to, workcenters, orders, ...capacity(orders, workcenters, await readCalendar(client, workspaceId), from, to) };
    });
  }

  /**
   * Groups work orders from any projects into one run on a workcenter and day. Each keeps its project,
   * output and checks. A work order is in one open batch at a time, and only before it starts.
   */
  saveBatch(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "factory.manage", async (client, user) => {
      const id = uuid(body.id, "Batch");
      const existing = (await client.query<{ status: string; version: number }>(`SELECT status, version FROM production_batches WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, id])).rows[0];
      const action = existing ? String(body.action ?? "") : "create";
      if (existing && body.version !== existing.version) throw new ConflictException("Someone else changed this batch. Reload to see their changes.");
      const orderIds = Array.isArray(body.orderIds) ? [...new Set(body.orderIds.map((value) => uuid(value, "Work order")))] : [];
      const join = async () => {
        if (!orderIds.length) throw new BadRequestException("Choose the work orders for the batch.");
        const orders = (await readWorkOrders(client, workspaceId)).filter((order) => orderIds.includes(order.id));
        if (orders.length !== orderIds.length) throw new BadRequestException("A work order isn't found.");
        const busy = orders.find((order) => !["planned", "released"].includes(order.status));
        if (busy) throw new ConflictException(`WO-${String(busy.number).padStart(4, "0")} has started or is closed.`);
        const elsewhere = orders.find((order) => order.batchId && order.batchId !== id);
        if (elsewhere) throw new ConflictException(`WO-${String(elsewhere.number).padStart(4, "0")} is already in ${elsewhere.batchName}.`);
        await client.query(`UPDATE work_orders SET batch_id = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = ANY($2::uuid[])`, [workspaceId, orderIds, id]);
      };
      if (action === "create") {
        const name = text(body.name, 200);
        if (!name) throw new BadRequestException("Name the batch.");
        const workcenterId = body.workcenterId ? uuid(body.workcenterId, "Workcenter") : null;
        if (workcenterId && !(await readWorkcenters(client, workspaceId)).some((center) => center.id === workcenterId)) throw new BadRequestException("Choose a workcenter in use.");
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('batch-number:' || $1::text, 0))`, [workspaceId]);
        const number = (await client.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM production_batches WHERE workspace_id = $1`, [workspaceId])).rows[0].next;
        await client.query(`INSERT INTO production_batches (id, workspace_id, number, name, workcenter_id, planned_on, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, workspaceId, number, name, workcenterId, optionalDate(body.plannedOn, "Date"), user.userId]);
        await join();
      } else if (action === "add") {
        if (existing.status !== "open") throw new ConflictException("Only an open batch takes more work orders.");
        await join();
      } else if (action === "remove") {
        const moved = await client.query(`UPDATE work_orders SET batch_id = NULL, version = version + 1, updated_at = now()
          WHERE workspace_id = $1 AND batch_id = $2 AND id = ANY($3::uuid[]) AND status IN ('planned', 'released')`, [workspaceId, id, orderIds]);
        if ((moved.rowCount ?? 0) !== orderIds.length) throw new ConflictException("A work order that started stays in its batch.");
      } else if (action === "start") {
        // Starting the run starts every released work order in it; the rest say why not.
        if (existing.status === "closed") throw new ConflictException("The batch is closed.");
        const orders = (await readWorkOrders(client, workspaceId)).filter((order) => order.batchId === id);
        const waiting = orders.filter((order) => order.status === "planned");
        if (waiting.length) throw new ConflictException(`Release ${waiting.map((order) => `WO-${String(order.number).padStart(4, "0")}`).join(", ")} first, or take it out of the batch.`);
        for (const order of orders.filter((item) => item.status === "released")) {
          if (order.lineStatus === "omitted" || Dec.of(order.scopeOver).cmp(0) > 0) throw new ConflictException(`WO-${String(order.number).padStart(4, "0")}: its scope changed.`);
          await client.query(`UPDATE work_orders SET status = 'in_production', started_at = now(), version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, order.id]);
          await this.event(client, workspaceId, order.id, "start", { batch: id }, user.userId);
          await this.productionStarted(client, workspaceId, order.projectId, user.userId);
          // PLM-125: starting takes the work order's materials out where its path says so (Furniture D and E).
          await useForProduction(client, workspaceId, { workOrderId: order.id, actorUserId: user.userId });
        }
        await client.query(`UPDATE production_batches SET status = 'started' WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
      } else if (action === "close") {
        await client.query(`UPDATE production_batches SET status = 'closed' WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
      } else throw new BadRequestException("Unknown action.");
      if (existing) await client.query(`UPDATE production_batches SET version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `production_batch.${action}`, entityType: "production_batch", entityId: id, after: { orderIds } });
      return { batches: await readBatches(client, workspaceId), orders: await readWorkOrders(client, workspaceId) };
    });
  }

  order(actor: RequestActor, workspaceId: string, orderId: string) {
    return this.access.withAnyPermission(actor, workspaceId, VIEW, async (client, user) => this.detail(client, workspaceId, orderId, user.userId));
  }

  /** Plans a work order for all or part of what's left of a scope line; replayed safely by its id. */
  plan(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "factory.manage", async (client, user) => {
      const id = uuid(body.id, "Work order");
      if ((await client.query(`SELECT 1 FROM work_orders WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rowCount) return this.detail(client, workspaceId, id, user.userId);
      const lineId = uuid(body.lineId, "Scope line");
      // One plan at a time per line, so two work orders can't both take what's left.
      await client.query(`SELECT 1 FROM project_boq_lines WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, lineId]);
      const line = (await readToMake(client, workspaceId, lineId))[0];
      if (!line) throw new BadRequestException("Choose a scope line of a running project that's made in the factory.");
      const quantity = amount(body.quantity, "Quantity");
      if (Dec.of(quantity).cmp(0) <= 0) throw new BadRequestException("Enter how many to make.");
      if (Dec.of(quantity).cmp(line.left) > 0)
        throw new ConflictException(Dec.of(line.left).cmp(0) > 0 ? `Only ${plain(line.left)} ${line.unit} of ${line.title} is left to plan.`.replace("  ", " ") : `All of ${line.title} is already on work orders.`);
      const schedule = await this.dates(client, workspaceId, body, { workcenterId: null, plannedStart: line.suggestedStart, plannedEnd: line.suggestedEnd, plannedHours: null });
      // No hours given: the workcenter's hours a day over the working days it's planned for.
      if (!schedule.plannedHours && schedule.workcenterId)
        schedule.plannedHours = defaultHours((await readWorkcenters(client, workspaceId)).find((center) => center.id === schedule.workcenterId)?.hoursPerDay ?? null,
          schedule.plannedStart, schedule.plannedEnd, await readCalendar(client, workspaceId));
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('work-order-number:' || $1::text, 0))`, [workspaceId]);
      const number = (await client.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM work_orders WHERE workspace_id = $1`, [workspaceId])).rows[0].next;
      await client.query(
        `INSERT INTO work_orders (id, workspace_id, number, project_id, package_id, boq_line_id, title, specification, quantity, unit, workcenter_id, planned_start, planned_end, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [id, workspaceId, number, line.projectId, line.packageId, lineId, line.title, line.specification.slice(0, 2000), quantity, line.unit, schedule.workcenterId, schedule.plannedStart,
          schedule.plannedEnd, text(body.notes, 2000), user.userId]);
      if (schedule.plannedHours) await client.query(`UPDATE work_orders SET planned_hours = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, schedule.plannedHours]);
      // The payment stage due when it's ready: the one the project's last work order is tied to, so it's chosen once per project.
      await client.query(`UPDATE work_orders SET ready_payment_id = (SELECT other.ready_payment_id FROM work_orders other WHERE other.workspace_id = $1 AND other.project_id = $3 AND other.id <> $2
          AND other.ready_payment_id IS NOT NULL ORDER BY other.number DESC LIMIT 1) WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, line.projectId]);
      await this.event(client, workspaceId, id, "planned", { quantity, line: line.title }, user.userId);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "work_order.planned", entityType: "work_order", entityId: id, after: { lineId, quantity } });
      return this.detail(client, workspaceId, id, user.userId);
    });
  }

  /** One change to a work order, version-checked (reports and checks also by their own id). */
  command(actor: RequestActor, workspaceId: string, orderId: string, body: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, ["factory.manage", "factory.report", "factory.approve", "stock.manage"], async (client, user) => {
      await client.query(`SELECT 1 FROM work_orders WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, uuid(orderId, "Work order")]);
      const order = (await readWorkOrders(client, workspaceId, { id: orderId }))[0];
      if (!order) throw new NotFoundException("Work order not found.");
      const action = String(body.action ?? "");
      const has = (code: string) => this.access.hasPermission(client, workspaceId, user.userId, code);
      const need = async (code: string, message: string) => { if (!(await has(code))) throw new ForbiddenException(message); };
      const status = (...allowed: string[]) => { if (!allowed.includes(order.status)) throw new ConflictException(statusMessage(order.status)); };
      // Reports, checks and stock issued or returned carry their own id: sent twice, they're recorded once.
      const recordId = ["report", "check", "issue_material", "return_material", "dispatch"].includes(action)
        ? uuid(body.id, action === "report" ? "Report" : action === "check" ? "Check" : action === "dispatch" ? "Move" : "Change") : null;
      if (recordId && (await client.query(`SELECT 1 FROM factory_commands WHERE workspace_id = $1 AND command_id = $2`, [workspaceId, recordId])).rowCount)
        return this.detail(client, workspaceId, orderId, user.userId);
      if (!recordId && body.version !== order.version) throw new ConflictException("Someone else changed this work order. Reload to see their changes.");
      const settings = await ensureFactorySettings(client, workspaceId);
      const set = async (sql: string, values: unknown[] = []) =>
        client.query(`UPDATE work_orders SET ${sql}, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, orderId, ...values]);
      const notices: Notice[] = [];
      let audit: Record<string, unknown> = {};
      // A variation that removed or reduced the scope line stops new work on it until the work orders fit the line again.
      const scopeProblem = order.lineStatus === "omitted" ? "A variation removed its scope line: cancel it, or close it short."
        : Dec.of(order.scopeOver).cmp(0) > 0 ? `A variation reduced its scope line: ${plain(order.scopeOver)} ${order.unit} more are on work orders than it needs. Reduce or cancel a work order first.`.replace("  ", " ")
        : null;
      if (scopeProblem && ["release", "start", "report"].includes(action)) throw new ConflictException(scopeProblem);

      if (action === "set_quantity") {
        await need("factory.manage", "You can't change work orders.");
        status("planned", "released", "in_production", "on_hold");
        const quantity = amount(body.quantity, "Quantity");
        // Never below what's made or on its way through approval and checks; never past the line.
        const floor = Dec.of(order.passed).add(order.toCheck).add(order.pending);
        if (Dec.of(quantity).cmp(0) <= 0 || Dec.of(quantity).cmp(floor) < 0)
          throw new ConflictException(`${plain(floor.toString())} ${order.unit} is already made or waiting for approval and checks.`.replace("  ", " "));
        // What's left of the line (negative when a variation reduced it) is all it can grow by.
        const lineLeft = (await readToMake(client, workspaceId, order.boqLineId))[0]?.left ?? "0";
        const most = order.lineStatus === "omitted" ? Dec.of(order.quantity) : Dec.of(order.quantity).add(lineLeft);
        if (Dec.of(quantity).cmp(most) > 0) throw new ConflictException(`At most ${plain(most.toString())} ${order.unit}: the rest of the line is on other work orders.`.replace("  ", " "));
        await set(`quantity = $3`, [quantity]);
        audit = { from: order.quantity, to: quantity };
      } else if (action === "revise_drawing") {
        await need("factory.manage", "You can't record drawing changes.");
        status("planned", "released", "in_production", "on_hold");
        const picked = body.versionId ? await this.pickDrawing(client, workspaceId, order, body.versionId) : null;
        const reference = picked?.reference ?? text(body.reference, 200);
        const note = text(body.note, 300);
        if (!reference) throw new BadRequestException("Say which drawing it is now (its number or revision).");
        if (!note) throw new BadRequestException("Say what changed.");
        const running = ["released", "in_production", "on_hold"].includes(order.status);
        await set(`drawing_ref = $3, drawing_approved_by = $4, drawing_approved_at = now(), drawing_revised_by = $4, drawing_design_id = $5, drawing_version_id = $6, drawing_stale_version_id = NULL`,
          [reference, user.userId, picked?.designId ?? null, picked?.versionId ?? null]);
        // Work already going stops until someone else decides it goes on with the new drawing.
        if (running) await set(`status = 'on_hold', hold_kind = 'drawing', hold_reason = $3, held_from = CASE WHEN status = 'on_hold' THEN held_from ELSE status END`,
          [`Drawing changed to ${reference}: ${note}`.slice(0, 500)]);
        if (running) notices.push({ code: "factory.drawing_revised", users: [...await this.team(client, workspaceId, order.projectId, ["factory_lead"], true), ...await this.holders(client, workspaceId, ["factory.approve"])],
          note: `${reference}: ${note}`, key: `drawing:${orderId}:${reference}` });
        audit = { reference, note, held: running };
      } else if (action === "update") {
        await need("factory.manage", "You can't plan work orders.");
        status("planned", "released", "on_hold");
        const schedule = await this.dates(client, workspaceId, body, order);
        await set(`workcenter_id = $3, planned_start = $4, planned_end = $5, notes = $6, planned_hours = $7`, [schedule.workcenterId, schedule.plannedStart, schedule.plannedEnd,
          body.notes === undefined ? order.notes : text(body.notes, 2000), schedule.plannedHours]);
        audit = schedule;
      } else if (action === "approve_drawing") {
        await need("factory.manage", "You can't record drawing approvals.");
        status("planned", "on_hold");
        // An approved revision of one of the project's designs, or (without one in the system) a typed reference.
        const picked = body.versionId ? await this.pickDrawing(client, workspaceId, order, body.versionId) : null;
        const reference = picked?.reference ?? text(body.reference, 200);
        if (!reference) throw new BadRequestException("Say which drawing was approved (its number or revision).");
        await set(`drawing_ref = $3, drawing_approved_by = $4, drawing_approved_at = now(), drawing_design_id = $5, drawing_version_id = $6, drawing_stale_version_id = NULL`,
          [reference, user.userId, picked?.designId ?? null, picked?.versionId ?? null]);
        audit = { reference, versionId: picked?.versionId ?? null };
      } else if (action === "release") {
        await need("factory.manage", "You can't release work orders.");
        status("planned");
        const missing = (await this.releaseChecks(client, workspaceId, order, settings)).filter((check) => !check.passed);
        if (missing.length) throw new ConflictException(`Before it's released: ${missing.map((check) => check.missing).join("; ")}.`);
        await set(`status = 'released', released_by = $3, released_at = now()`, [user.userId]);
        notices.push({ code: "factory.released", users: [...await this.holders(client, workspaceId, ["factory.report"]), ...await this.team(client, workspaceId, order.projectId, ["factory_lead"], false)],
          note: "", key: `released:${orderId}` });
      } else if (action === "start") {
        await need("factory.manage", "You can't start work orders.");
        status("released");
        await set(`status = 'in_production', started_at = now()`);
        await this.productionStarted(client, workspaceId, order.projectId, user.userId);
        await useForProduction(client, workspaceId, { workOrderId: orderId, actorUserId: user.userId });
      } else if (action === "report") {
        await need("factory.report", "You can't report output.");
        status("in_production");
        const good = amount(body.good ?? "0", "Good");
        const scrap = amount(body.scrap ?? "0", "Scrapped");
        const scrapReason = text(body.scrapReason, 500);
        if (Dec.of(good).add(scrap).cmp(0) <= 0) throw new BadRequestException("Enter what was made or scrapped.");
        if (Dec.of(scrap).cmp(0) > 0 && !scrapReason) throw new BadRequestException("Say why it was scrapped.");
        if (Dec.of(good).cmp(order.left) > 0) throw new ConflictException(`Only ${plain(order.left)} ${order.unit} is still to make.`.replace("  ", " "));
        // The hours it took, costed at the workcenter's hourly rate once approved; the workcenter is kept with the report.
        const hours = body.hours === undefined || body.hours === null || body.hours === "" ? null : hoursWorked(body.hours);
        await client.query(`INSERT INTO factory_commands (workspace_id, command_id, entity_id, action, actor_id) VALUES ($1, $2, $3, 'report', $4)`, [workspaceId, recordId, orderId, user.userId]);
        await client.query(`INSERT INTO work_order_reports (id, workspace_id, work_order_id, good, scrap, scrap_reason, note, reported_by, hours, workcenter_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [recordId, workspaceId, orderId, good, scrap, scrapReason, text(body.note, 1000), user.userId, hours, order.workcenterId]);
        await set(`notes = notes`);
        notices.push({ code: "factory.report_waiting", users: (await this.holders(client, workspaceId, ["factory.approve"])).filter((id) => id !== user.userId),
          note: `${plain(good)} ${order.unit} made${Dec.of(scrap).cmp(0) > 0 ? `, ${plain(scrap)} scrapped` : ""}`.replace("  ", " "), key: `report:${recordId}` });
        audit = { reportId: recordId, good, scrap, scrapReason, hours };
      } else if (action === "decide_report") {
        await need("factory.approve", "You can't approve output.");
        const report = (await client.query<{ id: string; good: string; scrap: string; status: string; reportedBy: string }>(
          `SELECT id, good::text AS good, scrap::text AS scrap, status, reported_by AS "reportedBy" FROM work_order_reports WHERE workspace_id = $1 AND work_order_id = $2 AND id = $3`,
          [workspaceId, orderId, uuid(body.reportId, "Report")])).rows[0];
        if (!report) throw new NotFoundException("Report not found.");
        if (report.status !== "pending") throw new ConflictException("This report is already decided.");
        if (report.reportedBy === user.userId) throw new ForbiddenException("Someone else approves your report.");
        const approve = body.decision === "approve";
        const note = text(body.note, 500);
        if (!approve && !note) throw new BadRequestException("Say why the report is refused.");
        await client.query(`UPDATE work_order_reports SET status = $4, decided_by = $5, decided_at = now(), decision_note = $6 WHERE workspace_id = $1 AND work_order_id = $2 AND id = $3`,
          [workspaceId, orderId, report.id, approve ? "approved" : "refused", user.userId, note]);
        // With no quality check required, approving the output passes it.
        if (approve && !settings.requireCheck && Dec.of(report.good).cmp(0) > 0)
          await this.pass(client, workspaceId, order, randomUUID(), report.good, "0", "", user.userId, notices);
        else await set(`notes = notes`);
        audit = { reportId: report.id, decision: approve ? "approved" : "refused", note };
      } else if (action === "check") {
        await need("factory.approve", "You can't check quality.");
        status("in_production", "ready");
        // Goods out for a step done elsewhere are checked once they're back.
        const away = (await this.operations(client, workspaceId, orderId)).find((operation) => operation.out);
        if (away) throw new ConflictException(`${away.name} isn't back from ${away.supplierName} yet (${away.orderNumber}).`);
        if (!settings.requireCheck) throw new ConflictException("Output passes when it's approved; there's no separate check.");
        const passed = amount(body.passed ?? "0", "Passed");
        const failed = amount(body.failed ?? "0", "Failed");
        const failReason = text(body.failReason, 500);
        const note = text(body.note, 1000);
        if (Dec.of(passed).add(failed).cmp(0) <= 0) throw new BadRequestException("Enter what passed or failed.");
        if (Dec.of(failed).cmp(0) > 0 && !failReason) throw new BadRequestException("Say why it failed.");
        if (Dec.of(passed).add(failed).cmp(order.toCheck) > 0)
          throw new ConflictException(Dec.of(order.toCheck).cmp(0) > 0 ? `Only ${plain(order.toCheck)} ${order.unit} is waiting to be checked.`.replace("  ", " ") : "Nothing is waiting to be checked.");
        await this.pass(client, workspaceId, order, recordId!, passed, failed, failReason, user.userId, notices, note);
        audit = { checkId: recordId, passed, failed, failReason, note };
      } else if (action === "set_ready_date") {
        // The day it was ready, when it was checked later than that (recorded on the day it became ready).
        if (!(await has("factory.manage")) && !(await has("factory.approve"))) throw new ForbiddenException("You can't change the ready date.");
        status("ready");
        const readyOn = optionalDate(body.readyOn, "Ready date");
        if (!readyOn) throw new BadRequestException("Choose the day it was ready.");
        const day = await workspaceDay(client, workspaceId);
        if (readyOn > day.today) throw new BadRequestException("The ready date can't be in the future.");
        const released = (await client.query<{ on: string | null }>(`SELECT (released_at AT TIME ZONE coalesce(nullif((SELECT default_timezone FROM workspaces WHERE id = $1), ''), 'UTC'))::date::text AS on
          FROM work_orders WHERE workspace_id = $1 AND id = $2`, [workspaceId, orderId])).rows[0]?.on;
        if (released && readyOn < released) throw new BadRequestException("The ready date can't be before it was released.");
        const before = (await client.query<{ on: string | null }>(`SELECT ready_on::text AS on FROM work_orders WHERE workspace_id = $1 AND id = $2`, [workspaceId, orderId])).rows[0]?.on ?? null;
        await set(`ready_on = $3`, [readyOn]);
        audit = { from: before, to: readyOn };
      } else if (action === "link_payment") {
        // The client's payment stage due when it's ready (a joinery balance before installation, say), or none.
        await need("factory.manage", "You can't change work orders.");
        status("planned", "released", "in_production", "on_hold", "ready");
        const paymentId = body.paymentId === null || body.paymentId === "" ? null : typeof body.paymentId === "string" && body.paymentId.length <= 200 ? body.paymentId : undefined;
        if (paymentId === undefined) throw new BadRequestException("Choose a payment stage.");
        if (paymentId && !(await readMilestones(client, workspaceId, { projectId: order.projectId, paymentId })).length)
          throw new BadRequestException("Choose a payment stage of this project.");
        await set(`ready_payment_id = $3`, [paymentId]);
        audit = { paymentId };
        // Tied once everything on the stage is already ready: its reminder goes now (still once per stage).
        if (paymentId && order.status === "ready") audit.reminder = (await remindForReady(client, workspaceId, order, user.userId))?.outcome ?? null;
      } else if (action === "hold") {
        await need("factory.manage", "You can't hold work orders.");
        status("planned", "released", "in_production");
        const reason = text(body.reason, 500);
        if (!reason) throw new BadRequestException("Say why it's on hold.");
        await set(`status = 'on_hold', hold_kind = 'manual', hold_reason = $3, held_from = status`, [reason]);
        audit = { reason };
      } else if (action === "resume") {
        status("on_hold");
        if (order.holdKind === "drawing") {
          // Going on after a drawing change is someone else's decision.
          await need("factory.approve", "Someone who approves factory work decides whether it goes on with the new drawing.");
          const reviser = (await client.query<{ by: string | null }>(`SELECT drawing_revised_by AS by FROM work_orders WHERE workspace_id = $1 AND id = $2`, [workspaceId, orderId])).rows[0]?.by;
          if (reviser === user.userId) throw new ForbiddenException("Someone else decides whether it goes on with the drawing you changed.");
        } else await need("factory.manage", "You can't resume work orders.");
        await set(`status = held_from, hold_reason = NULL, held_from = NULL, hold_kind = NULL`);
      } else if (action === "cancel" || action === "short_close") {
        await need("factory.manage", "You can't close work orders.");
        status("planned", "released", "in_production", "on_hold");
        const reason = text(body.reason, 500);
        const anything = Dec.of(order.made).add(order.pending).add(order.scrapped).cmp(0) > 0;
        if (action === "cancel" && anything) throw new ConflictException("Something was already made or reported on it: close it short instead.");
        if (action === "short_close" && !anything) throw new ConflictException("Nothing was made on it yet: cancel it instead.");
        if (action === "short_close" && Dec.of(order.pending).add(order.toCheck).cmp(0) > 0) throw new ConflictException("Decide the reports and check what was made first.");
        if (!reason) throw new BadRequestException(action === "cancel" ? "Say why it's cancelled." : "Say why the rest won't be made.");
        await set(`status = $3, closed_by = $4, closed_at = now(), close_reason = $5, hold_reason = NULL, held_from = NULL, hold_kind = NULL`, [action === "cancel" ? "cancelled" : "short_closed", user.userId, reason]);
        audit = { reason };
      } else if (action === "send_out") {
        // A step done by a supplier: a draft service order for the work order's goods, which the buyer places.
        await need("factory.manage", "You can't send work out.");
        status("released", "in_production");
        const operationId = uuid(body.operationId, "Step");
        const name = text(body.name, 200);
        if (!name) throw new BadRequestException("Say what the supplier does (polishing, upholstery…).");
        const quantity = amount(body.quantity ?? order.quantity, "Quantity");
        if (Dec.of(quantity).cmp(0) <= 0 || Dec.of(quantity).cmp(order.quantity) > 0) throw new BadRequestException(`Send out up to ${plain(order.quantity)} ${order.unit}.`.replace("  ", " "));
        const supplier = await this.orders.orderableSupplier(client, workspaceId, uuid(body.vendorId, "Supplier"));
        if ((await ensurePurchasingSettings(client, workspaceId)).requireApprovedSupplier && supplier.approval !== "approved")
          throw new ConflictException(`${supplier.name} isn't approved as a supplier yet.`);
        const legalEntityId = await this.orders.buyingCompany(client, workspaceId, supplier, body.legalEntityId);
        const currency = supplier.currency ?? (await client.query<{ currency: string }>(`SELECT base_currency AS currency FROM legal_entities WHERE workspace_id = $1 AND id = $2`, [workspaceId, legalEntityId])).rows[0].currency;
        const purchaseId = randomUUID();
        const reference = `WO-${String(order.number).padStart(4, "0")}`;
        const created = await this.orders.createDraft(client, workspaceId, user.userId, {
          id: purchaseId, supplier, legalEntityId, currency, from: { workOrder: reference },
          header: { deliverTo: "factory", deliveryAddress: "", expectedDate: optionalDate(body.expectedDate, "Back by"), notes: "" },
          lines: [{ source: "free", projectId: order.projectId, description: `${name} — ${reference} ${order.title}`.slice(0, 500), quantity, unit: order.unit, unitPrice: body.unitPrice ?? "0", taxRate: body.taxRate }],
        });
        const line = (await client.query<{ id: string }>(`SELECT id FROM purchase_order_lines WHERE workspace_id = $1 AND order_id = $2`, [workspaceId, purchaseId])).rows[0];
        await client.query(`UPDATE purchase_order_lines SET work_order_id = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, line.id, orderId]);
        await client.query(`INSERT INTO work_order_operations (id, workspace_id, work_order_id, name, vendor_id, order_id, order_line_id, quantity, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [operationId, workspaceId, orderId, name, supplier.id, purchaseId, line.id, quantity, user.userId]);
        await set(`notes = notes`);
        audit = { operationId, name, vendorId: supplier.id, orderId: purchaseId, number: created.number, quantity };
      } else if (action === "dispatch") {
        // Made goods from the factory to the project's site: a move the site receives like any other.
        if (!(await has("factory.manage")) && !(await has("stock.manage"))) throw new ForbiddenException("You can't send goods to site.");
        const quantity = amount(body.quantity, "Quantity");
        if (Dec.of(quantity).cmp(0) <= 0) throw new BadRequestException("Enter how much goes.");
        const line = (await client.query<{ catalogItemId: string | null }>(`SELECT catalog_item_id AS "catalogItemId" FROM project_boq_lines WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, order.boqLineId])).rows[0];
        const itemId = await stockItemFor(client, workspaceId, { catalogItemId: line?.catalogItemId ?? null, name: order.title, unit: order.unit });
        const factory = await resolvePlace(client, workspaceId, "factory", [order.projectId], randomUUID);
        const site = await resolvePlace(client, workspaceId, `site:${order.projectId}`, [order.projectId], randomUUID);
        if (!factory || !site) throw new ConflictException("The factory or the project's site isn't set up as a place.");
        const transferId = recordId!;
        await client.query(`INSERT INTO factory_commands (workspace_id, command_id, entity_id, action, actor_id) VALUES ($1, $2, $3, 'dispatch', $4)`, [workspaceId, transferId, orderId, user.userId]);
        await this.inventory.sendWith(client, workspaceId, user.userId, { id: transferId, fromLocationId: factory.id, toLocationId: site.id, note: text(body.note, 500),
          lines: [{ itemId, projectId: order.projectId, quantity }] });
        await client.query(`UPDATE stock_transfers SET work_order_id = $3 WHERE workspace_id = $1 AND id = $2 AND work_order_id IS NULL`, [workspaceId, transferId, orderId]);
        await set(`notes = notes`);
        audit = { transferId, quantity };
      } else if (MATERIAL_ACTIONS.includes(action)) {
        audit = await this.materialCommand(client, workspaceId, order, action, body, recordId, user.userId, notices, need);
      } else {
        throw new BadRequestException("Unknown action.");
      }
      await this.event(client, workspaceId, orderId, action, audit, user.userId);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `work_order.${action}`, entityType: "work_order", entityId: orderId, after: audit });
      for (const notice of notices) await this.tell(client, workspaceId, order, notice, user.userId);
      return this.detail(client, workspaceId, orderId, user.userId);
    });
  }

  settings(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, [...VIEW, "workspace.settings.manage"], async (client, user) => this.settingsView(client, workspaceId, user.userId));
  }

  saveSettings(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "workspace.settings.manage", async (client, user) => {
      const current = await ensureFactorySettings(client, workspaceId);
      if (body.version !== current.version) throw new ConflictException("Someone else changed these settings. Reload to see their changes.");
      const flag = (key: "requireDrawing" | "requirePayment" | "requireMaterials" | "requireCheck") => (body[key] === undefined ? current[key] : body[key] === true);
      // PLM-063: the production steps the firm keeps, in its own words, and its internal production target.
      const steps = body.productionSteps === undefined ? normaliseProductionSteps(current.productionSteps) : parseProductionSteps(body.productionSteps);
      const weeks = body.productionWeeks === undefined ? current.productionWeeks : parseProductionWeeks(body.productionWeeks);
      // PLM-067: how many days before the latest planned ready date the client is reminded to pay that stage.
      const reminderDays = body.balanceReminderDays === undefined ? current.balanceReminderDays : Number(body.balanceReminderDays);
      if (!Number.isInteger(reminderDays) || reminderDays < 0 || reminderDays > 90) throw new BadRequestException("Set the reminder from 0 to 90 days before the ready date.");
      await client.query(`UPDATE workspace_factory_settings SET require_drawing = $2, require_payment = $3, require_materials = $4, require_check = $5, production_steps = $7::jsonb,
        production_weeks = $8, balance_reminder_days = $9, version = version + 1, updated_by = $6, updated_at = now() WHERE workspace_id = $1`,
        [workspaceId, flag("requireDrawing"), flag("requirePayment"), flag("requireMaterials"), flag("requireCheck"), user.userId, JSON.stringify(steps), weeks, reminderDays]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "factory.settings_changed", entityType: "workspace", entityId: workspaceId, before: current, after: body });
      return this.settingsView(client, workspaceId, user.userId);
    });
  }

  /** Adds or renames a workcenter, sets its hourly rate from a date, or stops using it (a workcenter with open work orders stays). */
  saveWorkcenter(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "workspace.settings.manage", async (client, user) => {
      const id = uuid(body.id, "Workcenter");
      const name = text(body.name, 120);
      if (!name) throw new BadRequestException("Name the workcenter.");
      const hours = body.hoursPerDay === null || body.hoursPerDay === undefined || body.hoursPerDay === "" ? null : amount(body.hoursPerDay, "Hours a day");
      if (hours !== null && (Dec.of(hours).cmp(0) <= 0 || Dec.of(hours).cmp(24) > 0)) throw new BadRequestException("Hours a day is from 0 to 24.");
      const rate = body.hourlyRate === null || body.hourlyRate === undefined || body.hourlyRate === "" ? null : amount(body.hourlyRate, "Hourly rate");
      const active = body.active !== false;
      if (!active && (await client.query(`SELECT 1 FROM work_orders WHERE workspace_id = $1 AND workcenter_id = $2 AND status IN ('planned', 'released', 'in_production', 'on_hold') LIMIT 1`,
        [workspaceId, id])).rowCount) throw new ConflictException("Open work orders use this workcenter. Move them first.");
      try {
        await client.query(
          `INSERT INTO workcenters (id, workspace_id, name, hours_per_day, active, position) VALUES ($1, $2, $3, $4, $5, (SELECT count(*) FROM workcenters WHERE workspace_id = $2))
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, hours_per_day = EXCLUDED.hours_per_day, active = EXCLUDED.active WHERE workcenters.workspace_id = $2`,
          [id, workspaceId, name, hours, active]);
      } catch (error) {
        if ((error as { constraint?: string }).constraint === "workcenters_name_key") throw new ConflictException(`There's already a workcenter called ${name}.`);
        throw error;
      }
      const priced = rate === null ? null
        : await setWorkcenterRate(client, workspaceId, id, { rate, from: optionalDate(body.rateFrom, "Rate from"), version: body.rateVersion }, user.userId);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "factory.workcenter_saved", entityType: "workcenter", entityId: id, after: { name, hours, active, rate: priced } });
      return this.settingsView(client, workspaceId, user.userId);
    });
  }

  /** Adds the photo of a quality check (one per check). The same photo id twice changes nothing. */
  async uploadCheckPhoto(actor: RequestActor, workspaceId: string, orderId: string, checkId: string, photoId: string, file?: ReferenceUpload) {
    const prepared = await prepareReferenceUpload(file);
    if (!prepared.mimeType.startsWith("image/")) throw new BadRequestException("Choose a photo (JPG, PNG, WebP or HEIC).");
    const storage = this.storage;
    if (!storage) throw new ConflictException("Photos can't be stored here yet.");
    return this.access.withPermission(actor, workspaceId, "factory.approve", async (client, user) => {
      const id = uuid(photoId, "Photo");
      const check = (await client.query<{ id: string }>(`SELECT id FROM work_order_checks WHERE workspace_id = $1 AND work_order_id = $2 AND id = $3 FOR UPDATE`,
        [workspaceId, uuid(orderId, "Work order"), uuid(checkId, "Check")])).rows[0];
      if (!check) throw new NotFoundException("Check not found.");
      const existing = (await client.query<{ id: string; sha256: string }>(`SELECT id, sha256 FROM work_order_check_photos WHERE workspace_id = $1 AND check_id = $2`, [workspaceId, checkId])).rows[0];
      if (existing && (existing.id !== id || existing.sha256 !== prepared.digest)) throw new ConflictException("This check already has its photo.");
      if (!existing) {
        const key = `factory/checks/${workspaceId}/${id}`;
        await storage.put(`${key}/original`, prepared.body, prepared.mimeType);
        if (prepared.preview) await storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
        await client.query(
          `INSERT INTO work_order_check_photos (id, workspace_id, check_id, work_order_id, original_name, mime_type, byte_size, object_key, preview_key, sha256, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [id, workspaceId, checkId, orderId, prepared.name, prepared.mimeType, prepared.body.length, `${key}/original`, prepared.preview ? `${key}/preview.webp` : null, prepared.digest, user.userId]);
        await this.event(client, workspaceId, orderId, "check_photo", { checkId, photoId: id }, user.userId);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "work_order.check_photo_added", entityType: "work_order", entityId: orderId, after: { checkId, photoId: id } });
      }
      return this.detail(client, workspaceId, orderId, user.userId);
    });
  }

  /** A quality check's photo (or its preview) for someone who can see the factory. */
  checkPhoto(actor: RequestActor, workspaceId: string, photoId: string, preview: boolean) {
    return this.access.withAnyPermission(actor, workspaceId, VIEW, async (client) => {
      const row = (await client.query<{ objectKey: string; previewKey: string | null; mimeType: string }>(
        `SELECT object_key AS "objectKey", preview_key AS "previewKey", mime_type AS "mimeType" FROM work_order_check_photos WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, uuid(photoId, "Photo")])).rows[0];
      if (!row || !this.storage) throw new NotFoundException("Photo not found.");
      const key = preview && row.previewKey ? row.previewKey : row.objectKey;
      const stored = await this.storage.read(key).catch(() => null);
      if (!stored) throw new NotFoundException("Photo not found.");
      return { body: stored.body, contentType: key === row.previewKey ? "image/webp" : row.mimeType };
    });
  }

  /**
   * PLM-063: the production schedule, project by project: its status read from its work orders, and its planned
   * dates against the actual ones.
   */
  production(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, VIEW, async (client) => readProduction(client, workspaceId));
  }

  // ---------- helpers ----------
  /**
   * PLM-055: the first work order of a project starting is its production starting; the people kept informed (the
   * designer) hear it once. Work orders started in the same command count as one start.
   */
  private async productionStarted(client: Db, workspaceId: string, projectId: string, userId: string) {
    const earlier = (await client.query(`SELECT 1 FROM work_orders WHERE workspace_id = $1 AND project_id = $2 AND started_at < now() LIMIT 1`, [workspaceId, projectId])).rowCount;
    if (earlier) return;
    await tellKeepInformed(client, { workspaceId, projectId, event: "production_started", key: "first", actorUserId: userId, date: (await workspaceDay(client, workspaceId)).today });
  }

  /** Settings → Factory; the hourly rates only for people who set them or see costs. */
  private async settingsView(client: Db, workspaceId: string, userId: string) {
    const canManage = await this.access.hasPermission(client, workspaceId, userId, "workspace.settings.manage");
    const canSeeRates = canManage || await this.access.hasPermission(client, workspaceId, userId, "commercial.costs.view");
    const workspace = await workspaceDay(client, workspaceId);
    const settings = await ensureFactorySettings(client, workspaceId);
    return {
      settings: { ...settings, productionSteps: normaliseProductionSteps(settings.productionSteps) }, workcenters: await readWorkcenters(client, workspaceId, true), canManage, canSeeRates,
      rates: canSeeRates ? (await readWorkcenterRates(client, workspaceId)).map(({ key, ...rate }) => ({ ...rate, workcenterId: key })) : [],
      currency: workspace.currency, today: workspace.today,
    };
  }

  /** What has to hold before a work order is released, each with what's missing when it doesn't. */
  private async releaseChecks(client: Db, workspaceId: string, order: WorkOrderRow, settings: Awaited<ReturnType<typeof ensureFactorySettings>>,
    needs: Map<string, Awaited<ReturnType<typeof readNeeds>>> = new Map()) {
    const projectNeeds = async () => {
      if (!needs.has(order.projectId)) needs.set(order.projectId, await readNeeds(client, workspaceId, false, order.projectId));
      return needs.get(order.projectId)!;
    };
    const project = (await client.query<{ status: string; caseId: string; quoteId: string }>(
      `SELECT status, case_id AS "caseId", quote_id AS "quoteId" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, order.projectId])).rows[0];
    const drawing = (await client.query<{ at: string | null }>(`SELECT drawing_approved_at AS at FROM work_orders WHERE workspace_id = $1 AND id = $2`, [workspaceId, order.id])).rows[0];
    const checks: Array<{ key: string; passed: boolean; missing: string; detail?: string[] }> = [
      { key: "running", passed: project?.status === "active", missing: project?.status === "on_hold" ? "the project is on hold" : "the project isn't running" },
      { key: "scope", passed: order.lineStatus === "active" && Dec.of(order.scopeOver).cmp(0) <= 0,
        missing: order.lineStatus === "omitted" ? "a variation removed its scope line" : `a variation reduced its scope line by ${plain(order.scopeOver)} ${order.unit}`.replace("  ", " ") },
    ];
    // PLM-059: on a route that asks for the client's drawing approval, production waits for it (a skipped stage doesn't ask).
    const clientDrawings = await drawingsGate(client, workspaceId, order.projectId);
    if (clientDrawings.required) checks.push({ key: "client_drawings", passed: clientDrawings.approved, missing: "the client hasn't approved the technical drawings" });
    if (settings.requireDrawing) checks.push({ key: "drawing", passed: Boolean(drawing?.at) && !order.drawingNewer,
      missing: drawing?.at && order.drawingNewer ? `the drawing has a newer revision (R${order.drawingNewer})` : "the drawing isn't approved" });
    if (settings.requirePayment) checks.push({ key: "payment", passed: project ? await productionPaid(client, workspaceId, project.caseId, project.quoteId) : false, missing: "the payment before production isn't verified" });
    if (settings.requireMaterials) {
      // Its own materials when it lists them (issued, or covered by the project's stock); otherwise its package's.
      const materials = (await readWorkOrderMaterials(client, workspaceId, order.id)).filter((row) => row.status === "active");
      const short = materials.length ? (await materialsShort(client, workspaceId, order.id, materials)).map((row) => `${row.itemName} ${plain(row.short)} ${row.unit}`.trim())
        : needsNotIn(await projectNeeds(), order.packageId).map((need) => need.title);
      checks.push({ key: "materials", passed: !short.length, missing: `materials aren't in: ${short.slice(0, 5).join(", ")}${short.length > 5 ? ` and ${short.length - 5} more` : ""}`, detail: short });
    }
    checks.push({ key: "schedule", passed: Boolean(order.workcenterId && order.plannedStart && order.plannedEnd), missing: "it has no workcenter or dates" });
    return checks;
  }

  /**
   * Records a quality check: what passed goes into stock at the factory, owned by the project; what failed
   * is made again. When everything has passed the work order is ready.
   */
  private async pass(client: Db, workspaceId: string, order: WorkOrderRow, checkId: string, passed: string, failed: string, failReason: string, userId: string, notices: Notice[],
    note = "") {
    await client.query(`INSERT INTO factory_commands (workspace_id, command_id, entity_id, action, actor_id) VALUES ($1, $2, $3, 'check', $4)`, [workspaceId, checkId, order.id, userId]);
    await client.query(`INSERT INTO work_order_checks (id, workspace_id, work_order_id, passed, failed, fail_reason, checked_by, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [checkId, workspaceId, order.id, passed, failed, failReason, userId, note]);
    if (Dec.of(passed).cmp(0) > 0) {
      const line = (await client.query<{ catalogItemId: string | null }>(`SELECT catalog_item_id AS "catalogItemId" FROM project_boq_lines WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, order.boqLineId])).rows[0];
      const factory = await resolvePlace(client, workspaceId, "factory", [order.projectId], randomUUID);
      const itemId = await stockItemFor(client, workspaceId, { catalogItemId: line?.catalogItemId ?? null, name: order.title, unit: order.unit });
      const today = (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
      await move(client, workspaceId, { batchId: checkId, itemId, locationId: factory!.id, projectId: order.projectId, kind: "produce", quantity: passed, forProjectId: order.projectId,
        workOrderId: order.id, movedOn: today, actorId: userId });
    }
    if (Dec.of(failed).cmp(0) > 0)
      notices.push({ code: "factory.check_failed", users: await this.team(client, workspaceId, order.projectId, ["factory_lead"], true), note: `${plain(failed)} ${order.unit} failed: ${failReason}`.replace("  ", " "), key: `failed:${checkId}` });
    const total = Dec.of(order.passed).add(passed);
    if (total.cmp(order.quantity) >= 0) {
      // Ready: the order-ready date is the workspace's day (corrected later when it was ready earlier).
      const readyOn = (await workspaceDay(client, workspaceId)).today;
      await client.query(`UPDATE work_orders SET status = 'ready', ready_at = now(), ready_on = $3, hold_reason = NULL, held_from = NULL, hold_kind = NULL, version = version + 1, updated_at = now()
        WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, order.id, readyOn]);
      notices.push({ code: "factory.ready", users: await this.team(client, workspaceId, order.projectId, ["installation_lead"], true), note: "", key: `ready:${order.id}` });
      await orderReady(client, workspaceId, order, { checkId, readyOn, actorId: userId });
    } else {
      await client.query(`UPDATE work_orders SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, order.id]);
    }
  }

  /**
   * The materials a work order uses: added (from the project's list or by name and unit), suggested from
   * the materials used only on its line (their share for its quantity), changed while nothing more than
   * the new quantity is issued, issued from the project's own or free stock at a place and returned, or
   * swapped for another item with why — which someone else approves.
   */
  private async materialCommand(client: Db, workspaceId: string, order: WorkOrderRow, action: string, body: Record<string, unknown>, commandId: string | null, userId: string,
    notices: Notice[], need: (code: string, message: string) => Promise<void>) {
    if (!["planned", "released", "in_production", "on_hold"].includes(order.status)) throw new ConflictException(statusMessage(order.status));
    const materials = await readWorkOrderMaterials(client, workspaceId, order.id);
    const find = (value: unknown, statuses = ["active"]) => {
      const row = materials.find((item) => item.id === value);
      if (!row) throw new NotFoundException("Material not found.");
      if (!statuses.includes(row.status)) throw new ConflictException(`${row.itemName} isn't used on this work order any more.`);
      return row;
    };
    const itemFor = async () => {
      if (body.materialItemId) {
        const listed = (await client.query<{ name: string; unit: string; catalogItemId: string | null }>(
          `SELECT name, unit, catalog_item_id AS "catalogItemId" FROM project_material_items WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
          [workspaceId, order.projectId, uuid(body.materialItemId, "Material")])).rows[0];
        if (!listed) throw new BadRequestException("Choose a material from the project's list.");
        return { itemId: await stockItemFor(client, workspaceId, { catalogItemId: listed.catalogItemId, name: listed.name, unit: listed.unit }), materialItemId: String(body.materialItemId) };
      }
      const name = text(body.name, 300);
      if (!name) throw new BadRequestException("Name the material.");
      return { itemId: await stockItemFor(client, workspaceId, { catalogItemId: null, name, unit: text(body.unit, 40) }), materialItemId: null };
    };
    const insert = async (id: string, item: { itemId: string; materialItemId: string | null }, quantity: string, extra: { status?: string; replacesId?: string; reason?: string } = {}) => {
      if (materials.some((row) => row.id === id)) return;
      await client.query(
        `INSERT INTO work_order_materials (id, workspace_id, work_order_id, position, item_id, material_item_id, quantity, status, replaces_id, reason, requested_by)
         VALUES ($1, $2, $3, (SELECT count(*) FROM work_order_materials WHERE workspace_id = $2 AND work_order_id = $3), $4, $5, $6, $7, $8, $9, $10)`,
        [id, workspaceId, order.id, item.itemId, item.materialItemId, quantity, extra.status ?? "active", extra.replacesId ?? null, extra.reason ?? "", userId]);
    };
    const bump = () => client.query(`UPDATE work_orders SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, order.id]);

    if (action === "add_material") {
      await need("factory.manage", "You can't change a work order's materials.");
      const quantity = amount(body.quantity, "Quantity");
      if (Dec.of(quantity).cmp(0) <= 0) throw new BadRequestException("Enter how much it uses.");
      const item = await itemFor();
      if (materials.some((row) => row.itemId === item.itemId && row.status === "active")) throw new ConflictException("It's already on this work order: change its quantity instead.");
      await insert(uuid(body.materialId, "Material"), item, quantity);
      await bump();
      return { itemId: item.itemId, quantity };
    }
    if (action === "suggest_materials") {
      await need("factory.manage", "You can't change a work order's materials.");
      // Materials used only on this line, at this work order's share of the line.
      const listed = (await client.query<{ id: string; name: string; unit: string; catalogItemId: string | null; quantity: string | null; lineQuantity: string }>(
        `SELECT item.id, item.name, item.unit, item.catalog_item_id AS "catalogItemId", item.quantity::text AS quantity, line.quantity::text AS "lineQuantity"
           FROM project_material_items item JOIN project_boq_lines line ON line.workspace_id = item.workspace_id AND line.id = $3
          WHERE item.workspace_id = $1 AND item.project_id = $2 AND item.boq_line_ids = ARRAY[$3::uuid] AND item.quantity IS NOT NULL ORDER BY item.position`,
        [workspaceId, order.projectId, order.boqLineId])).rows;
      let added = 0;
      for (const row of listed) {
        if (materials.some((material) => material.materialItemId === row.id && ["active", "pending"].includes(material.status))) continue;
        const share = Dec.of(row.quantity!).mul(order.quantity).div(row.lineQuantity).ceil(4);
        if (share.cmp(0) <= 0) continue;
        await insert(randomUUID(), { itemId: await stockItemFor(client, workspaceId, { catalogItemId: row.catalogItemId, name: row.name, unit: row.unit }), materialItemId: row.id }, share.toFixed(4));
        added++;
      }
      if (!added) throw new ConflictException("No materials from the project's list are used only on this line.");
      await bump();
      return { added };
    }
    if (action === "set_material") {
      await need("factory.manage", "You can't change a work order's materials.");
      const row = find(body.materialId);
      const quantity = amount(body.quantity, "Quantity");
      if (Dec.of(quantity).cmp(0) <= 0) throw new BadRequestException("Enter how much it uses, or remove it.");
      if (Dec.of(quantity).cmp(row.issued) < 0) throw new ConflictException(`${plain(row.issued)} ${row.unit} of ${row.itemName} is already issued: return some first.`.replace("  ", " "));
      await client.query(`UPDATE work_order_materials SET quantity = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, row.id, quantity]);
      await bump();
      return { materialId: row.id, from: row.quantity, to: quantity };
    }
    if (action === "remove_material") {
      await need("factory.manage", "You can't change a work order's materials.");
      const row = find(body.materialId);
      if (Dec.of(row.issued).cmp(0) > 0) throw new ConflictException(`Some ${row.itemName} is issued to it: return it first.`);
      await client.query(`UPDATE work_order_materials SET status = 'removed' WHERE workspace_id = $1 AND id = $2`, [workspaceId, row.id]);
      await bump();
      return { materialId: row.id };
    }
    if (action === "issue_material" || action === "return_material") {
      if (!(await this.access.hasPermission(client, workspaceId, userId, "factory.manage")) && !(await this.access.hasPermission(client, workspaceId, userId, "stock.manage")))
        throw new ForbiddenException("You can't issue stock.");
      const row = find(body.materialId, action === "issue_material" ? ["active"] : ["active", "replaced", "removed"]);
      const quantity = amount(body.quantity, "Quantity");
      if (Dec.of(quantity).cmp(0) <= 0) throw new BadRequestException("Enter how much.");
      const place = (await readLocations(client, workspaceId)).find((location) => location.id === body.locationId);
      if (!place) throw new BadRequestException("Choose a place where stock is kept.");
      if (place.kind === "site" && place.projectId !== order.projectId) throw new BadRequestException("That's another project's site.");
      const reason = text(body.reason, 500);
      const today = (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
      await client.query(`INSERT INTO factory_commands (workspace_id, command_id, entity_id, action, actor_id) VALUES ($1, $2, $3, $4, $5)`, [workspaceId, commandId, order.id, action, userId]);
      if (action === "issue_material") {
        const left = Dec.of(row.quantity).sub(row.issued);
        // More than it needs only with why (a breakage, an offcut too small).
        if (Dec.of(quantity).cmp(left) > 0 && !reason) throw new BadRequestException(`It needs ${plain(left.cmp(0) > 0 ? left.toString() : "0")} ${row.unit} more: say why you're issuing more.`.replace("  ", " "));
        const owner = body.from === "free" ? null : order.projectId;
        await move(client, workspaceId, { batchId: commandId!, itemId: row.itemId, locationId: place.id, projectId: owner, kind: "issue", quantity: Dec.of(quantity).neg().toString(),
          forProjectId: order.projectId, workOrderId: order.id, workOrderMaterialId: row.id, reason, movedOn: today, actorId: userId });
      } else {
        if (!reason) throw new BadRequestException("Say why it's coming back.");
        if (Dec.of(quantity).cmp(row.issued) > 0) throw new ConflictException(Dec.of(row.issued).cmp(0) > 0 ? `Only ${plain(row.issued)} ${row.unit} was issued.`.replace("  ", " ") : "None of it was issued.");
        // It comes back to the project's stock at the cost it was issued at.
        const cost = (await client.query<{ unitCost: string | null; currency: string | null }>(
          `SELECT unit_cost::text AS "unitCost", currency FROM stock_movements WHERE workspace_id = $1 AND work_order_material_id = $2 AND kind = 'issue' AND unit_cost IS NOT NULL
            ORDER BY seq DESC LIMIT 1`, [workspaceId, row.id])).rows[0];
        await move(client, workspaceId, { batchId: commandId!, itemId: row.itemId, locationId: place.id, projectId: order.projectId, kind: "return", quantity, forProjectId: order.projectId,
          workOrderId: order.id, workOrderMaterialId: row.id, reason, movedOn: today, actorId: userId, unitCost: cost?.unitCost, currency: cost?.currency });
      }
      await bump();
      return { materialId: row.id, quantity, locationId: place.id, from: body.from === "free" ? "free" : "project", reason };
    }
    if (action === "substitute") {
      await need("factory.manage", "You can't change a work order's materials.");
      const row = find(body.replacesId);
      if (materials.some((material) => material.replacesId === row.id && material.status === "pending")) throw new ConflictException(`A swap for ${row.itemName} is already waiting for a decision.`);
      const reason = text(body.reason, 500);
      if (!reason) throw new BadRequestException("Say why it's swapped.");
      const quantity = amount(body.quantity, "Quantity");
      if (Dec.of(quantity).cmp(0) <= 0) throw new BadRequestException("Enter how much it uses.");
      const item = await itemFor();
      if (item.itemId === row.itemId) throw new BadRequestException("Choose a different material.");
      const id = uuid(body.materialId, "Material");
      await insert(id, item, quantity, { status: "pending", replacesId: row.id, reason });
      await bump();
      notices.push({ code: "factory.substitution", users: (await this.holders(client, workspaceId, ["factory.approve"])).filter((person) => person !== userId),
        note: `${row.itemName} → ${(await client.query<{ name: string }>(`SELECT name FROM stock_items WHERE workspace_id = $1 AND id = $2`, [workspaceId, item.itemId])).rows[0].name}: ${reason}`,
        key: `swap:${id}` });
      return { materialId: id, replacesId: row.id, quantity, reason };
    }
    // decide_substitution
    await need("factory.approve", "You can't decide material swaps.");
    const swap = find(body.materialId, ["pending"]);
    if (swap.requestedBy === userId) throw new ForbiddenException("Someone else decides your swap.");
    const approve = body.decision === "approve";
    const note = text(body.note, 500);
    if (!approve && !note) throw new BadRequestException("Say why the swap is refused.");
    const replaced = materials.find((row) => row.id === swap.replacesId);
    if (approve && replaced?.status !== "active") throw new ConflictException("The material it replaces isn't used any more.");
    await client.query(`UPDATE work_order_materials SET status = $3, decided_by = $4, decided_at = now(), decision_note = $5 WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, swap.id, approve ? "active" : "refused", userId, note]);
    if (approve) await client.query(`UPDATE work_order_materials SET status = 'replaced' WHERE workspace_id = $1 AND id = $2`, [workspaceId, swap.replacesId]);
    await bump();
    return { materialId: swap.id, decision: approve ? "approved" : "refused", note };
  }

  /** Where and when from a request, keeping what it doesn't change. */
  /** A design revision of the work order's project, approved (by the client, or internally for technical drawings), as its drawing. */
  private async pickDrawing(client: Db, workspaceId: string, order: WorkOrderRow, value: unknown) {
    const row = (await client.query<{ versionId: string; designId: string; title: string; number: number; status: string }>(
      `SELECT version.id AS "versionId", design.id AS "designId", design.title, version.number, version.status
         FROM pre_project_design_versions version
         JOIN pre_project_designs design ON design.workspace_id = version.workspace_id AND design.id = version.design_id AND design.archived_at IS NULL
         JOIN delivery_projects project ON project.workspace_id = design.workspace_id AND project.case_id = design.case_id AND project.id = $3
        WHERE version.workspace_id = $1 AND version.id = $2`, [workspaceId, uuid(value, "Drawing"), order.projectId])).rows[0];
    if (!row) throw new BadRequestException("Choose a design of this work order's project.");
    if (!["approved", "internal_approved"].includes(row.status)) throw new ConflictException(`${row.title} R${row.number} isn't approved.`);
    return { ...row, reference: `${row.title} R${row.number}`.slice(0, 200) };
  }

  /** The project's designs with an approved revision: the latest approved revision of each. */
  private async approvedDesigns(client: Db, workspaceId: string, projectId: string) {
    return (await client.query<{ designId: string; versionId: string; title: string; number: number; documentType: string }>(
      `SELECT DISTINCT ON (design.id) design.id AS "designId", version.id AS "versionId", design.title, version.number, design.document_type AS "documentType"
         FROM pre_project_designs design
         JOIN pre_project_design_versions version ON version.workspace_id = design.workspace_id AND version.design_id = design.id AND version.status IN ('approved', 'internal_approved')
         JOIN delivery_projects project ON project.workspace_id = design.workspace_id AND project.case_id = design.case_id AND project.id = $2
        WHERE design.workspace_id = $1 AND design.archived_at IS NULL
        ORDER BY design.id, version.number DESC`, [workspaceId, projectId])).rows.sort((a, b) => a.title.localeCompare(b.title));
  }

  private async dates(client: Db, workspaceId: string, body: Record<string, unknown>,
    current: { workcenterId: string | null; plannedStart: string | null; plannedEnd: string | null; plannedHours: string | null }) {
    const workcenterId = body.workcenterId === undefined ? current.workcenterId : body.workcenterId === null || body.workcenterId === "" ? null : uuid(body.workcenterId, "Workcenter");
    if (workcenterId && body.workcenterId !== undefined && !(await readWorkcenters(client, workspaceId)).some((center) => center.id === workcenterId))
      throw new BadRequestException("Choose a workcenter in use.");
    const plannedStart = body.plannedStart === undefined ? current.plannedStart : optionalDate(body.plannedStart, "Start");
    const plannedEnd = body.plannedEnd === undefined ? current.plannedEnd : optionalDate(body.plannedEnd, "Finish");
    if (plannedStart && plannedEnd && plannedEnd < plannedStart) throw new BadRequestException("The finish can't be before the start.");
    const plannedHours = body.plannedHours === undefined ? current.plannedHours : body.plannedHours === null || body.plannedHours === "" ? null : amount(body.plannedHours, "Hours");
    if (plannedHours !== null && Dec.of(plannedHours).cmp(0) <= 0) throw new BadRequestException("Hours must be more than nothing, or left empty.");
    return { workcenterId, plannedStart, plannedEnd, plannedHours };
  }

  private async detail(client: Db, workspaceId: string, orderId: string, userId: string) {
    const order = (await readWorkOrders(client, workspaceId, { id: orderId }))[0];
    if (!order) throw new NotFoundException("Work order not found.");
    const settings = await ensureFactorySettings(client, workspaceId);
    const extra = (await client.query<{ drawingRef: string; drawingApprovedAt: string | null; drawingApprovedByName: string | null; holdReason: string | null; closeReason: string | null;
      closedAt: string | null; releasedAt: string | null; readyAt: string | null; readyOn: string | null; readyPaymentId: string | null }>(
      `SELECT wo.drawing_ref AS "drawingRef", wo.drawing_approved_at AS "drawingApprovedAt", approver.display_name AS "drawingApprovedByName", wo.hold_reason AS "holdReason",
              wo.close_reason AS "closeReason", wo.closed_at AS "closedAt", wo.released_at AS "releasedAt", wo.ready_at AS "readyAt", wo.ready_on::text AS "readyOn",
              wo.ready_payment_id AS "readyPaymentId"
         FROM work_orders wo LEFT JOIN users approver ON approver.id = wo.drawing_approved_by WHERE wo.workspace_id = $1 AND wo.id = $2`, [workspaceId, orderId])).rows[0];
    const reports = (await client.query<{ id: string; good: string; scrap: string; scrapReason: string; note: string; hours: string | null; status: string; reportedBy: string;
      reportedByName: string; reportedAt: string; decidedByName: string | null; decisionNote: string }>(
      `SELECT report.id, report.good::text AS good, report.scrap::text AS scrap, report.scrap_reason AS "scrapReason", report.note, report.hours::text AS hours, report.status,
              report.reported_by AS "reportedBy", reporter.display_name AS "reportedByName", report.reported_at AS "reportedAt", decider.display_name AS "decidedByName",
              report.decision_note AS "decisionNote"
         FROM work_order_reports report JOIN users reporter ON reporter.id = report.reported_by LEFT JOIN users decider ON decider.id = report.decided_by
        WHERE report.workspace_id = $1 AND report.work_order_id = $2 ORDER BY report.reported_at`, [workspaceId, orderId])).rows;
    const checks = (await client.query<{ id: string; passed: string; failed: string; failReason: string; note: string; checkedByName: string; checkedAt: string; photoId: string | null }>(
      `SELECT checked.id, checked.passed::text AS passed, checked.failed::text AS failed, checked.fail_reason AS "failReason", checked.note, person.display_name AS "checkedByName",
              checked.checked_at AS "checkedAt", photo.id AS "photoId"
         FROM work_order_checks checked JOIN users person ON person.id = checked.checked_by
         LEFT JOIN work_order_check_photos photo ON photo.workspace_id = checked.workspace_id AND photo.check_id = checked.id
        WHERE checked.workspace_id = $1 AND checked.work_order_id = $2 ORDER BY checked.checked_at`,
      [workspaceId, orderId])).rows;
    // The client's payment stages it can be tied to (title and whether it's still owed), and the reminder its ready date triggered.
    const caseId = (await client.query<{ caseId: string }>(`SELECT case_id AS "caseId" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, order.projectId])).rows[0].caseId;
    const statuses = new Map((await client.query<{ id: string; status: string }>(`SELECT id, status FROM commercial_payments WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows
      .map((row) => [row.id, row.status]));
    const payments = (await readMilestones(client, workspaceId, { projectId: order.projectId }))
      .map((milestone) => ({ id: milestone.paymentId, title: milestone.title, status: statuses.get(milestone.paymentId) ?? "pending" }));
    const events = (await client.query<{ id: string; kind: string; detail: Record<string, unknown>; byName: string; at: string }>(
      `SELECT event.id, event.kind, event.detail, person.display_name AS "byName", event.at FROM work_order_events event JOIN users person ON person.id = event.actor_id
        WHERE event.workspace_id = $1 AND event.work_order_id = $2 ORDER BY event.at`, [workspaceId, orderId])).rows;
    const materials = await readWorkOrderMaterials(client, workspaceId, orderId);
    const projectMaterials = (await client.query<{ id: string; name: string; unit: string; lineOnly: boolean }>(
      `SELECT item.id, item.name, item.unit, item.boq_line_ids = ARRAY[$3::uuid] AS "lineOnly" FROM project_material_items item
        WHERE item.workspace_id = $1 AND item.project_id = $2 ORDER BY item.position`, [workspaceId, order.projectId, order.boqLineId])).rows;
    // Trips to site, and what was refused there (with the trip that brings it back).
    const dispatches = (await client.query<{ id: string; number: number; status: string; sentOn: string; quantity: string; received: string | null; short: boolean; rejected: string;
      rejectReason: string; returnId: string | null; returnNumber: number | null; returnStatus: string | null }>(
      `SELECT transfer.id, transfer.number, transfer.status, transfer.sent_on::text AS "sentOn", sum(line.quantity)::text AS quantity,
              CASE WHEN bool_and(line.received IS NOT NULL) THEN sum(line.received)::text END AS received, bool_or(line.received < line.quantity) AS short,
              sum(line.rejected)::text AS rejected, string_agg(nullif(line.reject_reason, ''), '; ') AS "rejectReason",
              back.id AS "returnId", back.number AS "returnNumber", back.status AS "returnStatus"
         FROM stock_transfers transfer JOIN stock_transfer_lines line ON line.workspace_id = transfer.workspace_id AND line.transfer_id = transfer.id
         LEFT JOIN stock_transfers back ON back.workspace_id = transfer.workspace_id AND back.returned_from_id = transfer.id
        WHERE transfer.workspace_id = $1 AND transfer.work_order_id = $2 AND transfer.returned_from_id IS NULL
        GROUP BY transfer.id, back.id ORDER BY transfer.number`, [workspaceId, orderId])).rows.map((row) => ({ ...row, rejectReason: row.rejectReason ?? "" }));
    const reworks = (await client.query<{ id: string; quantity: string; reason: string; source: string; at: string; byName: string }>(
      `SELECT rework.id, rework.quantity::text AS quantity, rework.reason, rework.source, rework.created_at AS at, person.display_name AS "byName"
         FROM work_order_reworks rework JOIN users person ON person.id = rework.created_by WHERE rework.workspace_id = $1 AND rework.work_order_id = $2 ORDER BY rework.created_at`,
      [workspaceId, orderId])).rows;
    // What it made that's still at the factory, for the project: what can go to site.
    const atFactory = (await client.query<{ onHand: string }>(
      `SELECT coalesce(sum(balance.on_hand), 0)::numeric(18, 4)::text AS "onHand" FROM stock_balances balance
         JOIN stock_locations place ON place.workspace_id = balance.workspace_id AND place.id = balance.location_id AND place.kind = 'factory'
        WHERE balance.workspace_id = $1 AND balance.project_id = $3
          AND balance.item_id IN (SELECT made.item_id FROM stock_movements made WHERE made.workspace_id = $1 AND made.work_order_id = $2 AND made.kind = 'produce')`,
      [workspaceId, orderId, order.projectId])).rows[0].onHand;
    const releaseChecks = order.status === "planned" ? await this.releaseChecks(client, workspaceId, order, settings) : [];
    const rights = await this.rights(client, workspaceId, userId);
    const next = workOrderNext(order, { blocked: releaseChecks.some((check) => !check.passed), atFactory, requireCheck: settings.requireCheck, canManage: rights.canManage,
      canReport: rights.canReport, canApprove: rights.canApprove, canSend: rights.canManage || rights.canIssue });
    return {
      order: { ...order, ...extra }, reports, checks, events, settings, materials, dispatches, atFactory, reworks, next: next.step,
      payments, readyReminder: await readReadyReminder(client, workspaceId, caseId, extra.readyPaymentId),
      // The project's approved designs, to pick the drawing from.
      designs: await this.approvedDesigns(client, workspaceId, order.projectId),
      projectStatus: (await client.query<{ status: string }>(`SELECT status FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, order.projectId])).rows[0]?.status ?? "active",
      operations: await this.operations(client, workspaceId, orderId),
      // Suppliers a step can go to (not archived, approved first).
      suppliers: (await client.query<{ id: string; name: string; approved: boolean }>(
        `SELECT id, display_name AS name, approval = 'approved' AS approved FROM workspace_vendors WHERE workspace_id = $1 AND status <> 'archived'
          ORDER BY approval = 'approved' DESC, lower(display_name) LIMIT 500`, [workspaceId])).rows,
      materialCost: materials.reduce((sum, row) => sum.add(row.issuedValue), Dec.ZERO).toFixed(4),
      currency: (await client.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? "",
      // Materials from the project's list; those used only on this line can be added in one go.
      projectMaterials: projectMaterials.map(({ lineOnly: _lineOnly, ...row }) => row),
      canSuggest: projectMaterials.some((row) => row.lineOnly && !materials.some((material) => material.materialItemId === row.id && ["active", "pending"].includes(material.status))),
      places: await readLocations(client, workspaceId),
      releaseChecks,
      workcenters: await readWorkcenters(client, workspaceId),
      ...rights, me: userId,
    };
  }

  /** Steps done by suppliers: each with its service order and how much is back. Out while the order is open and something is still to come. */
  private async operations(client: Db, workspaceId: string, orderId: string) {
    const rows = (await client.query<{ id: string; name: string; supplierName: string; orderId: string; orderNumber: string; orderStatus: string; orderLineId: string; quantity: string }>(
      `SELECT operation.id, operation.name, vendor.display_name AS "supplierName", operation.order_id AS "orderId", purchase.number AS "orderNumber", purchase.status AS "orderStatus",
              operation.order_line_id AS "orderLineId", operation.quantity::text AS quantity
         FROM work_order_operations operation
         JOIN workspace_vendors vendor ON vendor.workspace_id = operation.workspace_id AND vendor.id = operation.vendor_id
         JOIN purchase_orders purchase ON purchase.workspace_id = operation.workspace_id AND purchase.id = operation.order_id
        WHERE operation.workspace_id = $1 AND operation.work_order_id = $2 ORDER BY operation.created_at`, [workspaceId, orderId])).rows;
    const result = [];
    for (const row of rows) {
      const line = (await readOrderLines(client, workspaceId, row.orderId)).find((item) => item.id === row.orderLineId);
      const back = line ? line.accepted : "0";
      const out = !["cancelled", "closed", "received"].includes(row.orderStatus) && Boolean(line) && !outstanding(line!).isZero();
      result.push({ ...row, back, out });
    }
    return result;
  }

  private async rights(client: Db, workspaceId: string, userId: string) {
    const has = (code: string) => this.access.hasPermission(client, workspaceId, userId, code);
    const canManage = await has("factory.manage");
    return { canManage, canReport: await has("factory.report"), canApprove: await has("factory.approve"), canIssue: canManage || (await has("stock.manage")) };
  }

  private async event(client: Db, workspaceId: string, orderId: string, kind: string, detail: Record<string, unknown>, actorId: string) {
    await client.query(`INSERT INTO work_order_events (id, workspace_id, work_order_id, kind, detail, actor_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [randomUUID(), workspaceId, orderId, kind, JSON.stringify(detail), actorId]);
  }

  private async holders(client: Db, workspaceId: string, codes: string[]) {
    return (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
         JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = effective_role.role_id
         JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = ANY($2::text[])
        WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId, codes])).rows.map((row) => row.userId);
  }

  /** The project's people in these roles (and its project manager, when asked). */
  private async team(client: Db, workspaceId: string, projectId: string, roles: string[], lead: boolean) {
    return (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
         JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
        WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND (assignment.role_keys && $3::varchar[] OR ($4 AND assignment.is_manager))`,
      [workspaceId, projectId, roles, lead])).rows.map((row) => row.userId);
  }

  private async tell(client: Db, workspaceId: string, order: WorkOrderRow, notice: Notice, actorId: string) {
    const actor = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [actorId])).rows[0]?.name ?? "";
    const variables = { order: `WO-${String(order.number).padStart(4, "0")}`, item: order.title, project: `${order.projectReference} · ${order.projectName}`, actor, note: notice.note };
    for (const userId of new Set(notice.users.filter((id) => id !== actorId)))
      await notifyUserInApp(client, { workspaceId, recipientUserId: userId, code: notice.code, eventType: notice.code, variables, deepLink: `/workspace/factory/orders?order=${order.id}`,
        idempotencyKey: `${notice.code}:${notice.key}:${userId}` });
  }
}

function statusMessage(status: string) {
  return status === "on_hold" ? "The work order is on hold. Resume it first."
    : status === "ready" ? "The work order is ready: everything was made and checked."
    : status === "cancelled" || status === "short_closed" ? "The work order is closed."
    : status === "planned" ? "Release the work order first."
    : status === "released" ? "Start the work order first."
    : "The work order can't do that now.";
}

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} isn't valid.`);
  return value;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function amount(value: unknown, label: string) {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!NUMBER.test(raw)) throw new BadRequestException(`${label} must be a number with up to 4 decimals.`);
  return raw;
}

/** The hours one report of output took: more than none, at most 1,000, to the hundredth. */
function hoursWorked(value: unknown) {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(raw) || Dec.of(raw).cmp(0) <= 0 || Dec.of(raw).cmp(1000) > 0) throw new BadRequestException("Hours are more than 0 and at most 1000, with up to 2 decimals.");
  return raw;
}

function optionalDate(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} isn't a valid date.`);
  return value;
}
