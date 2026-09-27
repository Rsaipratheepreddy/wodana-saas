/**
 * Wodana brand characters: which role avatar a person gets by default, and Woddy's poses.
 * The files live in packages/brand; apps serve copies (web /brand/…, mobile assets/brand/…).
 */

export const AVATAR_ROLES = [
  "owner", "sales", "designer", "estimator", "project_manager", "site_supervisor", "purchasing",
  "finance", "people", "factory", "carpenter", "electrician", "painter", "installer", "client", "default",
] as const;
export type AvatarRole = (typeof AVATAR_ROLES)[number];
export type AvatarVariant = "f" | "m";

export const WODDY_POSES = ["main", "hello", "thinking", "working", "celebrating", "oops", "idle"] as const;
export type WoddyPose = (typeof WODDY_POSES)[number];

/** Workspace role codes (and common aliases) → the avatar drawn for that role. */
const ROLE_TO_AVATAR: Record<string, AvatarRole> = {
  owner: "owner",
  administrator: "owner",
  admin: "owner",
  manager: "project_manager",
  sales: "sales",
  bde: "sales",
  business_development: "sales",
  designer: "designer",
  design: "designer",
  quantity_surveyor: "estimator",
  estimator: "estimator",
  estimation: "estimator",
  project_manager: "project_manager",
  projects: "project_manager",
  project: "project_manager",
  site_supervisor: "site_supervisor",
  supervisor: "site_supervisor",
  site: "site_supervisor",
  purchasing: "purchasing",
  procurement: "purchasing",
  buyer: "purchasing",
  operations_approver: "purchasing",
  operations: "purchasing",
  ops: "purchasing",
  finance: "finance",
  finance_reviewer: "finance",
  accountant: "finance",
  people: "people",
  hr: "people",
  hrms: "people",
  factory: "factory",
  workshop: "factory",
  production: "factory",
  carpenter: "carpenter",
  carpentry: "carpenter",
  electrician: "electrician",
  electrical: "electrician",
  painter: "painter",
  painting: "painter",
  installer: "installer",
  installation: "installer",
  client: "client",
  customer: "client",
  member: "default",
  viewer: "default",
};

/** Roles listed first win when a person holds several (the most specific job before the generic seat). */
const PRECEDENCE: AvatarRole[] = [
  "owner", "project_manager", "site_supervisor", "estimator", "sales", "designer", "purchasing", "finance",
  "people", "factory", "carpenter", "electrician", "painter", "installer", "client", "default",
];

function normalise(code: string): string {
  return code.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** The avatar for one role code; unknown codes get `default`. */
export function avatarRoleForCode(code: string | null | undefined): AvatarRole {
  if (!code) return "default";
  const key = normalise(code).replace(/^workspace_/, "");
  // A kit's own codes follow the same words: `sales_executive`, `finance_admin`, `people_inviter`, `ops_admin`.
  return ROLE_TO_AVATAR[key] ?? ROLE_TO_AVATAR[key.split("_")[0] ?? ""] ?? "default";
}

/** The avatar for a person's main role: the highest-precedence match among their role codes. */
export function roleAvatarKey(roles: ReadonlyArray<string | null | undefined> | string | null | undefined): AvatarRole {
  const list = roles == null ? [] : typeof roles === "string" ? [roles] : roles;
  const matches = list.map(avatarRoleForCode);
  for (const role of PRECEDENCE) if (matches.includes(role)) return role;
  return "default";
}

/** A stable woman/man pick from the person's id, so the same person always gets the same picture. */
export function avatarVariant(seed: string | null | undefined): AvatarVariant {
  if (!seed) return "f";
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % 2 === 0 ? "f" : "m";
}

export type AvatarKey = `${AvatarRole}-${AvatarVariant}`;

/** Every picture in the set, `owner-f` … `default-m`, in role order (woman, then man). */
export const AVATAR_KEYS: readonly AvatarKey[] = AVATAR_ROLES.flatMap((role) => [`${role}-f`, `${role}-m`] as const);

/** A saved avatar choice (`sales-m`) when it names a picture in the set; anything else means "auto". */
export function chosenAvatarKey(preset: string | null | undefined): AvatarKey | null {
  return preset && (AVATAR_KEYS as readonly string[]).includes(preset) ? (preset as AvatarKey) : null;
}

/** File name (without folder) of the default picture for a person. */
export function roleAvatarFile(roles: Parameters<typeof roleAvatarKey>[0], seed: string | null | undefined): `${AvatarKey}.webp` {
  return `${roleAvatarKey(roles)}-${avatarVariant(seed)}.webp`;
}

/** Web path of a picture in the set. */
export function avatarPath(key: AvatarKey): string {
  return `/brand/avatars/${key}.webp`;
}

/** Web path of the default picture for a person. */
export function roleAvatarPath(roles: Parameters<typeof roleAvatarKey>[0], seed: string | null | undefined): string {
  return `/brand/avatars/${roleAvatarFile(roles, seed)}`;
}

/** Web path of a Woddy pose. */
export function woddyPath(pose: WoddyPose): string {
  return `/brand/woddy/${pose}.webp`;
}
