import type { Type } from "@nestjs/common";
import type { RequestActor } from "../auth/actor";
import { CreateBusinessUnitDto } from "../workspaces/dto/create-business-unit.dto";
import { CreateRoleDto } from "../workspaces/dto/create-role.dto";
import { CreateTeamDto } from "../workspaces/dto/create-team.dto";
import { UpdateRoleDto } from "../workspaces/dto/update-role.dto";
import { UpdateTeamDto } from "../workspaces/dto/update-team.dto";
import type { WorkspacesService } from "../workspaces/workspaces.service";
import type { Report } from "./ops-context";
import type { TeamSpec } from "./ops-sandbox-plan";

/**
 * A teams access file applied to a workspace (`sandbox --teams` and `configure --teams`), through the workspace's own
 * role and team commands, additive only. Each team has a role everyone in it inherits: its own (team_<code>), else a
 * role the workspace already has with the team's name (never a second role with that name). A missing role or team is
 * created (a new team with nobody in it); a role that lacks some of the file's permissions gets them; a team without
 * its role gets it beside the roles it has. Nothing is taken away: no team, role, permission or member is removed, and
 * nobody joins or leaves a team. Each step is reported under "teams": unchanged, would change (dry run) or changed.
 */

export type TeamsTarget = {
  workspaces: WorkspacesService;
  actor: RequestActor;
  workspaceId: string;
  apply: boolean;
  report: Report;
  validated: <T>(dto: Type<T>, body: unknown) => Promise<T>;
  /**
   * The business unit made for new teams when the workspace has none (a sandbox's own). Null on an existing workspace:
   * a team that can't be placed is reported, and nothing is made for it.
   */
  newUnit: { name: string; timezone: string } | null;
};
/** Each team's id and the code of the role it carries, by team code (for the sandbox's members and lead options). */
export type TeamMaps = { teamIds: Map<string, string>; teamRoles: Map<string, string> };

type RoleRow = { id: string; code: string; name: string; isSystem: boolean; version: number; permissions: string[] };
type TeamRow = { id: string; code: string; version: number; roleIds: string[] };
type Unit = { id: string | null; name: string };

const listed = (codes: string[]) => `${codes.length} permissions added: ${codes.join(", ")}`.slice(0, 300);

