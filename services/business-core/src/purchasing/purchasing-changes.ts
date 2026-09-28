import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp } from "../notifications/default-templates";
import { readNeeds } from "./orders";

type Db = Pick<PoolClient, "query">;

/**
 * A variation that takes scope away can leave placed or drafted orders past what the project now needs.
 * The people who buy hear which, once per variation, so they can cancel the rest of a line or change a
 * draft; To order shows them as over-ordered with the variation that changed them.
 */
export async function tellOverOrdered(db: Db, workspaceId: string, projectId: string, actorId: string, variation: { id: string; label: string }) {
  const over = (await readNeeds(db, workspaceId, false, projectId)).filter((need) => need.remaining !== null && Dec.of(need.remaining).cmp(0) < 0);
  if (!over.length) return 0;
  const project = `${over[0].projectReference} · ${over[0].projectName}`;
  const items = over.slice(0, 6).map((need) => `${need.title} +${Dec.of(need.remaining!).neg().toString()} ${need.unit}`.trim()).join(", ");
  const note = `Ordered past what's needed now: ${items}${over.length > 6 ? ` and ${over.length - 6} more` : ""}.`;
  const buyers = (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = effective_role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'purchasing.manage'
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows.map((row) => row.userId);
  let sent = 0;
  for (const userId of buyers.filter((id) => id !== actorId)) {
    const result = await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "purchasing.over_ordered", eventType: "purchasing.over_ordered",
      variables: { variation: variation.label, project, note: note.slice(0, 480) }, deepLink: `/workspace/purchasing?project=${projectId}&view=over`,
      idempotencyKey: `purchasing.over_ordered:${variation.id}:${userId}` });
    if (result.queued) sent += 1;
  }
  return sent;
}
