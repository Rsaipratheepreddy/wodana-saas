import { BadRequestException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { ProjectRole } from "./project-checks";
import { noticeProject } from "./project-notices";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-055: the key moments of a project the firm keeps people informed about, and the project roles told at each
 * (Settings → Projects). By default the designer hears all three, so the design is followed to handover: the
 * technical drawings started (they add the product details the technical team needs), production started, and the
 * installation scheduled. A moment's own people (the technical team, the factory, the installation team) are told
 * by the step itself; these roles are told on top. Never the person who acted.
 */
export const KEEP_INFORMED_EVENTS = ["drawings_started", "production_started", "installation_scheduled"] as const;
export type KeepInformedEvent = (typeof KEEP_INFORMED_EVENTS)[number];
export type KeepInformed = Record<KeepInformedEvent, string[]>;

/** The default designer role: while a project names nobody in it, the opportunity's dedicated designer is told. */
export const DESIGNER_ROLE = "designer";
export const DEFAULT_KEEP_INFORMED: KeepInformed = { drawings_started: [DESIGNER_ROLE], production_started: [DESIGNER_ROLE], installation_scheduled: [DESIGNER_ROLE] };

/** The stored setting, read leniently: each moment's roles that still exist (a role removed later drops out). */
export function normaliseKeepInformed(value: unknown, roles: ProjectRole[]): KeepInformed {
  const known = new Set(roles.map((role) => role.key));
  const stored = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : DEFAULT_KEEP_INFORMED;
  return Object.fromEntries(KEEP_INFORMED_EVENTS.map((event) => {
    const list = Array.isArray(stored[event]) ? stored[event] as unknown[] : [];
    return [event, [...new Set(list.filter((role): role is string => typeof role === "string" && known.has(role)))]];
  })) as KeepInformed;
}

/** Validates a change: each moment lists the firm's roles (none is allowed: nobody extra is told). */
export function parseKeepInformed(input: unknown, roles: ProjectRole[]): KeepInformed {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestException("Choose who is kept informed.");
  const known = new Set(roles.map((role) => role.key));
  const raw = input as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !KEEP_INFORMED_EVENTS.includes(key as KeepInformedEvent))) throw new BadRequestException("Unknown moment.");
  return Object.fromEntries(KEEP_INFORMED_EVENTS.map((event) => {
    const list = raw[event] === undefined ? [] : raw[event];
    if (!Array.isArray(list) || list.length > 10) throw new BadRequestException("Choose up to 10 roles for each moment.");
    if (list.some((role) => typeof role !== "string" || !known.has(role))) throw new BadRequestException("Choose roles from the project roles.");
    return [event, [...new Set(list as string[])]];
  })) as KeepInformed;
}

/** The project's people in these roles (active members); the opportunity's dedicated designer while nobody holds the designer role. */
export async function membersInRoles(db: Db, workspaceId: string, projectId: string, roles: string[]) {
  if (!roles.length) return [];
  const held = (await db.query<{ membershipId: string; roles: string[] }>(
    `SELECT assignment.membership_id AS "membershipId", assignment.role_keys AS roles FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND assignment.role_keys && $3::varchar[]`,
    [workspaceId, projectId, roles])).rows;
  const people = held.map((row) => row.membershipId);
  if (roles.includes(DESIGNER_ROLE) && !held.some((row) => row.roles.includes(DESIGNER_ROLE))) {
    const dedicated = (await db.query<{ membershipId: string }>(
      `SELECT designer.membership_id AS "membershipId" FROM delivery_projects project
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
         JOIN crm_opportunity_designer designer ON designer.workspace_id = pre_case.workspace_id AND designer.opportunity_id = pre_case.opportunity_id
         JOIN workspace_memberships membership ON membership.workspace_id = designer.workspace_id AND membership.id = designer.membership_id AND membership.status = 'active'
        WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, projectId])).rows[0];
    if (dedicated) people.push(dedicated.membershipId);
  }
  return [...new Set(people)];
}

/** The workspace's keep-informed setting, by moment. */
export async function readKeepInformed(db: Db, workspaceId: string, roles: ProjectRole[]) {
  const stored = (await db.query<{ value: unknown }>(`SELECT keep_informed AS value FROM workspace_project_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.value;
  return normaliseKeepInformed(stored ?? DEFAULT_KEEP_INFORMED, roles);
}

/**
 * Tells the people kept informed about one moment of the project (in the app and by email), with `also` (the
 * moment's own people) on top. Once per project, moment and `key` per person.
 */
export async function tellKeepInformed(db: Db, input: {
  workspaceId: string; projectId: string; event: KeepInformedEvent; key: string; actorUserId: string | null; date: string; note?: string; also?: string[];
}) {
  const roles = (await db.query<{ value: unknown; roles: ProjectRole[] }>(`SELECT keep_informed AS value, roles FROM workspace_project_settings WHERE workspace_id = $1`,
    [input.workspaceId])).rows[0];
  const setting = normaliseKeepInformed(roles?.value ?? DEFAULT_KEEP_INFORMED, roles?.roles ?? [{ key: DESIGNER_ROLE, label: "Designer" }]);
  const memberships = [...new Set([...(input.also ?? []), ...await membersInRoles(db, input.workspaceId, input.projectId, setting[input.event])])];
  if (!memberships.length) return 0;
  await noticeProject(db, { workspaceId: input.workspaceId, projectId: input.projectId, key: `${input.event}:${input.key}`, actorUserId: input.actorUserId,
    notice: { code: `project.${input.event}`, date: input.date, note: input.note ?? "", memberships } });
  return memberships.length;
}