export async function applyTeams(target: TeamsTarget, specs: readonly TeamSpec[], maps: TeamMaps = { teamIds: new Map(), teamRoles: new Map() }): Promise<TeamMaps> {
  const { workspaces, actor, workspaceId, apply, report, validated } = target;
  const { teamIds, teamRoles } = maps;
  const roles = await workspaces.listRoles(actor, workspaceId) as unknown as RoleRow[];
  // "*" is every permission the workspace has: the administrator's.
  const everyPermission = roles.find((role) => role.code === "administrator")?.permissions ?? [];
  const roleIds = new Map<string, string>();
  /** Teams whose role a dry run would create (no id yet). */
  const rolesToMake = new Set<string>();
  for (const team of specs) {
    const code = `team_${team.code.toLowerCase()}`;
    teamRoles.set(team.code, code);
    const wanted = team.permissions.includes("*") ? everyPermission : team.permissions.filter((permission) => everyPermission.includes(permission));
    const unknown = team.permissions.filter((permission) => permission !== "*" && !everyPermission.includes(permission));
    if (unknown.length) report.add("teams", "info", `team ${team.code}`, `${unknown.length} permissions this workspace doesn't have: ${unknown.join(", ")}`.slice(0, 300));
    const existing = roles.find((role) => role.code === code) ?? roles.find((role) => !role.isSystem && role.name.trim().toLowerCase() === team.name.trim().toLowerCase());
    if (existing) {
      roleIds.set(team.code, existing.id);
      teamRoles.set(team.code, existing.code);
      // Only added: permissions the role has beyond the file's stay.
      const missing = wanted.filter((permission) => !existing.permissions.includes(permission));
      if (!missing.length) { report.add("teams", "unchanged", `role ${existing.code}`, `holds the team's ${wanted.length} permissions`); continue; }
      if (!apply) { report.add("teams", "would change", `role ${existing.code}`, listed(missing)); continue; }
      await workspaces.updateRole(actor, workspaceId, existing.id, await validated(UpdateRoleDto, { version: existing.version, permissionCodes: [...existing.permissions, ...missing].sort() }));
      report.add("teams", "changed", `role ${existing.code}`, listed(missing));
      continue;
    }
    if (!apply) { rolesToMake.add(team.code); report.add("teams", "would change", `role ${code}`, `created with ${wanted.length} permissions`); continue; }
    const created = await workspaces.createRole(actor, workspaceId, await validated(CreateRoleDto, {
      code, name: team.name, description: `${team.name} team: everyone in it has this role.`.slice(0, 500), permissionCodes: [...new Set(wanted)].sort(),
    })) as unknown as { id: string };
    roleIds.set(team.code, created.id);
    report.add("teams", "changed", `role ${code}`, `created with ${wanted.length} permissions`);
  }

  // Only active teams are listed; a team is matched by its code.
  const current = await workspaces.listTeams(actor, workspaceId) as unknown as TeamRow[];
  const unit = specs.some((team) => !current.some((row) => row.code === team.code)) ? await unitForNewTeams(target) : null;
  for (const team of specs) {
    const roleId = roleIds.get(team.code);
    const roleCode = teamRoles.get(team.code)!;
    const found = current.find((row) => row.code === team.code);
    if (found) {
      teamIds.set(team.code, found.id);
      if (roleId && found.roleIds.includes(roleId)) { report.add("teams", "unchanged", `team ${team.code}`, `has role ${roleCode}`); continue; }
      // The team keeps its roles and its people; it only gets its own role beside them.
      if (!apply) { report.add("teams", "would change", `team ${team.code}`, `gets role ${roleCode}`); continue; }
      await workspaces.updateTeam(actor, workspaceId, found.id, await validated(UpdateTeamDto, { version: found.version, roleIds: [...found.roleIds, roleId!] }));
      report.add("teams", "changed", `team ${team.code}`, `gets role ${roleCode}`);
      continue;
    }
    if (!unit) { report.add("teams", "not found", `team ${team.code}`, "not created: no business unit to put it in"); continue; }
    if (!apply || !unit.id) { report.add("teams", "would change", `team ${team.code}`, `${team.name}: created in ${unit.name}`); continue; }
    const created = await workspaces.createTeam(actor, workspaceId, await validated(CreateTeamDto, {
      businessUnitId: unit.id, code: team.code, name: team.name, description: `Access is granted per team: everyone in ${team.name} has its role.`.slice(0, 500),
      roleIds: [roleId!], memberIds: [],
    })) as unknown as { id: string };
    teamIds.set(team.code, created.id);
    report.add("teams", "changed", `team ${team.code}`, `${team.name}: created in ${unit.name}`);
  }
  return maps;
}

/** The business unit new teams go in: the first active one by name; a sandbox makes one when there is none. */
async function unitForNewTeams(target: TeamsTarget): Promise<Unit | null> {
  const { workspaces, actor, workspaceId, apply, report, validated, newUnit } = target;
  const detail = await workspaces.get(actor, workspaceId) as unknown as { legalEntities: Array<{ id: string }>; businessUnits: Array<{ id: string; name: string; status: string }> };
  const active = detail.businessUnits.find((unit) => unit.status === "active");
  if (active) return { id: active.id, name: active.name };
  if (!newUnit) { report.add("teams", "not found", "business unit", "the workspace has no active business unit for new teams; add one in Settings, then run again"); return null; }
  if (!apply) { report.add("teams", "would change", "business unit", `${newUnit.name} (MAIN)`); return { id: null, name: newUnit.name }; }
  const unit = await workspaces.createBusinessUnit(actor, workspaceId, await validated(CreateBusinessUnitDto, {
    legalEntityId: detail.legalEntities[0].id, code: "MAIN", name: newUnit.name, type: "department", timezone: newUnit.timezone,
  })) as unknown as { id: string };
  report.add("teams", "changed", "business unit", `${newUnit.name} (MAIN)`);
  return { id: unit.id, name: newUnit.name };
}
