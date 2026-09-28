import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { ActorUser, RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { tellClients } from "../client-portal/portal-notices";
import { Dec } from "../catalog-core/decimal";
import { acceptedQuoteValue } from "../commercial/commercial.domain";
import { commercialRepository } from "../commercial/commercial-repository";
import type { CommercialData } from "../commercial/commercial.types";
import { financeGatePaymentsReady } from "../commercial/release-integrity";
import { canonicalHash } from "../crm/shared/crm-types";
import { acceptedScope } from "../quotation/quotation-builder.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { HARD_CHECKS, LEAD_ROLE, parseRoles, parseStages } from "./project-checks";
import {
  activeMembers, ensureSettings, ensureTemplates, evaluateStages, membershipOf, readProject, readProjects, readStages, readTeam,
  readTemplates, setRole, writeTemplate, type ProjectRow, type StageRow, type TeamMember,
} from "./project-core.store";
import { tellScopeChanges } from "../factory/factory-changes";
import { closeOutBlockers, readCloseOut, settleCloseOut } from "./project-closeout";
import { readProgress } from "./project-work";
import { noticeProject, type ProjectNotice } from "./project-notices";
import { deleteMaterial, readMaterials, recordMaterialDecision, saveMaterial, sendMaterials, suggestMaterials } from "./project-materials";
import { applyVariation, assignLines, deletePackage, lineHistory, proposePackages, readScope, savePackage, SUPPLY, type Supply } from "./project-scope";
import { ensureWorkTemplates, parseTemplateTasks } from "./work-templates";
import { readReadyCases, readStartState, startProject } from "./project-start";
import { moneyAccess } from "./project-access";
import { decideClientUpdate } from "./client-updates";
import { tellBuyersOverOrdered } from "./variation-orders";
import { holdLength, shiftForHold } from "./project-hold";
import { noticeStageReady } from "./project-stage-watch";
import { partyOfCase, recordClientMessageSkipped, sendClientEvent } from "../crm/conversations/inbox/client-messages";

type Db = PoolClient;
const SETTINGS = ["workspace.settings.manage"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIORITIES = ["normal", "high", "critical"] as const;
const HEALTH = ["on_track", "at_risk", "off_track"] as const;

/**
 * Projects (plan §6.10). A project starts only from an accepted quotation once the firm's start rules
 * pass; its scope is sealed there and never changes (a change is a variation). The project page shows
 * the stages with what each needs to finish, the team by role, and the lead's status updates.
 */
@Injectable()
export class ProjectCoreService {
  constructor(private readonly access: WorkspaceAccessService) {}

  // ---------- settings ----------
  settings(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const settings = await ensureSettings(client, workspaceId);
      return {
        settings,
        templates: await ensureTemplates(client, workspaceId, user.userId),
        workTemplates: await ensureWorkTemplates(client, workspaceId, settings.roles),
        canManage: await this.any(client, workspaceId, user.userId, SETTINGS),
      };
    });
  }

  /** The standard work for one way of delivering a package. */
  saveWorkTemplate(actor: RequestActor, workspaceId: string, supply: string, body: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, SETTINGS, async (client, user) => {
      if (!SUPPLY.includes(supply as Supply)) throw new NotFoundException("Template not found.");
      const settings = await ensureSettings(client, workspaceId);
      const current = (await ensureWorkTemplates(client, workspaceId, settings.roles)).find((item) => item.supply === supply)!;
      if (body.version !== current.version) throw new ConflictException("Someone else changed this template. Reload to see their changes.");
      const tasks = parseTemplateTasks(body.tasks, settings.roles);
      await client.query(`UPDATE work_templates SET tasks = $3::jsonb, version = version + 1, updated_by = $4, updated_at = now() WHERE workspace_id = $1 AND supply = $2`,
        [workspaceId, supply, JSON.stringify(tasks), user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "project.work_template_changed", entityType: "work_template", entityId: workspaceId, before: current, after: { supply, tasks } });
      return { settings, templates: await readTemplates(client, workspaceId), workTemplates: await ensureWorkTemplates(client, workspaceId, settings.roles), canManage: true };
    });
  }

  saveSettings(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, SETTINGS, async (client, user) => {
      const current = await ensureSettings(client, workspaceId);
      if (body.version !== current.version) throw new ConflictException("Someone else changed these settings. Reload to see their changes.");
      const roles = body.roles === undefined ? current.roles : parseRoles(body.roles);
      const removed = current.roles.filter((role) => !roles.some((next) => next.key === role.key)).map((role) => role.key);
      if (removed.length) {
        const used = (await client.query(`SELECT 1 FROM project_template_stages stage JOIN project_templates template ON template.workspace_id = stage.workspace_id AND template.id = stage.template_id
          WHERE stage.workspace_id = $1 AND template.status = 'active' AND (stage.owner_role = ANY($2::varchar[]) OR EXISTS (SELECT 1 FROM jsonb_array_elements(stage.checks) item WHERE item->>'role' = ANY($2::varchar[]))) LIMIT 1`,
          [workspaceId, removed])).rowCount;
        if (used) throw new ConflictException("A stage still uses a role you removed. Change the stage first.");
        const inTemplate = (await client.query(`SELECT 1 FROM work_templates template, jsonb_array_elements(template.tasks) item WHERE template.workspace_id = $1 AND item->>'role' = ANY($2::varchar[]) LIMIT 1`,
          [workspaceId, removed])).rowCount;
        if (inTemplate) throw new ConflictException("A task template still uses a role you removed. Change the template first.");
      }
      const prefix = body.referencePrefix === undefined ? current.referencePrefix : String(body.referencePrefix).trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9]{0,11}$/.test(prefix)) throw new BadRequestException("Use up to 12 letters or digits for the project number, starting with a letter.");
      const flag = (key: "requireAgreement" | "requirePayment" | "requireApproval" | "requireVariationPayment") => (body[key] === undefined ? current[key] : body[key] === true);
      await client.query(
        `UPDATE workspace_project_settings SET require_agreement = $2, require_payment = $3, require_approval = $4, reference_prefix = $5, roles = $6::jsonb,
                require_variation_payment = $8, version = version + 1, updated_by = $7, updated_at = now() WHERE workspace_id = $1`,
        [workspaceId, flag("requireAgreement"), flag("requirePayment"), flag("requireApproval"), prefix, JSON.stringify(roles), user.userId, flag("requireVariationPayment")]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "project.settings_changed", entityType: "workspace_project_settings", entityId: workspaceId, before: current, after: { ...body, roles } });
      const saved = await ensureSettings(client, workspaceId);
      return { settings: saved, templates: await readTemplates(client, workspaceId), workTemplates: await ensureWorkTemplates(client, workspaceId, saved.roles), canManage: true };
    });
  }

  saveTemplate(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, SETTINGS, async (client, user) => {
      const settings = await ensureSettings(client, workspaceId);
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : "";
      if (!name) throw new BadRequestException("Name the route.");
      const stages = parseStages(body.stages, settings.roles);
      const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
      if (id) {
        const current = (await client.query<{ version: number }>(`SELECT version FROM project_templates WHERE workspace_id = $1 AND id = $2 AND status = 'active' FOR UPDATE`, [workspaceId, id])).rows[0];
        if (!current) throw new NotFoundException("Route not found.");
        if (body.version !== current.version) throw new ConflictException("Someone else changed this route. Reload to see their changes.");
      }
      const duplicate = (await client.query(`SELECT 1 FROM project_templates WHERE workspace_id = $1 AND status = 'active' AND lower(name) = lower($2) AND id IS DISTINCT FROM $3::uuid`, [workspaceId, name, id])).rowCount;
      if (duplicate) throw new ConflictException("Another route has this name.");
      const templateId = id ?? randomUUID();
      await writeTemplate(client, workspaceId, templateId, name, body.isDefault === true, stages, user.userId, !id);
      const defaults = (await client.query(`SELECT 1 FROM project_templates WHERE workspace_id = $1 AND is_default`, [workspaceId])).rowCount;
      if (!defaults) await client.query(`UPDATE project_templates SET is_default = true WHERE workspace_id = $1 AND id = $2`, [workspaceId, templateId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: id ? "project.route_changed" : "project.route_created", entityType: "project_template", entityId: templateId, after: { name, stages } });
      return { settings, templates: await readTemplates(client, workspaceId), workTemplates: await ensureWorkTemplates(client, workspaceId, settings.roles), canManage: true };
    });
  }

  archiveTemplate(actor: RequestActor, workspaceId: string, templateId: string) {
    return this.access.withAnyPermission(actor, workspaceId, SETTINGS, async (client, user) => {
      const template = (await client.query<{ isDefault: boolean }>(`SELECT is_default AS "isDefault" FROM project_templates WHERE workspace_id = $1 AND id = $2 AND status = 'active' FOR UPDATE`, [workspaceId, templateId])).rows[0];
      if (!template) throw new NotFoundException("Route not found.");
      if (template.isDefault) throw new ConflictException("Make another route the default first.");
      await client.query(`UPDATE project_templates SET status = 'archived', updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, templateId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "project.route_archived", entityType: "project_template", entityId: templateId });
      const settings = await ensureSettings(client, workspaceId);
      return { settings, templates: await readTemplates(client, workspaceId), workTemplates: await ensureWorkTemplates(client, workspaceId, settings.roles), canManage: true };
    });
  }

  // ---------- start ----------
  /** What starting a project from this case needs, and whether it can start now. */
  startState(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.asMember(actor, workspaceId, (client, user) => readStartState(client, this.access, workspaceId, caseId, user));
  }

  /** Accepted quotations whose project hasn't started yet, for the Projects page's "Start project". */
  ready(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, (client, user) => readReadyCases(client, this.access, workspaceId, user));
  }

  /** Starts the project from the accepted quotation; starting twice returns the same project. */
  start(actor: RequestActor, workspaceId: string, caseId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "projects.manage", (client, user) => startProject(client, this.access, workspaceId, caseId, body, user));
  }

  // ---------- read ----------
  list(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const { all } = await this.viewer(client, workspaceId, user);
      const membershipId = await membershipOf(client, workspaceId, user.userId);
      const projects = await readProjects(client, workspaceId, membershipId, all);
      const ids = projects.map((project) => project.id);
      const teams = await readTeam(client, workspaceId, ids);
      const stages = await readStages(client, workspaceId, ids);
      const settings = await ensureSettings(client, workspaceId);
      const rows = [];
      for (const project of projects) {
        const mine = stages.filter((stage) => stage.projectId === project.id);
        const team = teams.get(project.id) ?? [];
        const current = mine.find((stage) => stage.status === "current");
        const evaluated = current ? (await evaluateStages(client, workspaceId, project, [current], team))[0] : null;
        rows.push({
          ...summary(project),
          stage: current ? { name: current.name, position: current.position + 1, count: mine.length } : null,
          lead: team.find((member) => member.lead)?.name ?? null,
          next: evaluated ? nextStep(evaluated, settings.roles) : null,
        });
      }
      return { projects: rows, canStart: all };
    });
  }

  get(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => this.detail(client, workspaceId, projectId, user));
  }

  /** The live BOQ, its packages and the sealed documents it comes from. */
  scope(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const { all, membershipId, project } = await this.visible(client, workspaceId, projectId, user);
      const team = (await readTeam(client, workspaceId, [projectId])).get(projectId) ?? [];
      const manager = all || team.some((member) => member.membershipId === membershipId && member.lead);
      return { ...(await readScope(client, workspaceId, projectId)), currency: project.currency, version: project.version, caseId: project.caseId, baselineQuoteId: project.quoteId,
        canManage: manager && ["active", "on_hold"].includes(project.status), members: manager ? await activeMembers(client, workspaceId) : [] };
    });
  }

  /** One sealed document exactly as the client accepted it, with a fresh check that it's untouched. */
  seal(actor: RequestActor, workspaceId: string, projectId: string, sealId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.visible(client, workspaceId, projectId, user);
      const seal = (await client.query<{ snapshot: Record<string, unknown>; contentHash: string; sealedAt: string; sealedBy: string; kind: string }>(
        `SELECT seal.snapshot, seal.content_hash AS "contentHash", seal.sealed_at AS "sealedAt", sealer.display_name AS "sealedBy", seal.kind
           FROM project_scope_seals seal JOIN users sealer ON sealer.id = seal.sealed_by
          WHERE seal.workspace_id = $1 AND seal.project_id = $2 AND seal.id = $3`, [workspaceId, projectId, sealId])).rows[0];
      if (!seal) throw new NotFoundException("Sealed document not found.");
      return { ...seal, intact: canonicalHash(seal.snapshot) === seal.contentHash };
    });
  }

  /** The material list, where each material is used, and what the client decided. */
  materials(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const { project, all, membershipId } = await this.visible(client, workspaceId, projectId, user);
      const team = (await readTeam(client, workspaceId, [projectId])).get(projectId) ?? [];
      const onTeam = all || team.some((member) => member.membershipId === membershipId);
      return { ...(await readMaterials(client, workspaceId, projectId)), version: project.version, canEdit: onTeam && ["active", "on_hold"].includes(project.status) };
    });
  }

  /** A line's history: agreed, changed by variations, packaged, signed off… */
  line(actor: RequestActor, workspaceId: string, projectId: string, lineId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.visible(client, workspaceId, projectId, user);
      return { history: await lineHistory(client, workspaceId, projectId, lineId) };
    });
  }

  /** What closing the project would need settled first, and what it would do by itself. */
  closeOut(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const { all } = await this.visible(client, workspaceId, projectId, user);
      if (!all) throw new ForbiddenException("Only people who manage projects can close one.");
      const closeOut = await readCloseOut(client, workspaceId, projectId);
      return { ...closeOut, blockers: closeOutBlockers(closeOut, false) };
    });
  }

  // ---------- commands ----------
  command(actor: RequestActor, workspaceId: string, projectId: string, body: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const project = await readProject(client, workspaceId, projectId, true);
      if (!project) throw new NotFoundException("Project not found.");
      const { all } = await this.viewer(client, workspaceId, user);
      const membershipId = await membershipOf(client, workspaceId, user.userId);
      const team = (await readTeam(client, workspaceId, [projectId])).get(projectId) ?? [];
      const manager = all || team.some((member) => member.membershipId === membershipId && member.lead);
      if (!manager && !team.some((member) => member.membershipId === membershipId)) throw new NotFoundException("Project not found.");
      if (body.version !== project.version) throw new ConflictException("Someone else changed this project. Reload to see their changes.");
      const settings = await ensureSettings(client, workspaceId);
      const action = String(body.action ?? "");
      const needManager = () => { if (!manager) throw new ForbiddenException("Only the project manager can do this."); };
      const running = () => { if (project.status !== "active") throw new ConflictException(project.status === "on_hold" ? "The project is on hold. Resume it first." : "The project is closed."); };
      // A completed or cancelled project is a record: its details, team and status don't change any more.
      const open = () => { if (!["active", "on_hold"].includes(project.status)) throw new ConflictException("The project is closed."); };
      const notices: Array<{ key: string; notice: ProjectNotice }> = [];
      const teamIds = () => team.map((member) => member.membershipId);
      let audit: Record<string, unknown> = {};

      if (action === "rename") {
        needManager(); open();
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name || name.length > 240) throw new BadRequestException("Name the project.");
        await client.query(`UPDATE delivery_projects SET name = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId, name]);
        audit = { name };
      } else if (action === "set_priority") {
        needManager(); open();
        const priority = oneOf(body.priority, PRIORITIES, "Priority");
        await client.query(`UPDATE delivery_projects SET priority = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId, priority]);
        audit = { priority };
      } else if (action === "set_dates") {
        needManager(); open();
        const startDate = body.startDate === undefined ? project.startDate : optionalDate(body.startDate, "Start date");
        const promiseDate = body.promiseDate === undefined ? project.promiseDate : optionalDate(body.promiseDate, "Handover date");
        if (startDate && promiseDate && promiseDate < startDate) throw new BadRequestException("The handover date can't be before the start date.");
        await client.query(`UPDATE delivery_projects SET start_date = $3, promise_date = $4 WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId, startDate, promiseDate]);
        audit = { startDate, promiseDate };
      } else if (action === "set_member") {
        needManager(); open();
        const role = settings.roles.find((item) => item.key === body.role);
        if (!role) throw new BadRequestException("Choose a role.");
        const next = body.membershipId === null || body.membershipId === "" ? null : String(body.membershipId);
        if (role.key === LEAD_ROLE && !next) throw new BadRequestException("A project always has a project manager.");
        if (next && !(await activeMembers(client, workspaceId)).some((member) => member.membershipId === next)) throw new BadRequestException("Choose someone from your team.");
        const holder = team.find((member) => member.roles.includes(role.key))?.membershipId ?? null;
        if (holder === next) return this.detail(client, workspaceId, projectId, user);
        await setRole(client, workspaceId, projectId, role.key, next);
        if (next) notices.push({ key: `role:${role.key}:${next}:${project.version}`, notice: { code: "project.team_added", membershipId: next, role: role.label } });
        audit = { role: role.key, from: holder, to: next };
      } else if (action === "post_update") {
        needManager(); open();
        const health = oneOf(body.health, HEALTH, "Status");
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
        if (health !== "on_track" && !note) throw new BadRequestException("Say in one line what's wrong.");
        // Shared with the client on purpose: its words only (never the status), and only when there are words.
        const share = body.shareWithClient === true;
        if (share && !note) throw new BadRequestException("Write what the client should read.");
        const updateId = randomUUID();
        await client.query(`INSERT INTO project_status_updates (id, workspace_id, project_id, health, note, created_by, shared_at, shared_by)
          VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::boolean THEN now() END, CASE WHEN $7::boolean THEN $6::uuid END)`,
          [updateId, workspaceId, projectId, health, note, user.userId, share]);
        await client.query(`UPDATE delivery_projects SET health = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId, health]);
        if (health === "off_track" && project.health !== "off_track") notices.push({ key: `off:${project.version}`, notice: { code: "project.off_track", note, memberships: teamIds() } });
        if (share) await tellClients(client, { workspaceId, caseId: project.caseId, event: "update_published", recordId: updateId, title: project.name, note });
        audit = { health, note, shared: share };
      } else if (action === "share_update") {
        needManager();
        const update = (await client.query<{ id: string; note: string; sharedAt: string | null }>(
          `SELECT id, note, shared_at AS "sharedAt" FROM project_status_updates WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
          [workspaceId, projectId, typeof body.updateId === "string" && /^[0-9a-f-]{36}$/i.test(body.updateId) ? body.updateId : null])).rows[0];
        if (!update) throw new NotFoundException("Update not found.");
        const share = body.shared === true;
        if (share && !update.note.trim()) throw new BadRequestException("An update without words has nothing for the client to read.");
        await client.query(`UPDATE project_status_updates SET shared_at = CASE WHEN $4::boolean THEN coalesce(shared_at, now()) END,
          shared_by = CASE WHEN $4::boolean THEN coalesce(shared_by, $5::uuid) END WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
          [workspaceId, projectId, update.id, share, user.userId]);
        // Told once per update, however often it's shared again.
        if (share) await tellClients(client, { workspaceId, caseId: project.caseId, event: "update_published", recordId: update.id, title: project.name, note: update.note });
        audit = { updateId: update.id, shared: share };
      } else if (action === "approve_client_update" || action === "discard_client_update") {
        // The week's drafted client update: the project manager approves it (with edited words) or discards it.
        needManager(); open();
        audit = await decideClientUpdate(client, { workspaceId, projectId, caseId: project.caseId, title: project.name, updateId: body.updateId, note: body.note,
          approve: action === "approve_client_update", userId: user.userId });
      } else if (action === "hold") {
        needManager(); running();
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (!reason || reason.length > 500) throw new BadRequestException("Say why the project is on hold.");
        const reviewOn = optionalDate(body.reviewOn, "Review date");
        await client.query(`UPDATE delivery_projects SET status = 'on_hold', hold_reason = $3, hold_review_on = $4, held_at = now(), held_by = $5 WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, projectId, reason, reviewOn, user.userId]);
        notices.push({ key: `hold:${project.version}`, notice: { code: "project.on_hold", note: reason, memberships: teamIds() } });
        audit = { reason, reviewOn };
      } else if (action === "resume") {
        needManager();
        if (project.status !== "on_hold") throw new ConflictException("The project isn't on hold.");
        // Optionally, open work and the handover date move later by the working days lost on hold.
        const shifted = body.shiftDates === true ? await shiftForHold(client, workspaceId, projectId, user.userId) : null;
        await client.query(`UPDATE delivery_projects SET status = 'active', hold_reason = NULL, hold_review_on = NULL, held_at = NULL, held_by = NULL WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId]);
        notices.push({ key: `resume:${project.version}`, notice: { code: "project.resumed", note: "", memberships: teamIds() } });
        audit = shifted ? { shiftedWorkingDays: shifted.workingDays, moved: shifted.moved, promiseDate: shifted.promiseDate } : {};
      } else if (action === "cancel") {
        // Cancelling ends the contract: only someone who manages projects, with why, once nothing is left half-way.
        if (!all) throw new ForbiddenException("Only people who manage projects can cancel one.");
        open();
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (!reason || reason.length > 500) throw new BadRequestException("Say why the project is cancelled.");
        const closeOut = await readCloseOut(client, workspaceId, projectId);
        const blockers = closeOutBlockers(closeOut, false);
        if (blockers.length) throw new ConflictException(`Before the project can be cancelled: ${blockers.join("; ")}.`);
        const settled = await settleCloseOut(client, { workspaceId, projectId, reference: project.reference, closeOut, why: `${project.reference} cancelled: ${reason}`, actorId: user.userId,
          today: await this.today(client, workspaceId) });
        await client.query(
          `UPDATE delivery_projects SET status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancel_reason = $4, hold_reason = NULL, hold_review_on = NULL, held_at = NULL, held_by = NULL
            WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId, user.userId, reason]);
        notices.push({ key: `cancelled:${project.version}`, notice: { code: "project.cancelled", note: reason, memberships: teamIds() } });
        audit = { reason, ...settled };
      } else if (action === "reopen") {
        // A completed project opens again at its last stage, with why; a cancelled one stays cancelled.
        if (!all) throw new ForbiddenException("Only people who manage projects can reopen one.");
        if (project.status !== "completed") throw new ConflictException("Only a completed project can be reopened.");
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (!reason || reason.length > 500) throw new BadRequestException("Say why the project is reopened.");
        const last = [...(await readStages(client, workspaceId, [projectId]))].reverse().find((stage) => stage.status === "done" || stage.status === "skipped");
        if (last) await client.query(`UPDATE project_stages SET status = 'current', started_at = coalesce(started_at, now()), completed_at = NULL, completed_by = NULL, skip_reason = NULL
          WHERE workspace_id = $1 AND id = $2`, [workspaceId, last.id]);
        await client.query(`UPDATE delivery_projects SET status = 'active', completed_at = NULL, completed_by = NULL WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId]);
        await client.query(`UPDATE stock_locations SET active = true WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId]);
        notices.push({ key: `reopened:${project.version}`, notice: { code: "project.reopened", note: reason, memberships: teamIds() } });
        audit = { reason, stage: last?.key ?? null };
      } else if (["propose_packages", "save_package", "delete_package", "assign_lines"].includes(action)) {
        needManager();
        if (!["active", "on_hold"].includes(project.status)) throw new ConflictException("The project is closed.");
        if (action === "propose_packages") audit = { created: await proposePackages(client, workspaceId, projectId, user.userId) };
        else if (action === "save_package") audit = { packageId: await savePackage(client, workspaceId, projectId, body) };
        else if (action === "delete_package") { await deletePackage(client, workspaceId, projectId, String(body.packageId ?? "")); audit = { packageId: body.packageId }; }
        else audit = { moved: await assignLines(client, workspaceId, projectId, body.lineIds, body.packageId ?? null, user.userId), packageId: body.packageId ?? null };
      } else if (["suggest_materials", "save_material", "delete_material", "send_materials", "record_materials_decision", "remind_materials"].includes(action)) {
        // The team prepares the material list; the project manager sees every step in the audit.
        if (!["active", "on_hold"].includes(project.status)) throw new ConflictException("The project is closed.");
        if (action === "suggest_materials") audit = { added: await suggestMaterials(client, workspaceId, projectId) };
        else if (action === "save_material") audit = { itemId: await saveMaterial(client, workspaceId, projectId, body) };
        else if (action === "delete_material") { await deleteMaterial(client, workspaceId, projectId, String(body.itemId ?? "")); audit = { itemId: body.itemId }; }
        else if (action === "send_materials") {
          const revision = await sendMaterials(client, workspaceId, projectId, user.userId);
          // The client's decision-makers hear the list is waiting for them in the portal.
          await tellClients(client, { workspaceId, caseId: project.caseId, event: "decision_waiting", recordId: `materials:${projectId}:${revision}`, title: `Material list R${revision}` });
          audit = { revision };
        }
        else if (action === "remind_materials") {
          // A nudge to the client's decision-makers about the list waiting with them; at most once a day.
          const waiting = (await client.query<{ number: number }>(
            `SELECT number FROM project_material_revisions WHERE workspace_id = $1 AND project_id = $2 AND status = 'sent' ORDER BY number DESC LIMIT 1`, [workspaceId, projectId])).rows[0];
          if (!waiting) throw new ConflictException("No material list is waiting on the client.");
          const sent = await tellClients(client, { workspaceId, caseId: project.caseId, event: "decision_waiting", recordId: `materials:${projectId}:${waiting.number}:manual:${await this.today(client, workspaceId)}`,
            title: `Material list R${waiting.number}` });
          if (!sent.queued) throw new ConflictException(sent.reason === "no_contact" ? "The client has no portal contact to remind."
            : sent.reason === null ? "The client was already reminded today." : "The client portal isn't open for this project.");
          audit = { revision: waiting.number, reminded: true };
        }
        else {
          const result = await recordMaterialDecision(client, workspaceId, projectId, body, user.userId);
          audit = result;
          notices.push({ key: `materials:${result.number}`, notice: result.signedOff
            ? { code: "project.materials_signed_off", revision: `R${result.number}`, note: "", memberships: teamIds() }
            : { code: "project.materials_changes", revision: `R${result.number}`, note: result.note, memberships: teamIds() } });
        }
      } else if (action === "apply_variation") {
        needManager();
        if (!["active", "on_hold"].includes(project.status)) throw new ConflictException("The project is closed.");
        const loaded = await commercialRepository.load(client, workspaceId, project.caseId, { forUpdate: true });
        const data = loaded ? ({ ...(loaded.content as CommercialData), revision: loaded.revision }) : null;
        const quote = data?.quotes.find((item) => item.id === body.quoteId && item.kind === "variation");
        if (!data || !quote) throw new NotFoundException("Variation not found.");
        if (quote.status !== "accepted" || quote.clientDecision?.decision !== "accept") throw new ConflictException("The client hasn't accepted this variation yet.");
        const applied = (await client.query<{ label: string }>(`SELECT revision_label AS label FROM project_scope_seals WHERE workspace_id = $1 AND project_id = $2 AND quote_id = $3`, [workspaceId, projectId, quote.id])).rows[0];
        if (applied) throw new ConflictException(`This variation is already applied as ${applied.label}.`);
        if (settings.requireVariationPayment && !financeGatePaymentsReady(data, "release", quote.id))
          throw new ConflictException("The variation's payment before the work starts isn't verified yet.");
        const scope = await acceptedScope(client, workspaceId, project.caseId, quote.id);
        const tolerance = Dec.of(Math.min(2, scope.quote.decimals) === 0 ? "1" : Math.min(2, scope.quote.decimals) === 1 ? "0.1" : "0.01");
        if (Dec.of(scope.pricing.total).sub(Dec.of(String(acceptedQuoteValue(quote)))).abs().cmp(tolerance) > 0)
          throw new ConflictException("The variation's lines no longer add up to the total the client accepted. Issue a new revision and record the client's decision again.");
        const count = (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM project_scope_seals WHERE workspace_id = $1 AND project_id = $2 AND kind = 'variation'`, [workspaceId, projectId])).rows[0].count;
        const label = `VO-${count + 1}`;
        const decision = quote.clientDecision;
        const snapshot = { ...scope, revisionLabel: label,
          acceptance: { decidedBy: decision.decidedBy, decidedAt: decision.decidedAt, method: decision.method ?? "portal", recordedBy: decision.recordedBy ?? null,
            note: decision.note ?? "", quoteHash: decision.quoteHash, acceptedTotal: String(decision.acceptedTotal ?? quote.total) }, agreement: null };
        const sealId = randomUUID();
        await client.query(
          `INSERT INTO project_scope_seals (id, workspace_id, project_id, kind, quote_id, quote_number, revision_label, quote_hash, snapshot, content_hash, currency, total,
             accepted_at, accepted_by_name, acceptance_method, recorded_by_name, agreement_reference, sealed_by)
           VALUES ($1, $2, $3, 'variation', $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, NULL, $16)`,
          [sealId, workspaceId, projectId, quote.id, quote.number, label, decision.quoteHash, JSON.stringify(snapshot), canonicalHash(snapshot), scope.quote.currency,
            scope.pricing.total, decision.decidedAt, decision.decidedBy, decision.method ?? "portal", decision.recordedBy ?? null, user.userId]);
        await applyVariation(client, workspaceId, projectId, { id: sealId, label }, scope.lines, user.userId);
        // Work orders the variation removed or reduced stop; the factory hears which, and buyers hear what's now over-ordered.
        await tellScopeChanges(client, workspaceId, projectId, user.userId, sealId);
        await tellBuyersOverOrdered(client, workspaceId, project, { id: sealId, label }, user.userId);
        notices.push({ key: `variation:${quote.id}`, notice: { code: "project.variation_applied", variation: label, amount: `${scope.quote.currency} ${scope.pricing.total}`, memberships: teamIds() } });
        audit = { quoteId: quote.id, label, total: scope.pricing.total };
      } else if (["confirm_check", "unconfirm_check", "complete_stage", "skip_stage", "reopen_stage"].includes(action)) {
        running();
        const stages = await readStages(client, workspaceId, [projectId]);
        const current = stages.find((stage) => stage.status === "current");
        const owner = (stage: StageRow) => manager || Boolean(stage.ownerRole && team.some((member) => member.membershipId === membershipId && member.roles.includes(stage.ownerRole!)));
        if (action === "reopen_stage") {
          needManager();
          const reason = typeof body.reason === "string" ? body.reason.trim() : "";
          if (!reason) throw new BadRequestException("Say why the stage is going back.");
          const previous = [...stages].reverse().find((stage) => (stage.status === "done" || stage.status === "skipped") && (!current || stage.position < current.position));
          if (!previous) throw new ConflictException("There's no earlier stage to go back to.");
          if (current) await client.query(`UPDATE project_stages SET status = 'upcoming', started_at = NULL WHERE workspace_id = $1 AND id = $2`, [workspaceId, current.id]);
          // A stage skipped before it ever started starts now.
          await client.query(`UPDATE project_stages SET status = 'current', started_at = coalesce(started_at, now()), completed_at = NULL, completed_by = NULL, skip_reason = NULL
            WHERE workspace_id = $1 AND id = $2`, [workspaceId, previous.id]);
          audit = { stage: previous.key, reason };
        } else {
          const stage = stages.find((item) => item.id === body.stageId);
          if (!stage) throw new NotFoundException("Stage not found.");
          if (action === "skip_stage") {
            needManager();
            if (stage.status !== "current" && stage.status !== "upcoming") throw new ConflictException("This stage is already finished.");
            if (stage.checks.some((check) => HARD_CHECKS.includes(check.kind))) throw new ConflictException("This stage checks a payment; it can't be skipped.");
            const reason = typeof body.reason === "string" ? body.reason.trim() : "";
            if (!reason || reason.length > 500) throw new BadRequestException("Say why this stage doesn't apply.");
            await client.query(`UPDATE project_stages SET status = 'skipped', skip_reason = $3, completed_at = now(), completed_by = $4 WHERE workspace_id = $1 AND id = $2`,
              [workspaceId, stage.id, reason, user.userId]);
            if (stage.status === "current") await this.advance(client, workspaceId, project, stages, stage, team, user.userId, notices);
            audit = { stage: stage.key, reason };
          } else {
            if (stage.status !== "current") throw new ConflictException("Only the current stage can be worked on.");
            if (!owner(stage)) throw new ForbiddenException("Only the stage's owner or the project manager can do this.");
            if (action === "complete_stage") {
              const [evaluated] = await evaluateStages(client, workspaceId, project, [stage], team);
              const open = evaluated.checks.filter((check) => !check.passed);
              if (open.length) throw new ConflictException(`Still needed: ${open.map((check) => checkLabel(check, settings.roles)).join(", ")}.`);
              await client.query(`UPDATE project_stages SET status = 'done', completed_at = now(), completed_by = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, stage.id, user.userId]);
              await this.advance(client, workspaceId, project, stages, stage, team, user.userId, notices);
              audit = { stage: stage.key };
            } else {
              const check = stage.checks.find((item) => item.key === body.checkKey && item.kind === "confirm");
              if (!check) throw new BadRequestException("Only manual checks can be confirmed.");
              if (action === "confirm_check") {
                const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
                await client.query(
                  `INSERT INTO project_stage_confirmations (id, workspace_id, project_id, stage_id, check_key, note, confirmed_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
                   ON CONFLICT (workspace_id, stage_id, check_key) DO NOTHING`, [randomUUID(), workspaceId, projectId, stage.id, check.key, note, user.userId]);
                audit = { stage: stage.key, check: check.key, note };
              } else {
                await client.query(`DELETE FROM project_stage_confirmations WHERE workspace_id = $1 AND stage_id = $2 AND check_key = $3`, [workspaceId, stage.id, check.key]);
                audit = { stage: stage.key, check: check.key };
              }
            }
          }
        }
      } else {
        throw new BadRequestException("Unknown action.");
      }
      await client.query(`UPDATE delivery_projects SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `project.${action}`, entityType: "project", entityId: projectId, after: audit });
      for (const item of notices) await noticeProject(client, { workspaceId, projectId, key: item.key, actorUserId: user.userId, notice: item.notice });
      // A check read from records may pass now (a role named, a material list signed off): the stage owner hears it can finish.
      await noticeStageReady(client, workspaceId, projectId, user.userId);
      return this.detail(client, workspaceId, projectId, user);
    });
  }

  // ---------- helpers ----------
  /** Moves to the next stage that isn't skipped; after the last one the project is complete. */
  private async advance(client: Db, workspaceId: string, project: ProjectRow, stages: StageRow[], finished: StageRow, team: TeamMember[], userId: string, notices: Array<{ key: string; notice: ProjectNotice }>) {
    const next = stages.find((stage) => stage.position > finished.position && stage.status === "upcoming");
    if (next) {
      await client.query(`UPDATE project_stages SET status = 'current', started_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, next.id]);
      // The client hears on WhatsApp that the next stage started (when the firm has it on and the portal isn't paused).
      const owner = await partyOfCase(client, workspaceId, project.caseId);
      const toldClient = await sendClientEvent(client, { workspaceId, event: "project.stage_started", partyId: owner.partyId, leadId: owner.leadId, recordKey: `${project.id}:${next.id}`,
        record: { projectId: project.id, stageName: next.name }, actorUserId: userId });
      if (!toldClient.sent) await recordClientMessageSkipped(client, workspaceId, "project.stage_started", `${project.id}:${next.id}`, toldClient, false);
      const told = team.filter((member) => member.lead || (next.ownerRole && member.roles.includes(next.ownerRole))).map((member) => member.membershipId);
      notices.push({ key: `stage:${next.key}:${project.version}`, notice: { code: "project.stage_done", stage: next.name, previous: finished.name, memberships: told } });
    } else if (!stages.some((stage) => stage.id !== finished.id && (stage.status === "current" || stage.status === "upcoming"))) {
      // The last stage closes the project, once nothing is left open; leftover project stock becomes free stock.
      const closeOut = await readCloseOut(client, workspaceId, project.id);
      const blockers = closeOutBlockers(closeOut, true);
      if (blockers.length) throw new ConflictException(`Before the project closes: ${blockers.join("; ")}.`);
      const settled = await settleCloseOut(client, { workspaceId, projectId: project.id, reference: project.reference, closeOut, why: `${project.reference} completed`, actorId: userId,
        today: await this.today(client, workspaceId) });
      await client.query(`UPDATE delivery_projects SET status = 'completed', completed_at = now(), completed_by = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, project.id, userId]);
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "project.completed", entityType: "project", entityId: project.id, after: settled });
      notices.push({ key: `completed:${project.version}`, notice: { code: "project.completed", note: "", memberships: team.map((member) => member.membershipId) } });
    }
  }

  private async detail(client: Db, workspaceId: string, projectId: string, user: ActorUser) {
    const { project, all, membershipId } = await this.visible(client, workspaceId, projectId, user);
    const settings = await ensureSettings(client, workspaceId);
    const team = (await readTeam(client, workspaceId, [projectId])).get(projectId) ?? [];
    const stages = await evaluateStages(client, workspaceId, project, await readStages(client, workspaceId, [projectId]), team);
    const manager = all || team.some((member) => member.membershipId === membershipId && member.lead);
    // Status updates and the weekly client updates (a draft only for the people who manage the project).
    const updates = (await client.query<{ id: string; health: string; note: string; byName: string; at: string; sharedAt: string | null; kind: string; draft: boolean; photoIds: string[] }>(
      `SELECT update.id, update.health, update.note, person.display_name AS "byName", update.created_at AS at, update.shared_at AS "sharedAt", update.kind,
              (update.kind = 'client_update' AND update.approved_at IS NULL) AS draft,
              ARRAY(SELECT chosen.photo_id FROM project_update_photos chosen WHERE chosen.workspace_id = update.workspace_id AND chosen.update_id = update.id ORDER BY chosen.position) AS "photoIds"
         FROM project_status_updates update JOIN users person ON person.id = update.created_by
        WHERE update.workspace_id = $1 AND update.project_id = $2 ORDER BY update.created_at DESC LIMIT 20`, [workspaceId, projectId])).rows
      .filter((update) => !update.draft || manager);
    const seal = (await client.query<{ revisionLabel: string; quoteNumber: number; acceptedAt: string; acceptedBy: string; method: string | null; contentHash: string; sealedAt: string }>(
      `SELECT revision_label AS "revisionLabel", quote_number AS "quoteNumber", accepted_at AS "acceptedAt", accepted_by_name AS "acceptedBy",
              acceptance_method AS method, content_hash AS "contentHash", sealed_at AS "sealedAt"
         FROM project_scope_seals WHERE workspace_id = $1 AND project_id = $2 AND kind = 'baseline'`, [workspaceId, projectId])).rows[0];
    const current = stages.find((stage) => stage.status === "current");
    const money = await moneyAccess(client, this.access, workspaceId, user.userId, { all, onTeam: team.some((member) => member.membershipId === membershipId) });
    const site = (await client.query<{ startedOn: string | null; finishedOn: string | null }>(
      `SELECT site_started_on::text AS "startedOn", site_finished_on::text AS "finishedOn" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0];
    return {
      project: { ...summary(project), caseId: project.caseId, opportunityId: project.opportunityId, opportunityReference: project.opportunityReference,
        holdReason: project.holdReason, holdReviewOn: project.holdReviewOn, startDate: project.startDate, templateName: project.templateName, version: project.version,
        closedAt: project.cancelledAt ?? project.completedAt, closedByName: project.closedByName, cancelReason: project.cancelReason, heldAt: project.heldAt,
        siteStartedOn: site?.startedOn ?? null, siteFinishedOn: site?.finishedOn ?? null,
        handoverAccepted: Boolean((await client.query(`SELECT 1 FROM handover_packs WHERE workspace_id = $1 AND project_id = $2 AND status = 'accepted' LIMIT 1`, [workspaceId, projectId])).rowCount) },
      hold: project.status === "on_hold" ? await holdLength(client, workspaceId, projectId) : null,
      seal,
      roles: settings.roles,
      team: settings.roles.map((role) => ({ role: role.key, label: role.label, member: team.find((member) => member.roles.includes(role.key)) ?? null }))
        .map(({ member, ...role }) => ({ ...role, member: member ? { membershipId: member.membershipId, name: member.name } : null })),
      stages: stages.map((stage) => ({ ...stage, canWork: stage.status === "current" && project.status === "active"
        && (manager || Boolean(stage.ownerRole && team.some((member) => member.membershipId === membershipId && member.roles.includes(stage.ownerRole!)))) })),
      next: current ? nextStep(current, settings.roles) : null,
      updates,
      members: manager ? await activeMembers(client, workspaceId) : [],
      canManage: manager,
      canClose: all,
      // The Money tab is for people who see costs.
      // Who sees what of the money: costs (with margin only for commercial costs), and the client side.
      money,
      canSeeMoney: money.costs,
      progress: (await readProgress(client, workspaceId, projectId)).project,
    };
  }

  private async visible(client: Db, workspaceId: string, projectId: string, user: ActorUser) {
    const project = await readProject(client, workspaceId, projectId);
    if (!project) throw new NotFoundException("Project not found.");
    const { all } = await this.viewer(client, workspaceId, user);
    const membershipId = await membershipOf(client, workspaceId, user.userId);
    if (!all) {
      const assigned = (await client.query(`SELECT 1 FROM project_assignments WHERE workspace_id = $1 AND project_id = $2 AND membership_id = $3 AND active`, [workspaceId, projectId, membershipId])).rowCount;
      if (!assigned) throw new NotFoundException("Project not found.");
    }
    return { project, all, membershipId };
  }

  private async today(client: Db, workspaceId: string) {
    return (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
  }

  private async viewer(client: Db, workspaceId: string, user: ActorUser) {
    const all = await this.any(client, workspaceId, user.userId, ["projects.manage"]);
    if (!all && !(await this.any(client, workspaceId, user.userId, ["projects.view"]))) throw new ForbiddenException("You don't have access to projects.");
    return { all };
  }

  private async any(client: Db, workspaceId: string, userId: string, codes: string[]) {
    for (const code of codes) if (await this.access.hasPermission(client, workspaceId, userId, code)) return true;
    return false;
  }
}

