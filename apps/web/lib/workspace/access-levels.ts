import accessModel from "@wodana/contracts/access-levels.json";
import { tKey, type MessageKey } from "@/lib/i18n/keys";

/**
 * Roles & permissions by module, from the shared model Business Core validates with
 * (packages/contracts/access-levels.json). A level adds to the one before it; the rest of a role's
 * permissions in a module are its advanced extras.
 */
export const ACCESS_LEVELS = ["none", "view", "edit", "manage"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
type GrantingLevel = Exclude<AccessLevel, "none">;
export type AccessModule = { id: string; view: string[]; edit: string[]; manage: string[]; advanced: string[] };
export type RoleAccess = { levels: Record<string, AccessLevel>; extras: string[] };

export const ACCESS_MODULES: readonly AccessModule[] = (accessModel as { modules: AccessModule[] }).modules;
const GRANTING: readonly GrantingLevel[] = ["view", "edit", "manage"];

export const LEVEL_LABELS: Record<AccessLevel, MessageKey> = {
  none: tKey("No access"), view: tKey("View"), edit: tKey("Edit"), manage: tKey("Manage"),
};

/** A module whose levels mean something more specific than View · Edit · Manage names them (the Inbox: plan §5b). */
export const MODULE_LEVEL_LABELS: Record<string, Partial<Record<AccessLevel, MessageKey>>> = {
  inbox: { view: tKey("Own chats"), edit: tKey("Team chats"), manage: tKey("Manage") },
};

/** The name of a level in a module: the module's own word for it, else the shared one. */
export function levelLabel(moduleId: string, level: AccessLevel): MessageKey {
  return MODULE_LEVEL_LABELS[moduleId]?.[level] ?? LEVEL_LABELS[level];
}

export const MODULE_LABELS: Record<string, MessageKey> = {
  sales: tKey("Sales"), inbox: tKey("Inbox"), flows: tKey("Enquiry types & automations"), planning: tKey("Planning"), quotations: tKey("Quotations"),
  projects: tKey("Projects"), purchasing: tKey("Purchasing"), inventory: tKey("Inventory"), factory: tKey("Factory"),
  finance: tKey("Finance"), ledger: tKey("Ledger"), people: tKey("People"), settings: tKey("Settings"), woddy: tKey("Woddy"),
};

export function offeredLevels(module: AccessModule): AccessLevel[] {
  return ["none", ...GRANTING.filter((level) => module[level].length > 0)];
}

/** Every permission a level gives in its module (its own and the levels before it). */
export function levelPermissions(module: AccessModule, level: AccessLevel): string[] {
  if (level === "none") return [];
  return GRANTING.slice(0, GRANTING.indexOf(level) + 1).flatMap((step) => module[step]);
}

export function modulePermissions(module: AccessModule) {
  return [...module.view, ...module.edit, ...module.manage, ...module.advanced];
}

/** In each module the highest level the role holds whole; everything else it holds is an extra. */
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

export function expandAccess(access: RoleAccess): string[] {
  const codes = new Set(access.extras);
  for (const module of ACCESS_MODULES) for (const code of levelPermissions(module, access.levels[module.id] ?? "none")) codes.add(code);
  return [...codes].sort();
}

/** A role with a module set to a level: that module's extras the level now includes stop being extras. */
export function withLevel(access: RoleAccess, moduleId: string, level: AccessLevel): RoleAccess {
  const module = ACCESS_MODULES.find((item) => item.id === moduleId);
  if (!module) return access;
  const included = new Set(levelPermissions(module, level));
  return { levels: { ...access.levels, [moduleId]: level }, extras: access.extras.filter((code) => !included.has(code)) };
}

/** A role with one advanced permission given or taken away. */
export function withExtra(access: RoleAccess, code: string, granted: boolean): RoleAccess {
  const extras = new Set(access.extras);
  if (granted) extras.add(code); else extras.delete(code);
  return { ...access, extras: [...extras].sort() };
}

/** How many permissions differ between two roles' access. */
export function accessChanges(saved: Iterable<string>, draft: RoleAccess) {
  const before = new Set(saved);
  const after = new Set(expandAccess(draft));
  return [...before].filter((code) => !after.has(code)).length + [...after].filter((code) => !before.has(code)).length;
}
