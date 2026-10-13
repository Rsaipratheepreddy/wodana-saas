import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { DESIGNER_ROLE, membersInRoles } from "../project-core/project-keep-informed";
import { permissionHolders } from "../project-core/project-release";
import { settledTeam } from "../project-core/project-team";
import { noticeWork } from "../project-core/project-notices";
import { ensureProjectAccess, snagCheckers, workEvent } from "../project-core/project-work";
import { readCalendar, workdays } from "../project-core/work-calendar";
import { ensureFactorySettings, FINAL_PENDING, type FactorySettings } from "./factory";
import { projectReady } from "./factory-ready";
import { workspaceDay } from "./workcenter-rates";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-150: design inspections at the factory. Each made item (a work order) of a trade that needs them is inspected by
 * the design team in up to two stages: Inspection 1 in raw material before the final finish (e.g. before veneer) and
 * Inspection 2 after finishing, before dispatch. The factory marks the item ready (Inspection 2 is asked for by itself
 * once the item is ready); the inspection goes to the project's inspecting designer (the role the firm names, or its
 * director role on projects of the listed design packages; the project's designer when nobody holds it) and the project
 * manager may attend. The designer passes it, or fails it with photos and comments: each problem is a snag (a
 * rectification task for the factory, in the project's one task system). Once the factory fixed them the item comes
 * back for the next round by itself. Every round is kept. Finishing waits for Inspection 1; dispatch to site and
 * booking the delivery wait for Inspection 2.
 */
export const INSPECTION_STAGE_KINDS = ["raw", "final"] as const;
export type InspectionStageKind = (typeof INSPECTION_STAGE_KINDS)[number];
/** A stage as the firm keeps it: its kind and its own name for it (empty: the standard name). */
export type InspectionStage = { kind: InspectionStageKind; label: string };
export const DEFAULT_INSPECTION_STAGES: InspectionStage[] = [{ kind: "raw", label: "" }, { kind: "final", label: "" }];
export const SNAG_SEVERITIES = ["minor", "major", "critical"] as const;

export type InspectionSettings = {
  enabled: boolean; stages: InspectionStage[];
  /** The trades (workspace work packages) whose made items are inspected; none listed: every made item. */
  workPackageIds: string[];
  /** The project role that inspects; on projects of `directorPackages` (design package codes) `directorRole` inspects instead. */
  inspectorRole: string; directorRole: string | null; directorPackages: string[];
  /** Working days the inspecting designer has before it is overdue. */
  days: number;
};

const ROLE = /^[a-z][a-z0-9_]{0,59}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The stored stages, read leniently: known kinds, each once, raw before final, always ending with final; both when nothing usable is stored. */
export function normaliseInspectionStages(value: unknown): InspectionStage[] {
  if (!Array.isArray(value)) return DEFAULT_INSPECTION_STAGES;
  const seen = new Set<string>();
  const stages = value.flatMap((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const kind = row.kind as InspectionStageKind;
    if (!INSPECTION_STAGE_KINDS.includes(kind) || seen.has(kind)) return [];
    seen.add(kind);
    return [{ kind, label: typeof row.label === "string" ? row.label.trim().slice(0, 60) : "" }];
  }).sort((a, b) => INSPECTION_STAGE_KINDS.indexOf(a.kind) - INSPECTION_STAGE_KINDS.indexOf(b.kind));
  return stages.length && stages.at(-1)!.kind === "final" ? stages : DEFAULT_INSPECTION_STAGES;
}

/** Validates a change to the stages: one (after finishing) or both, each once, in their order, with names of up to 60 characters. */
export function parseInspectionStages(input: unknown): InspectionStage[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 2) throw new BadRequestException("Keep one or two inspections.");
  const stages = input.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    if (!INSPECTION_STAGE_KINDS.includes(row.kind as InspectionStageKind)) throw new BadRequestException("Unknown inspection.");
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (label.length > 60) throw new BadRequestException("Keep each inspection's name under 60 characters.");
    return { kind: row.kind as InspectionStageKind, label };
  });
  if (new Set(stages.map((stage) => stage.kind)).size !== stages.length) throw new BadRequestException("Each inspection appears once.");
  if (stages.at(-1)!.kind !== "final") throw new BadRequestException("The last inspection is after finishing, before dispatch.");
  return stages;
}

export function inspectionSettings(settings: Pick<FactorySettings, "inspectionsEnabled" | "inspectionStages" | "inspectionWorkPackages" | "inspectorRole" | "directorRole"
  | "directorPackages" | "inspectionDays">): InspectionSettings {
  return {
    enabled: Boolean(settings.inspectionsEnabled), stages: normaliseInspectionStages(settings.inspectionStages), workPackageIds: settings.inspectionWorkPackages ?? [],
    inspectorRole: settings.inspectorRole || DESIGNER_ROLE, directorRole: settings.directorRole ?? null, directorPackages: settings.directorPackages ?? [],
    days: Number(settings.inspectionDays) || 2,
  };
}

/**
 * Validates a change to the inspection settings against the firm's choices (its project roles, trades and design
 * packages). Fields left out keep their value.
 */
export function parseInspectionSettings(body: Record<string, unknown>, current: InspectionSettings, choices: { roles: string[]; workPackages: string[]; designPackages: string[] }): InspectionSettings {
  const next = { ...current };
  if (body.inspectionsEnabled !== undefined) next.enabled = body.inspectionsEnabled === true;
  if (body.inspectionStages !== undefined) next.stages = parseInspectionStages(body.inspectionStages);
  if (body.inspectionWorkPackages !== undefined) {
    const ids = body.inspectionWorkPackages;
    if (!Array.isArray(ids) || ids.length > 50 || ids.some((id) => typeof id !== "string" || !choices.workPackages.includes(id))) throw new BadRequestException("Choose trades the firm uses.");
    next.workPackageIds = [...new Set(ids as string[])];
  }
  if (body.inspectorRole !== undefined) {
    if (typeof body.inspectorRole !== "string" || !ROLE.test(body.inspectorRole) || !choices.roles.includes(body.inspectorRole)) throw new BadRequestException("Choose the project role that inspects.");
    next.inspectorRole = body.inspectorRole;
  }
  if (body.directorRole !== undefined) {
    if (body.directorRole === null || body.directorRole === "") next.directorRole = null;
    else if (typeof body.directorRole !== "string" || !ROLE.test(body.directorRole) || !choices.roles.includes(body.directorRole)) throw new BadRequestException("Choose a project role.");
    else next.directorRole = body.directorRole;
  }
  if (body.directorPackages !== undefined) {
    const codes = body.directorPackages;
    if (!Array.isArray(codes) || codes.length > 20 || codes.some((code) => typeof code !== "string" || !choices.designPackages.includes(code))) throw new BadRequestException("Choose design packages the firm offers.");
    next.directorPackages = [...new Set(codes as string[])];
  }
  if (body.inspectionDays !== undefined) {
    const days = Number(body.inspectionDays);
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new BadRequestException("Give the designer 1 to 30 working days to inspect.");
    next.days = days;
  }
  return next;
}

