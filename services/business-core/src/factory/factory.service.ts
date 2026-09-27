import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { move, stockItemFor } from "../inventory/stock";
import { notifyUserInApp } from "../notifications/default-templates";
import { productionPaid } from "../project-core/project-core.store";
import { needsNotIn, readNeeds } from "../purchasing/orders";
import { resolvePlace } from "../purchasing/receiving";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { ensureFactorySettings, plain, readToMake, readWorkcenters, readWorkOrders, type WorkOrderRow } from "./factory";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^\d{1,14}(\.\d{1,4})?$/;
const VIEW = ["factory.view", "factory.manage", "factory.report", "factory.approve"];
type Notice = { code: "factory.released" | "factory.report_waiting" | "factory.check_failed" | "factory.ready"; users: string[]; note: string; key: string };

/**
 * The factory: work orders for scope lines made in our factory. A line splits across work orders but
 * never beyond its quantity. A work order is released only when its checks pass; its output is
 * reported, approved by someone else and quality-checked. What passes goes into stock at the factory
 * for the project; what fails is made again, and never counts twice.
 */
@Injectable()
export class FactoryService {
  constructor(private readonly access: WorkspaceAccessService) {}

  state(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, VIEW, async (client, user) => ({
      toMake: await readToMake(client, workspaceId),
      orders: await readWorkOrders(client, workspaceId),
      workcenters: await readWorkcenters(client, workspaceId),
      ...(await this.rights(client, workspaceId, user.userId)),
    }));
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
      const schedule = await this.schedule(client, workspaceId, body, { workcenterId: null, plannedStart: line.suggestedStart, plannedEnd: line.suggestedEnd });
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('work-order-number:' || $1::text, 0))`, [workspaceId]);
      const number = (await client.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM work_orders WHERE workspace_id = $1`, [workspaceId])).rows[0].next;
      await client.query(
        `INSERT INTO work_orders (id, workspace_id, number, project_id, package_id, boq_line_id, title, specification, quantity, unit, workcenter_id, planned_start, planned_end, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [id, workspaceId, number, line.projectId, line.packageId, lineId, line.title, line.specification.slice(0, 2000), quantity, line.unit, schedule.workcenterId, schedule.plannedStart,
          schedule.plannedEnd, text(body.notes, 2000), user.userId]);
      await this.event(client, workspaceId, id, "planned", { quantity, line: line.title }, user.userId);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "work_order.planned", entityType: "work_order", entityId: id, after: { lineId, quantity } });
      return this.detail(client, workspaceId, id, user.userId);
    });
  }

  /** One change to a work order, version-checked (reports and checks also by their own id). */
  command(actor: RequestActor, workspaceId: string, orderId: string, body: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, ["factory.manage", "factory.report", "factory.approve"], async (client, user) => {
      await client.query(`SELECT 1 FROM work_orders WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, uuid(orderId, "Work order")]);
      const order = (await readWorkOrders(client, workspaceId, { id: orderId }))[0];
      if (!order) throw new NotFoundException("Work order not found.");
      const action = String(body.action ?? "");
      const has = (code: string) => this.access.hasPermission(client, workspaceId, user.userId, code);
      const need = async (code: string, message: string) => { if (!(await has(code))) throw new ForbiddenException(message); };
      const status = (...allowed: string[]) => { if (!allowed.includes(order.status)) throw new ConflictException(statusMessage(order.status)); };
      // Reports and checks carry their own id: sent twice, they're recorded once.
      const recordId = ["report", "check"].includes(action) ? uuid(body.id, action === "report" ? "Report" : "Check") : null;
      if (recordId && (await client.query(`SELECT 1 FROM factory_commands WHERE workspace_id = $1 AND command_id = $2`, [workspaceId, recordId])).rowCount)
        return this.detail(client, workspaceId, orderId, user.userId);
      if (!recordId && body.version !== order.version) throw new ConflictException("Someone else changed this work order. Reload to see their changes.");
      const settings = await ensureFactorySettings(client, workspaceId);
      const set = async (sql: string, values: unknown[] = []) =>
        client.query(`UPDATE work_orders SET ${sql}, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, orderId, ...values]);
      const notices: Notice[] = [];
      let audit: Record<string, unknown> = {};

      if (action === "update") {
        await need("factory.manage", "You can't plan work orders.");
        status("planned", "released", "on_hold");
        const schedule = await this.schedule(client, workspaceId, body, order);
        await set(`workcenter_id = $3, planned_start = $4, planned_end = $5, notes = $6`, [schedule.workcenterId, schedule.plannedStart, schedule.plannedEnd,
          body.notes === undefined ? order.notes : text(body.notes, 2000)]);
        audit = schedule;
      } else if (action === "approve_drawing") {
        await need("factory.manage", "You can't record drawing approvals.");
        status("planned", "on_hold");
        const reference = text(body.reference, 200);
        if (!reference) throw new BadRequestException("Say which drawing was approved (its number or revision).");
        await set(`drawing_ref = $3, drawing_approved_by = $4, drawing_approved_at = now()`, [reference, user.userId]);
        audit = { reference };
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
      } else if (action === "report") {
        await need("factory.report", "You can't report output.");
        status("in_production");
        const good = amount(body.good ?? "0", "Good");
        const scrap = amount(body.scrap ?? "0", "Scrapped");
        const scrapReason = text(body.scrapReason, 500);
        if (Dec.of(good).add(scrap).cmp(0) <= 0) throw new BadRequestException("Enter what was made or scrapped.");
        if (Dec.of(scrap).cmp(0) > 0 && !scrapReason) throw new BadRequestException("Say why it was scrapped.");
        if (Dec.of(good).cmp(order.left) > 0) throw new ConflictException(`Only ${plain(order.left)} ${order.unit} is still to make.`.replace("  ", " "));
        await client.query(`INSERT INTO factory_commands (workspace_id, command_id, entity_id, action, actor_id) VALUES ($1, $2, $3, 'report', $4)`, [workspaceId, recordId, orderId, user.userId]);
        await client.query(`INSERT INTO work_order_reports (id, workspace_id, work_order_id, good, scrap, scrap_reason, note, reported_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [recordId, workspaceId, orderId, good, scrap, scrapReason, text(body.note, 1000), user.userId]);
        await set(`notes = notes`);
        notices.push({ code: "factory.report_waiting", users: (await this.holders(client, workspaceId, ["factory.approve"])).filter((id) => id !== user.userId),
          note: `${plain(good)} ${order.unit} made${Dec.of(scrap).cmp(0) > 0 ? `, ${plain(scrap)} scrapped` : ""}`.replace("  ", " "), key: `report:${recordId}` });
        audit = { reportId: recordId, good, scrap, scrapReason };
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
        if (!settings.requireCheck) throw new ConflictException("Output passes when it's approved; there's no separate check.");
        const passed = amount(body.passed ?? "0", "Passed");
        const failed = amount(body.failed ?? "0", "Failed");
        const failReason = text(body.failReason, 500);
        if (Dec.of(passed).add(failed).cmp(0) <= 0) throw new BadRequestException("Enter what passed or failed.");
        if (Dec.of(failed).cmp(0) > 0 && !failReason) throw new BadRequestException("Say why it failed.");
        if (Dec.of(passed).add(failed).cmp(order.toCheck) > 0)
          throw new ConflictException(Dec.of(order.toCheck).cmp(0) > 0 ? `Only ${plain(order.toCheck)} ${order.unit} is waiting to be checked.`.replace("  ", " ") : "Nothing is waiting to be checked.");
        await this.pass(client, workspaceId, order, recordId!, passed, failed, failReason, user.userId, notices);
        audit = { checkId: recordId, passed, failed, failReason };
      } else if (action === "hold") {
        await need("factory.manage", "You can't hold work orders.");
        status("planned", "released", "in_production");
        const reason = text(body.reason, 500);
        if (!reason) throw new BadRequestException("Say why it's on hold.");
        await set(`status = 'on_hold', hold_reason = $3, held_from = status`, [reason]);
        audit = { reason };
      } else if (action === "resume") {
        await need("factory.manage", "You can't resume work orders.");
        status("on_hold");
        await set(`status = held_from, hold_reason = NULL, held_from = NULL`);
      } else if (action === "cancel" || action === "short_close") {
        await need("factory.manage", "You can't close work orders.");
        status("planned", "released", "in_production", "on_hold");
        const reason = text(body.reason, 500);
        const anything = Dec.of(order.made).add(order.pending).add(order.scrapped).cmp(0) > 0;
        if (action === "cancel" && anything) throw new ConflictException("Something was already made or reported on it: close it short instead.");
        if (action === "short_close" && !anything) throw new ConflictException("Nothing was made on it yet: cancel it instead.");
        if (action === "short_close" && Dec.of(order.pending).add(order.toCheck).cmp(0) > 0) throw new ConflictException("Decide the reports and check what was made first.");
        if (!reason) throw new BadRequestException(action === "cancel" ? "Say why it's cancelled." : "Say why the rest won't be made.");
        await set(`status = $3, closed_by = $4, closed_at = now(), close_reason = $5, hold_reason = NULL, held_from = NULL`, [action === "cancel" ? "cancelled" : "short_closed", user.userId, reason]);
        audit = { reason };
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
    return this.access.withAnyPermission(actor, workspaceId, [...VIEW, "workspace.settings.manage"], async (client, user) => ({
      settings: await ensureFactorySettings(client, workspaceId),
      workcenters: await readWorkcenters(client, workspaceId, true),
      canManage: await this.access.hasPermission(client, workspaceId, user.userId, "workspace.settings.manage"),
    }));
  }

  saveSettings(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "workspace.settings.manage", async (client, user) => {
      const current = await ensureFactorySettings(client, workspaceId);
      if (body.version !== current.version) throw new ConflictException("Someone else changed these settings. Reload to see their changes.");
      const flag = (key: "requireDrawing" | "requirePayment" | "requireMaterials" | "requireCheck") => (body[key] === undefined ? current[key] : body[key] === true);
      await client.query(`UPDATE workspace_factory_settings SET require_drawing = $2, require_payment = $3, require_materials = $4, require_check = $5, version = version + 1, updated_by = $6,
        updated_at = now() WHERE workspace_id = $1`, [workspaceId, flag("requireDrawing"), flag("requirePayment"), flag("requireMaterials"), flag("requireCheck"), user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "factory.settings_changed", entityType: "workspace", entityId: workspaceId, before: current, after: body });
      return { settings: await ensureFactorySettings(client, workspaceId), workcenters: await readWorkcenters(client, workspaceId, true), canManage: true };
    });
  }

  /** Adds or renames a workcenter, or stops using one (a workcenter with open work orders stays). */
  saveWorkcenter(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "workspace.settings.manage", async (client, user) => {
      const id = uuid(body.id, "Workcenter");
      const name = text(body.name, 120);
      if (!name) throw new BadRequestException("Name the workcenter.");
      const hours = body.hoursPerDay === null || body.hoursPerDay === undefined || body.hoursPerDay === "" ? null : amount(body.hoursPerDay, "Hours a day");
      if (hours !== null && (Dec.of(hours).cmp(0) <= 0 || Dec.of(hours).cmp(24) > 0)) throw new BadRequestException("Hours a day is from 0 to 24.");
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
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "factory.workcenter_saved", entityType: "workcenter", entityId: id, after: { name, hours, active } });
      return { settings: await ensureFactorySettings(client, workspaceId), workcenters: await readWorkcenters(client, workspaceId, true), canManage: true };
    });
  }

  // ---------- helpers ----------
  /** What has to hold before a work order is released, each with what's missing when it doesn't. */
  private async releaseChecks(client: Db, workspaceId: string, order: WorkOrderRow, settings: Awaited<ReturnType<typeof ensureFactorySettings>>) {
    const project = (await client.query<{ status: string; caseId: string; quoteId: string }>(
      `SELECT status, case_id AS "caseId", quote_id AS "quoteId" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, order.projectId])).rows[0];
    const drawing = (await client.query<{ at: string | null }>(`SELECT drawing_approved_at AS at FROM work_orders WHERE workspace_id = $1 AND id = $2`, [workspaceId, order.id])).rows[0];
    const checks: Array<{ key: string; passed: boolean; missing: string; detail?: string[] }> = [
      { key: "running", passed: project?.status === "active", missing: project?.status === "on_hold" ? "the project is on hold" : "the project isn't running" },
    ];
    if (settings.requireDrawing) checks.push({ key: "drawing", passed: Boolean(drawing?.at), missing: "the drawing isn't approved" });
    if (settings.requirePayment) checks.push({ key: "payment", passed: project ? await productionPaid(client, workspaceId, project.caseId, project.quoteId) : false, missing: "the payment before production isn't verified" });
    if (settings.requireMaterials) {
      const short = needsNotIn(await readNeeds(client, workspaceId, false, order.projectId), order.packageId).map((need) => need.title);
      checks.push({ key: "materials", passed: !short.length, missing: `materials aren't in: ${short.slice(0, 5).join(", ")}${short.length > 5 ? ` and ${short.length - 5} more` : ""}`, detail: short });
    }
    checks.push({ key: "schedule", passed: Boolean(order.workcenterId && order.plannedStart && order.plannedEnd), missing: "it has no workcenter or dates" });
    return checks;
  }

  /**
   * Records a quality check: what passed goes into stock at the factory, owned by the project; what failed
   * is made again. When everything has passed the work order is ready.
   */
  private async pass(client: Db, workspaceId: string, order: WorkOrderRow, checkId: string, passed: string, failed: string, failReason: string, userId: string, notices: Notice[]) {
    await client.query(`INSERT INTO factory_commands (workspace_id, command_id, entity_id, action, actor_id) VALUES ($1, $2, $3, 'check', $4)`, [workspaceId, checkId, order.id, userId]);
    await client.query(`INSERT INTO work_order_checks (id, workspace_id, work_order_id, passed, failed, fail_reason, checked_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [checkId, workspaceId, order.id, passed, failed, failReason, userId]);
    if (Dec.of(passed).cmp(0) > 0) {
      const line = (await client.query<{ catalogItemId: string | null }>(`SELECT catalog_item_id AS "catalogItemId" FROM project_boq_lines WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, order.boqLineId])).rows[0];
      const factory = await resolvePlace(client, workspaceId, "factory", [order.projectId], randomUUID);
      const itemId = await stockItemFor(client, workspaceId, { catalogItemId: line?.catalogItemId ?? null, name: order.title, unit: order.unit });
      const today = (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
      await move(client, workspaceId, { batchId: checkId, itemId, locationId: factory!.id, projectId: order.projectId, kind: "produce", quantity: passed, forProjectId: order.projectId,
        workOrderId: order.id, reason: `WO-${String(order.number).padStart(4, "0")}`, movedOn: today, actorId: userId });
    }
    if (Dec.of(failed).cmp(0) > 0)
      notices.push({ code: "factory.check_failed", users: await this.team(client, workspaceId, order.projectId, ["factory_lead"], true), note: `${plain(failed)} ${order.unit} failed: ${failReason}`.replace("  ", " "), key: `failed:${checkId}` });
    const total = Dec.of(order.passed).add(passed);
    if (total.cmp(order.quantity) >= 0) {
      await client.query(`UPDATE work_orders SET status = 'ready', ready_at = now(), hold_reason = NULL, held_from = NULL, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, order.id]);
      notices.push({ code: "factory.ready", users: await this.team(client, workspaceId, order.projectId, ["installation_lead"], true), note: "", key: `ready:${order.id}` });
    } else {
      await client.query(`UPDATE work_orders SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, order.id]);
    }
  }

  private async schedule(client: Db, workspaceId: string, body: Record<string, unknown>, current: { workcenterId: string | null; plannedStart: string | null; plannedEnd: string | null }) {
    const workcenterId = body.workcenterId === undefined ? current.workcenterId : body.workcenterId === null || body.workcenterId === "" ? null : uuid(body.workcenterId, "Workcenter");
    if (workcenterId && body.workcenterId !== undefined && !(await readWorkcenters(client, workspaceId)).some((center) => center.id === workcenterId))
      throw new BadRequestException("Choose a workcenter in use.");
    const plannedStart = body.plannedStart === undefined ? current.plannedStart : optionalDate(body.plannedStart, "Start");
    const plannedEnd = body.plannedEnd === undefined ? current.plannedEnd : optionalDate(body.plannedEnd, "Finish");
    if (plannedStart && plannedEnd && plannedEnd < plannedStart) throw new BadRequestException("The finish can't be before the start.");
    return { workcenterId, plannedStart, plannedEnd };
  }

  private async detail(client: Db, workspaceId: string, orderId: string, userId: string) {
    const order = (await readWorkOrders(client, workspaceId, { id: orderId }))[0];
    if (!order) throw new NotFoundException("Work order not found.");
    const settings = await ensureFactorySettings(client, workspaceId);
    const extra = (await client.query<{ drawingRef: string; drawingApprovedAt: string | null; drawingApprovedByName: string | null; holdReason: string | null; closeReason: string | null;
      closedAt: string | null; releasedAt: string | null; readyAt: string | null }>(
      `SELECT wo.drawing_ref AS "drawingRef", wo.drawing_approved_at AS "drawingApprovedAt", approver.display_name AS "drawingApprovedByName", wo.hold_reason AS "holdReason",
              wo.close_reason AS "closeReason", wo.closed_at AS "closedAt", wo.released_at AS "releasedAt", wo.ready_at AS "readyAt"
         FROM work_orders wo LEFT JOIN users approver ON approver.id = wo.drawing_approved_by WHERE wo.workspace_id = $1 AND wo.id = $2`, [workspaceId, orderId])).rows[0];
    const reports = (await client.query<{ id: string; good: string; scrap: string; scrapReason: string; note: string; status: string; reportedBy: string; reportedByName: string; reportedAt: string;
      decidedByName: string | null; decisionNote: string }>(
      `SELECT report.id, report.good::text AS good, report.scrap::text AS scrap, report.scrap_reason AS "scrapReason", report.note, report.status, report.reported_by AS "reportedBy",
              reporter.display_name AS "reportedByName", report.reported_at AS "reportedAt", decider.display_name AS "decidedByName", report.decision_note AS "decisionNote"
         FROM work_order_reports report JOIN users reporter ON reporter.id = report.reported_by LEFT JOIN users decider ON decider.id = report.decided_by
        WHERE report.workspace_id = $1 AND report.work_order_id = $2 ORDER BY report.reported_at`, [workspaceId, orderId])).rows;
    const checks = (await client.query<{ id: string; passed: string; failed: string; failReason: string; checkedByName: string; checkedAt: string }>(
      `SELECT checked.id, checked.passed::text AS passed, checked.failed::text AS failed, checked.fail_reason AS "failReason", person.display_name AS "checkedByName", checked.checked_at AS "checkedAt"
         FROM work_order_checks checked JOIN users person ON person.id = checked.checked_by WHERE checked.workspace_id = $1 AND checked.work_order_id = $2 ORDER BY checked.checked_at`,
      [workspaceId, orderId])).rows;
    const events = (await client.query<{ id: string; kind: string; detail: Record<string, unknown>; byName: string; at: string }>(
      `SELECT event.id, event.kind, event.detail, person.display_name AS "byName", event.at FROM work_order_events event JOIN users person ON person.id = event.actor_id
        WHERE event.workspace_id = $1 AND event.work_order_id = $2 ORDER BY event.at`, [workspaceId, orderId])).rows;
    return {
      order: { ...order, ...extra }, reports, checks, events, settings,
      releaseChecks: order.status === "planned" ? await this.releaseChecks(client, workspaceId, order, settings) : [],
      workcenters: await readWorkcenters(client, workspaceId),
      ...(await this.rights(client, workspaceId, userId)), me: userId,
    };
  }

  private async rights(client: Db, workspaceId: string, userId: string) {
    const has = (code: string) => this.access.hasPermission(client, workspaceId, userId, code);
    return { canManage: await has("factory.manage"), canReport: await has("factory.report"), canApprove: await has("factory.approve") };
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

function optionalDate(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} isn't a valid date.`);
  return value;
}
