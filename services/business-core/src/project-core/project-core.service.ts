import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { ActorUser, RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { isFrequency, isMode } from "../client-calls/client-calls.domain";
import { tellClients } from "../client-portal/portal-notices";
import { commercialRepository } from "../commercial/commercial-repository";
import type { CommercialData } from "../commercial/commercial.types";
import { financeGatePaymentsReady } from "../commercial/release-integrity";
import { canonicalHash } from "../crm/shared/crm-types";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { HARD_CHECKS, LEAD_ROLE, parseRoles, parseStages } from "./project-checks";
import {
  activeMembers, ensureSettings, ensureTemplates, evaluateStages, membershipOf, readProject, readProjects, readStages, readTeam,
  readTemplates, setRole, writeTemplate, type ProjectRow, type StageRow, type TeamMember,
} from "./project-core.store";
import { readNeeds } from "../purchasing/orders";
import { closeOutBlockers, readCloseOut, settleCloseOut } from "./project-closeout";
import { readProgress } from "./project-work";
import { noticeProject, type ProjectNotice } from "./project-notices";
import { confirmMaterialList, deleteMaterial, materialListMissing, readMaterialListConfirmation, readMaterials, recordMaterialDecision, saveMaterial, sendMaterials, setMaterialDetails, suggestMaterials } from "./project-materials";
import { applyBoqAction, BOQ_COMMANDS, boqActionsFor, boqTechnicalRoleOf, canActOnBoq, membershipsWithPermission, readBoqState } from "./project-boq-state";
import { ensurePurchasingSettings } from "../purchasing/orders";
import { priceHolds } from "../purchasing/price-hold";
import { assignLines, deletePackage, lineHistory, proposePackages, readScope, readScopeCosts, readScopeLinks, savePackage, SUPPLY, withLineDetails, type PricedScopeLine, type Supply } from "./project-scope";
import { readRecordLinks } from "./record-links";
import { currencyDecimals } from "../common/currency";
import { sealVariation } from "./variation-seal";
import { ensureWorkTemplates, parseTemplateTasks } from "./work-templates";
import { readReadyCases, readStartState, startProject } from "./project-start";
import { moneyAccess, valueAccess, withValue } from "./project-access";
import { readAttention } from "./project-attention";
import { decideClientUpdate } from "./client-updates";
import { holdLength, shiftForHold } from "./project-hold";
import { noticeStageReady } from "./project-stage-watch";
import { markNotApplicable, notApplicableRoles } from "./project-team";
import { assertDecidable, assertSendable, drawingRoute, drawingsClientRoleOf, productionReleased, readLatestRevision } from "./project-drawings";
import { parseMeasure, recordMeasure } from "./project-technical-measure";
import { readDrawingItems } from "./project-drawing-needs";
import { decideDrawings } from "./project-drawing-decisions";
import { advanceStage } from "./project-advance";
import { DRAWING_CHECKS } from "./project-checks";
import { installationRoles, readInstallation, writeFactorySlot, writeInstallationDays } from "./project-installation";
import { readInstallationCrew } from "../logistics/logistics.store";
import { parseKeepInformed } from "./project-keep-informed";
import { readProduction } from "../factory/production-status";
import { projectAreas } from "./project-areas";
import { readProjectReadiness } from "./project-readiness";
import { projectBrief } from "../design/design-checklists";
import { readReadinessSettings } from "../catalog-core/item-readiness";
import { calendarDay as optionalDate } from "./calendar-day";
import { confirmFactoryRequirement, saveFactoryRequirement } from "./project-factory-requirements";
import { acceptTechnicalHandover, handOverTechnical, readTechnicalHandover, waiveHandoverItem } from "./project-technical-handover";

type Db = PoolClient;
const SETTINGS = ["workspace.settings.manage"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIORITIES = ["normal", "high", "critical"] as const;
const HEALTH = ["on_track", "at_risk", "off_track"] as const;
/** Commands the factory runs on a project it isn't on (PLM-165, PLM-166): the technical pack and a custom line's requirements. */
const FACTORY_ACTIONS = ["save_factory_requirement", "confirm_factory_requirement", "accept_technical_handover", "waive_handover_item"];
/** PLM-165: the technical team: the roles that own a stage with drawing checks, and the technical designer. */
const technicalRoles = (stages: Array<{ ownerRole: string | null; checks: Array<{ kind: string }> }>) =>
  new Set(["technical_designer", ...stages.filter((stage) => stage.ownerRole && stage.checks.some((check) => (DRAWING_CHECKS as readonly string[]).includes(check.kind))).map((stage) => stage.ownerRole!)]);

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
      const flag = (key: "requireAgreement" | "requirePayment" | "requireApproval" | "requireVariationPayment" | "autoFinish") => (body[key] === undefined ? current[key] : body[key] === true);
      const autoSend = body.clientUpdateAutoSendHours === undefined ? current.clientUpdateAutoSendHours : body.clientUpdateAutoSendHours;
      if (autoSend !== null && !(Number.isInteger(autoSend) && Number(autoSend) >= 1 && Number(autoSend) <= 168))
        throw new BadRequestException("Send client updates by themselves after 1 to 168 hours, or keep them manual.");
      const dueTime = body.reportDueTime === undefined ? current.reportDueTime : String(body.reportDueTime);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime)) throw new BadRequestException("Give the day's report a time, like 18:00.");
      const option = (key: "autoSendPendingReports" | "weeklyRollup") => (body[key] === undefined ? current[key] : body[key] === true);
      // PLM-055: the roles told at the project's key moments (a role removed drops out).
      const keepInformed = body.keepInformed === undefined
        ? Object.fromEntries(Object.entries(current.keepInformed).map(([event, list]) => [event, list.filter((role) => roles.some((next) => next.key === role))]))
        : parseKeepInformed(body.keepInformed, roles);
      // §6.20: how a variation is paid. When a change waiting for the client is chased is its reminder rule (Settings › Reminders).
      const paymentRule = body.variationPaymentRule === undefined ? current.variationPaymentRule : body.variationPaymentRule;
      if (paymentRule !== "before_work" && paymentRule !== "next_milestone") throw new BadRequestException("Choose how a variation is paid.");
      // PLM-149: who talks to the client about the drawings (a project role, or the project manager), and when the technical measure is due.
      const clientRole = body.drawingsClientRole === undefined ? (roles.some((role) => role.key === current.drawingsClientRole) ? current.drawingsClientRole : null)
        : body.drawingsClientRole === null || body.drawingsClientRole === "" ? null : String(body.drawingsClientRole);
      if (clientRole !== null && !roles.some((role) => role.key === clientRole)) throw new BadRequestException("Choose who sends the drawings to the client from the project roles.");
      const measureDays = body.technicalMeasureDays === undefined ? current.technicalMeasureDays : body.technicalMeasureDays;
      if (measureDays !== null && !(Number.isInteger(measureDays) && Number(measureDays) >= 1 && Number(measureDays) <= 60))
        throw new BadRequestException("Give the technical measure 1 to 60 working days, or no due date.");
      // PLM-179: how a job's client updates start (each job can still change its own).
      const updateMode = body.clientUpdateMode === undefined ? current.clientUpdateMode : body.clientUpdateMode;
      if (!isMode(updateMode)) throw new BadRequestException("Choose a call, a portal update or either for client updates.");
      const updateFrequency = body.clientUpdateFrequency === undefined ? current.clientUpdateFrequency : body.clientUpdateFrequency;
      if (!isFrequency(updateFrequency)) throw new BadRequestException("Choose how often clients hear from you.");
      // PLM-161 / PLM-167: the BOQ lifecycle, the project starting by itself on the verified upfront payment, and who verifies the BOQ.
      const boqReview = body.boqReview === undefined ? current.boqReview : body.boqReview === true;
      const autoStart = body.autoStartOnPayment === undefined ? current.autoStartOnPayment : body.autoStartOnPayment === true;
      const technicalRole = body.boqTechnicalRole === undefined ? (roles.some((role) => role.key === current.boqTechnicalRole) ? current.boqTechnicalRole : null)
        : body.boqTechnicalRole === null || body.boqTechnicalRole === "" ? null : String(body.boqTechnicalRole);
      if (technicalRole !== null && !roles.some((role) => role.key === technicalRole)) throw new BadRequestException("Choose who verifies the BOQ from the project roles.");
      await client.query(
        `UPDATE workspace_project_settings SET require_agreement = $2, require_payment = $3, require_approval = $4, reference_prefix = $5, roles = $6::jsonb,
                require_variation_payment = $8, auto_finish = $9, client_update_auto_send_hours = $10, report_due_time = $11::time, auto_send_pending_reports = $12, weekly_rollup = $13,
                keep_informed = $14::jsonb, variation_payment_rule = $15, drawings_client_role = $16, technical_measure_days = $17, client_update_mode = $18, client_update_frequency = $19,
                boq_review = $20, auto_start_on_payment = $21, boq_technical_role = $22,
                version = version + 1, updated_by = $7, updated_at = now() WHERE workspace_id = $1`,
        [workspaceId, flag("requireAgreement"), flag("requirePayment"), flag("requireApproval"), prefix, JSON.stringify(roles), user.userId, flag("requireVariationPayment"), flag("autoFinish"), autoSend,
          dueTime, option("autoSendPendingReports") && autoSend !== null, option("weeklyRollup"), JSON.stringify(keepInformed), paymentRule, clientRole, measureDays, updateMode, updateFrequency, boqReview, autoStart, technicalRole]);
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
    return this.access.withPermission(actor, workspaceId, "projects.manage", async (client, user) => {
      const started = await startProject(client, this.access, workspaceId, caseId, body, user);
      // The first stage's record-driven tasks open, and the factory hears to book its slot when the deposit is in.
      if (!started.existing) await noticeStageReady(client, workspaceId, started.projectId, user.userId);
      return started;
    });
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
      const attention = await readAttention(client, workspaceId, ids);
      // QA-006: the agreed value only for the people who see it (the list holds their own projects, or all with projects.manage).
      const canSeeValue = await valueAccess(client, this.access, workspaceId, user.userId, { all, onTeam: true });
      const rows = [];
      for (const project of projects) {
        const mine = stages.filter((stage) => stage.projectId === project.id);
        const team = teams.get(project.id) ?? [];
        const current = mine.find((stage) => stage.status === "current");
        const evaluated = current ? (await evaluateStages(client, workspaceId, project, [current], team))[0] : null;
        rows.push({
          ...withValue(summary(project), canSeeValue),
          stage: current ? { name: current.name, position: current.position + 1, count: mine.length } : null,
          lead: team.find((member) => member.lead)?.name ?? null,
          next: evaluated ? nextStep(evaluated, settings, team) : null,
          // Which project needs a look: its late and held-up work.
          attention: attention.get(project.id) ?? { late: 0, blocked: 0 },
        });
      }
      // Projects › Profitability is for people who see project costs (with margins, or their own projects' costs).
      const canSeeProfit = await this.access.hasPermission(client, workspaceId, user.userId, "commercial.costs.view")
        || await this.access.hasPermission(client, workspaceId, user.userId, "projects.costs.view");
      return { projects: rows, canStart: all, canSeeProfit, canSeeValue };
    });
  }

  get(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => this.detail(client, workspaceId, projectId, user));
  }

  /** The live BOQ, its packages and the sealed documents it comes from. */
  scope(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const { all, membershipId, project } = await this.visible(client, workspaceId, projectId, user, { qs: true });
      const team = (await readTeam(client, workspaceId, [projectId])).get(projectId) ?? [];
      const manager = all || team.some((member) => member.membershipId === membershipId && member.lead);
      const scope = await readScope(client, workspaceId, projectId);
      const onTeam = team.some((member) => member.membershipId === membershipId);
      // QA-006: the BOQ's prices and the sealed totals only for the people who see the project's value.
      const canSeeValue = await valueAccess(client, this.access, workspaceId, user.userId, { all, onTeam });
      const priced = canSeeValue ? scope : {
        ...scope, lines: scope.lines.map((line) => ({ ...line, rate: null, net: null })),
        seals: scope.seals.map((seal) => ({ ...seal, total: null })), variations: scope.variations.map((variation) => ({ ...variation, total: null })),
      };
      // PLM-170: the internal view (each line's cost, what is committed on orders, and the margin) only for the people who see costs;
      // the cost fields are never on the line for anyone else. PLM-164: every line names the orders it is on.
      const money = await moneyAccess(client, this.access, workspaceId, user.userId, { all, onTeam });
      const links = await readScopeLinks(client, workspaceId, projectId);
      const costs = money.costs ? await readScopeCosts(client, workspaceId, { id: projectId, caseId: project.caseId, currency: project.currency }) : null;
      const lines = withLineDetails(priced.lines as PricedScopeLine[], links, costs, { costs: money.costs, margin: money.margin && canSeeValue }, currencyDecimals(project.currency));
      // PLM-167 / PLM-168 / PLM-169: the BOQ's state with what this person may do to it, and the lines held for a price the client hasn't approved.
      const settings = await ensureSettings(client, workspaceId);
      const state = await readBoqState(client, workspaceId, projectId);
      const rights = await this.boqRights(client, workspaceId, user.userId, { manager, team, membershipId, settings });
      const open = ["active", "on_hold"].includes(project.status);
      const holds = (await ensurePurchasingSettings(client, workspaceId)).requirePriceApproval ? await priceHolds(client, workspaceId, { projectId }) : new Map<string, string>();
      const boq = { enabled: settings.boqReview, ...(canSeeValue ? state : { ...state, revisions: state.revisions.map((revision) => ({ ...revision, total: null, cost: null })) }),
        actions: open ? boqActionsFor(state.status).filter((action) => canActOnBoq(action, rights)) : [],
        priceHolds: [...holds.entries()].map(([lineId, reason]) => ({ lineId, reason })) };
      return { ...priced, lines, currency: project.currency, version: project.version, caseId: project.caseId, baselineQuoteId: project.quoteId,
        canManage: manager && open, members: manager ? await activeMembers(client, workspaceId) : [], canSeeValue,
        canSeeCosts: money.costs, canSeeMargin: money.margin && canSeeValue, boq };
    });
  }

  /** PLM-164: the records the project runs through (quotation, Deal File, purchase orders, work orders), for the linked-records block. */
  links(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.visible(client, workspaceId, projectId, user);
      const links = await readRecordLinks(client, workspaceId, projectId);
      if (!links) throw new NotFoundException("Project not found.");
      return links;
    });
  }

  /** Who the person is to the BOQ: the project manager (or anyone who manages projects), the technical team, the QS. */
  private async boqRights(client: Db, workspaceId: string, userId: string, input: { manager: boolean; team: TeamMember[]; membershipId: string | null; settings: { boqTechnicalRole: string | null; roles: Array<{ key: string }> } }) {
    const technicalRole = boqTechnicalRoleOf(input.settings);
    return {
      manager: input.manager,
      technical: Boolean(technicalRole && input.team.some((member) => member.membershipId === input.membershipId && member.roles.includes(technicalRole))),
      qs: await this.access.hasPermission(client, workspaceId, userId, "commercial.estimate"),
    };
  }

  /** One sealed document exactly as the client accepted it, with a fresh check that it's untouched. */
  seal(actor: RequestActor, workspaceId: string, projectId: string, sealId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const { all, membershipId } = await this.visible(client, workspaceId, projectId, user);
      // QA-006: the sealed document is the priced quotation; the team without the project's value works from the scope's items.
      const team = (await readTeam(client, workspaceId, [projectId])).get(projectId) ?? [];
      if (!(await valueAccess(client, this.access, workspaceId, user.userId, { all, onTeam: team.some((member) => member.membershipId === membershipId) })))
        throw new ForbiddenException("You don't see this project's prices.");
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
      const { project, all, membershipId } = await this.visible(client, workspaceId, projectId, user, { qs: true });
      const team = (await readTeam(client, workspaceId, [projectId])).get(projectId) ?? [];
      const onTeam = all || team.some((member) => member.membershipId === membershipId);
      const materials = await readMaterials(client, workspaceId, projectId);
      // PLM-072: where each material has got to (required, ordered, received, installed), as Purchasing works it out.
      const status = new Map((await readNeeds(client, workspaceId, false, projectId)).filter((need) => need.source === "material").map((need) => [need.sourceId, need.status]));
      // PLM-159: the QS's confirmation of the list (the ordering gate reads it), and whether this person is the QS.
      const purchasing = await ensurePurchasingSettings(client, workspaceId);
      return { ...materials, items: materials.items.map((item) => ({ ...item, status: status.get(item.id) ?? null })), version: project.version,
        canEdit: onTeam && ["active", "on_hold"].includes(project.status),
        qsConfirmation: await readMaterialListConfirmation(client, workspaceId, projectId), qsGate: purchasing.requireMaterialListConfirmed,
        canConfirmQs: ["active", "on_hold"].includes(project.status) && await this.access.hasPermission(client, workspaceId, user.userId, "commercial.estimate") };
    });
  }

  /**
   * Item readiness: every active line of the scope with what it still needs (picture, size, drawing, materials, labour,
   * the client's material choice, purchase, production and installation), worked out from the records. The columns
   * are the firm's choice, less the delivery areas the project's path doesn't use.
   */
  /** The job's brief from design: the discovery answers by section and the checklists that apply, read-only, with the pending lines counted. */
  brief(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const { project } = await this.visible(client, workspaceId, projectId, user);
      return { ...(await projectBrief(client, workspaceId, project.caseId ?? null)), caseId: project.caseId ?? null };
    });
  }

  readiness(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const { project } = await this.visible(client, workspaceId, projectId, user);
      const areas = await projectAreas(client, workspaceId, projectId, project.caseId ?? null);
      return { ...(await readProjectReadiness(client, workspaceId, projectId, await readReadinessSettings(client, workspaceId), areas)), caseId: project.caseId };
    });
  }

  /**
   * PLM-165 / PLM-166: the technical handover pack: every line with its drawing need, requirements (verified recipe or
   * the factory's record), selections, sizes and missing-information checklist, and what the viewer may do with it.
   */
  technicalHandover(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const { project, all, membershipId } = await this.visible(client, workspaceId, projectId, user);
      const areas = await projectAreas(client, workspaceId, projectId, project.caseId ?? null);
      const pack = await readTechnicalHandover(client, workspaceId, projectId, await readReadinessSettings(client, workspaceId), areas);
      const team = (await readTeam(client, workspaceId, [projectId])).get(projectId) ?? [];
      const mine = team.find((member) => member.membershipId === membershipId);
      const manager = all || Boolean(mine?.lead);
      const technical = technicalRoles(await readStages(client, workspaceId, [projectId]));
      const factory = await this.any(client, workspaceId, user.userId, ["factory.manage", "factory.approve"]);
      const open = ["active", "on_hold"].includes(project.status);
      return {
        ...pack, caseId: project.caseId, projectVersion: project.version,
        canHandOver: open && pack.status !== "accepted" && (manager || Boolean(mine)),
        canAccept: open && pack.status === "handed_over" && (manager || factory || Boolean(mine?.roles.some((role) => technical.has(role)))),
        canWaive: open && (manager || factory || Boolean(mine)),
        canSaveRequirements: open && (manager || factory || Boolean(mine)),
        canConfirmRequirements: open && await this.any(client, workspaceId, user.userId, ["factory.approve"]),
      };
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
      // The people who run the factory book its slot (PLM-068) and take the technical measure (PLM-149) on a project they aren't on;
      // the factory also records and confirms a custom line's requirements and accepts the technical pack (PLM-165, PLM-166).
      const factoryHand = (body.action === "book_factory_slot" || body.action === "record_technical_measure") ? await this.any(client, workspaceId, user.userId, ["factory.manage"])
        : FACTORY_ACTIONS.includes(String(body.action)) ? await this.any(client, workspaceId, user.userId, ["factory.manage", "factory.approve", "factory.recipe.verify", "factory.dispatch.signoff"]) : false;
      // PLM-168 / PLM-159: the QS approves or returns the BOQ and confirms the material list on a project they aren't on.
      const qsHand = (String(body.action) in BOQ_COMMANDS || body.action === "confirm_material_list") && await this.any(client, workspaceId, user.userId, ["commercial.estimate"]);
      const { all } = factoryHand || qsHand ? { all: await this.any(client, workspaceId, user.userId, ["projects.manage"]) } : await this.viewer(client, workspaceId, user);
      const membershipId = await membershipOf(client, workspaceId, user.userId);
      const team = (await readTeam(client, workspaceId, [projectId])).get(projectId) ?? [];
      const manager = all || team.some((member) => member.membershipId === membershipId && member.lead);
      if (!manager && !factoryHand && !qsHand && !team.some((member) => member.membershipId === membershipId)) throw new NotFoundException("Project not found.");
      if (body.version !== project.version) throw new ConflictException("Someone else changed this project. Reload to see their changes.");
      const settings = await ensureSettings(client, workspaceId);
      const action = String(body.action ?? "");
      const needManager = () => { if (!manager) throw new ForbiddenException("Only the project manager can do this."); };
      const running = () => { if (project.status !== "active") throw new ConflictException(project.status === "on_hold" ? "The project is on hold. Resume it first." : "The project is closed."); };
      // A completed or cancelled project is a record: its details, team and status don't change any more.
      const open = () => { if (!["active", "on_hold"].includes(project.status)) throw new ConflictException("The project is closed."); };
      const notices: Array<{ key: string; notice: ProjectNotice; deepLink?: string }> = [];
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
        // "Not applicable" (PLM-100): nobody holds the role on this project, on purpose.
        const notApplicable = body.notApplicable === true;
        const next = notApplicable || body.membershipId === null || body.membershipId === "" || body.membershipId === undefined ? null : String(body.membershipId);
        if (role.key === LEAD_ROLE && !next) throw new BadRequestException("A project always has a project manager.");
        if (next && !(await activeMembers(client, workspaceId)).some((member) => member.membershipId === next)) throw new BadRequestException("Choose someone from your team.");
        const holder = team.find((member) => member.roles.includes(role.key))?.membershipId ?? null;
        const wasNotApplicable = (await notApplicableRoles(client, workspaceId, { projectId })).includes(role.key);
        if (holder === next && wasNotApplicable === notApplicable) return this.detail(client, workspaceId, projectId, user);
        await setRole(client, workspaceId, projectId, role.key, next);
        await markNotApplicable(client, workspaceId, { projectId }, role.key, notApplicable, user.userId);
        if (next) notices.push({ key: `role:${role.key}:${next}:${project.version}`, notice: { code: "project.team_added", membershipId: next, role: role.label } });
        audit = { role: role.key, from: holder, to: next, ...(notApplicable || wasNotApplicable ? { notApplicable, wasNotApplicable } : {}) };
      } else if (action === "set_team_note") {
        // PLM-089: who outside Wodana does the work (installers, subcontractors), in a line or two.
        needManager(); open();
        const note = typeof body.note === "string" ? body.note.trim() : "";
        if (note.length > 1000) throw new BadRequestException("Keep the note under 1000 characters.");
        const before = await teamNote(client, workspaceId, projectId);
        if (before === note) return this.detail(client, workspaceId, projectId, user);
        await client.query(`UPDATE delivery_projects SET team_note = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId, note]);
        audit = { from: before, to: note };
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
      } else if (action === "set_material_details") {
        // PLM-055: the team (the designer) adds product details to a material for the technical team, at any time.
        open();
        const result = await setMaterialDetails(client, workspaceId, projectId, { itemId: body.itemId, note: body.note, userId: user.userId });
        if (!result.changed) return this.detail(client, workspaceId, projectId, user);
        if (result.note) {
          // The technical team: whoever holds a role that owns a stage with drawing checks, or the technical designer.
          const stages = await readStages(client, workspaceId, [projectId]);
          const technical = new Set(["technical_designer", ...stages.filter((stage) => stage.ownerRole && stage.checks.some((check) => DRAWING_CHECKS.includes(check.kind))).map((stage) => stage.ownerRole!)]);
          notices.push({ key: `details:${String(body.itemId)}:${project.version}`, notice: { code: "project.material_details", item: result.name, note: result.note,
            memberships: team.filter((member) => member.roles.some((role) => technical.has(role))).map((member) => member.membershipId) } });
        }
        audit = { itemId: body.itemId, material: result.name, from: result.before, to: result.note };
      } else if (action === "schedule_installation") {
        // PLM-069: the delivery day booked and the installation day, by the project manager or the installation team.
        open();
        const stages = await readStages(client, workspaceId, [projectId]);
        const installers = installationRoles(stages);
        if (!manager && !team.some((member) => member.membershipId === membershipId && member.roles.some((role) => installers.includes(role))))
          throw new ForbiddenException("Only the project manager or the installation team schedules delivery and installation.");
        const deliveryOn = optionalDate(body.deliveryOn, "Delivery day");
        const installationOn = optionalDate(body.installationOn, "Installation day");
        const note = typeof body.note === "string" ? body.note.trim() : "";
        // Clearing both days is the project manager's; otherwise the installation day is needed and delivery comes first.
        // The installation team and the project manager hear the day, and the people kept informed (the designer).
        const before = await writeInstallationDays(client, { workspaceId, projectId, days: { deliveryOn, installationOn, note }, actorUserId: user.userId, canClear: manager,
          team: team.filter((member) => member.lead || member.roles.some((role) => installers.includes(role))).map((member) => member.membershipId) });
        if (!before) return this.detail(client, workspaceId, projectId, user);
        audit = { from: before, to: { deliveryOn, installationOn, note } };
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
      } else if (action in BOQ_COMMANDS) {
        // PLM-167 / PLM-168: the BOQ's lifecycle. The technical team verifies, the QS approves (a snapshot is kept as BOQ R-n),
        // anyone involved returns it with a reason, the project manager locks it. Each step tells its next owner.
        open();
        const rights = await this.boqRights(client, workspaceId, user.userId, { manager, team, membershipId, settings });
        const result = await applyBoqAction(client, workspaceId, projectId, BOQ_COMMANDS[action], { reason: body.reason, actorUserId: user.userId, rights });
        const technicalRole = boqTechnicalRoleOf(settings);
        const holders = (...roles: Array<string | null>) => team.filter((member) => member.roles.some((role) => roles.includes(role))).map((member) => member.membershipId);
        const next = result.status === "technical_verified" ? await membershipsWithPermission(client, workspaceId, "commercial.estimate")
          : result.status === "draft" ? holders(LEAD_ROLE, technicalRole)
          : [...holders(LEAD_ROLE, "procurement"), ...await membershipsWithPermission(client, workspaceId, "purchasing.manage")];
        const code = result.status === "technical_verified" ? "project.boq_verified" : result.status === "qs_approved" ? "project.boq_approved"
          : result.status === "locked" ? "project.boq_locked" : "project.boq_returned";
        notices.push({ key: `boq:${action}:${project.version}`, notice: { code, revision: result.label ?? "", note: result.reason, memberships: next } });
        audit = { from: result.from, to: result.status, revision: result.label, reason: result.reason };
      } else if (action === "confirm_material_list") {
        // PLM-159: the QS confirms the project's material list as it is now; a list that changes since needs confirming again.
        open();
        if (!(await this.access.hasPermission(client, workspaceId, user.userId, "commercial.estimate"))) throw new ForbiddenException("Only the QS confirms the material list.");
        audit = await confirmMaterialList(client, workspaceId, projectId, user.userId);
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
        if (quote.changeRequestId) throw new ConflictException("This variation is applied from its change request.");
        const { label, total, currency } = await sealVariation(client, { workspaceId, projectId, caseId: project.caseId, quote, actorUserId: user.userId });
        notices.push({ key: `variation:${quote.id}`, notice: { code: "project.variation_applied", variation: label, amount: `${currency} ${total}`, memberships: teamIds() } });
        audit = { quoteId: quote.id, label, total };
      } else if (action === "hand_over_technical") {
        // PLM-165: sales or design (anyone on the project, or its manager) hands the technical pack over; the technical team hears, also by email.
        open();
        // Guide step 17: technical work starts only once the Material List is complete.
        const incomplete = await materialListMissing(client, workspaceId, projectId);
        if (incomplete.length) throw new ConflictException(`Complete the material list first: ${incomplete.slice(0, 5).join("; ")}${incomplete.length > 5 ? ` and ${incomplete.length - 5} more` : ""}.`);
        const result = await handOverTechnical(client, { workspaceId, projectId, userId: user.userId, note: body.note, version: body.handoverVersion });
        const stages = await readStages(client, workspaceId, [projectId]);
        const technical = technicalRoles(stages);
        notices.push({ key: `technical_handover:${project.version}`, deepLink: `/workspace/projects/${projectId}/scope?view=technical`, notice: { code: "project.technical_handover", note: result.note,
          memberships: team.filter((member) => member.roles.some((role) => technical.has(role))).map((member) => member.membershipId) } });
        audit = { note: result.note, again: result.again };
      } else if (action === "accept_technical_handover") {
        // PLM-165: the technical team (or the factory, or the project manager) accepts the pack once nothing required is missing.
        open();
        const stages = await readStages(client, workspaceId, [projectId]);
        const technical = technicalRoles(stages);
        if (!manager && !factoryHand && !team.some((member) => member.membershipId === membershipId && member.roles.some((role) => technical.has(role))))
          throw new ForbiddenException("Only the technical team or the project manager accepts the technical handover.");
        const areas = await projectAreas(client, workspaceId, projectId, project.caseId ?? null);
        const pack = await readTechnicalHandover(client, workspaceId, projectId, await readReadinessSettings(client, workspaceId), areas);
        if (!(await acceptTechnicalHandover(client, { workspaceId, projectId, userId: user.userId, version: body.handoverVersion, missing: pack.missing }))) return this.detail(client, workspaceId, projectId, user);
        // Whoever handed it over hears, and the lead.
        const hander = (await client.query<{ membershipId: string | null }>(
          `SELECT membership.id AS "membershipId" FROM project_technical_handovers handover JOIN workspace_memberships membership ON membership.workspace_id = handover.workspace_id AND membership.user_id = handover.handed_over_by
            WHERE handover.workspace_id = $1 AND handover.project_id = $2`, [workspaceId, projectId])).rows[0]?.membershipId ?? null;
        notices.push({ key: `technical_handover_accepted:${project.version}`, deepLink: `/workspace/projects/${projectId}/scope?view=technical`, notice: { code: "project.technical_handover_accepted", note: "",
          memberships: [...team.filter((member) => member.lead).map((member) => member.membershipId), ...(hander ? [hander] : [])] } });
        audit = { lines: pack.rows.length, waived: pack.rows.reduce((sum, row) => sum + Object.keys(row.waivers).length, 0) };
      } else if (action === "waive_handover_item") {
        // PLM-165: a checklist item marked "Not applicable" on one line, with the reason (anyone on the project, the factory or the manager).
        open();
        const result = await waiveHandoverItem(client, { workspaceId, projectId, lineId: body.lineId, item: body.item, reason: body.reason === null ? null : body.reason, userId: user.userId });
        audit = { lineId: body.lineId, title: result.title, item: result.item, reason: result.reason };
      } else if (action === "save_factory_requirement") {
        // PLM-166: the materials, labour hours and notes a custom line needs, by the factory or the project team; a confirmed record edited is open again.
        open();
        if (typeof body.lineId !== "string" || !UUID.test(body.lineId)) throw new BadRequestException("Choose the item.");
        const result = await saveFactoryRequirement(client, { workspaceId, projectId, lineId: body.lineId, body, userId: user.userId });
        if (result.reopened) notices.push({ key: `requirements_reopened:${body.lineId}:${project.version}`, deepLink: `/workspace/projects/${projectId}/scope?view=technical`,
          notice: { code: "project.factory_requirements_reopened", item: result.title, note: "", memberships: team.filter((member) => member.roles.includes("factory_lead") || member.lead).map((member) => member.membershipId) } });
        audit = { lineId: body.lineId, title: result.title, items: result.items, labourHours: result.labourHours, created: result.created, reopened: result.reopened };
      } else if (action === "confirm_factory_requirement") {
        // PLM-166: the Factory Lead (whoever approves factory work) confirms a line's requirements; from then on they are its quantities.
        open();
        if (!(await this.any(client, workspaceId, user.userId, ["factory.recipe.verify", "factory.approve"]))) throw new ForbiddenException("Only the factory lead confirms factory requirements.");
        if (typeof body.lineId !== "string" || !UUID.test(body.lineId)) throw new BadRequestException("Choose the item.");
        const result = await confirmFactoryRequirement(client, { workspaceId, projectId, lineId: body.lineId, version: body.requirementVersion, userId: user.userId });
        if (!result.changed) return this.detail(client, workspaceId, projectId, user);
        notices.push({ key: `requirements_confirmed:${body.lineId}:${project.version}`, deepLink: `/workspace/projects/${projectId}/scope?view=technical`,
          notice: { code: "project.factory_requirements_confirmed", item: result.title, note: "", memberships: team.filter((member) => member.lead).map((member) => member.membershipId) } });
        audit = { lineId: body.lineId, title: result.title, requirementId: result.requirementId };
      } else if (action === "set_drawing_need") {
        // PLM-057: whether an item needs technical drawings, decided by the project manager or the technical team against
        // the rule (bespoke and made-to-order always; standard only without a catalogue drawing), with the reason.
        open();
        const stages = await readStages(client, workspaceId, [projectId]);
        const drawingRoles = new Set(stages.filter((stage) => stage.ownerRole && stage.checks.some((check) => DRAWING_CHECKS.includes(check.kind))).map((stage) => stage.ownerRole!));
        if (!manager && !team.some((member) => member.membershipId === membershipId && member.roles.some((role) => drawingRoles.has(role))))
          throw new ForbiddenException("Only the project manager or the technical team can decide which items need drawings.");
        const item = (await readDrawingItems(client, workspaceId, projectId)).find((entry) => entry.lineId === body.lineId);
        if (!item) throw new NotFoundException("Item not found.");
        if (body.needed !== null && typeof body.needed !== "boolean") throw new BadRequestException("Choose whether it needs drawings.");
        const needed = body.needed as boolean | null;
        const reason = needed === null ? "" : typeof body.reason === "string" ? body.reason.trim() : "";
        if (needed !== null && !reason) throw new BadRequestException("Say why.");
        if (reason.length > 500) throw new BadRequestException("Keep the reason under 500 characters.");
        if ((item.override?.needed ?? null) === needed && (item.override?.reason ?? "") === reason) return this.detail(client, workspaceId, projectId, user);
        await client.query(`UPDATE project_boq_lines SET drawing_needed = $3, drawing_reason = $4, drawing_set_by = $5, drawing_set_at = now(), version = version + 1, updated_at = now()
          WHERE workspace_id = $1 AND id = $2`, [workspaceId, item.lineId, needed, reason, user.userId]);
        audit = { lineId: item.lineId, title: item.title, rule: item.rule, from: item.override?.needed ?? null, to: needed, reason };
      } else if (action === "record_technical_measure") {
        // PLM-149: the technical site measure before shop drawings, by the project manager or the factory team.
        open();
        if (!manager && !factoryHand && !team.some((member) => member.membershipId === membershipId && member.roles.includes("factory_lead")))
          throw new ForbiddenException("Only the project manager or the factory team records the technical measure.");
        if (!(await drawingRoute(client, workspaceId, projectId)).needsMeasure) throw new ConflictException("This project's route has no technical measure.");
        const measure = parseMeasure(body, await this.today(client, workspaceId));
        if (!(await recordMeasure(client, { ...measure, workspaceId, projectId, userId: user.userId }))) return this.detail(client, workspaceId, projectId, user);
        audit = { measureId: measure.measureId, measuredOn: measure.measuredOn, dimensions: measure.lines.length, note: measure.note };
      } else if (["check_drawings", "send_drawings", "decide_drawings"].includes(action)) {
        // The technical drawings (PLM-058 … 060, PLM-149): checked on site or against the design, sent to the client, and the client's decision recorded.
        open();
        const latest = await readLatestRevision(client, workspaceId, projectId, true);
        if (!latest || latest.id !== body.revisionId) throw new ConflictException("These drawings changed. Reload to see the latest revision.");
        const stages = await readStages(client, workspaceId, [projectId]);
        const revision = `R${latest.number}`;
        const route = await drawingRoute(client, workspaceId, projectId);
        // PLM-149: the client hears about drawings only from the project manager or the role the firm chose (the lead designer).
        const clientRole = drawingsClientRoleOf(settings, route.check);
        const clientFacing = manager || Boolean(clientRole && team.some((member) => member.membershipId === membershipId && member.roles.includes(clientRole)));
        const clientRoleLabel = settings.roles.find((role) => role.key === clientRole)?.label.toLowerCase() ?? null;
        const needClientFacing = (what: string) => {
          if (!clientFacing) throw new ForbiddenException(clientRoleLabel ? `Only the ${clientRoleLabel} or the project manager ${what}.` : `Only the project manager ${what}.`);
        };
        // The technical team: whoever holds the role that owns a stage with drawing checks; and whoever uploaded them.
        const drawingRoles = new Set(stages.filter((stage) => stage.ownerRole && stage.checks.some((check) => DRAWING_CHECKS.includes(check.kind))).map((stage) => stage.ownerRole!));
        const drawers = async () => {
          const uploader = await membershipOf(client, workspaceId, latest.createdBy);
          return [...team.filter((member) => member.roles.some((role) => drawingRoles.has(role))).map((member) => member.membershipId), ...(uploader ? [uploader] : [])];
        };
        if (action === "check_drawings") {
          // The site check: the technical drawer or the project manager. The design check (PLM-149): the lead designer or the project manager.
          const kind = route.check ?? "site";
          if (kind === "design") needClientFacing("checks the drawings match the design");
          else if (!manager && !team.some((member) => member.membershipId === membershipId && member.roles.some((role) => drawingRoles.has(role))))
            throw new ForbiddenException("Only the project manager or the technical team can record the site check.");
          if (latest.status !== "uploaded") throw new ConflictException(kind === "design" ? `Drawings ${revision} aren't waiting for the design check.` : `Drawings ${revision} aren't waiting for a site check.`);
          if (!latest.drawingFiles) throw new ConflictException("Upload the drawings first.");
          const result = oneOf(body.result, ["ok", "changes"] as const, "Result");
          const note = typeof body.note === "string" ? body.note.trim() : "";
          if (note.length > 1000) throw new BadRequestException("Keep the note under 1000 characters.");
          if (result === "changes" && !note) throw new BadRequestException("Say what needs changing.");
          await client.query(`UPDATE project_drawing_revisions SET status = $3, site_check = $4, site_check_note = $5, site_checked_by = $6, site_checked_at = now(), check_kind = $7,
            version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, latest.id, result === "ok" ? "checked" : "changes_needed", result, note, user.userId, kind]);
          if (result === "changes") notices.push({ key: `drawings:check:${latest.id}`, notice: { code: "project.drawings_changes", revision, note, memberships: await drawers() } });
          audit = kind === "design" ? { revisionId: latest.id, number: latest.number, designCheck: result, note } : { revisionId: latest.id, number: latest.number, siteCheck: result, note };
        } else if (action === "send_drawings") {
          needClientFacing("sends the drawings to the client");
          assertSendable(latest, route.check);
          await client.query(`UPDATE project_drawing_revisions SET status = 'sent', sent_by = $3, sent_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`,
            [workspaceId, latest.id, user.userId]);
          // The client's decision-makers hear the drawings wait for them in the portal.
          await tellClients(client, { workspaceId, caseId: project.caseId, event: "decision_waiting", recordId: `drawings:${projectId}:${latest.number}`, title: `Drawings ${revision}` });
          audit = { revisionId: latest.id, number: latest.number };
        } else {
          // The project manager (or the lead designer, PLM-149) records the client's decision: the day, who decided, and (to approve) the signed file.
          needClientFacing("records the client's decision");
          const decision = oneOf(body.decision, ["approve", "changes"] as const, "Decision");
          const decidedOn = optionalDate(body.decidedOn, "Decision date");
          if (!decidedOn) throw new BadRequestException("Say on which day the client decided.");
          assertDecidable(latest, decidedOn, await this.today(client, workspaceId));
          const decidedBy = typeof body.decidedBy === "string" ? body.decidedBy.trim() : "";
          if (!decidedBy || decidedBy.length > 200) throw new BadRequestException("Name who decided for the client.");
          const note = typeof body.note === "string" ? body.note.trim() : "";
          if (note.length > 1000) throw new BadRequestException("Keep the note under 1000 characters.");
          if (decision === "changes" && !note) throw new BadRequestException("Say what the client wants changed.");
          if (decision === "approve" && !latest.approvalFiles) throw new ConflictException("Attach the client's signed approval first.");
          audit = { revisionId: latest.id, number: latest.number, decision, decidedOn, decidedBy, note,
            ...(await decideDrawings(client, { workspaceId, projectId, revisionId: latest.id, decision, decidedOn, decidedBy, note, via: "recorded", userId: user.userId })) };
        }
      } else if (action === "book_factory_slot") {
        // PLM-068: the factory slot's day on the project (changed when it moves, cleared by the project manager).
        open();
        if (!manager && !factoryHand && !team.some((member) => member.membershipId === membershipId && member.roles.includes("factory_lead")))
          throw new ForbiddenException("Only the project manager or the factory can book the slot.");
        const slot = optionalDate(body.date, "Slot date");
        const note = typeof body.note === "string" ? body.note.trim() : "";
        const before = await writeFactorySlot(client, { workspaceId, projectId, slot, note, actorUserId: user.userId, canClear: manager,
          leads: team.filter((member) => member.lead).map((member) => member.membershipId) });
        if (!before) return this.detail(client, workspaceId, projectId, user);
        audit = { from: before.on, to: slot, note };
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
            const hard = stage.checks.find((check) => HARD_CHECKS.includes(check.kind));
            if (hard) throw new ConflictException(hard.kind === "permit_collected" ? "The building permit is mandatory; this stage can't be skipped." : "This stage checks a payment; it can't be skipped.");
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
      for (const item of notices) await noticeProject(client, { workspaceId, projectId, key: item.key, actorUserId: user.userId, notice: item.notice, ...(item.deepLink ? { deepLink: item.deepLink } : {}) });
      // A check read from records may pass now (a role named, a material list signed off): the stage owner hears it can finish.
      await noticeStageReady(client, workspaceId, projectId, user.userId);
      // A QS who isn't on the project and doesn't see projects gets the BOQ back, nothing else of the project (QA-007).
      if (qsHand && !manager && !team.some((member) => member.membershipId === membershipId)) {
        const fresh = (await readProject(client, workspaceId, projectId))!;
        const slim = { project: { id: fresh.id, reference: fresh.reference, name: fresh.name, status: fresh.status, version: fresh.version }, boq: await readBoqState(client, workspaceId, projectId) };
        return slim as unknown as Awaited<ReturnType<ProjectCoreService["detail"]>>;
      }
      return this.detail(client, workspaceId, projectId, user);
    });
  }

  // ---------- helpers ----------
  /** Moves to the next stage that isn't skipped; after the last one the project is complete. */
  private async advance(client: Db, workspaceId: string, project: ProjectRow, stages: StageRow[], finished: StageRow, team: TeamMember[], userId: string, notices: Array<{ key: string; notice: ProjectNotice }>) {
    await advanceStage(client, workspaceId, project, stages, finished, team, userId, notices);
  }

  private async detail(client: Db, workspaceId: string, projectId: string, user: ActorUser) {
    const { project, all, membershipId } = await this.visible(client, workspaceId, projectId, user);
    const settings = await ensureSettings(client, workspaceId);
    const team = (await readTeam(client, workspaceId, [projectId])).get(projectId) ?? [];
    const stages = await evaluateStages(client, workspaceId, project, await readStages(client, workspaceId, [projectId]), team);
    const manager = all || team.some((member) => member.membershipId === membershipId && member.lead);
    // Status updates and the weekly client updates (a draft only for the people who manage the project).
    // A draft client update says when it goes to the client by itself, when the firm sends them automatically (D-40).
    const updates = (await client.query<{ id: string; health: string; note: string; byName: string; at: string; sharedAt: string | null; kind: string; draft: boolean; photoIds: string[]; sendsAt: string | null }>(
      `SELECT update.id, update.health, update.note, person.display_name AS "byName", update.created_at AS at, update.shared_at AS "sharedAt", update.kind,
              (update.kind = 'client_update' AND update.approved_at IS NULL) AS draft,
              ARRAY(SELECT chosen.photo_id FROM project_update_photos chosen WHERE chosen.workspace_id = update.workspace_id AND chosen.update_id = update.id ORDER BY chosen.position) AS "photoIds",
              CASE WHEN update.kind = 'client_update' AND update.approved_at IS NULL AND $3::int IS NOT NULL THEN update.created_at + make_interval(hours => $3::int) END AS "sendsAt"
         FROM project_status_updates update JOIN users person ON person.id = update.created_by
        WHERE update.workspace_id = $1 AND update.project_id = $2 ORDER BY update.created_at DESC LIMIT 20`, [workspaceId, projectId, settings.clientUpdateAutoSendHours])).rows
      .filter((update) => !update.draft || manager);
    const seal = (await client.query<{ revisionLabel: string; quoteNumber: number; acceptedAt: string; acceptedBy: string; method: string | null; contentHash: string; sealedAt: string }>(
      `SELECT revision_label AS "revisionLabel", quote_number AS "quoteNumber", accepted_at AS "acceptedAt", accepted_by_name AS "acceptedBy",
              acceptance_method AS method, content_hash AS "contentHash", sealed_at AS "sealedAt"
         FROM project_scope_seals WHERE workspace_id = $1 AND project_id = $2 AND kind = 'baseline'`, [workspaceId, projectId])).rows[0];
    const current = stages.find((stage) => stage.status === "current");
    const money = await moneyAccess(client, this.access, workspaceId, user.userId, { all, onTeam: team.some((member) => member.membershipId === membershipId) });
    // QA-006: the agreed value only for the people who see it.
    const canSeeValue = await valueAccess(client, this.access, workspaceId, user.userId, { all, onTeam: team.some((member) => member.membershipId === membershipId) });
    const notApplicable = await notApplicableRoles(client, workspaceId, { projectId });
    const site = (await client.query<{ startedOn: string | null; finishedOn: string | null }>(
      `SELECT site_started_on::text AS "startedOn", site_finished_on::text AS "finishedOn" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0];
    return {
      project: { ...withValue(summary(project), canSeeValue), caseId: project.caseId, opportunityId: project.opportunityId, opportunityReference: project.opportunityReference,
        holdReason: project.holdReason, holdReviewOn: project.holdReviewOn, startDate: project.startDate, templateName: project.templateName, version: project.version,
        closedAt: project.cancelledAt ?? project.completedAt, closedByName: project.closedByName, cancelReason: project.cancelReason, heldAt: project.heldAt,
        siteStartedOn: site?.startedOn ?? null, siteFinishedOn: site?.finishedOn ?? null,
        handoverAccepted: Boolean((await client.query(`SELECT 1 FROM handover_packs WHERE workspace_id = $1 AND project_id = $2 AND status = 'accepted' LIMIT 1`, [workspaceId, projectId])).rowCount) },
      hold: project.status === "on_hold" ? await holdLength(client, workspaceId, projectId) : null,
      seal,
      roles: settings.roles,
      team: settings.roles.map((role) => ({ role: role.key, label: role.label, member: team.find((member) => member.roles.includes(role.key)) ?? null }))
        .map(({ member, ...role }) => ({ ...role, member: member ? { membershipId: member.membershipId, name: member.name, email: member.email ?? null } : null,
          notApplicable: !member && notApplicable.includes(role.role) })),
      // PLM-089: people outside Wodana who do the work (installers, subcontractors).
      teamNote: await teamNote(client, workspaceId, projectId),
      stages: stages.map((stage) => ({ ...stage, canWork: stage.status === "current" && project.status === "active"
        && (manager || Boolean(stage.ownerRole && team.some((member) => member.membershipId === membershipId && member.roles.includes(stage.ownerRole!)))) })),
      next: current ? nextStep(current, settings, team) : null,
      updates,
      members: manager ? await activeMembers(client, workspaceId) : [],
      canManage: manager,
      canClose: all,
      // The Money tab is for people who see costs.
      // Who sees what of the money: costs (with margin only for commercial costs), and the client side.
      money,
      canSeeMoney: money.costs,
      canSeeValue,
      progress: (await readProgress(client, workspaceId, projectId)).project,
      // PLM-068: the factory slot booked for the project; the project manager, its factory lead or the factory books it.
      factorySlot: (await client.query<{ date: string; note: string; byName: string | null; at: string | null }>(
        `SELECT project.factory_slot_on::text AS date, project.factory_slot_note AS note, booker.display_name AS "byName", project.factory_slot_at AS at
           FROM delivery_projects project LEFT JOIN users booker ON booker.id = project.factory_slot_by
          WHERE project.workspace_id = $1 AND project.id = $2 AND project.factory_slot_on IS NOT NULL`, [workspaceId, projectId])).rows[0] ?? null,
      canBookSlot: ["active", "on_hold"].includes(project.status) && (manager || team.some((member) => member.membershipId === membershipId && member.roles.includes("factory_lead"))
        || await this.any(client, workspaceId, user.userId, ["factory.manage"])),
      // PLM-057 … 060: whether the route keeps drawings, and where the latest revision stands.
      drawings: { ...(await drawingRoute(client, workspaceId, projectId)), latest: await readLatestRevision(client, workspaceId, projectId)
        .then((latest) => (latest ? { id: latest.id, number: latest.number, status: latest.status } : null)) },
      // PLM-063: the project's production, read from its work orders (none when the factory makes nothing for it).
      production: (await readProduction(client, workspaceId, projectId)).projects[0] ?? null,
      // PLM-069: delivery and installation; the project manager or the installation team schedules them.
      // Who goes on the delivery and the installation (people by name, the vehicle and driver) and the building permit (Palm, 6 Oct).
      installation: { ...await readInstallation(client, workspaceId, projectId), ...await readInstallationCrew(client, workspaceId, projectId) },
      canScheduleInstallation: ["active", "on_hold"].includes(project.status) && (manager
        || team.some((member) => member.membershipId === membershipId && member.roles.some((role) => installationRoles(stages).includes(role)))),
      // PLM-098: the areas this job's enquiry-type path uses after Won (and any area that already holds a record).
      areas: await projectAreas(client, workspaceId, projectId, project.caseId ?? null),
    };
  }

  /** Who may read the project; `qs` opens the BOQ reads (the scope, the material list) to the QS, never the project record itself (QA-007). */
  private async visible(client: Db, workspaceId: string, projectId: string, user: ActorUser, options: { qs?: boolean } = {}) {
    const project = await readProject(client, workspaceId, projectId);
    if (!project) throw new NotFoundException("Project not found.");
    const membershipId = await membershipOf(client, workspaceId, user.userId);
    // PLM-062: the factory reads a project its work comes from (read-only): once the client approved its drawings, or
    // while its route asks the factory to book a slot or to take the technical measure (PLM-149).
    const factoryReader = async () => {
      if (!(await this.any(client, workspaceId, user.userId, ["factory.view", "factory.manage"]))) return false;
      if (await productionReleased(client, workspaceId, projectId)) return true;
      const route = await drawingRoute(client, workspaceId, projectId);
      return route.factorySlot || route.needsMeasure;
    };
    // PLM-168 / PLM-159: the QS reads the BOQ and the material list to approve and confirm them, where the read allows it.
    const qsReader = async () => options.qs === true && await this.any(client, workspaceId, user.userId, ["commercial.estimate"]);
    const projects = await this.any(client, workspaceId, user.userId, ["projects.manage", "projects.view"]);
    if (!projects) {
      if (await factoryReader()) return { project, all: false, membershipId, factory: true };
      if (await qsReader()) return { project, all: false, membershipId, factory: false };
      throw new ForbiddenException("You don't have access to projects.");
    }
    const { all } = await this.viewer(client, workspaceId, user);
    if (!all) {
      const assigned = (await client.query(`SELECT 1 FROM project_assignments WHERE workspace_id = $1 AND project_id = $2 AND membership_id = $3 AND active`, [workspaceId, projectId, membershipId])).rowCount;
      if (!assigned && !(await factoryReader()) && !(await qsReader())) throw new NotFoundException("Project not found.");
    }
    return { project, all, membershipId, factory: false };
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

async function teamNote(client: Db, workspaceId: string, projectId: string) {
  return (await client.query<{ note: string }>(`SELECT team_note AS note FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0]?.note ?? "";
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
  if (check.kind === "drawings_uploaded") return "Technical drawings uploaded";
  if (check.kind === "drawings_site_checked") return "Technical site check passed";
  if (check.kind === "technical_measure_done") return "Technical site measure done";
  if (check.kind === "drawings_design_checked") return "Drawings match the design";
  if (check.kind === "drawings_client_approved") return "Client approved the drawings";
  if (check.kind === "factory_slot_booked") return "Factory slot booked";
  if (check.kind === "installation_scheduled") return "Installation scheduled";
  if (check.kind === "goods_delivered") return "Everything delivered";
  if (check.kind === "installation_done") return "Installation signed off";
  if (check.kind === "permit_collected") return "Building permit collected";
  return "Production payment verified";
}

/** The project's next step: the current stage's first open check and who holds it. */
function nextStep(stage: Evaluated, settings: { roles: Array<{ key: string; label: string }>; drawingsClientRole: string | null }, team: TeamMember[]) {
  const open = stage.checks.find((check) => !check.passed);
  // PLM-149: the technical measure is the project manager's; the design check and the client's approval the lead designer's (when the firm chose one).
  const clientRole = drawingsClientRoleOf(settings, stage.checks.some((check) => check.kind === "drawings_design_checked") ? "design" : null);
  const own = open?.kind === "technical_measure_done" ? LEAD_ROLE
    : (open?.kind === "drawings_design_checked" || open?.kind === "drawings_client_approved") && clientRole ? clientRole : null;
  if (own) return { stage: stage.name, kind: open!.kind, text: checkLabel(open!, settings.roles), role: own, owner: team.find((member) => member.roles.includes(own))?.name ?? null };
  return {
    stage: stage.name,
    kind: open ? open.kind : "finish",
    text: open ? checkLabel(open, settings.roles) : `Finish ${stage.name}`,
    role: open?.kind === "payment_verified" ? null : stage.ownerRole,
    owner: open?.kind === "payment_verified" ? null : stage.owner?.name ?? null,
  };
}

function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (!options.includes(value as T)) throw new BadRequestException(`${label} is not valid.`);
  return value as T;
}