/** The stages a made item needs: none while inspections are off or its trade isn't listed (an item with no trade is inspected). */
export function stagesFor(settings: InspectionSettings, workPackageId: string | null): InspectionStageKind[] {
  if (!settings.enabled) return [];
  if (settings.workPackageIds.length && workPackageId && !settings.workPackageIds.includes(workPackageId)) return [];
  return settings.stages.map((stage) => stage.kind);
}

/** A stage as notices and messages name it: the firm's name, else Inspection 1 / 2 (or "the design inspection" when it keeps one). */
export function stageName(stage: InspectionStageKind, stages: InspectionStage[]) {
  const kept = stages.find((entry) => entry.kind === stage);
  if (kept?.label) return kept.label;
  if (stages.length === 1) return "the design inspection";
  return stage === "raw" ? "Inspection 1" : "Inspection 2";
}

/** Where one stage of an item is: not needed, still to be asked for, due with the designer, snags with the factory, or passed. */
export type StageState = "not_needed" | "to_request" | "due" | "snags" | "passed";
export type RoundFact = { status: "due" | "passed" | "failed" | "cancelled"; openSnags: number; reworkedAfter: boolean };

export function stageState(needed: boolean, rounds: RoundFact[], final: boolean): StageState {
  if (!needed) return "not_needed";
  const last = rounds.at(-1);
  if (!last || last.status === "cancelled") return "to_request";
  if (last.status === "due") return "due";
  if (last.status === "failed") return last.openSnags > 0 ? "snags" : "to_request";
  return final && last.reworkedAfter ? "to_request" : "passed";
}

export type OrderInspection = {
  raw: StageState; final: StageState;
  /** The round open with the designer, and the latest round (any status). */
  dueId: string | null; dueStage: InspectionStageKind | null; dueOn: string | null; latestId: string | null;
  /** Who the open round is with (null: nobody on the team inspects), and the snags the factory still has to fix. */
  inspectorName: string | null; openSnags: number;
};

/**
 * Each work order's inspection state (only work orders that need inspections are in the map; none while the firm has
 * inspections switched off).
 */
export async function readOrderInspections(db: Db, workspaceId: string, filter: { orderIds?: string[]; projectId?: string } = {}): Promise<Map<string, OrderInspection>> {
  if (!(await inspectionsOn(db, workspaceId))) return new Map();
  const orders = (await db.query<{ id: string; stages: string[] }>(
    `SELECT wo.id, wo.inspection_stages::text[] AS stages FROM work_orders wo
      WHERE wo.workspace_id = $1 AND cardinality(coalesce(wo.inspection_stages, '{}'::varchar[])) > 0
        AND ($2::uuid[] IS NULL OR wo.id = ANY($2::uuid[])) AND ($3::uuid IS NULL OR wo.project_id = $3::uuid)`,
    [workspaceId, filter.orderIds ?? null, filter.projectId ?? null])).rows;
  if (!orders.length) return new Map();
  const rounds = (await db.query<RoundFact & { id: string; workOrderId: string; stage: InspectionStageKind; dueOn: string; inspectorName: string | null }>(
    `SELECT inspection.id, inspection.work_order_id AS "workOrderId", inspection.stage, inspection.status, inspection.due_on::text AS "dueOn",
            (SELECT coalesce(person.display_name, person.primary_email) FROM workspace_memberships member JOIN users person ON person.id = member.user_id
              WHERE member.workspace_id = inspection.workspace_id AND member.id = inspection.inspector_membership_id) AS "inspectorName",
            (SELECT count(*)::int FROM work_items snag WHERE snag.workspace_id = inspection.workspace_id AND snag.factory_inspection_id = inspection.id
               AND snag.status IN ('todo', 'in_progress')) AS "openSnags",
            (inspection.status = 'passed' AND EXISTS (SELECT 1 FROM work_order_reworks back WHERE back.workspace_id = inspection.workspace_id
               AND back.work_order_id = inspection.work_order_id AND back.created_at > inspection.result_at)) AS "reworkedAfter"
       FROM factory_inspections inspection
      WHERE inspection.workspace_id = $1 AND inspection.work_order_id = ANY($2::uuid[])
      ORDER BY inspection.work_order_id, inspection.stage, inspection.round`, [workspaceId, orders.map((order) => order.id)])).rows;
  const result = new Map<string, OrderInspection>();
  for (const order of orders) {
    const mine = rounds.filter((round) => round.workOrderId === order.id);
    const of = (stage: InspectionStageKind) => mine.filter((round) => round.stage === stage);
    const due = mine.find((round) => round.status === "due") ?? null;
    const latest = [...mine].sort((a, b) => (a.stage === b.stage ? 0 : a.stage === "raw" ? -1 : 1)).at(-1) ?? null;
    result.set(order.id, {
      raw: stageState(order.stages.includes("raw"), of("raw"), false), final: stageState(order.stages.includes("final"), of("final"), true),
      dueId: due?.id ?? null, dueStage: due?.stage ?? null, dueOn: due?.dueOn ?? null, latestId: latest?.id ?? null,
      inspectorName: due?.inspectorName ?? null, openSnags: mine.reduce((sum, round) => sum + round.openSnags, 0),
    });
  }
  return result;
}

