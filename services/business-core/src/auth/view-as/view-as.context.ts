import { AsyncLocalStorage } from "node:async_hooks";

/**
 * An open view-as session, attached to the viewer's request by `ViewAsGuard`. While it is open the viewer
 * reads the workspace as `effectiveUserId` (the subject; for a role preview, the viewer) with `permissions`
 * (the subject's, or the role's, intersected with the viewer's), and every change is refused.
 */
export type ViewAsContext = {
  sessionId: string;
  workspaceId: string;
  kind: "person" | "role";
  viewerUserId: string;
  viewerMembershipId: string;
  subjectUserId: string | null;
  subjectMembershipId: string | null;
  subjectRoleId: string | null;
  subjectName: string;
  subjectRoleLabel: string | null;
  /** Whose records the reads are scoped to (own / team): the subject, or the viewer for a role preview. */
  effectiveUserId: string;
  permissions: ReadonlySet<string>;
  startedAt: Date;
  expiresAt: Date;
  returnPath: string | null;
};

type ViewAsStore = { viewAs: ViewAsContext; readOnly: boolean };

const storage = new AsyncLocalStorage<ViewAsStore>();

/** Runs a request handler inside its view-as session: reads are scoped to it and database work is discarded. */
export function runViewingAs<T>(viewAs: ViewAsContext, readOnly: boolean, work: () => T): T {
  return storage.run({ viewAs, readOnly }, work);
}

/** The view-as session of the request being handled, if any. */
export function currentViewAs(): ViewAsContext | null {
  return storage.getStore()?.viewAs ?? null;
}

/** True while a view-as request is handled: every transaction is rolled back, so a read leaves no trace. */
export function viewAsReadOnly(): boolean {
  return storage.getStore()?.readOnly === true;
}

/**
 * The view-as permission set that limits `userId` in `workspaceId`, or null when no view-as session applies.
 * Only the effective user is limited: checks about other people (an assignee, an approver) are unchanged.
 */
export function viewAsPermissionsFor(workspaceId: string, userId: string): ReadonlySet<string> | null {
  const context = currentViewAs();
  if (!context || context.workspaceId !== workspaceId || context.effectiveUserId !== userId) return null;
  return context.permissions;
}
