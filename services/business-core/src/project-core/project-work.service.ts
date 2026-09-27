import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { ActorUser, RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { needsNotIn, readNeeds } from "../purchasing/orders";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { activeMembers, ensureSettings, membershipOf, readProject, readTeam, type ProjectRow } from "./project-core.store";
import { noticeWork, type WorkNotice } from "./project-notices";
import {
  ensureProjectAccess, OPEN, readActivity, readInsights, readItem, readItems, readLinks, readOpenWork, readProgress, readProjectLinks, WORK_PRIORITIES, WORK_STATUSES, WORK_TYPES, wouldCycle, workEvent,
  type WorkItem, type WorkStatus,
} from "./project-work";
import { criticalPath, readCalendar, ripple, type PlanMove } from "./work-calendar";
import { ensureWorkTemplates, schedulePackage } from "./work-templates";
import { MISS_REASONS, readSprintDetail, readSprints, type MissReason } from "./project-sprints";

type Db = PoolClient;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SEVERITIES = ["minor", "major", "critical"] as const;
const SNAG_SOURCES = ["internal", "inspection", "delivery", "client", "warranty"] as const;
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
  constructor(private readonly access: WorkspaceAccessService, @Optional() private readonly storage?: BrandAssetStorageService) {}

  /** A photo of a snag before or after it's fixed (up to 10 each); replayed safely by its id. */
  async uploadPhoto(actor: RequestActor, workspaceId: string, projectId: string, itemId: string, photoId: string, kind: string, file?: ReferenceUpload) {
    const prepared = await prepareReferenceUpload(file);
    if (!prepared.mimeType.startsWith("image/")) throw new BadRequestException("Choose a photo (JPG, PNG, WebP or HEIC).");
    const storage = this.storage;
    if (!storage) throw new ConflictException("Photos can't be stored here yet.");
    const photoKind = oneOf(kind, ["before", "after"] as const, "Photo");
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const context = await this.context(client, workspaceId, projectId, user);
      if (!context.canEdit) throw new ConflictException("The project is closed.");
      const item = await this.own(client, workspaceId, projectId, itemId, true);
      if (item.type !== "snag") throw new BadRequestException("Photos before and after are for snags.");
      const id = uuid(photoId, "Photo");
      const existing = (await client.query<{ sha256: string }>(`SELECT sha256 FROM work_item_photos WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
      if (existing && existing.sha256 !== prepared.digest) throw new ConflictException("This upload id belongs to another photo.");
      if (!existing) {
        const count = (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM work_item_photos WHERE workspace_id = $1 AND work_item_id = $2 AND kind = $3`,
          [workspaceId, itemId, photoKind])).rows[0].count;
        if (count >= 10) throw new BadRequestException("A snag takes up to 10 photos before and 10 after.");
        const key = `projects/snags/${workspaceId}/${id}`;
        await storage.put(`${key}/original`, prepared.body, prepared.mimeType);
        if (prepared.preview) await storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
        await client.query(
          `INSERT INTO work_item_photos (id, workspace_id, work_item_id, kind, original_name, mime_type, byte_size, object_key, preview_key, sha256, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [id, workspaceId, itemId, photoKind, prepared.name, prepared.mimeType, prepared.body.length, `${key}/original`, prepared.preview ? `${key}/preview.webp` : null, prepared.digest, user.userId]);
        await workEvent(client, workspaceId, itemId, "photo", { kind: photoKind }, user.userId);
      }
      return this.state(client, workspaceId, context, itemId);
    });
  }

  /** One snag photo (or its preview) for someone on the project. */
  photo(actor: RequestActor, workspaceId: string, projectId: string, photoId: string, preview: boolean) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.context(client, workspaceId, projectId, user);
      const row = (await client.query<{ objectKey: string; previewKey: string | null; mimeType: string }>(
        `SELECT photo.object_key AS "objectKey", photo.preview_key AS "previewKey", photo.mime_type AS "mimeType"
           FROM work_item_photos photo JOIN work_items item ON item.workspace_id = photo.workspace_id AND item.id = photo.work_item_id
          WHERE photo.workspace_id = $1 AND photo.id = $2 AND item.project_id = $3`, [workspaceId, uuid(photoId, "Photo"), projectId])).rows[0];
      if (!row || !this.storage) throw new NotFoundException("Photo not found.");
      const key = preview && row.previewKey ? row.previewKey : row.objectKey;
      const stored = await this.storage.read(key).catch(() => null);
      if (!stored) throw new NotFoundException("Photo not found.");
      return { body: stored.body, contentType: key === row.previewKey ? "image/webp" : row.mimeType };
    });
  }

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

  /** A package's standard work laid out from a start date: what planning it would create. */
  packagePlan(actor: RequestActor, workspaceId: string, projectId: string, packageId: string, startDate?: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const context = await this.context(client, workspaceId, projectId, user);
      return this.layout(client, workspaceId, context, packageId, startDate ? date(startDate, "Start date") : null);
    });
  }

  /** A sprint's burndown and what was missed and why. */
  sprint(actor: RequestActor, workspaceId: string, projectId: string, sprintId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.context(client, workspaceId, projectId, user);
      const detail = await readSprintDetail(client, workspaceId, projectId, sprintId, await readCalendar(client, workspaceId));
      if (!detail) throw new NotFoundException("Sprint not found.");
      return detail;
    });
  }

  /** Open work across projects: the person's own, or (for someone who sees every project) everyone's. */
  open(actor: RequestActor, workspaceId: string, view: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const all = await this.access.hasPermission(client, workspaceId, user.userId, "projects.manage");
      if (!all && !(await this.access.hasPermission(client, workspaceId, user.userId, "projects.view"))) throw new ForbiddenException("You don't have access to projects.");
      const membershipId = await membershipOf(client, workspaceId, user.userId);
      const mine = view !== "all";
      return { items: await readOpenWork(client, workspaceId, membershipId, { all, mine }), me: membershipId, view: mine ? "mine" : "all", canSeeTeam: all };
    });
  }

  /** Workload and how work has gone, per person and in total, for someone who oversees every project. */
  insights(actor: RequestActor, workspaceId: string, period: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      if (!(await this.access.hasPermission(client, workspaceId, user.userId, "projects.manage"))) throw new ForbiddenException("Only people who oversee all projects see the team's work.");
      const days = period === "90" ? 90 : 30;
      const rows = await readInsights(client, workspaceId, await membershipOf(client, workspaceId, user.userId), true, days);
      return { days, total: rows.find((row) => row.total) ?? null, people: rows.filter((row) => !row.total) };
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
      } else if (["create_sprint", "update_sprint", "delete_sprint", "start_sprint", "close_sprint"].includes(action)) {
        if (!context.manager) throw new ForbiddenException("Only the project manager can plan sprints.");
        audit = await this.sprintCommand(client, workspaceId, projectId, action, body, user.userId, notices);
        itemId = null;
      } else if (action === "set_sprint") {
        audit = await this.setSprint(client, workspaceId, projectId, body, user.userId);
        itemId = null;
      } else if (action === "plan_package") {
        const packageId = uuid(body.packageId, "Package");
        await client.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, projectId]);
        const plan = await this.layout(client, workspaceId, context, packageId, body.startDate ? date(body.startDate, "Start date") : null);
        if (plan.planned) throw new ConflictException(`${plan.package.name} is already planned.`);
        if (!plan.tasks.length) throw new ConflictException("This kind of package has no standard tasks yet. Add them in Settings → Projects.");
        let number = (await client.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM work_items WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows[0].next;
        const ids: string[] = [];
        for (const [index, task] of plan.tasks.entries()) {
          const id = randomUUID();
          await client.query(
            `INSERT INTO work_items (id, workspace_id, project_id, number, type, package_id, stage_id, title, assignee_membership_id, start_date, due_date, created_by, template_key, needs_materials)
             VALUES ($1, $2, $3, $4, 'task', $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [id, workspaceId, projectId, number++, packageId, task.stageId, task.title, task.assigneeId, task.startDate, task.dueDate, user.userId, `${plan.package.supply}:${index}`, task.needsMaterials]);
          await workEvent(client, workspaceId, id, "created", { template: plan.package.name }, user.userId);
          if (ids.length) await client.query(`INSERT INTO work_item_links (workspace_id, project_id, predecessor_id, successor_id, kind, lag_days, created_by) VALUES ($1, $2, $3, $4, $5, 0, $6)`,
            [workspaceId, projectId, ids.at(-1), id, task.withPrevious ? "ss" : "fs", user.userId]);
          ids.push(id);
        }
        // One notice per person for the whole package, pointing at their first task.
        const byPerson = new Map<string, Array<{ id: string; dueDate: string }>>();
        plan.tasks.forEach((task, index) => { if (task.assigneeId) byPerson.set(task.assigneeId, [...(byPerson.get(task.assigneeId) ?? []), { id: ids[index], dueDate: task.dueDate }]); });
        for (const [membershipId, mine] of byPerson)
          notices.push({ key: `${packageId}:${membershipId}`, notice: { code: "work.planned", item: { id: mine[0].id, number: 0, title: plan.package.name, dueDate: mine[0].dueDate },
            note: String(mine.length), memberships: [membershipId] } });
        itemId = null;
        audit = { packageId, startDate: plan.startDate, tasks: ids.length };
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
        // Links in a project are added one at a time, so two opposite links can't both pass the loop check.
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('work-links:' || $1::text, 0))`, [projectId]);
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
    if (parent && !OPEN(parent.status)) throw new ConflictException(`#${parent.number} is ${parent.status === "done" ? "done" : "cancelled"}; reopen it to add subtasks.`);
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
    const snag = type === "snag" ? { severity: oneOf(body.severity ?? "minor", SEVERITIES, "Severity"), source: oneOf(body.source ?? "internal", SNAG_SOURCES, "Source"),
      areaId: body.areaId ? await this.area(client, workspaceId, projectId, body.areaId) : null } : null;
    await client.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, projectId]);
    const number = (await client.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM work_items WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows[0].next;
    await client.query(
      `INSERT INTO work_items (id, workspace_id, project_id, number, type, parent_id, package_id, boq_line_id, stage_id, title, description, priority, assignee_membership_id, start_date, due_date, created_by,
                               needs_materials, severity, source, area_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [id, workspaceId, projectId, number, type, parent?.id ?? null, packageId, line?.id ?? null, stageId, title, description, priority, assigneeId, startDate, dueDate, userId,
        body.needsMaterials === true, snag?.severity ?? null, snag?.source ?? null, snag?.areaId ?? null]);
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
    let type = item.type;
    if (body.type !== undefined && body.type !== item.type) {
      if (item.parentId) throw new BadRequestException("A subtask is always a task.");
      type = oneOf(body.type, WORK_TYPES, "Type");
      set("type", type);
      // A snag carries how serious it is and where it came from; other work doesn't.
      if (type === "snag") { set("severity", "minor"); set("source", "internal"); }
      if (item.type === "snag") { set("severity", null); set("source", null); set("area_id", null); set("fixed_by", null); }
      await workEvent(client, workspaceId, itemId, "type", { from: item.type, to: type }, userId);
    }
    if (type === "snag") {
      if (body.severity !== undefined && body.severity !== item.severity) {
        const severity = oneOf(body.severity, SEVERITIES, "Severity");
        set("severity", severity);
        await workEvent(client, workspaceId, itemId, "severity", { from: item.severity, to: severity }, userId);
      }
      if (body.source !== undefined && body.source !== item.source) set("source", oneOf(body.source, SNAG_SOURCES, "Source"));
      if (body.areaId !== undefined) {
        const areaId = body.areaId ? await this.area(client, workspaceId, projectId, body.areaId) : null;
        if (areaId !== item.areaId) set("area_id", areaId);
      }
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
    if (body.needsMaterials !== undefined && Boolean(body.needsMaterials) !== item.needsMaterials) {
      set("needs_materials", body.needsMaterials === true);
      await workEvent(client, workspaceId, itemId, "needs_materials", { to: body.needsMaterials === true }, userId);
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
      // A subtask reopens only under an open parent.
      if (item.parentId && OPEN(status) && !OPEN(item.status)) {
        const parent = await this.own(client, workspaceId, projectId, item.parentId);
        if (!OPEN(parent.status)) throw new ConflictException(`#${parent.number} is ${parent.status === "done" ? "done" : "cancelled"}; reopen it first.`);
      }
      const children = (await client.query<{ id: string; status: WorkStatus; number: number }>(
        `SELECT id, status, number FROM work_items WHERE workspace_id = $1 AND parent_id = $2 FOR UPDATE`, [workspaceId, itemId])).rows.filter((child) => OPEN(child.status));
      if (status === "done" && children.length) throw new ConflictException(children.length === 1 ? "Finish or cancel its open subtask first." : `Finish or cancel its ${children.length} open subtasks first.`);
      if (status === "cancelled") for (const child of children) {
        await client.query(`UPDATE work_items SET status = 'cancelled', version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, child.id]);
        await workEvent(client, workspaceId, child.id, "status", { from: child.status, to: "cancelled", because: item.number }, userId);
      }
      if (type === "snag") {
        // Whoever fixed it marks it ready; someone else closes it, with a photo after.
        if (status === "in_review") set("fixed_by", userId);
        if (status === "done") {
          const fixer = item.fixedBy;
          const assignee = item.assigneeId ? (await client.query<{ userId: string }>(`SELECT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = $2`,
            [workspaceId, item.assigneeId])).rows[0]?.userId : null;
          if (fixer === userId || assignee === userId) throw new ForbiddenException("Someone other than who fixed it closes a snag.");
          const after = (await client.query(`SELECT 1 FROM work_item_photos WHERE workspace_id = $1 AND work_item_id = $2 AND kind = 'after' LIMIT 1`, [workspaceId, itemId])).rowCount;
          if (!after) throw new ConflictException("Add a photo of it fixed before closing it.");
        }
        if (item.status === "done" && OPEN(status)) {
          const reason = text(body.reason, 500, "Reason");
          if (!reason) throw new BadRequestException("Say why the snag is open again.");
          set("fixed_by", null);
          await workEvent(client, workspaceId, itemId, "reopened", { reason }, userId);
          if (item.assigneeId) notices.push({ key: `reopen:${itemId}:${item.version}`, notice: { code: "work.snag_reopened", item, note: reason, memberships: [item.assigneeId] } });
        }
        if (status === "in_review") {
          const checkers = ((await readTeam(client, workspaceId, [projectId])).get(projectId) ?? []).filter((member) => member.lead).map((member) => member.membershipId);
          const raiser = await this.reporter(client, workspaceId, item);
          notices.push({ key: `ready:${itemId}:${item.version}`, notice: { code: "work.snag_ready", item, note: "", memberships: [...checkers, ...(raiser ? [raiser] : [])] } });
        }
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
    const packages = await client.query<{ id: string; name: string; supply: string; planned: boolean }>(
      `SELECT package.id, package.name, package.supply,
              EXISTS (SELECT 1 FROM work_items item WHERE item.workspace_id = package.workspace_id AND item.package_id = package.id AND item.template_key IS NOT NULL) AS planned
         FROM project_packages package WHERE package.workspace_id = $1 AND package.project_id = $2 ORDER BY package.position, package.name`, [workspaceId, project.id]);
    const stages = await client.query<{ id: string; name: string; status: string }>(`SELECT id, name, status FROM project_stages WHERE workspace_id = $1 AND project_id = $2 ORDER BY position`, [workspaceId, project.id]);
    const lines = await client.query<{ id: string; title: string; areaName: string | null; packageId: string | null }>(
      `SELECT line.id, line.title, room.name AS "areaName", line.package_id AS "packageId" FROM project_boq_lines line
         LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = $3 AND room.id = line.area_id
        WHERE line.workspace_id = $1 AND line.project_id = $2 AND line.status = 'active' ORDER BY line.position`, [workspaceId, project.id, project.caseId]);
    const calendar = await readCalendar(client, workspaceId);
    const path = criticalPath(items, await readProjectLinks(client, workspaceId, project.id), calendar);
    const baseline = (await client.query<{ at: string | null; byName: string | null }>(
      `SELECT project.plan_baseline_at AS at, person.display_name AS "byName" FROM delivery_projects project LEFT JOIN users person ON person.id = project.plan_baseline_by
        WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, project.id])).rows[0];
    return {
      items, packages: packages.rows, stages: stages.rows, lines: lines.rows,
      people: context.canEdit ? await activeMembers(client, workspaceId) : [],
      sprints: await readSprints(client, workspaceId, project.id),
      me: context.membershipId, canEdit: context.canEdit, canManage: context.manager && context.canEdit,
      calendar, promiseDate: project.promiseDate, startDate: project.startDate,
      // Working days each open item can slip before the plan's finish moves; none or less is the critical path.
      critical: { finish: path.finish, float: Object.fromEntries(path.float) },
      progress: await readProgress(client, workspaceId, project.id),
      materials: await this.materialsWaiting(client, workspaceId, project.id, items),
      // The project's areas, for where a snag is.
      areas: (await client.query<{ id: string; name: string }>(`SELECT id, name FROM pre_project_rooms WHERE workspace_id = $1 AND case_id = $2 ORDER BY name`,
        [workspaceId, project.caseId])).rows,
      baseline: baseline?.at ? baseline : null,
      item: itemId ? await this.detail(client, workspaceId, project.id, itemId) : null,
    };
  }

  /**
   * For each open piece of work that needs its package's materials: those not in yet (received on orders
   * or given from stock, short of what's needed). A material used nowhere in particular counts for every package.
   */
  private async materialsWaiting(client: Db, workspaceId: string, projectId: string, items: WorkItem[]) {
    const needing = items.filter((item) => item.needsMaterials && OPEN(item.status));
    if (!needing.length) return {};
    const needs = await readNeeds(client, workspaceId, false, projectId);
    return Object.fromEntries(needing.map((item) => [item.id, needsNotIn(needs, item.packageId).map((need) => need.title)]).filter(([, titles]) => titles.length));
  }

  private async detail(client: Db, workspaceId: string, projectId: string, itemId: string) {
    const item = await this.own(client, workspaceId, projectId, itemId);
    const subtasks = await client.query<{ id: string }>(`SELECT id FROM work_items WHERE workspace_id = $1 AND parent_id = $2 ORDER BY number`, [workspaceId, itemId]);
    const links = await readLinks(client, workspaceId, itemId);
    const activity = await readActivity(client, workspaceId, itemId);
    const extra = await client.query<{ description: string; createdByName: string; createdAt: string; startedAt: string | null }>(
      `SELECT item.description, creator.display_name AS "createdByName", item.created_at AS "createdAt", item.started_at AS "startedAt"
         FROM work_items item JOIN users creator ON creator.id = item.created_by WHERE item.workspace_id = $1 AND item.id = $2`, [workspaceId, itemId]);
    const photos = (await client.query<{ id: string; kind: "before" | "after"; name: string; byName: string; at: string }>(
      `SELECT photo.id, photo.kind, photo.original_name AS name, person.display_name AS "byName", photo.created_at AS at
         FROM work_item_photos photo JOIN users person ON person.id = photo.created_by WHERE photo.workspace_id = $1 AND photo.work_item_id = $2 ORDER BY photo.created_at`,
      [workspaceId, itemId])).rows;
    return { ...item, ...extra.rows[0], subtaskIds: subtasks.rows.map((row) => row.id), before: links.before, after: links.after, activity, photos };
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

  private async sprintCommand(client: Db, workspaceId: string, projectId: string, action: string, body: Record<string, unknown>, userId: string, notices: Array<{ key: string; notice: WorkNotice }>) {
    if (action === "create_sprint") {
      const id = uuid(body.id, "Sprint");
      if ((await client.query(`SELECT 1 FROM work_sprints WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rowCount) return { sprintId: id };
      const startDate = date(body.startDate, "Start date");
      const endDate = date(body.endDate, "End date");
      if (!startDate || !endDate) throw new BadRequestException("Give the sprint a start and an end.");
      if (endDate < startDate) throw new BadRequestException("The sprint can't end before it starts.");
      await client.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, projectId]);
      const number = (await client.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM work_sprints WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows[0].next;
      const name = text(body.name, 120, "Name") || `Sprint ${number}`;
      await client.query(`INSERT INTO work_sprints (id, workspace_id, project_id, number, name, goal, start_date, end_date, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, workspaceId, projectId, number, name, text(body.goal, 500, "Goal"), startDate, endDate, userId]);
      return { sprintId: id, name, startDate, endDate };
    }
    const sprintId = uuid(body.sprintId, "Sprint");
    const sprint = (await client.query<{ name: string; goal: string; status: string; version: number; startDate: string; endDate: string }>(
      `SELECT name, goal, status, version, start_date::text AS "startDate", end_date::text AS "endDate" FROM work_sprints WHERE workspace_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`,
      [workspaceId, projectId, sprintId])).rows[0];
    if (!sprint) throw new NotFoundException("Sprint not found.");
    if (body.version !== sprint.version) throw new ConflictException("Someone else changed this sprint. Reload to see their changes.");
    const bump = () => client.query(`UPDATE work_sprints SET version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, sprintId]);
    if (action === "update_sprint") {
      if (sprint.status === "closed") throw new ConflictException("The sprint is closed.");
      const name = body.name === undefined ? sprint.name : text(body.name, 120, "Name");
      if (!name) throw new BadRequestException("Name the sprint.");
      const startDate = body.startDate === undefined ? sprint.startDate : date(body.startDate, "Start date");
      const endDate = body.endDate === undefined ? sprint.endDate : date(body.endDate, "End date");
      if (!startDate || !endDate) throw new BadRequestException("Give the sprint a start and an end.");
      if (sprint.status === "active" && startDate !== sprint.startDate) throw new ConflictException("A running sprint keeps its start date.");
      if (endDate < startDate) throw new BadRequestException("The sprint can't end before it starts.");
      const goal = body.goal === undefined ? sprint.goal : text(body.goal, 500, "Goal");
      await client.query(`UPDATE work_sprints SET name = $3, goal = $4, start_date = $5, end_date = $6 WHERE workspace_id = $1 AND id = $2`, [workspaceId, sprintId, name, goal, startDate, endDate]);
      await bump();
      return { sprintId, name, goal, startDate, endDate };
    }
    if (action === "delete_sprint") {
      if (sprint.status !== "planned") throw new ConflictException("Only a sprint that hasn't started can be deleted.");
      const moved = (await client.query(`UPDATE work_items SET sprint_id = NULL, updated_at = now() WHERE workspace_id = $1 AND sprint_id = $2`, [workspaceId, sprintId])).rowCount;
      await client.query(`DELETE FROM work_sprints WHERE workspace_id = $1 AND id = $2`, [workspaceId, sprintId]);
      return { sprintId, name: sprint.name, backToBacklog: moved };
    }
    const team = ((await readTeam(client, workspaceId, [projectId])).get(projectId) ?? []).map((member) => member.membershipId);
    if (action === "start_sprint") {
      if (sprint.status !== "planned") throw new ConflictException("This sprint has already started.");
      if ((await client.query(`SELECT 1 FROM work_sprints WHERE workspace_id = $1 AND project_id = $2 AND status = 'active'`, [workspaceId, projectId])).rowCount)
        throw new ConflictException("Close the running sprint first.");
      const committed = (await client.query(
        `INSERT INTO work_sprint_commitments (workspace_id, sprint_id, item_id)
         SELECT workspace_id, $2, id FROM work_items WHERE workspace_id = $1 AND sprint_id = $2 AND status NOT IN ('done', 'cancelled')`, [workspaceId, sprintId])).rowCount ?? 0;
      if (!committed) throw new ConflictException("Add work to the sprint first.");
      await client.query(`UPDATE work_sprints SET status = 'active', started_at = now(), started_by = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, sprintId, userId]);
      await bump();
      notices.push({ key: `start:${sprintId}`, notice: { code: "work.sprint_started", item: { id: sprintId, number: 0, title: sprint.name },
        note: sprint.goal || (committed === 1 ? "1 committed item" : `${committed} committed items`), memberships: team } });
      return { sprintId, committed };
    }
    // close_sprint: every unfinished commitment says why; unfinished work moves on.
    if (sprint.status !== "active") throw new ConflictException("Only a running sprint can be closed.");
    const moveTo = body.moveTo === null || body.moveTo === undefined || body.moveTo === "" ? null : uuid(body.moveTo, "Sprint");
    if (moveTo) {
      const target = (await client.query<{ status: string }>(`SELECT status FROM work_sprints WHERE workspace_id = $1 AND project_id = $2 AND id = $3`, [workspaceId, projectId, moveTo])).rows[0];
      if (!target || target.status !== "planned") throw new BadRequestException("Move unfinished work to a sprint that hasn't started, or to the backlog.");
    }
    const reasons = (body.reasons ?? {}) as Record<string, { reason?: unknown; note?: unknown }>;
    const open = (await client.query<{ itemId: string; number: number; done: boolean }>(
      `SELECT commitment.item_id AS "itemId", item.number, item.status = 'done' AS done FROM work_sprint_commitments commitment
         JOIN work_items item ON item.workspace_id = commitment.workspace_id AND item.id = commitment.item_id
        WHERE commitment.workspace_id = $1 AND commitment.sprint_id = $2 AND commitment.outcome = 'open'`, [workspaceId, sprintId])).rows;
    // Every reason is checked before anything is written.
    const missed = open.filter((row) => !row.done).map((row) => {
      const given = reasons[row.itemId];
      if (!given || !MISS_REASONS.includes(given.reason as MissReason)) throw new BadRequestException(`Say why #${row.number} wasn't finished.`);
      return { itemId: row.itemId, reason: given.reason as MissReason, note: text(given.note, 500, "Note") };
    });
    const done = open.length - missed.length;
    await client.query(`UPDATE work_sprint_commitments SET outcome = 'done', decided_at = now() WHERE workspace_id = $1 AND sprint_id = $2 AND item_id = ANY($3::uuid[])`,
      [workspaceId, sprintId, open.filter((row) => row.done).map((row) => row.itemId)]);
    for (const row of missed)
      await client.query(`UPDATE work_sprint_commitments SET outcome = 'missed', reason = $4, note = $5, decided_at = now() WHERE workspace_id = $1 AND sprint_id = $2 AND item_id = $3`,
        [workspaceId, sprintId, row.itemId, row.reason, row.note]);
    const carried = (await client.query(`UPDATE work_items SET sprint_id = $3, updated_at = now() WHERE workspace_id = $1 AND sprint_id = $2 AND status NOT IN ('done', 'cancelled')`,
      [workspaceId, sprintId, moveTo])).rowCount ?? 0;
    await client.query(`UPDATE work_sprints SET status = 'closed', closed_at = now(), closed_by = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, sprintId, userId]);
    await bump();
    notices.push({ key: `close:${sprintId}`, notice: { code: "work.sprint_closed", item: { id: sprintId, number: 0, title: sprint.name },
      note: `${done} of ${open.length} committed items done.`, memberships: team } });
    return { sprintId, done, missed: open.length - done, carried, moveTo };
  }

  /** Puts tasks and issues in a sprint (or back in the backlog); taking one out of a running sprint marks its commitment removed. */
  private async setSprint(client: Db, workspaceId: string, projectId: string, body: Record<string, unknown>, userId: string) {
    const ids = Array.isArray(body.itemIds) ? [...new Set(body.itemIds.map((id) => uuid(id, "Item")))] : [];
    if (!ids.length || ids.length > 200) throw new BadRequestException("Choose up to 200 items.");
    const sprintId = body.sprintId === null || body.sprintId === "" || body.sprintId === undefined ? null : uuid(body.sprintId, "Sprint");
    const target = sprintId ? (await client.query<{ name: string; status: string }>(`SELECT name, status FROM work_sprints WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
      [workspaceId, projectId, sprintId])).rows[0] : null;
    if (sprintId && (!target || target.status === "closed")) throw new BadRequestException("Choose a sprint that isn't closed.");
    const items = (await client.query<{ id: string; number: number; parentId: string | null; sprintId: string | null }>(
      `SELECT id, number, parent_id AS "parentId", sprint_id AS "sprintId" FROM work_items WHERE workspace_id = $1 AND project_id = $2 AND id = ANY($3::uuid[]) FOR UPDATE`,
      [workspaceId, projectId, ids])).rows;
    if (items.length !== ids.length) throw new NotFoundException("Item not found.");
    const subtask = items.find((item) => item.parentId);
    if (subtask) throw new BadRequestException(`#${subtask.number} is a subtask; it goes with its task.`);
    let moved = 0;
    for (const item of items) {
      if (item.sprintId === sprintId) continue;
      if (item.sprintId) await client.query(`UPDATE work_sprint_commitments SET outcome = 'removed', decided_at = now() WHERE workspace_id = $1 AND sprint_id = $2 AND item_id = $3 AND outcome = 'open'`,
        [workspaceId, item.sprintId, item.id]);
      await client.query(`UPDATE work_items SET sprint_id = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, item.id, sprintId]);
      await workEvent(client, workspaceId, item.id, "sprint", { name: target?.name ?? null }, userId);
      moved++;
    }
    return { sprintId, moved };
  }

  /** The package's template scheduled on working days, with who does each task and its stage. */
  private async layout(client: Db, workspaceId: string, context: Context, packageId: string, requested: string | null) {
    const pkg = (await client.query<{ id: string; name: string; supply: "make" | "buy" | "ready_made" | "subcontract" | "client" | "site_work" }>(
      `SELECT id, name, supply FROM project_packages WHERE workspace_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`, [workspaceId, context.project.id, packageId])).rows[0];
    if (!pkg) throw new NotFoundException("Package not found.");
    const settings = await ensureSettings(client, workspaceId);
    const template = (await ensureWorkTemplates(client, workspaceId, settings.roles)).find((item) => item.supply === pkg.supply)!;
    const planned = Boolean((await client.query(`SELECT 1 FROM work_items WHERE workspace_id = $1 AND package_id = $2 AND template_key IS NOT NULL LIMIT 1`, [workspaceId, packageId])).rowCount);
    const today = (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(default_timezone, 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
    const startDate = requested ?? (context.project.startDate && context.project.startDate > today ? context.project.startDate : today);
    const team = (await readTeam(client, workspaceId, [context.project.id])).get(context.project.id) ?? [];
    const stages = (await client.query<{ id: string; key: string; name: string }>(`SELECT id, key, name FROM project_stages WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, context.project.id])).rows;
    const tasks = schedulePackage(template.tasks, startDate, await readCalendar(client, workspaceId)).map((task) => {
      const member = task.role ? team.find((item) => item.roles.includes(task.role!)) : undefined;
      const stage = task.stage ? stages.find((item) => item.key === task.stage) : undefined;
      return { title: task.title, days: task.days, withPrevious: task.withPrevious, needsMaterials: task.needsMaterials === true, startDate: task.startDate, dueDate: task.dueDate,
        role: task.role, roleLabel: settings.roles.find((role) => role.key === task.role)?.label ?? null,
        assigneeId: member?.membershipId ?? null, assigneeName: member?.name ?? null, stageId: stage?.id ?? null, stageName: stage?.name ?? null };
    });
    return { package: pkg, startDate, planned, tasks };
  }

  private async ripple(client: Db, workspaceId: string, projectId: string, changed: { id: string; startDate: string | null; dueDate: string | null }) {
    return ripple(await readItems(client, workspaceId, projectId), await readProjectLinks(client, workspaceId, projectId), changed, await readCalendar(client, workspaceId));
  }

  /** An area of the project (a room of its planning record). */
  private async area(client: Db, workspaceId: string, projectId: string, value: unknown) {
    const id = uuid(value, "Area");
    const found = (await client.query(
      `SELECT 1 FROM pre_project_rooms room JOIN delivery_projects project ON project.workspace_id = room.workspace_id AND project.case_id = room.case_id
        WHERE room.workspace_id = $1 AND project.id = $2 AND room.id = $3`, [workspaceId, projectId, id])).rowCount;
    if (!found) throw new BadRequestException("Choose one of the project's areas.");
    return id;
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