/** Whether the firm inspects made items now (switched off, nothing waits on an inspection). */
export async function inspectionsOn(db: Db, workspaceId: string) {
  return Boolean((await db.query<{ on: boolean }>(`SELECT inspections_enabled AS on FROM workspace_factory_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.on);
}

/**
 * Fixes the stages a work order needs from the firm's settings and its scope line's trade: when it is planned, and
 * again when it starts (so a setting changed in between applies). A work order from before inspections keeps none.
 */
export async function fixInspectionStages(db: Db, workspaceId: string, workOrderId: string, when: "planned" | "started") {
  const settings = inspectionSettings(await ensureFactorySettings(db, workspaceId));
  const order = (await db.query<{ stages: string[] | null; workPackageId: string | null }>(
    `SELECT wo.inspection_stages::text[] AS stages, line.work_package_id AS "workPackageId" FROM work_orders wo
       JOIN project_boq_lines line ON line.workspace_id = wo.workspace_id AND line.id = wo.boq_line_id
      WHERE wo.workspace_id = $1 AND wo.id = $2`, [workspaceId, workOrderId])).rows[0];
  if (!order || (when === "started" && order.stages === null)) return;
  await db.query(`UPDATE work_orders SET inspection_stages = $3::varchar[] WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, workOrderId, stagesFor(settings, order.workPackageId)]);
}

/** Whether the project's design package is one the director inspects (its code is listed and a director role is set). */
async function directorProject(db: Db, workspaceId: string, projectId: string, settings: InspectionSettings) {
  if (!settings.directorRole || !settings.directorPackages.length) return false;
  const code = (await db.query<{ code: string }>(
    `SELECT package.code FROM delivery_projects project
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
       JOIN crm_opportunity_discovery discovery ON discovery.workspace_id = pre_case.workspace_id AND discovery.opportunity_id = pre_case.opportunity_id
       JOIN design_packages package ON package.workspace_id = discovery.workspace_id AND package.id = discovery.design_package_id
      WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, projectId])).rows[0]?.code;
  return Boolean(code && settings.directorPackages.includes(code));
}

/** The project roles that inspect, in order: the director (on its packages), the inspecting role, then the designer. */
export async function inspectingRoles(db: Db, workspaceId: string, projectId: string, settings: InspectionSettings) {
  const roles = await directorProject(db, workspaceId, projectId, settings) ? [settings.directorRole!, settings.inspectorRole] : [settings.inspectorRole];
  return [...new Set([...roles, DESIGNER_ROLE])];
}

/**
 * Who inspects a project's items, read from its team: the first inspecting role someone holds; else the project's
 * designer (the opportunity's dedicated designer while nobody holds the role); else nobody (the role it should have).
 */
export async function inspectorFor(db: Db, workspaceId: string, projectId: string, settings: InspectionSettings): Promise<{ membershipId: string | null; role: string }> {
  const roles = await inspectingRoles(db, workspaceId, projectId, settings);
  const team = await settledTeam(db, workspaceId, { projectId });
  for (const role of roles) {
    const holder = team.get(role)?.membershipId;
    if (holder) return { membershipId: holder, role };
  }
  // On the director's packages the director inspects even when not on the project's team: whoever holds the
  // workspace role or team with that code (e.g. the Creative Director, who reviews those packages' designs).
  if (settings.directorRole && roles[0] === settings.directorRole) {
    const director = (await workspaceRoleHolders(db, workspaceId, settings.directorRole))[0];
    if (director) return { membershipId: director, role: settings.directorRole };
  }
  const designer = (await membersInRoles(db, workspaceId, projectId, [DESIGNER_ROLE]))[0];
  return designer ? { membershipId: designer, role: DESIGNER_ROLE } : { membershipId: null, role: roles[0] };
}

/** Active members holding a workspace role, or in an active team, whose code matches (case-insensitive). */
async function workspaceRoleHolders(db: Db, workspaceId: string, code: string): Promise<string[]> {
  return (await db.query<{ id: string }>(
    `SELECT membership.id FROM workspace_memberships membership
       JOIN effective_member_roles assigned ON assigned.membership_id = membership.id AND assigned.workspace_id = membership.workspace_id
       JOIN roles role ON role.id = assigned.role_id AND role.workspace_id = membership.workspace_id
      WHERE membership.workspace_id = $1 AND membership.status = 'active' AND lower(role.code) = lower($2)
     UNION
     SELECT membership.id FROM workspace_memberships membership
       JOIN workspace_team_members member ON member.membership_id = membership.id AND member.workspace_id = membership.workspace_id
       JOIN workspace_teams team ON team.id = member.team_id AND team.workspace_id = member.workspace_id AND team.status = 'active'
      WHERE membership.workspace_id = $1 AND membership.status = 'active' AND lower(team.code) = lower($2)
      ORDER BY 1`, [workspaceId, code])).rows.map((row) => row.id);
}

type OrderFacts = { id: string; number: number; title: string; status: string; projectId: string; projectReference: string; projectName: string; stages: string[] | null;
  boqLineId: string; packageId: string | null };

async function orderFacts(db: Db, workspaceId: string, workOrderId: string, lock = false): Promise<OrderFacts | null> {
  return (await db.query<OrderFacts>(
    `SELECT wo.id, wo.number, wo.title, wo.status, wo.project_id AS "projectId", project.reference AS "projectReference", project.name AS "projectName",
            wo.inspection_stages::text[] AS stages, wo.boq_line_id AS "boqLineId", wo.package_id AS "packageId"
       FROM work_orders wo JOIN delivery_projects project ON project.workspace_id = wo.workspace_id AND project.id = wo.project_id
      WHERE wo.workspace_id = $1 AND wo.id = $2 ${lock ? "FOR UPDATE OF wo" : ""}`, [workspaceId, workOrderId])).rows[0] ?? null;
}

const orderNumber = (number: number) => `WO-${String(number).padStart(4, "0")}`;

/**
 * Asks for a stage's next round: the factory marked the item ready (by hand, or by itself once it is ready, or once the
 * last snag of a failed round is fixed). Replayed safely: an open round is returned as it is. `auto` asks quietly:
 * nothing happens where a person would be refused.
 */
export async function requestInspection(db: Db, workspaceId: string, input: { workOrderId: string; stage: InspectionStageKind; actorId: string; requesterId?: string; auto: boolean }) {
  const refuse = (message: string) => { if (input.auto) return null; throw new ConflictException(message); };
  const order = await orderFacts(db, workspaceId, input.workOrderId, true);
  if (!order) throw new NotFoundException("Work order not found.");
  const settings = inspectionSettings(await ensureFactorySettings(db, workspaceId));
  const label = stageName(input.stage, settings.stages);
  if (!settings.enabled) return refuse("Design inspections are switched off.");
  if (!(order.stages ?? []).includes(input.stage)) return refuse(`${orderNumber(order.number)} doesn't need ${label}.`);
  if (!input.auto) {
    if (input.stage === "raw" && order.status !== "in_production") return refuse(`Mark it ready for ${label} while it's in production, before the final finish.`);
    if (input.stage === "final" && !["ready", "short_closed"].includes(order.status)) return refuse(`It goes for ${label} once it's made and checked.`);
  }
  if (order.status === "cancelled") return refuse("The work order is cancelled.");
  const state = (await readOrderInspections(db, workspaceId, { orderIds: [order.id] })).get(order.id)!;
  const current = input.stage === "raw" ? state.raw : state.final;
  if (current === "due") return { id: state.dueId!, created: false };
  if (current === "passed") return refuse(`It already passed ${label}.`);
  if (current === "snags") return refuse(`Fix its ${state.openSnags === 1 ? "snag" : `${state.openSnags} snags`} first: it then goes back for ${label} by itself.`);
  const previous = (await db.query<{ round: number; status: string; requestedBy: string }>(
    `SELECT round, status, requested_by AS "requestedBy" FROM factory_inspections WHERE workspace_id = $1 AND work_order_id = $2 AND stage = $3 ORDER BY round DESC LIMIT 1`,
    [workspaceId, order.id, input.stage])).rows[0];
  const inspector = await inspectorFor(db, workspaceId, order.projectId, settings);
  const today = (await workspaceDay(db, workspaceId)).today;
  const dueOn = workdays(await readCalendar(db, workspaceId)).shift(today, settings.days);
  const id = randomUUID();
  const requester = input.requesterId ?? input.actorId;
  await db.query(
    `INSERT INTO factory_inspections (id, workspace_id, work_order_id, project_id, stage, round, requested_by, due_on, inspector_membership_id, inspector_role)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, workspaceId, order.id, order.projectId, input.stage, (previous?.round ?? 0) + 1, requester, dueOn, inspector.membershipId, inspector.role]);
  const round = (previous?.round ?? 0) + 1;
  await orderEvent(db, workspaceId, order.id, "inspection_requested", { inspectionId: id, stage: input.stage, round, dueOn, auto: input.auto }, input.actorId);
  await recordAudit(db, { workspaceId, actorUserId: input.actorId, action: "work_order.inspection_requested", entityType: "work_order", entityId: order.id,
    after: { inspectionId: id, stage: label, round, dueOn, inspectorMembershipId: inspector.membershipId } });
  // The inspecting designer, and the project manager (who may attend); without an inspector, the project's managers hear nobody will.
  const again = previous?.status === "failed";
  const variables = await noticeVariables(db, workspaceId, order, label, input.actorId, dueOn);
  const managers = await projectManagers(db, workspaceId, order.projectId);
  const inspectorUser = inspector.membershipId ? await userOf(db, workspaceId, inspector.membershipId) : null;
  const code = again ? "factory.reinspection_ready" : "factory.inspection_ready";
  if (inspectorUser) await tell(db, workspaceId, [inspectorUser], input.actorId, { code, variables: { ...variables, note: "" }, link: inspectionHref(id), key: id });
  else await tell(db, workspaceId, managers.length ? managers : (await permissionHolders(db, workspaceId, ["projects.manage"])).map((row) => row.userId), input.actorId,
    { code: "factory.inspector_missing", variables: { ...variables, note: await roleLabel(db, workspaceId, inspector.role) }, link: inspectionHref(id), key: id });
  if (inspectorUser) await tell(db, workspaceId, managers.filter((user) => user !== inspectorUser), input.actorId,
    { code, variables: { ...variables, note: "You may attend." }, link: inspectionHref(id), key: `${id}:attend` });
  return { id, created: true };
}

export const inspectionHref = (id: string) => `/workspace/inspections/${id}`;

/** Who may record a round's result: its inspector, anyone on the project in an inspecting role, or a manager; never the factory person who asked. */
export async function recordRights(db: Db, workspaceId: string, inspection: { projectId: string; requestedBy: string; inspectorMembershipId: string | null },
  userId: string, manages: boolean): Promise<{ canRecord: boolean; why: string | null }> {
  if (userId === inspection.requestedBy) return { canRecord: false, why: "The factory marked it ready: someone in the design team records the inspection." };
  if (manages) return { canRecord: true, why: null };
  const settings = inspectionSettings(await ensureFactorySettings(db, workspaceId));
  const roles = await inspectingRoles(db, workspaceId, inspection.projectId, settings);
  const mine = (await db.query<{ membershipId: string; roles: string[]; manager: boolean }>(
    `SELECT membership.id AS "membershipId", coalesce(assignment.role_keys::text[], '{}') AS roles, coalesce(assignment.is_manager, false) AS manager
       FROM workspace_memberships membership
       LEFT JOIN project_assignments assignment ON assignment.workspace_id = membership.workspace_id AND assignment.membership_id = membership.id
            AND assignment.project_id = $3 AND assignment.active
      WHERE membership.workspace_id = $1 AND membership.user_id = $2 AND membership.status = 'active'`, [workspaceId, userId, inspection.projectId])).rows[0];
  if (!mine) return { canRecord: false, why: "You aren't a member of this workspace." };
  if (mine.manager || mine.membershipId === inspection.inspectorMembershipId || mine.roles.some((role) => roles.includes(role))) return { canRecord: true, why: null };
  return { canRecord: false, why: "Only the inspecting designer or a manager records it." };
}

export type SnagLine = { title: string; severity: (typeof SNAG_SEVERITIES)[number] };

/** The snag lines of a failed round: 1 to 30, each named, with how serious it is (major unless said). */
export function parseSnagLines(input: unknown): SnagLine[] {
  if (!Array.isArray(input) || !input.length) throw new BadRequestException("List what has to be fixed: at least one snag.");
  if (input.length > 30) throw new BadRequestException("List up to 30 snags.");
  return input.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    if (!title || title.length > 300) throw new BadRequestException("Name each snag in up to 300 characters.");
    const severity = row.severity === undefined ? "major" : row.severity;
    if (!SNAG_SEVERITIES.includes(severity as SnagLine["severity"])) throw new BadRequestException("Choose how serious each snag is.");
    return { title, severity: severity as SnagLine["severity"] };
  });
}

type InspectionRow = { id: string; workOrderId: string; projectId: string; stage: InspectionStageKind; round: number; status: string; requestedBy: string; inspectorMembershipId: string | null;
  dueOn: string; version: number };

async function inspectionRow(db: Db, workspaceId: string, id: string, lock = false) {
  if (!UUID.test(id)) throw new BadRequestException("Inspection isn't valid.");
  return (await db.query<InspectionRow>(
    `SELECT id, work_order_id AS "workOrderId", project_id AS "projectId", stage, round, status, requested_by AS "requestedBy",
            inspector_membership_id AS "inspectorMembershipId", due_on::text AS "dueOn", version
       FROM factory_inspections WHERE workspace_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}`, [workspaceId, id])).rows[0] ?? null;
}

/**
 * Records a round's result, version-checked. Passed: the snags of the rounds before that were fixed are closed (the
 * inspection is their check); after Inspection 1 the factory hears finishing can go ahead, after the last one the
 * project manager and the factory hear it can go to site. Failed (comments and at least one photo): each snag line is
 * a snag for the factory (its lead on the team, else whoever marked it ready), due in the firm's working days; the
 * factory hears what to fix and the project manager that it failed.
 */
export async function recordInspection(db: Db, workspaceId: string, input: { id: string; body: Record<string, unknown>; userId: string; manages: boolean }) {
  const inspection = await inspectionRow(db, workspaceId, input.id, true);
  if (!inspection) throw new NotFoundException("Inspection not found.");
  const order = await orderFacts(db, workspaceId, inspection.workOrderId, true);
  if (!order) throw new NotFoundException("Work order not found.");
  if (input.body.version !== inspection.version) throw new ConflictException("Someone else changed this inspection. Reload to see their changes.");
  if (inspection.status !== "due") throw new ConflictException(inspection.status === "cancelled" ? "This inspection was withdrawn." : "This inspection is already recorded.");
  if (order.status === "cancelled") throw new ConflictException("The work order is cancelled.");
  const rights = await recordRights(db, workspaceId, inspection, input.userId, input.manages);
  if (!rights.canRecord) throw new ForbiddenException(rights.why ?? "You can't record this inspection.");
  const action = String(input.body.action ?? "");
  if (action !== "pass" && action !== "fail") throw new BadRequestException("Pass or fail it.");
  const comments = typeof input.body.comments === "string" ? input.body.comments.trim() : "";
  if (comments.length > 2000) throw new BadRequestException("Keep the comments under 2000 characters.");
  const settings = inspectionSettings(await ensureFactorySettings(db, workspaceId));
  const label = stageName(inspection.stage, settings.stages);
  const today = (await workspaceDay(db, workspaceId)).today;
  let snags: SnagLine[] = [];
  if (action === "fail") {
    if (!comments) throw new BadRequestException("Say what's wrong.");
    snags = parseSnagLines(input.body.snags);
    const photos = (await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM factory_inspection_photos WHERE workspace_id = $1 AND inspection_id = $2`,
      [workspaceId, inspection.id])).rows[0].count;
    if (!photos) throw new BadRequestException("Add a photo of what's wrong before failing it.");
  }
  await db.query(`UPDATE factory_inspections SET status = $3, result_by = $4, result_at = now(), comments = $5, version = version + 1, updated_at = now()
    WHERE workspace_id = $1 AND id = $2`, [workspaceId, inspection.id, action === "pass" ? "passed" : "failed", input.userId, comments]);
  // The snags of earlier rounds the factory marked fixed: this round looked at them.
  const fixed = (await db.query<{ id: string }>(
    `UPDATE work_items SET status = 'done', completed_at = now(), completed_by = $4, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND status = 'in_review' AND factory_inspection_id IN (SELECT id FROM factory_inspections WHERE workspace_id = $1 AND work_order_id = $2 AND stage = $3 AND id <> $5)
      RETURNING id`, [workspaceId, order.id, inspection.stage, input.userId, inspection.id])).rows;
  for (const snag of fixed) await workEvent(db, workspaceId, snag.id, "status", { from: "in_review", to: "done", via: "inspection", inspectionId: inspection.id }, input.userId);
  const variables = await noticeVariables(db, workspaceId, order, label, input.userId, today);
  const managers = await projectManagers(db, workspaceId, order.projectId);
  const factoryLead = (await settledTeam(db, workspaceId, { projectId: order.projectId })).get("factory_lead")?.membershipId ?? null;
  const factoryPeople = [inspection.requestedBy, ...(factoryLead ? [await userOf(db, workspaceId, factoryLead)] : [])].filter((user): user is string => Boolean(user));
  let created: Array<{ id: string; number: number }> = [];
  if (action === "fail") {
    const requester = (await db.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`,
      [workspaceId, inspection.requestedBy])).rows[0]?.id ?? null;
    const assignee = factoryLead ?? requester;
    if (assignee) await ensureProjectAccess(db, workspaceId, order.projectId, assignee);
    const dueDate = workdays(await readCalendar(db, workspaceId)).shift(today, settings.days);
    created = [];
    for (const snag of snags) created.push(await raiseInspectionSnag(db, workspaceId, { order, inspectionId: inspection.id, snag, comments, label, round: inspection.round, assignee, dueDate,
      actorId: input.userId }));
    const list = snags.map((snag) => snag.title).join("; ");
    const assigneeUser = assignee ? await userOf(db, workspaceId, assignee) : null;
    const fixers = assigneeUser ? [assigneeUser] : (await permissionHolders(db, workspaceId, ["factory.manage"])).map((row) => row.userId);
    await tell(db, workspaceId, fixers, input.userId, { code: "factory.inspection_snags", variables: { ...variables, note: `${snags.length === 1 ? "1 snag" : `${snags.length} snags`}: ${list}`.slice(0, 480) },
      link: inspectionHref(inspection.id), key: inspection.id });
    await tell(db, workspaceId, managers, input.userId, { code: "factory.inspection_failed", variables: { ...variables, note: comments.slice(0, 480) }, link: inspectionHref(inspection.id), key: inspection.id });
  } else if (inspection.stage === "raw" && (order.stages ?? []).includes("final")) {
    await tell(db, workspaceId, factoryPeople, input.userId, { code: "factory.inspection_passed", variables: { ...variables, note: comments.slice(0, 480) }, link: `/workspace/factory/orders?order=${order.id}`,
      key: inspection.id });
  } else {
    await tell(db, workspaceId, [...managers, ...factoryPeople], input.userId, { code: "factory.dispatch_cleared", variables: { ...variables, note: comments.slice(0, 480) },
      link: `/workspace/factory/orders?order=${order.id}`, key: inspection.id });
    // The last item for the project cleared: the people who deliver and install hear everything is made.
    await projectReady(db, workspaceId, { id: order.id, number: order.number, title: order.title, projectId: order.projectId, projectReference: order.projectReference,
      projectName: order.projectName }, { readyOn: today, actorId: input.userId });
  }
  await orderEvent(db, workspaceId, order.id, action === "pass" ? "inspection_passed" : "inspection_failed",
    { inspectionId: inspection.id, stage: inspection.stage, round: inspection.round, comments, snags: created.map((snag) => snag.number) }, input.userId);
  await recordAudit(db, { workspaceId, actorUserId: input.userId, action: action === "pass" ? "work_order.inspection_passed" : "work_order.inspection_failed", entityType: "work_order",
    entityId: order.id, after: { inspectionId: inspection.id, stage: label, round: inspection.round, comments, snags: snags.map((snag) => snag.title), closed: fixed.length } });
  return { status: action === "pass" ? "passed" : "failed", snags: created };
}

/** A snag line of a failed round: a snag on the project (source: inspection) on the item's scope line, given to the factory. */
async function raiseInspectionSnag(db: Db, workspaceId: string, input: { order: OrderFacts; inspectionId: string; snag: SnagLine; comments: string; label: string; round: number;
  assignee: string | null; dueDate: string; actorId: string }) {
  const { order } = input;
  await db.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, order.projectId]);
  const number = (await db.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM work_items WHERE workspace_id = $1 AND project_id = $2`,
    [workspaceId, order.projectId])).rows[0].next;
  const id = randomUUID();
  const description = `${input.label}${input.round > 1 ? ` (round ${input.round})` : ""} of ${orderNumber(order.number)} ${order.title}: ${input.comments}`;
  await db.query(
    `INSERT INTO work_items (id, workspace_id, project_id, number, type, package_id, boq_line_id, title, description, priority, assignee_membership_id, due_date, severity, source,
                             factory_inspection_id, created_by)
     VALUES ($1, $2, $3, $4, 'snag', $5, $6, $7, $8, $9, $10, $11, $12, 'inspection', $13, $14)`,
    [id, workspaceId, order.projectId, number, order.packageId, order.boqLineId, input.snag.title.slice(0, 300), description.slice(0, 10000),
      input.snag.severity === "critical" ? "urgent" : input.snag.severity === "major" ? "high" : "normal", input.assignee, input.dueDate, input.snag.severity, input.inspectionId, input.actorId]);
  await workEvent(db, workspaceId, id, "created", { type: "snag", source: "inspection", inspectionId: input.inspectionId }, input.actorId);
  return { id, number };
}

