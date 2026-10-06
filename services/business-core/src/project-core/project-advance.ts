import { ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { partyOfCase, recordClientMessageSkipped, sendClientEvent } from "../crm/conversations/inbox/client-messages";
import { recordAudit } from "../audit/record-audit";
import type { ProjectRow, StageRow, TeamMember } from "./project-core.store";
import { drawingOnlyStage, NO_DRAWINGS_REASON, projectNeedsDrawings } from "./project-drawing-needs";
import { completeProject } from "./project-finish";
import type { ProjectNotice } from "./project-notices";

type Db = PoolClient;

/**
 * Moves the project on from a finished (or skipped) stage to the next one that isn't skipped; after the last one the
 * project is complete. No stage starts without a project manager (PLM-056): the person who leads the stage work and
 * records the client's decisions. The client hears on WhatsApp that the next stage started (when the firm has it on and
 * the portal isn't paused); the lead and the next stage's owner hear it in the app.
 */
export async function advanceStage(client: Db, workspaceId: string, project: ProjectRow, stages: StageRow[], finished: StageRow, team: TeamMember[], userId: string,
  notices: Array<{ key: string; notice: ProjectNotice }>) {
  let next = stages.find((stage) => stage.position > finished.position && stage.status === "upcoming");
  // A stage holding only drawing checks has no work when no item needs drawings: it is skipped by itself (PLM-057).
  let needsDrawings: boolean | null = null;
  while (next && drawingOnlyStage(next) && !(needsDrawings ??= await projectNeedsDrawings(client, workspaceId, project.id))) {
    await skipWithoutDrawings(client, workspaceId, project.id, next, userId);
    const skipped: StageRow = next;
    next = stages.find((stage) => stage.position > skipped.position && stage.status === "upcoming");
  }
  if (next) {
    if (!team.some((member) => member.lead)) throw new ConflictException(`Name the project manager before ${next.name} starts.`);
    await client.query(`UPDATE project_stages SET status = 'current', started_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, next.id]);
    const owner = await partyOfCase(client, workspaceId, project.caseId);
    const toldClient = await sendClientEvent(client, { workspaceId, event: "project.stage_started", partyId: owner.partyId, leadId: owner.leadId, recordKey: `${project.id}:${next.id}`,
      record: { projectId: project.id, stageName: next.name }, actorUserId: userId });
    if (!toldClient.sent) await recordClientMessageSkipped(client, workspaceId, "project.stage_started", `${project.id}:${next.id}`, toldClient, false);
    const told = team.filter((member) => member.lead || (next.ownerRole && member.roles.includes(next.ownerRole))).map((member) => member.membershipId);
    notices.push({ key: `stage:${next.key}:${project.version}`, notice: { code: "project.stage_done", stage: next.name, previous: finished.name, memberships: told } });
  } else if (!stages.some((stage) => stage.id !== finished.id && (stage.status === "current" || stage.status === "upcoming"))) {
    // The last stage closes the project, once nothing is left open; leftover project stock becomes free stock.
    await completeProject(client, { workspaceId, project, actorUserId: userId });
    notices.push({ key: `completed:${project.version}`, notice: { code: "project.completed", note: "", memberships: team.map((member) => member.membershipId) } });
  }
}

/** Skips a drawings-only stage because no item needs drawings, recorded as an automatic skip with the reason. */
export async function skipWithoutDrawings(client: Pick<Db, "query">, workspaceId: string, projectId: string, stage: StageRow, userId: string) {
  await client.query(`UPDATE project_stages SET status = 'skipped', skip_reason = $3, completed_at = now(), completed_by = $4 WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, stage.id, NO_DRAWINGS_REASON, userId]);
  await recordAudit(client, { workspaceId, actorUserId: userId, action: "project.skip_stage", entityType: "project", entityId: projectId,
    after: { stage: stage.key, reason: NO_DRAWINGS_REASON, automatic: true } });
  stage.status = "skipped";
  stage.skipReason = NO_DRAWINGS_REASON;
}
