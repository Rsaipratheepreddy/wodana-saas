import { ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { thankForHandover } from "../crm/conversations/inbox/client-followups";
import { closeOutBlockers, readCloseOut, settleCloseOut } from "./project-closeout";
import { ensureSettings, evaluateStages, readProject, readStages, readTeam, type ProjectRow, type TeamMember } from "./project-core.store";
import { noticeProject } from "./project-notices";

type Db = Pick<PoolClient, "query">;

/** The workspace's date in its own zone (close-out moves are dated with it). */
async function workspaceToday(db: Db, workspaceId: string) {
  return (await db.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
}

/**
 * The project closes after its last stage, once nothing is left open: leftover project stock becomes free stock,
 * the client is thanked (once per project) and the completion is audited. Throws what still blocks it.
 */
export async function completeProject(db: Db, input: { workspaceId: string; project: Pick<ProjectRow, "id" | "reference">; actorUserId: string; automatic?: boolean }) {
  const { workspaceId, project, actorUserId } = input;
  const closeOut = await readCloseOut(db, workspaceId, project.id);
  const blockers = closeOutBlockers(closeOut, true);
  if (blockers.length) throw new ConflictException(`Before the project closes: ${blockers.join("; ")}.`);
  const settled = await settleCloseOut(db, { workspaceId, projectId: project.id, reference: project.reference, closeOut, why: `${project.reference} completed`, actorId: actorUserId,
    today: await workspaceToday(db, workspaceId) });
  await db.query(`UPDATE delivery_projects SET status = 'completed', completed_at = now(), completed_by = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, project.id, actorUserId]);
  await recordAudit(db, input.automatic
    ? { workspaceId, actorUserId: null, source: "internal", action: "project.completed", entityType: "project", entityId: project.id, after: { ...settled, automatic: true, onBehalfOf: actorUserId } }
    : { workspaceId, actorUserId, action: "project.completed", entityType: "project", entityId: project.id, after: settled });
  // Unless the handover already thanked them, the client is thanked now (once per project).
  await thankForHandover(db, workspaceId, project.id, { actorUserId });
  return settled;
}

/**
 * D-7: with Settings → Projects → "Finish by itself" on, a project whose last open stage checks the client's
 * handover acceptance finishes on its own once that stage's checks all pass: the stage is marked done (finished
 * automatically, on behalf of whoever's action made it pass, else the project manager), the project completes
 * and the team hears. Nothing happens while close-out still has open orders, moves or bills: the stage owner is
 * told it can be finished instead. Returns whether the project finished.
 */
export async function autoFinishProject(db: Db, workspaceId: string, projectId: string, actorUserId: string | null) {
  const settings = await ensureSettings(db, workspaceId);
  if (!settings.autoFinish) return false;
  const project = await readProject(db, workspaceId, projectId);
  if (!project || project.status !== "active") return false;
  const stages = await readStages(db, workspaceId, [projectId]);
  const current = stages.find((stage) => stage.status === "current");
  if (!current || stages.some((stage) => stage.status === "upcoming")) return false;
  if (!current.checks.some((check) => check.kind === "handover_accepted")) return false;
  const team: TeamMember[] = (await readTeam(db, workspaceId, [projectId])).get(projectId) ?? [];
  const [evaluated] = await evaluateStages(db, workspaceId, project, [current], team);
  if (!evaluated?.ready) return false;
  if (closeOutBlockers(await readCloseOut(db, workspaceId, projectId), true).length) return false;
  const onBehalfOf = actorUserId ?? await leadUser(db, workspaceId, team);
  if (!onBehalfOf) return false;
  // Taken under the project's lock, so a command or another run finishing it at the same time can't finish it twice.
  const locked = await readProject(db, workspaceId, projectId, true);
  if (locked?.status !== "active" || locked.version !== project.version) return false;
  await db.query(`UPDATE project_stages SET status = 'done', completed_at = now(), completed_by = $3, finished_automatically = true WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, current.id, onBehalfOf]);
  await recordAudit(db, { workspaceId, actorUserId: null, source: "internal", action: "project.complete_stage", entityType: "project", entityId: projectId,
    after: { stage: current.key, automatic: true, onBehalfOf } });
  await completeProject(db, { workspaceId, project, actorUserId: onBehalfOf, automatic: true });
  await db.query(`UPDATE delivery_projects SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId]);
  await noticeProject(db, { workspaceId, projectId, key: `completed:${project.version}`, actorUserId: null,
    notice: { code: "project.finished_automatically", note: current.name, memberships: team.map((member) => member.membershipId) } });
  return true;
}

async function leadUser(db: Db, workspaceId: string, team: TeamMember[]) {
  const lead = team.find((member) => member.lead);
  if (!lead) return null;
  return (await db.query<{ userId: string }>(`SELECT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = $2`, [workspaceId, lead.membershipId])).rows[0]?.userId ?? null;
}