/**
 * A snag changed (project-core's task system): once no snag of a failed round is still to fix (each is fixed, closed or
 * cancelled), the item goes back for the next round of that inspection by itself, asked for as the factory asked
 * the round before.
 */
export async function inspectionSnagChanged(db: Db, workspaceId: string, itemId: string, actorId: string) {
  const round = (await db.query<{ id: string; workOrderId: string; stage: InspectionStageKind; status: string; requestedBy: string; latest: boolean; open: number }>(
    `SELECT inspection.id, inspection.work_order_id AS "workOrderId", inspection.stage, inspection.status, inspection.requested_by AS "requestedBy",
            NOT EXISTS (SELECT 1 FROM factory_inspections later WHERE later.workspace_id = inspection.workspace_id AND later.work_order_id = inspection.work_order_id
                         AND later.stage = inspection.stage AND later.round > inspection.round) AS latest,
            (SELECT count(*)::int FROM work_items snag WHERE snag.workspace_id = inspection.workspace_id AND snag.factory_inspection_id = inspection.id
               AND snag.status IN ('todo', 'in_progress')) AS open
       FROM work_items item JOIN factory_inspections inspection ON inspection.workspace_id = item.workspace_id AND inspection.id = item.factory_inspection_id
      WHERE item.workspace_id = $1 AND item.id = $2`, [workspaceId, itemId])).rows[0];
  if (!round || round.status !== "failed" || !round.latest || round.open > 0) return null;
  return requestInspection(db, workspaceId, { workOrderId: round.workOrderId, stage: round.stage, actorId, requesterId: round.requestedBy, auto: true });
}

