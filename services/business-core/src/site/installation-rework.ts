import type { PoolClient } from "pg";
import { notifyUserInApp } from "../notifications/default-templates";
import { raiseSnag, workEvent } from "../project-core/project-work";

type Db = Pick<PoolClient, "query">;

/**
 * Installation that isn't accepted: a major snag on the scope line with why (from an inspection), and the
 * finished tasks for that line open again for rework, their assignees told. The approved report stays as it
 * was (history is never edited); the snag carries the rework until someone else checks it fixed.
 */
export async function reworkInstallation(db: Db, workspaceId: string, input: {
  projectId: string; projectTitle: string; boqLineId: string; title: string; reason: string; actorId: string; actorName: string;
}) {
  const packageId = (await db.query<{ packageId: string | null }>(`SELECT package_id AS "packageId" FROM project_boq_lines WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, input.boqLineId])).rows[0]?.packageId ?? null;
  const snag = await raiseSnag(db, workspaceId, { projectId: input.projectId, title: `Not accepted: ${input.title}`.slice(0, 300), description: input.reason, severity: "major",
    source: "inspection", packageId, boqLineId: input.boqLineId, actorId: input.actorId });
  const reopened = (await db.query<{ id: string; number: number; title: string; userId: string | null }>(
    `UPDATE work_items item SET status = 'in_progress', completed_at = NULL, completed_by = NULL, version = item.version + 1, updated_at = now()
       FROM (SELECT id FROM work_items WHERE workspace_id = $1 AND project_id = $2 AND boq_line_id = $3 AND type = 'task' AND status = 'done' FOR UPDATE) done
      WHERE item.workspace_id = $1 AND item.id = done.id
      RETURNING item.id, item.number, item.title,
        (SELECT membership.user_id FROM workspace_memberships membership WHERE membership.workspace_id = item.workspace_id AND membership.id = item.assignee_membership_id AND membership.status = 'active') AS "userId"`,
    [workspaceId, input.projectId, input.boqLineId])).rows;
  for (const task of reopened) {
    await workEvent(db, workspaceId, task.id, "reopened", { reason: input.reason, snag: snag.number }, input.actorId);
    if (task.userId && task.userId !== input.actorId)
      await notifyUserInApp(db, { workspaceId, recipientUserId: task.userId, code: "work.snag_reopened", eventType: "work.snag_reopened",
        variables: { title: input.projectTitle, clientName: "", actor: input.actorName, task: `#${task.number} ${task.title}`, note: input.reason.slice(0, 480) },
        deepLink: `/workspace/projects/${input.projectId}/plan?item=${task.id}`, idempotencyKey: `work.rework:${task.id}:${snag.id}:${task.userId}` });
  }
  return { snag: snag.number, reopened: reopened.map((task) => task.number) };
}
