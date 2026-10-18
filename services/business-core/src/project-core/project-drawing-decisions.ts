import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { advanceStage } from "./project-advance";
import { DRAWING_CHECKS } from "./project-checks";
import { evaluateStages, readProject, readStages, readTeam, type ProjectRow } from "./project-core.store";
import { noticeProject, type ProjectNotice } from "./project-notices";
import { permissionHolders } from "./project-release";

type Db = PoolClient;

/**
 * The client's decision on the drawings sent to them (PLM-059, PLM-060, PLM-062), recorded by the project manager
 * (the day, who decided, the signed file) or made by the client in the portal.
 *
 * Approved: the drawings are the production release. Production / the factory hear it (the project's factory lead
 * and the people who run the factory, by email too) and can open the approved drawings, the material list and the
 * BOQ read-only; when the current stage asks for this approval and now has everything it needs, it finishes by
 * itself and the project moves on (to Production on a route that has it next).
 * Sent back: the technical team hears what to change; the next revision starts.
 */
export async function decideDrawings(db: Db, input: {
  workspaceId: string; projectId: string; revisionId: string; decision: "approve" | "changes"; decidedOn: string; decidedBy: string; note: string;
  via: "recorded" | "portal"; userId: string | null; grantId?: string | null;
}) {
  const { workspaceId, projectId } = input;
  const project = (await readProject(db, workspaceId, projectId, true))!;
  const revision = (await db.query<{ number: number; createdBy: string }>(
    `UPDATE project_drawing_revisions SET status = $3, decided_on = $4, decided_by_name = $5, decision_note = $6, decision_via = $7, decision_recorded_by = $8,
            decision_grant_id = $9, decided_at = now(), version = version + 1
      WHERE workspace_id = $1 AND id = $2 AND status = 'sent' RETURNING number, created_by AS "createdBy"`,
    [workspaceId, input.revisionId, input.decision === "approve" ? "approved" : "changes_requested", input.decidedOn, input.decidedBy, input.note, input.via, input.userId,
      input.grantId ?? null])).rows[0];
  if (!revision) return { advanced: null as string | null };
  const label = `R${revision.number}`;
  const team = (await readTeam(db, workspaceId, [projectId])).get(projectId) ?? [];
  const stages = await readStages(db, workspaceId, [projectId]);
  const leads = team.filter((member) => member.lead).map((member) => member.membershipId);
  const notices: Array<{ key: string; notice: ProjectNotice; deepLink?: string }> = [];
  const drawingsLink = `/workspace/projects/${projectId}/scope?view=drawings`;
  let advanced: string | null = null;
  if (input.decision === "approve") {
    const factory = [
      ...team.filter((member) => member.roles.includes("factory_lead")).map((member) => member.membershipId),
      ...(await permissionHolders(db, workspaceId, ["factory.manage"])).map((person) => person.membershipId),
    ];
    notices.push({ key: `drawings:approved:${input.revisionId}`, notice: { code: "project.drawings_approved", revision: label, date: input.decidedOn, memberships: [...factory, ...leads] },
      deepLink: drawingsLink });
    // The stage that waited for this approval finishes by itself, on behalf of whoever recorded it (else the project manager).
    const current = stages.find((stage) => stage.status === "current");
    if (project.status === "active" && current?.checks.some((check) => check.kind === "drawings_client_approved")) {
      const [evaluated] = await evaluateStages(db, workspaceId, project, [current], team);
      const onBehalfOf = input.userId ?? (leads[0] ? (await db.query<{ userId: string }>(`SELECT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, leads[0]])).rows[0]?.userId ?? null : null);
      if (evaluated?.ready && onBehalfOf && team.some((member) => member.lead)) {
        await db.query(`UPDATE project_stages SET status = 'done', completed_at = now(), completed_by = $3, finished_automatically = true WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, current.id, onBehalfOf]);
        await recordAudit(db, { workspaceId, actorUserId: input.userId, source: input.via === "portal" ? "client_portal" : "user", action: "project.complete_stage", entityType: "project", entityId: projectId,
          after: { stage: current.key, automatic: true, onBehalfOf, because: "drawings_approved" } });
        const moving: Array<{ key: string; notice: ProjectNotice }> = [];
        await advanceStage(db, workspaceId, project as ProjectRow, stages, current, team, onBehalfOf, moving);
        notices.push(...moving);
        advanced = stages.find((stage) => stage.position > current.position && stage.status === "upcoming")?.name ?? null;
      }
    }
  } else {
    // The technical team (the owners of the drawing stages) and whoever uploaded them hear what to change.
    const roles = new Set(stages.filter((stage) => stage.ownerRole && stage.checks.some((check) => DRAWING_CHECKS.includes(check.kind))).map((stage) => stage.ownerRole!));
    const uploader = (await db.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`,
      [workspaceId, revision.createdBy])).rows[0]?.id;
    notices.push({ key: `drawings:changes:${input.revisionId}`, deepLink: drawingsLink, notice: { code: "project.drawings_changes", revision: label, note: input.note,
      memberships: [...team.filter((member) => member.roles.some((role) => roles.has(role))).map((member) => member.membershipId), ...(uploader ? [uploader] : []), ...leads] } });
  }
  for (const item of notices) await noticeProject(db, { workspaceId, projectId, key: item.key, actorUserId: input.userId, notice: item.notice, deepLink: item.deepLink });
  return { advanced };
}