/**
 * The factory marks one snag of a failed inspection fixed, from the work order or the inspection: the same as setting
 * its task to "In review" in the project's work (who fixed it is kept, the project's leads and whoever raised it hear
 * it's ready to check), and once the last one is fixed the item goes back for inspection by itself. Version-checked;
 * a snag already marked fixed (or closed) is left as it is.
 */
export async function markInspectionSnagFixed(db: Db, workspaceId: string, input: { inspectionId: string; snagId: string; version: unknown; userId: string }) {
  const snag = (await db.query<{ id: string; projectId: string; number: number; title: string; status: string; version: number; createdBy: string; workOrderId: string }>(
    `SELECT item.id, item.project_id AS "projectId", item.number, item.title, item.status, item.version, item.created_by AS "createdBy", inspection.work_order_id AS "workOrderId"
       FROM work_items item JOIN factory_inspections inspection ON inspection.workspace_id = item.workspace_id AND inspection.id = item.factory_inspection_id
      WHERE item.workspace_id = $1 AND item.id = $2 AND item.type = 'snag'
        AND inspection.work_order_id = (SELECT work_order_id FROM factory_inspections WHERE workspace_id = $1 AND id = $3)
      FOR UPDATE OF item`, [workspaceId, input.snagId, input.inspectionId])).rows[0];
  if (!snag) throw new NotFoundException("Snag not found.");
  if (snag.status === "in_review" || snag.status === "done") return { snag, changed: false };
  if (snag.status === "cancelled") throw new ConflictException("This snag was cancelled.");
  if (input.version !== snag.version) throw new ConflictException("Someone else changed this snag. Reload to see their changes.");
  await db.query(
    `UPDATE work_items SET status = 'in_review', fixed_by = $3, started_at = coalesce(started_at, now()), completed_at = NULL, completed_by = NULL, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND id = $2`, [workspaceId, snag.id, input.userId]);
  await workEvent(db, workspaceId, snag.id, "status", { from: snag.status, to: "in_review", via: "factory" }, input.userId);
  await noticeWork(db, { workspaceId, projectId: snag.projectId, key: `ready:${snag.id}:${snag.version}`, actorUserId: input.userId,
    notice: { code: "work.snag_ready", item: { id: snag.id, number: snag.number, title: snag.title }, note: "", memberships: await snagCheckers(db, workspaceId, snag.projectId, snag.createdBy) } });
  await inspectionSnagChanged(db, workspaceId, snag.id, input.userId);
  return { snag, changed: true };
}

