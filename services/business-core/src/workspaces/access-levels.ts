import { BadRequestException } from "@nestjs/common";

/**
 * Roles & permissions by module (packages/contracts/access-levels.json, shared with the web). A role is still a
 * set of permission codes; a level is a name for a set: view, then edit, then manage, each adding to the one
 * before. The rest of a role's codes in a module are its "advanced" extras, given one by one.
 */
export const ACCESS_LEVELS = ["none", "view", "edit", "manage"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
type GrantingLevel = Exclude<AccessLevel, "none">;
export type AccessModule = { id: string; view: string[]; edit: string[]; manage: string[]; advanced: string[] };
export type RoleAccess = { levels: Record<string, AccessLevel>; extras: string[] };

// Shared data contract; this relative path also resolves from dist/workspaces.
const model: { levels: string[]; modules: AccessModule[] } = require("../../../../packages/contracts/access-levels.json");
export const ACCESS_MODULES: readonly AccessModule[] = model.modules;
const GRANTING: readonly GrantingLevel[] = ["view", "edit", "manage"];

/** The levels a module offers: none, and each level that adds something. */
export function offeredLevels(module: AccessModule): AccessLevel[] {
  return ["none", ...GRANTING.filter((level) => module[level].length > 0)];
}

/** Every permission a level gives in its module (its own and the levels before it). */
export function levelPermissions(module: AccessModule, level: AccessLevel): string[] {
  if (level === "none") return [];
  return GRANTING.slice(0, GRANTING.indexOf(level) + 1).flatMap((step) => module[step]);
}

/** Every permission code a module covers, levels and advanced. */
export function modulePermissions(module: AccessModule) {
  return [...module.view, ...module.edit, ...module.manage, ...module.advanced];
}

/** The module a permission belongs to, if any. */
export function moduleOf(code: string) {
  return ACCESS_MODULES.find((module) => modulePermissions(module).includes(code));
}

/**
 * A role's permissions as levels: in each module, the highest offered level it holds whole; everything else it
 * holds (a permission beyond its level, or outside every module) is an extra. Expanding the result gives the
 * same permissions back.
 */
export function describeAccess(permissions: Iterable<string>): RoleAccess {
  const held = new Set(permissions);
  const levels: Record<string, AccessLevel> = {};
  const covered = new Set<string>();
  for (const module of ACCESS_MODULES) {
    const level = [...offeredLevels(module)].reverse().find((candidate) => candidate !== "none" && levelPermissions(module, candidate).every((code) => held.has(code))) ?? "none";
    levels[module.id] = level;
    for (const code of levelPermissions(module, level)) covered.add(code);
  }
  return { levels, extras: [...held].filter((code) => !covered.has(code)).sort() };
}

/** The permissions a set of levels and extras gives, after checking every module and level is one the model offers. */
export function expandAccess(access: { levels?: Record<string, unknown>; extras?: unknown }): string[] {
  const levels = access.levels ?? {};
  if (typeof levels !== "object" || Array.isArray(levels)) throw new BadRequestException("Choose an access level for each module");
  const codes = new Set<string>();
  for (const [moduleId, level] of Object.entries(levels)) {
    const module = ACCESS_MODULES.find((item) => item.id === moduleId);
    if (!module) throw new BadRequestException(`Unknown module: ${moduleId}`);
    if (!ACCESS_LEVELS.includes(level as AccessLevel) || !offeredLevels(module).includes(level as AccessLevel)) {
      throw new BadRequestException(`${moduleId} has no ${String(level)} level`);
    }
    for (const code of levelPermissions(module, level as AccessLevel)) codes.add(code);
  }
  const extras = access.extras ?? [];
  if (!Array.isArray(extras) || extras.some((code) => typeof code !== "string")) throw new BadRequestException("Extras must be permission codes");
  for (const code of extras as string[]) codes.add(code);
  return [...codes].sort();
}
