import type { PoolClient } from "pg";
import { notifyUserInApp } from "../notifications/default-templates";
import { evaluateStages, readProject, readStages, readTeam } from "./project-core.store";
import { autoFinishProject } from "./project-finish";
import { noticeFactorySlotDue } from "./project-release";
import { syncStageTasks } from "./project-stage-tasks";

type Db = Pick<PoolClient, "query">;

/**
 * When the current stage's checks all pass because of a record elsewhere (everything ordered, made and
 * checked, the material list signed off, the handover accepted…), the stage owner and the project manager
 * hear once that it can be finished. A stage with only hand-ticked checks isn't announced: whoever ticked
 * the last one knows. Runs after the commands that can flip a check and in the daily run, which catches
 * changes made in Purchasing, the Factory or the client portal. Returns how many were told.
 */
export async function noticeStageReady(db: Db, workspaceId: string, projectId: string, actorUserId: string | null = null) {
  const project = await readProject(db, workspaceId, projectId);
  if (!project || project.status !== "active") return 0;
  // The current stage's record-driven tasks follow the records (PLM-057 … 059), and the factory hears to book its
  // slot once the deposit is in (PLM-068).
  await syncStageTasks(db, workspaceId, projectId, actorUserId);
  await noticeFactorySlotDue(db, workspaceId, projectId, actorUserId);
  // With "Finish by itself" on, a handover the client accepted closes the project instead (D-7).
  if (await autoFinishProject(db, workspaceId, projectId, actorUserId)) return 0;
  const [stage] = await readStages(db, workspaceId, [projectId], true);
  if (!stage || !stage.checks.some((check) => check.kind !== "confirm")) return 0;
  const team = (await readTeam(db, workspaceId, [projectId])).get(projectId) ?? [];
  const [evaluated] = await evaluateStages(db, workspaceId, project, [stage], team);
  if (!evaluated?.ready) return 0;
  const memberships = team.filter((member) => member.lead || (stage.ownerRole && member.roles.includes(stage.ownerRole))).map((member) => member.membershipId);
  if (!memberships.length) return 0;
  const people = (await db.query<{ userId: string }>(
    `SELECT DISTINCT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
    [workspaceId, memberships])).rows.map((row) => row.userId).filter((userId) => userId !== actorUserId);
  const started = stage.startedAt ? new Date(stage.startedAt).toISOString() : "";
  let sent = 0;
  for (const userId of people) {
    const result = await notifyUserInApp(db, {
      workspaceId, recipientUserId: userId, code: "project.stage_ready", eventType: "project.stage_ready",
      variables: { title: `${project.reference} · ${project.name}`, clientName: project.clientName, actor: "", stage: stage.name, note: "" },
      deepLink: `/workspace/projects/${projectId}`,
      // Once per run of the stage (a stage opened again announces again).
      idempotencyKey: `project.stage_ready:${stage.id}:${started}:${userId}`,
    });
    if (result.queued) sent += 1;
  }
  return sent;
}