/** A cancelled work order's open rounds are withdrawn (their reminders stop). */
export async function cancelInspections(db: Db, workspaceId: string, workOrderId: string) {
  await db.query(`UPDATE factory_inspections SET status = 'cancelled', version = version + 1, updated_at = now() WHERE workspace_id = $1 AND work_order_id = $2 AND status = 'due'`,
    [workspaceId, workOrderId]);
}

/** The work orders (of one work order, a project, or a deal's projects) still waiting for their last inspection. */
async function waiting(db: Db, workspaceId: string, scope: { workOrderId: string } | { projectId: string } | { opportunityId: string }) {
  const where = "workOrderId" in scope ? "wo.id = $2::uuid" : "projectId" in scope ? "wo.project_id = $2::uuid"
    : "project.case_id IN (SELECT pre_case.id FROM pre_project_cases pre_case WHERE pre_case.workspace_id = wo.workspace_id AND pre_case.opportunity_id = $2::uuid)";
  const value = "workOrderId" in scope ? scope.workOrderId : "projectId" in scope ? scope.projectId : scope.opportunityId;
  return (await db.query<{ number: number; title: string; stages: string[] }>(
    `SELECT wo.number, wo.title, wo.inspection_stages::text[] AS stages FROM work_orders wo
       JOIN delivery_projects project ON project.workspace_id = wo.workspace_id AND project.id = wo.project_id
      WHERE wo.workspace_id = $1 AND ${where} AND wo.status <> 'cancelled' AND ${FINAL_PENDING("wo")}
      ORDER BY wo.number`, [workspaceId, value])).rows;
}

const named = (rows: Array<{ number: number; title: string }>) =>
  `${rows.slice(0, 3).map((row) => `${orderNumber(row.number)} ${row.title}`).join(", ")}${rows.length > 3 ? ` and ${rows.length - 3} more` : ""}`;

