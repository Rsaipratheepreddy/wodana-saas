import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { ActorUser, RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { activeMembers, membershipOf, readProject, readTeam, type ProjectRow } from "./project-core.store";
import { noticeWork, type WorkNotice } from "./project-notices";
import {
  ensureProjectAccess, OPEN, readActivity, readItem, readItems, readLinks, readOpenWork, readProjectLinks, WORK_PRIORITIES, WORK_STATUSES, WORK_TYPES, wouldCycle, workEvent,
  type WorkItem, type WorkStatus,
} from "./project-work";
import { readCalendar, ripple, type PlanMove } from "./work-calendar";

type Db = PoolClient;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EDITABLE = ["active", "on_hold"];

/**
 * A project's work, run like an issue tracker: tasks with subtasks, and issues (blockers, client
 * requests, snags), each optionally tied to a package, a scope line and a stage. Anyone on the project
 * can add and move work; giving work to someone gives them access to the project. Items are
 * version-checked one by one, so a busy team doesn't trip over the project's own version.
 */
@Injectable()
export class ProjectWorkService {
  constructor(private readonly access: WorkspaceAccessService) {}

  /** Every item on the project, with what the plan needs to group and assign them. */
  board(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => this.state(client, workspaceId, await this.context(client, workspaceId, projectId, user), null));
  }

  /** One item: its subtasks, what it waits on, and its comments and history. */
  item(actor: RequestActor, workspaceId: string, projectId: string, itemId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.context(client, workspaceId, projectId, user);
      return this.detail(client, workspaceId, projectId, itemId);
    });
  }

  /** What else would move later if this item's dates changed, without saving anything. */
  preview(actor: RequestActor, workspaceId: string, projectId: string, itemId: string, query: { startDate?: string; dueDate?: string }) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.context(client, workspaceId, projectId, user);
      const item = await this.own(client, workspaceId, projectId, itemId);
      const startDate = query.startDate === undefined ? item.startDate : date(query.startDate, "Start date");
      const dueDate = query.dueDate === undefined ? item.dueDate : date(query.dueDate, "Due date");
      return { moves: await this.ripple(client, workspaceId, projectId, { id: itemId, startDate, dueDate }) };
    });
  }

  /** Open work across projects: the person's own, or (for someone who sees every project) everyone's. */
  open(actor: RequestActor, workspaceId: string, view: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const all = await this.access.hasPermission(client, workspaceId, user.userId, "projects.manage");
      if (!all && !(await this.access.hasPermission(client, workspaceId, user.userId, "projects.view"))) throw new ForbiddenException("You don't have access to projects.");
      const membershipId = await membershipOf(client, workspaceId, user.userId);
      const mine = view !== "all";
      return { items: await readOpenWork(client, workspaceId, membershipId, { all, mine }), me: membershipId, view: mine ? "mine" : "all" };
    });
  }

  command(actor: RequestActor, workspaceId: string, projectId: string, body: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const context = await this.context(client, workspaceId, projectId, user);
      if (!context.canEdit) throw new ConflictException(EDITABLE.includes(context.project.status) ? "Only the project's team can change its work." : "The project is closed.");
      const action = String(body.action ?? "");
      const notices: Array<{ key: string; notice: WorkNotice }> = [];
      let itemId: string | null;
      let audit: Record<string, unknown>;

      if (action === "set_baseline") {
        if (!context.manager) throw new ForbiddenException("Only the project manager can set the baseline.");
        const saved = (await client.query(`UPDATE work_items SET baseline_start = start_date, baseline_due = due_date WHERE workspace_id = $1 AND project_id = $2 AND status <> 'cancelled'`,
          [workspaceId, projectId])).rowCount;
        await client.query(`UPDATE delivery_projects SET plan_baseline_at = now(), plan_baseline_by = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId, user.userId]);
        itemId = null;
        audit = { items: saved };
      } else if (action === "create") {
        const id = uuid(body.id, "Item");
        const existing = (await client.query<{ projectId: string }>(`SELECT project_id AS "projectId" FROM work_items WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
        if (existing) {
          if (existing.projectId !== projectId) throw new ConflictException("This item belongs to another project.");
          return this.state(client, workspaceId, context, id);
        }
        const created = await this.create(client, workspaceId, projectId, id, body, user.userId, notices);
        itemId = id;
        audit = created;
      } else if (action === "update") {
        itemId = uuid(body.itemId, "Item");
        audit = await this.update(client, workspaceId, projectId, itemId, body, user.userId, notices);
      } else if (action === "comment") {
        itemId = uuid(body.itemId, "Item");
        const item = await this.own(client, workspaceId, projectId, itemId);
        const id = uuid(body.id, "Comment");
        const text = typeof body.body === "string" ? body.body.trim() : "";
        if (!text || text.length > 4000) throw new BadRequestException("Write a comment of up to 4000 characters.");
        const inserted = (await client.query(`INSERT INTO work_item_comments (id, workspace_id, work_item_id, body, author_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
          [id, workspaceId, itemId, text, user.userId])).rowCount;
        if (inserted) notices.push({ key: id, notice: { code: "work.commented", item, note: text.slice(0, 280), memberships: [item.assigneeId, await this.reporter(client, workspaceId, item)].filter(Boolean) as string[] } });
        audit = { commentId: id };
      } else if (action === "link") {
        itemId = uuid(body.itemId, "Item");
        const after = await this.own(client, workspaceId, projectId, itemId);
        const before = await this.own(client, workspaceId, projectId, uuid(body.predecessorId, "Item"));
        if (before.id === after.id) throw new BadRequestException("An item can't wait on itself.");
        const kind = body.kind === "ss" ? "ss" : "fs";
        const lag = body.lagDays === undefined || body.lagDays === null || body.lagDays === "" ? 0 : Number(body.lagDays);
        if (!Number.isInteger(lag) || Math.abs(lag) > 365) throw new BadRequestException("The lag is a whole number of days, up to a year.");
        if (await wouldCycle(client, workspaceId, before.id, after.id)) throw new ConflictException(`#${before.number} already waits on #${after.number}, so this would go round in a circle.`);
        await client.query(
          `INSERT INTO work_item_links (workspace_id, project_id, predecessor_id, successor_id, kind, lag_days, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (workspace_id, predecessor_id, successor_id) DO UPDATE SET kind = EXCLUDED.kind, lag_days = EXCLUDED.lag_days`,
          [workspaceId, projectId, before.id, after.id, kind, lag, user.userId]);
        await workEvent(client, workspaceId, after.id, "linked", { number: before.number, title: before.title, kind, lagDays: lag }, user.userId);
        audit = { predecessorId: before.id, kind, lag };
      } else if (action === "unlink") {
        itemId = uuid(body.itemId, "Item");
        const after = await this.own(client, workspaceId, projectId, itemId);
        const before = await this.own(client, workspaceId, projectId, uuid(body.predecessorId, "Item"));
        const removed = (await client.query(`DELETE FROM work_item_links WHERE workspace_id = $1 AND predecessor_id = $2 AND successor_id = $3`, [workspaceId, before.id, after.id])).rowCount;
        if (removed) await workEvent(client, workspaceId, after.id, "unlinked", { number: before.number, title: before.title }, user.userId);
        audit = { predecessorId: before.id };
      } else {
        throw new BadRequestException("Unknown action.");
      }

      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `work.${action}`, entityType: itemId ? "work_item" : "project", entityId: itemId ?? projectId, after: audit });
      for (const item of notices) await noticeWork(client, { workspaceId, projectId, key: item.key, actorUserId: user.userId, notice: item.notice });
      return this.state(client, workspaceId, await this.context(client, workspaceId, projectId, user), itemId);
    });
  }

  // ---------- commands ----------
  private async create(client: Db, workspaceId: string, projectId: string, id: string, body: Record<string, unknown>, userId: string, notices: Array<{ key: string; notice: WorkNotice }>) {
    const title = text(body.title, 300, "Title");
    if (!title) throw new BadRequestException("Give it a title.");
    const parent = body.parentId ? await this.own(client, workspaceId, projectId, uuid(body.parentId, "Parent")) : null;
    if (parent?.parentId) throw new BadRequestException("A subtask can't have its own subtasks.");
    const type = parent ? "task" : oneOf(body.type ?? "task", WORK_TYPES, "Type");
    const blocks = type === "blocker" && body.blocks ? await this.own(client, workspaceId, projectId, uuid(body.blocks, "Item")) : null;
    const line = body.boqLineId ? await this.line(client, workspaceId, projectId, uuid(body.boqLineId, "Line")) : null;
    const packageId = body.packageId !== undefined ? await this.packageOf(client, workspaceId, projectId, body.packageId) : parent?.packageId ?? blocks?.packageId ?? line?.packageId ?? null;
    const stageId = body.stageId !== undefined ? await this.stageOf(client, workspaceId, projectId, body.stageId) : parent?.stageId ?? blocks?.stageId ?? null;
    const assigneeId = body.assigneeId ? await this.assignee(client, workspaceId, projectId, body.assigneeId) : null;
    const startDate = date(body.startDate, "Start date");
    const dueDate = date(body.dueDate, "Due date");
    if (startDate && dueDate && dueDate < startDate) throw new BadRequestException("The due date can't be before the start date.");
    const priority = oneOf(body.priority ?? "normal", WORK_PRIORITIES, "Priority");
    const description = text(body.description, 10000, "Description");
    await client.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, projectId]);
    const number = (await client.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM work_items WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows[0].next;
    await client.query(
      `INSERT INTO work_items (id, workspace_id, project_id, number, type, parent_id, package_id, boq_line_id, stage_id, title, description, priority, assignee_membership_id, start_date, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [id, workspaceId, projectId, number, type, parent?.id ?? null, packageId, line?.id ?? null, stageId, title, description, priority, assigneeId, startDate, dueDate, userId]);
    await workEvent(client, workspaceId, id, "created", { type, parent: parent ? parent.number : null }, userId);
    if (blocks) {
      await client.query(`INSERT INTO work_item_links (workspace_id, project_id, predecessor_id, successor_id, kind, lag_days, created_by) VALUES ($1, $2, $3, $4, 'fs', 0, $5)`,
        [workspaceId, projectId, id, blocks.id, userId]);
      await workEvent(client, workspaceId, blocks.id, "blocked", { number, title }, userId);
      const leads = ((await readTeam(client, workspaceId, [projectId])).get(projectId) ?? []).filter((member) => member.lead).map((member) => member.membershipId);
      notices.push({ key: id, notice: { code: "work.blocked", item: blocks, note: title, memberships: [...leads, ...(blocks.assigneeId ? [blocks.assigneeId] : [])] } });
    }
    const created = (await readItem(client, workspaceId, id))!;
    if (assigneeId) notices.push({ key: `${id}:${assigneeId}:0`, notice: { code: "work.assigned", item: created, memberships: [assigneeId] } });
    return { number, type, title, parentId: parent?.id ?? null, blocks: blocks?.id ?? null, assigneeId };
  }

  private async update(client: Db, workspaceId: string, projectId: string, itemId: string, body: Record<string, unknown>, userId: string, notices: Array<{ key: string; notice: WorkNotice }>) {
    const item = await this.own(client, workspaceId, projectId, itemId, true);
    if (body.version !== item.version) throw new ConflictException("Someone else changed this item. Reload to see their changes.");
    const changes: Record<string, unknown> = {};
    const set = (column: string, value: unknown) => { changes[column] = value; };

    if (body.title !== undefined) {
      const title = text(body.title, 300, "Title");
      if (!title) throw new BadRequestException("Give it a title.");
      if (title !== item.title) { set("title", title); await workEvent(client, workspaceId, itemId, "title", { from: item.title, to: title }, userId); }
    }
    if (body.description !== undefined) {
      const description = text(body.description, 10000, "Description");
      set("description", description);
    }
    if (body.type !== undefined && body.type !== item.type) {
      if (item.parentId) throw new BadRequestException("A subtask is always a task.");
      const type = oneOf(body.type, WORK_TYPES, "Type");
      set("type", type);
      await workEvent(client, workspaceId, itemId, "type", { from: item.type, to: type }, userId);
    }
    if (body.priority !== undefined && body.priority !== item.priority) {
      const priority = oneOf(body.priority, WORK_PRIORITIES, "Priority");
      set("priority", priority);
      await workEvent(client, workspaceId, itemId, "priority", { from: item.priority, to: priority }, userId);
    }
    let moves: PlanMove[] = [];
    if (body.startDate !== undefined || body.dueDate !== undefined) {
      const startDate = body.startDate === undefined ? item.startDate : date(body.startDate, "Start date");
      const dueDate = body.dueDate === undefined ? item.dueDate : date(body.dueDate, "Due date");
      if (startDate && dueDate && dueDate < startDate) throw new BadRequestException("The due date can't be before the start date.");
      if (startDate !== item.startDate || dueDate !== item.dueDate) {
        set("start_date", startDate); set("due_date", dueDate);
        await workEvent(client, workspaceId, itemId, "dates", { startDate, dueDate, fromStart: item.startDate, fromDue: item.dueDate }, userId);
        // "Move them too": what waits on this item is pushed later, in the same save.
        if (body.ripple === true) moves = await this.ripple(client, workspaceId, projectId, { id: itemId, startDate, dueDate });
      }
    }
    if (body.packageId !== undefined) {
      const packageId = await this.packageOf(client, workspaceId, projectId, body.packageId);
      if (packageId !== item.packageId) { set("package_id", packageId); await workEvent(client, workspaceId, itemId, "package", { name: await this.packageName(client, workspaceId, packageId) }, userId); }
    }
    if (body.stageId !== undefined) {
      const stageId = await this.stageOf(client, workspaceId, projectId, body.stageId);
      if (stageId !== item.stageId) { set("stage_id", stageId); await workEvent(client, workspaceId, itemId, "stage", { name: await this.stageName(client, workspaceId, stageId) }, userId); }
    }
    if (body.boqLineId !== undefined) {
      const line = body.boqLineId ? await this.line(client, workspaceId, projectId, uuid(body.boqLineId, "Line")) : null;
      if ((line?.id ?? null) !== item.boqLineId) { set("boq_line_id", line?.id ?? null); await workEvent(client, workspaceId, itemId, "line", { title: line?.title ?? null }, userId); }
    }
    if (body.assigneeId !== undefined) {
      const assigneeId = body.assigneeId ? await this.assignee(client, workspaceId, projectId, body.assigneeId) : null;
      if (assigneeId !== item.assigneeId) {
        set("assignee_membership_id", assigneeId);
        await workEvent(client, workspaceId, itemId, "assignee", { name: assigneeId ? await this.memberName(client, workspaceId, assigneeId) : null }, userId);
        if (assigneeId) notices.push({ key: `${itemId}:${assigneeId}:${item.version}`, notice: { code: "work.assigned", item, memberships: [assigneeId] } });
      }
    }
    if (body.status !== undefined && body.status !== item.status) {
      const status = oneOf(body.status, WORK_STATUSES, "Status");
      const children = (await client.query<{ id: string; status: WorkStatus; number: number }>(
        `SELECT id, status, number FROM work_items WHERE workspace_id = $1 AND parent_id = $2 FOR UPDATE`, [workspaceId, itemId])).rows.filter((child) => OPEN(child.status));
      if (status === "done" && children.length) throw new ConflictException(children.length === 1 ? "Finish or cancel its open subtask first." : `Finish or cancel its ${children.length} open subtasks first.`);
      if (status === "cancelled") for (const child of children) {
        await client.query(`UPDATE work_items SET status = 'cancelled', version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, child.id]);
        await workEvent(client, workspaceId, child.id, "status", { from: child.status, to: "cancelled", because: item.number }, userId);
      }
      set("status", status);
      set("completed_at", status === "done" ? new Date().toISOString() : null);
      set("completed_by", status === "done" ? userId : null);
      if (status !== "todo" && status !== "cancelled") await client.query(`UPDATE work_items SET started_at = coalesce(started_at, now()) WHERE workspace_id = $1 AND id = $2`, [workspaceId, itemId]);
      await workEvent(client, workspaceId, itemId, "status", { from: item.status, to: status }, userId);
      if (status === "done") notices.push({ key: `${itemId}:${item.version}`, notice: { code: "work.done", item, memberships: [await this.reporter(client, workspaceId, item)].filter(Boolean) as string[] } });
    }

    const columns = Object.keys(changes);
    if (!columns.length) return {};
    await client.query(
      `UPDATE work_items SET ${columns.map((column, index) => `${column} = $${index + 3}`).join(", ")}, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, itemId, ...columns.map((column) => changes[column])]);
    for (const move of moves) {
      const moved = (await client.query<{ assigneeId: string | null }>(
        `UPDATE work_items SET start_date = $3, due_date = $4, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2 AND status NOT IN ('done', 'cancelled')
         RETURNING assignee_membership_id AS "assigneeId"`, [workspaceId, move.id, move.startDate, move.dueDate])).rows[0];
      if (!moved) continue;
      await workEvent(client, workspaceId, move.id, "dates", { startDate: move.startDate, dueDate: move.dueDate, fromStart: move.fromStart, fromDue: move.fromDue, because: move.because }, userId);
      if (moved.assigneeId) notices.push({ key: `${move.id}:${item.version}`, notice: { code: "work.moved", item: { id: move.id, number: move.number, title: move.title, dueDate: move.dueDate ?? move.startDate },
        note: `#${move.because}`, memberships: [moved.assigneeId] } });
    }
    return moves.length ? { ...changes, moved: moves.map((move) => move.number) } : changes;
  }

  // ---------- reads ----------
  private async state(client: Db, workspaceId: string, context: Context, itemId: string | null) {
    const { project } = context;
    const items = await readItems(client, workspaceId, project.id);
    const packages = await client.query<{ id: string; name: string }>(`SELECT id, name FROM project_packages WHERE workspace_id = $1 AND project_id = $2 ORDER BY position, name`, [workspaceId, project.id]);
    const stages = await client.query<{ id: string; name: string; status: string }>(`SELECT id, name, status FROM project_stages WHERE workspace_id = $1 AND project_id = $2 ORDER BY position`, [workspaceId, project.id]);
    const lines = await client.query<{ id: string; title: string; areaName: string | null; packageId: string | null }>(
      `SELECT line.id, line.title, room.name AS "areaName", line.package_id AS "packageId" FROM project_boq_lines line
         LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = $3 AND room.id = line.area_id
        WHERE line.workspace_id = $1 AND line.project_id = $2 AND line.status = 'active' ORDER BY line.position`, [workspaceId, project.id, project.caseId]);
    const baseline = (await client.query<{ at: string | null; byName: string | null }>(
      `SELECT project.plan_baseline_at AS at, person.display_name AS "byName" FROM delivery_projects project LEFT JOIN users person ON person.id = project.plan_baseline_by
        WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, project.id])).rows[0];
    return {
      items, packages: packages.rows, stages: stages.rows, lines: lines.rows,
      people: context.canEdit ? await activeMembers(client, workspaceId) : [],
      me: context.membershipId, canEdit: context.canEdit, canManage: context.manager && context.canEdit,
      calendar: await readCalendar(client, workspaceId), promiseDate: project.promiseDate, startDate: project.startDate,
      baseline: baseline?.at ? baseline : null,
      item: itemId ? await this.detail(client, workspaceId, project.id, itemId) : null,
    };
  }

  private async detail(client: Db, workspaceId: string, projectId: string, itemId: string) {
    const item = await this.own(client, workspaceId, projectId, itemId);
    const subtasks = await client.query<{ id: string }>(`SELECT id FROM work_items WHERE workspace_id = $1 AND parent_id = $2 ORDER BY number`, [workspaceId, itemId]);
    const links = await readLinks(client, workspaceId, itemId);
    const activity = await readActivity(client, workspaceId, itemId);
    const extra = await client.query<{ description: string; createdByName: string; createdAt: string; startedAt: string | null }>(
      `SELECT item.description, creator.display_name AS "createdByName", item.created_at AS "createdAt", item.started_at AS "startedAt"
         FROM work_items item JOIN users creator ON creator.id = item.created_by WHERE item.workspace_id = $1 AND item.id = $2`, [workspaceId, itemId]);
    return { ...item, ...extra.rows[0], subtaskIds: subtasks.rows.map((row) => row.id), before: links.before, after: links.after, activity };
  }

  private async context(client: Db, workspaceId: string, projectId: string, user: ActorUser): Promise<Context> {
    const project = await readProject(client, workspaceId, projectId);
    if (!project) throw new NotFoundException("Project not found.");
    const all = await this.access.hasPermission(client, workspaceId, user.userId, "projects.manage");
    if (!all && !(await this.access.hasPermission(client, workspaceId, user.userId, "projects.view"))) throw new ForbiddenException("You don't have access to projects.");
    const membershipId = await membershipOf(client, workspaceId, user.userId);
    const onProject = all || Boolean((await client.query(
      `SELECT 1 FROM project_assignments WHERE workspace_id = $1 AND project_id = $2 AND membership_id = $3 AND active`, [workspaceId, projectId, membershipId])).rowCount);
    if (!onProject) throw new NotFoundException("Project not found.");
    const lead = all || Boolean((await client.query(
      `SELECT 1 FROM project_assignments WHERE workspace_id = $1 AND project_id = $2 AND membership_id = $3 AND active AND is_manager`, [workspaceId, projectId, membershipId])).rowCount);
    return { project, membershipId, canEdit: EDITABLE.includes(project.status), manager: lead };
  }

  private async ripple(client: Db, workspaceId: string, projectId: string, changed: { id: string; startDate: string | null; dueDate: string | null }) {
    return ripple(await readItems(client, workspaceId, projectId), await readProjectLinks(client, workspaceId, projectId), changed, await readCalendar(client, workspaceId));
  }

  private async own(client: Db, workspaceId: string, projectId: string, itemId: string, lock = false): Promise<WorkItem> {
    const item = await readItem(client, workspaceId, itemId, lock);
    if (!item || item.projectId !== projectId) throw new NotFoundException("Item not found.");
    return item;
  }

  private async line(client: Db, workspaceId: string, projectId: string, lineId: string) {
    const line = (await client.query<{ id: string; title: string; packageId: string | null }>(
      `SELECT id, title, package_id AS "packageId" FROM project_boq_lines WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND status = 'active'`, [workspaceId, projectId, lineId])).rows[0];
    if (!line) throw new BadRequestException("Choose an item of the project's scope.");
    return line;
  }

  private async packageOf(client: Db, workspaceId: string, projectId: string, value: unknown) {
    if (value === null || value === "") return null;
    const found = (await client.query(`SELECT 1 FROM project_packages WHERE workspace_id = $1 AND project_id = $2 AND id = $3`, [workspaceId, projectId, uuid(value, "Package")])).rowCount;
    if (!found) throw new BadRequestException("Choose one of the project's packages.");
    return value as string;
  }

  private async stageOf(client: Db, workspaceId: string, projectId: string, value: unknown) {
    if (value === null || value === "") return null;
    const found = (await client.query(`SELECT 1 FROM project_stages WHERE workspace_id = $1 AND project_id = $2 AND id = $3`, [workspaceId, projectId, uuid(value, "Stage")])).rowCount;
    if (!found) throw new BadRequestException("Choose one of the project's stages.");
    return value as string;
  }

  /** Someone from the team; they get access to the project if they didn't have it. */
  private async assignee(client: Db, workspaceId: string, projectId: string, value: unknown) {
    const membershipId = uuid(value, "Person");
    if (!(await activeMembers(client, workspaceId)).some((member) => member.membershipId === membershipId)) throw new BadRequestException("Choose someone from your team.");
    await ensureProjectAccess(client, workspaceId, projectId, membershipId);
    return membershipId;
  }

  private async packageName(client: Db, workspaceId: string, id: string | null) {
    return id ? (await client.query<{ name: string }>(`SELECT name FROM project_packages WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0]?.name ?? null : null;
  }

  private async stageName(client: Db, workspaceId: string, id: string | null) {
    return id ? (await client.query<{ name: string }>(`SELECT name FROM project_stages WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0]?.name ?? null : null;
  }

  private async memberName(client: Db, workspaceId: string, membershipId: string) {
    return (await client.query<{ name: string }>(
      `SELECT coalesce(person.display_name, person.primary_email) AS name FROM workspace_memberships membership JOIN users person ON person.id = membership.user_id
        WHERE membership.workspace_id = $1 AND membership.id = $2`, [workspaceId, membershipId])).rows[0]?.name ?? null;
  }

  private async reporter(client: Db, workspaceId: string, item: WorkItem) {
    return membershipOf(client, workspaceId, item.createdBy);
  }
}

type Context = { project: ProjectRow; membershipId: string | null; canEdit: boolean; manager: boolean };

// ---------- pure helpers ----------
function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} is not valid.`);
  return value;
}

function text(value: unknown, max: number, label: string) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new BadRequestException(`${label} is not valid.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new BadRequestException(`${label} is too long (up to ${max} characters).`);
  return trimmed;
}

function date(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} must be a date.`);
  return value;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (!options.includes(value as T)) throw new BadRequestException(`${label} is not valid.`);
  return value as T;
}