// ---------- pure helpers ----------
function summary(project: ProjectRow) {
  return { id: project.id, reference: project.reference, name: project.name, clientName: project.clientName, status: project.status,
    priority: project.priority, health: project.health, promiseDate: project.promiseDate, currency: project.currency, total: project.total, startedAt: project.startedAt };
}

type Evaluated = Awaited<ReturnType<typeof evaluateStages>>[number];

function checkLabel(check: Evaluated["checks"][number], roles: Array<{ key: string; label: string }>) {
  if (check.kind === "confirm") return check.label ?? "";
  if (check.kind === "lead_assigned") return "Name the project manager";
  if (check.kind === "role_assigned") return `Name the ${roles.find((role) => role.key === check.role)?.label.toLowerCase() ?? "role"}`;
  if (check.kind === "material_list_signed_off") return "Client signed off the material list";
  if (check.kind === "everything_ordered") return "Everything is ordered";
  if (check.kind === "everything_made") return "Everything is made and checked";
  if (check.kind === "snags_closed") return "All snags closed";
  if (check.kind === "no_critical_snags") return "No critical snag open";
  if (check.kind === "handover_accepted") return "The client accepted the handover";
  return "Production payment verified";
}

/** The project's next step: the current stage's first open check and who holds it. */
function nextStep(stage: Evaluated, roles: Array<{ key: string; label: string }>) {
  const open = stage.checks.find((check) => !check.passed);
  return {
    stage: stage.name,
    kind: open ? open.kind : "finish",
    text: open ? checkLabel(open, roles) : `Finish ${stage.name}`,
    role: open?.kind === "payment_verified" ? null : stage.ownerRole,
    owner: open?.kind === "payment_verified" ? null : stage.owner?.name ?? null,
  };
}

function optionalDate(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} must be a date.`);
  return value;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (!options.includes(value as T)) throw new BadRequestException(`${label} is not valid.`);
  return value as T;
}
