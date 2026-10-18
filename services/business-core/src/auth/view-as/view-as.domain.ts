/** A person view-as lasts at most 30 minutes; a role preview 15 (VA-1, VA-4). */
export const VIEW_AS_MAX_MINUTES = 30;
export const ROLE_PREVIEW_MINUTES = 15;
/** Distinct pages and routes kept per session for the audit trail. */
export const VIEW_AS_MAX_RECORDED_ROUTES = 500;

export type ViewAsRefusal =
  | "view_as_not_allowed"
  | "view_as_chained"
  | "view_as_self"
  | "view_as_not_a_member"
  | "view_as_operator"
  | "view_as_owner_protected"
  | "view_as_role_not_found";

const MESSAGES: Record<ViewAsRefusal, string> = {
  view_as_not_allowed: "Only owners and administrators can view as someone.",
  view_as_chained: "Exit the current view first.",
  view_as_self: "You can't view as yourself.",
  view_as_not_a_member: "Only active team members can be viewed as.",
  view_as_operator: "Wodana support staff can't be viewed as.",
  view_as_owner_protected: "Only an owner can view as an owner.",
  view_as_role_not_found: "That role no longer exists.",
};

export class ViewAsRuleError extends Error {
  constructor(readonly code: ViewAsRefusal) {
    super(MESSAGES[code]);
  }
}

const OWNER = "owner";
const ADMINISTRATOR = "administrator";

export type ViewAsStartInput = {
  /** The viewer's request already runs inside a view-as session. */
  chained: boolean;
  viewer: { userId: string; roles: readonly string[]; canViewAs: boolean };
  minutes?: number;
} & (
  | { kind: "person"; subject: { userId: string; active: boolean; roles: readonly string[]; operator: boolean } | null }
  | { kind: "role"; role: { code: string } | null }
);

/**
 * Who may view as whom. Only an owner (who also holds `workspace.view_as`) views as an active team member for up
 * to 30 minutes, read-only; an administrator or any other role never does, whatever it was granted. Never as
 * oneself, never from inside another view (no chaining), never as a Wodana operator or someone who is not a staff
 * member (client-portal users have no membership). A role preview follows the same rules.
 */
export function planViewAsStart(input: ViewAsStartInput): { minutes: number } {
  if (input.chained) throw new ViewAsRuleError("view_as_chained");
  const viewerIsOwner = input.viewer.roles.includes(OWNER);
  if (!input.viewer.canViewAs || !viewerIsOwner) throw new ViewAsRuleError("view_as_not_allowed");
  if (input.kind === "role") {
    if (!input.role) throw new ViewAsRuleError("view_as_role_not_found");
    if (input.role.code === OWNER && !viewerIsOwner) throw new ViewAsRuleError("view_as_owner_protected");
    return { minutes: ROLE_PREVIEW_MINUTES };
  }
  const subject = input.subject;
  if (!subject || !subject.active) throw new ViewAsRuleError("view_as_not_a_member");
  if (subject.userId === input.viewer.userId) throw new ViewAsRuleError("view_as_self");
  if (subject.operator) throw new ViewAsRuleError("view_as_operator");
  if (subject.roles.includes(OWNER) && !viewerIsOwner) throw new ViewAsRuleError("view_as_owner_protected");
  return { minutes: clampViewAsMinutes(input.minutes) };
}

export function clampViewAsMinutes(minutes: number | undefined) {
  if (minutes === undefined || !Number.isFinite(minutes)) return VIEW_AS_MAX_MINUTES;
  return Math.min(VIEW_AS_MAX_MINUTES, Math.max(5, Math.round(minutes)));
}

/** True for the two roles that manage the workspace (only an owner may view as someone else). */
export function isWorkspaceAdministrator(roles: readonly string[]) {
  return roles.includes(OWNER) || roles.includes(ADMINISTRATOR);
}

/** Only an in-app workspace path is kept as the place to return to on exit. */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (path.length > 512 || !/^\/workspace(?:[/?#][^\s\\]*)?$/.test(path) || path.includes("//")) return null;
  return path;
}

/**
 * What the audit trail keeps of one request: the page the viewer opened (sent by the web on page loads) or
 * the API route, relative to the workspace. Background checks of the session itself are not recorded.
 */
export function viewAsRouteLabel(input: { method: string; path: string; page?: string | null; workspaceId: string }): string | null {
  const page = input.page ? safeReturnPath(input.page.split(/[?#]/)[0]) : null;
  if (page) return `page ${page}`.slice(0, 300);
  const path = input.path.split(/[?#]/)[0].replace(/^\/api\/v\d+/, "");
  if (path === "/me" || path.startsWith("/view-as")) return null;
  const scoped = path.replace(`/workspaces/${input.workspaceId}`, "");
  if (/^\/view-as(?:\/|$)/.test(scoped)) return null;
  return `${input.method.toUpperCase()} ${scoped || "/"}`.slice(0, 300);
}

/**
 * What stays private in someone's notices while an owner views as them (VA-3): the notices about being viewed
 * (their Security record) are left out, and a leave notice keeps its title but not its reason.
 */
export function privateNoticesRemoved<Row extends Record<string, unknown>>(rows: readonly Row[]): Row[] {
  return rows
    .filter((row) => row.eventType !== "workspace.viewed_as")
    .map((row) => String(row.eventType ?? "").startsWith("hrms.leave_") ? { ...row, body: "" } : row);
}

/** Leave requests seen while viewing as someone: dates and status, never the reasons (VA-3). */
export function leaveReasonsRemoved<Row extends Record<string, unknown>>(rows: readonly Row[]): Row[] {
  return rows.map((row) => ({ ...row, reason: null, decisionReason: null, cancellationReason: null }));
}

/** "12 min" style duration between two instants, at least one minute. */
export function viewAsDurationMinutes(startedAt: Date, endedAt: Date) {
  return Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000));
}