/** Dispatch to site waits for the item's last inspection (PLM-150). No override: a manager who has seen it records the inspection. */
export async function assertOrderCleared(db: Db, workspaceId: string, workOrderId: string) {
  const rows = await waiting(db, workspaceId, { workOrderId });
  if (!rows.length) return;
  const settings = inspectionSettings(await ensureFactorySettings(db, workspaceId));
  throw new ConflictException(`${named(rows)} can't go to site yet: ${stageName("final", settings.stages)} hasn't passed.`);
}

/** Booking a project's (or a deal's) delivery, or recording it delivered, waits until every made item passed its last inspection. */
export async function assertDeliveryCleared(db: Db, workspaceId: string, scope: { projectId: string } | { opportunityId: string }) {
  const rows = await waiting(db, workspaceId, scope);
  if (!rows.length) return;
  const settings = inspectionSettings(await ensureFactorySettings(db, workspaceId));
  throw new ConflictException(`The delivery waits for the design inspection: ${named(rows)} ${rows.length === 1 ? "hasn't" : "haven't"} passed ${stageName("final", settings.stages)} yet.`);
}

/**
 * A move of stock from the factory to a site, by hand: goods a work order made for the project go through that work
 * order (Send to site), so they can't leave before their last inspection.
 */
export async function assertTransferCleared(db: Db, workspaceId: string, transfer: { fromLocationId: unknown; toLocationId: unknown; lines: unknown }) {
  if (typeof transfer.fromLocationId !== "string" || typeof transfer.toLocationId !== "string" || !UUID.test(transfer.fromLocationId) || !UUID.test(transfer.toLocationId)
    || !Array.isArray(transfer.lines)) return;
  const places = (await db.query<{ id: string; kind: string }>(`SELECT id, kind FROM stock_locations WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
    [workspaceId, [transfer.fromLocationId, transfer.toLocationId]])).rows;
  if (places.find((place) => place.id === transfer.fromLocationId)?.kind !== "factory" || places.find((place) => place.id === transfer.toLocationId)?.kind !== "site") return;
  const lines = (transfer.lines as Array<Record<string, unknown>>).filter((line) => typeof line?.itemId === "string" && UUID.test(line.itemId as string)
    && typeof line?.projectId === "string" && UUID.test(line.projectId as string));
  for (const line of lines) {
    const rows = (await db.query<{ number: number; title: string }>(
      `SELECT DISTINCT wo.number, wo.title FROM work_orders wo
        WHERE wo.workspace_id = $1 AND wo.project_id = $2 AND wo.status <> 'cancelled' AND ${FINAL_PENDING("wo")}
          AND EXISTS (SELECT 1 FROM stock_movements made WHERE made.workspace_id = wo.workspace_id AND made.work_order_id = wo.id AND made.kind = 'produce' AND made.item_id = $3)
        ORDER BY wo.number`, [workspaceId, line.projectId, line.itemId])).rows;
    if (rows.length) {
      const settings = inspectionSettings(await ensureFactorySettings(db, workspaceId));
      throw new ConflictException(`${named(rows)} can't go to site yet: ${stageName("final", settings.stages)} hasn't passed. Send it from its work order once it has.`);
    }
  }
}

/** One open inspection as the design calendar, My day and the factory read it. */
export type OpenInspection = {
  id: string; workOrderId: string; order: string; item: string; projectId: string; projectReference: string; projectName: string;
  stage: InspectionStageKind; stageLabel: string; round: number; inspectorMembershipId: string | null; inspectorName: string | null; inspectorRole: string | null;
  dueOn: string; requestedAt: string; overdue: boolean;
};

/**
 * PLM-152 reads this for the design calendar: the open inspections (due with the design team) with who, which item,
 * which project and when they are due; optionally one person's, one project's, or those due in a date range. The
 * stage's label is the firm's name for it ("" for the standard name).
 */
export async function readOpenInspections(db: Db, workspaceId: string, filter: { membershipId?: string | null; projectId?: string | null; from?: string | null; to?: string | null } = {})
  : Promise<OpenInspection[]> {
  const settings = inspectionSettings(await ensureFactorySettings(db, workspaceId));
  if (!settings.enabled) return [];
  const today = (await workspaceDay(db, workspaceId)).today;
  const rows = (await db.query<Omit<OpenInspection, "stageLabel" | "overdue" | "order"> & { number: number }>(
    `SELECT inspection.id, inspection.work_order_id AS "workOrderId", wo.number, wo.title AS item, inspection.project_id AS "projectId", project.reference AS "projectReference",
            project.name AS "projectName", inspection.stage, inspection.round, inspection.inspector_membership_id AS "inspectorMembershipId",
            coalesce(person.display_name, person.primary_email) AS "inspectorName", inspection.inspector_role AS "inspectorRole", inspection.due_on::text AS "dueOn",
            inspection.requested_at AS "requestedAt"
       FROM factory_inspections inspection
       JOIN work_orders wo ON wo.workspace_id = inspection.workspace_id AND wo.id = inspection.work_order_id AND wo.status <> 'cancelled'
       JOIN delivery_projects project ON project.workspace_id = inspection.workspace_id AND project.id = inspection.project_id
       LEFT JOIN workspace_memberships member ON member.workspace_id = inspection.workspace_id AND member.id = inspection.inspector_membership_id
       LEFT JOIN users person ON person.id = member.user_id
      WHERE inspection.workspace_id = $1 AND inspection.status = 'due'
        AND ($2::uuid IS NULL OR inspection.inspector_membership_id = $2::uuid) AND ($3::uuid IS NULL OR inspection.project_id = $3::uuid)
        AND ($4::date IS NULL OR inspection.due_on >= $4::date) AND ($5::date IS NULL OR inspection.due_on <= $5::date)
      ORDER BY inspection.due_on, wo.number LIMIT 500`,
    [workspaceId, filter.membershipId ?? null, filter.projectId ?? null, filter.from ?? null, filter.to ?? null])).rows;
  return rows.map(({ number, ...row }) => ({ ...row, order: orderNumber(number), stageLabel: settings.stages.find((stage) => stage.kind === row.stage)?.label ?? "",
    overdue: row.dueOn < today }));
}

/** One round with its item, its photos, its snags and every round of the item. */
export async function readInspection(db: Db, workspaceId: string, id: string) {
  const row = (await db.query<{
    id: string; workOrderId: string; projectId: string; stage: InspectionStageKind; round: number; status: string; dueOn: string; requestedAt: string; requestedBy: string;
    requestedByName: string; inspectorMembershipId: string | null; inspectorName: string | null; inspectorRole: string | null; resultByName: string | null; resultAt: string | null;
    comments: string; version: number; number: number; title: string; specification: string; quantity: string; unit: string; orderStatus: string; projectReference: string;
    projectName: string; projectStatus: string;
  }>(
    `SELECT inspection.id, inspection.work_order_id AS "workOrderId", inspection.project_id AS "projectId", inspection.stage, inspection.round, inspection.status,
            inspection.due_on::text AS "dueOn", inspection.requested_at AS "requestedAt", inspection.requested_by AS "requestedBy", requester.display_name AS "requestedByName",
            inspection.inspector_membership_id AS "inspectorMembershipId", coalesce(inspector.display_name, inspector.primary_email) AS "inspectorName",
            inspection.inspector_role AS "inspectorRole", recorder.display_name AS "resultByName", inspection.result_at AS "resultAt", inspection.comments, inspection.version,
            wo.number, wo.title, wo.specification, wo.quantity::text AS quantity, wo.unit, wo.status AS "orderStatus", project.reference AS "projectReference",
            project.name AS "projectName", project.status AS "projectStatus"
       FROM factory_inspections inspection
       JOIN work_orders wo ON wo.workspace_id = inspection.workspace_id AND wo.id = inspection.work_order_id
       JOIN delivery_projects project ON project.workspace_id = inspection.workspace_id AND project.id = inspection.project_id
       JOIN users requester ON requester.id = inspection.requested_by
       LEFT JOIN workspace_memberships member ON member.workspace_id = inspection.workspace_id AND member.id = inspection.inspector_membership_id
       LEFT JOIN users inspector ON inspector.id = member.user_id
       LEFT JOIN users recorder ON recorder.id = inspection.result_by
      WHERE inspection.workspace_id = $1 AND inspection.id = $2`, [workspaceId, id])).rows[0];
  if (!row) return null;
  const photos = (await db.query<{ id: string; name: string; byName: string; at: string }>(
    `SELECT photo.id, photo.original_name AS name, person.display_name AS "byName", photo.created_at AS at FROM factory_inspection_photos photo JOIN users person ON person.id = photo.created_by
      WHERE photo.workspace_id = $1 AND photo.inspection_id = $2 ORDER BY photo.created_at`, [workspaceId, id])).rows;
  const snags = (await db.query<{ id: string; number: number; title: string; severity: string; status: string; dueDate: string | null; assigneeName: string | null; assigneeId: string | null; inspectionId: string; version: number }>(
    `SELECT item.id, item.number, item.title, item.severity, item.status, item.due_date::text AS "dueDate", coalesce(person.display_name, person.primary_email) AS "assigneeName", item.assignee_membership_id AS "assigneeId", item.version,
            item.factory_inspection_id AS "inspectionId"
       FROM work_items item
       LEFT JOIN workspace_memberships member ON member.workspace_id = item.workspace_id AND member.id = item.assignee_membership_id
       LEFT JOIN users person ON person.id = member.user_id
      WHERE item.workspace_id = $1 AND item.factory_inspection_id IN (SELECT id FROM factory_inspections WHERE workspace_id = $1 AND work_order_id = $2)
      ORDER BY item.number`, [workspaceId, row.workOrderId])).rows;
  const rounds = (await db.query<{ id: string; stage: InspectionStageKind; round: number; status: string; dueOn: string; resultAt: string | null; resultByName: string | null; comments: string }>(
    `SELECT inspection.id, inspection.stage, inspection.round, inspection.status, inspection.due_on::text AS "dueOn", inspection.result_at AS "resultAt",
            person.display_name AS "resultByName", inspection.comments
       FROM factory_inspections inspection LEFT JOIN users person ON person.id = inspection.result_by
      WHERE inspection.workspace_id = $1 AND inspection.work_order_id = $2 ORDER BY inspection.stage <> 'raw', inspection.round`, [workspaceId, row.workOrderId])).rows;
  const settings = inspectionSettings(await ensureFactorySettings(db, workspaceId));
  return { row, photos, snags, rounds: rounds.map((round) => ({ ...round, snags: snags.filter((snag) => snag.inspectionId === round.id).length })), stages: settings.stages,
    managers: (await db.query<{ name: string }>(
      `SELECT DISTINCT person.display_name AS name FROM project_assignments assignment
         JOIN workspace_memberships member ON member.workspace_id = assignment.workspace_id AND member.id = assignment.membership_id AND member.status = 'active'
         JOIN users person ON person.id = member.user_id
        WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND assignment.is_manager ORDER BY 1`, [workspaceId, row.projectId])).rows.map((manager) => manager.name) };
}

// ---------- notices ----------

async function noticeVariables(db: Db, workspaceId: string, order: OrderFacts, stage: string, actorId: string, date: string) {
  const actor = (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [actorId])).rows[0]?.name ?? "";
  const locale = (await db.query<{ locale: string | null }>(`SELECT default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.locale || "en";
  let day = date;
  try { day = new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00Z`)); } catch { /* the ISO day */ }
  return { order: orderNumber(order.number), item: order.title, project: `${order.projectReference} · ${order.projectName}`, stage, date: day, actor, note: "" };
}

async function projectManagers(db: Db, workspaceId: string, projectId: string) {
  return (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND assignment.is_manager`, [workspaceId, projectId])).rows.map((row) => row.userId);
}

async function userOf(db: Db, workspaceId: string, membershipId: string) {
  return (await db.query<{ userId: string }>(`SELECT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`,
    [workspaceId, membershipId])).rows[0]?.userId ?? null;
}

/** A project role's name in the firm's words (its key when it was removed). */
async function roleLabel(db: Db, workspaceId: string, role: string) {
  const roles = (await db.query<{ roles: Array<{ key: string; label: string }> }>(`SELECT roles FROM workspace_project_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.roles ?? [];
  return roles.find((entry) => entry.key === role)?.label ?? role.replace(/_/g, " ");
}

/** Notices with an email: everyone but the person who acted, once per key and person. */
async function tell(db: Db, workspaceId: string, users: Array<string | null>, actorId: string, notice: { code: string; variables: Record<string, string>; link: string; key: string }) {
  for (const userId of new Set(users.filter((id): id is string => Boolean(id) && id !== actorId))) {
    const message = { workspaceId, recipientUserId: userId, code: notice.code, eventType: notice.code, variables: notice.variables, deepLink: notice.link };
    await notifyUserInApp(db, { ...message, idempotencyKey: `${notice.code}:${notice.key}:${userId}` });
    await queueUserEmail(db, { ...message, idempotencyKey: `${notice.code}:${notice.key}:${userId}:email` });
  }
}

async function orderEvent(db: Db, workspaceId: string, workOrderId: string, kind: string, detail: Record<string, unknown>, actorId: string) {
  await db.query(`INSERT INTO work_order_events (id, workspace_id, work_order_id, kind, detail, actor_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [randomUUID(), workspaceId, workOrderId, kind, JSON.stringify(detail), actorId]);
}
