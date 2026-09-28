import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { raiseSnag } from "../project-core/project-work";
import { grantFor, type DecisionContext } from "./portal-decisions";
import { attach, ownUploads, readAttachments } from "./portal-files";
import { caseTeam, caseTitle, tellClients, tellStaff } from "./portal-notices";

type Db = Pick<PoolClient, "query">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An issue the client sees while the work is on (a chipped panel during installation): reported with a photo and the
 * room, it waits for the project manager to triage it into a snag (with a severity) or decline it with a reason the
 * client reads. After handover, problems go through the warranty instead.
 */
export async function reportIssue(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "progress");
  if (!row.projectId || !["active", "on_hold"].includes(row.projectStatus ?? "")) throw new ConflictException("After handover, report problems under Warranty.");
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description) throw new BadRequestException("Say what's wrong.");
  if (description.length > 2000) throw new BadRequestException("Keep it under 2000 characters.");
  const areaId = body.areaId ? String(body.areaId) : null;
  if (areaId && (!UUID.test(areaId) || !(await ctx.db.query(`SELECT 1 FROM pre_project_rooms WHERE workspace_id = $1 AND case_id = $2 AND id = $3`,
    [ctx.workspaceId, row.caseId, areaId])).rowCount)) throw new BadRequestException("Choose a room of this project.");
  const files = await ownUploads(ctx.db, ctx.workspaceId, ctx.contact, row.caseId, body.uploadIds, 6);
  await ctx.db.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [ctx.workspaceId, row.projectId]);
  const number = (await ctx.db.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM client_portal_issues WHERE workspace_id = $1 AND project_id = $2`,
    [ctx.workspaceId, row.projectId])).rows[0].next;
  const id = randomUUID();
  await ctx.db.query(
    `INSERT INTO client_portal_issues (workspace_id, id, case_id, project_id, number, grant_id, raised_on, description, area_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [ctx.workspaceId, id, row.caseId, row.projectId, number, grant.id, ctx.today, description, areaId]);
  await attach(ctx.db, ctx.workspaceId, { caseId: row.caseId, grantId: grant.id, kind: "issue", targetId: id, files });
  const facts = await caseTitle(ctx.db, ctx.workspaceId, row.caseId);
  await tellStaff(ctx.db, { workspaceId: ctx.workspaceId, recipients: await caseTeam(ctx.db, ctx.workspaceId, row.caseId, ["managers"]), code: "project.client_issue",
    variables: { title: facts.title, clientName: facts.clientName, actor: grant.name, note: description.slice(0, 480) },
    deepLink: `/workspace/projects/${row.projectId}/site?issue=${id}`, key: id, email: true });
  return { ok: true, issueId: id, number, entity: { type: "project", id: row.projectId }, audit: { issueId: id, number, files: files.length } };
}

type IssueRow = { id: string; number: number; raisedOn: string; description: string; area: string | null; areaId: string | null; status: "to_triage" | "accepted" | "declined";
  severity: string | null; reason: string; by: string; snagId: string | null; version: number; decidedBy: string | null };

async function issues(db: Db, workspaceId: string, projectId: string) {
  return (await db.query<IssueRow>(
    `SELECT issue.id, issue.number, issue.raised_on::text AS "raisedOn", issue.description, room.name AS area, issue.area_id AS "areaId", issue.status, issue.severity,
            issue.decision_note AS reason, coalesce(grant_row.confirmed_name, grant_row.name) AS by, issue.snag_id AS "snagId", issue.version, person.display_name AS "decidedBy"
       FROM client_portal_issues issue
       JOIN client_portal_grants grant_row ON grant_row.workspace_id = issue.workspace_id AND grant_row.id = issue.grant_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = issue.workspace_id AND room.case_id = issue.case_id AND room.id = issue.area_id
       LEFT JOIN users person ON person.id = issue.decided_by
      WHERE issue.workspace_id = $1 AND issue.project_id = $2 ORDER BY issue.number DESC`, [workspaceId, projectId])).rows;
}

/** The client's issues on a project: what they reported, where, and what the team decided (why, when declined). */
export async function readIssues(db: Db, workspaceId: string, caseId: string, projectId: string) {
  const files = await readAttachments(db, workspaceId, caseId, ["issue"]);
  // The snag's own state once it's accepted: open, being fixed, fixed.
  const snags = new Map((await db.query<{ id: string; status: string }>(
    `SELECT item.id, item.status FROM work_items item WHERE item.workspace_id = $1 AND item.project_id = $2 AND item.type = 'snag' AND item.source = 'client'`,
    [workspaceId, projectId])).rows.map((row) => [row.id, row.status]));
  return (await issues(db, workspaceId, projectId)).map((issue) => ({
    id: issue.id, number: issue.number, raisedOn: issue.raisedOn, description: issue.description, area: issue.area,
    status: (issue.status === "accepted" && issue.snagId && ["done", "cancelled"].includes(snags.get(issue.snagId) ?? "") ? "fixed" : issue.status) as "to_triage" | "accepted" | "declined" | "fixed",
    reason: issue.status === "declined" ? issue.reason : "", files: files.get(`issue:${issue.id}`) ?? [],
  }));
}

/** For the project team: the client's issues with what's needed to triage them. */
export async function readStaffIssues(db: Db, workspaceId: string, caseId: string, projectId: string) {
  const files = await readAttachments(db, workspaceId, caseId, ["issue"]);
  return (await issues(db, workspaceId, projectId)).map((issue) => ({ ...issue, files: files.get(`issue:${issue.id}`) ?? [] }));
}

/**
 * The project manager triages a client's issue: accepted as a snag from the client (with a severity, in its room), or
 * declined with a reason the client reads. Version-checked; the same decision again changes nothing.
 */
export async function triageIssue(db: Db, workspaceId: string, projectId: string, userId: string, issueId: string, body: Record<string, unknown>) {
  if (!UUID.test(issueId)) throw new NotFoundException("Issue not found.");
  const issue = (await db.query<{ status: string; version: number; description: string; number: number; areaId: string | null; caseId: string }>(
    `SELECT status, version, description, number, area_id AS "areaId", case_id AS "caseId" FROM client_portal_issues WHERE workspace_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`,
    [workspaceId, projectId, issueId])).rows[0];
  if (!issue) throw new NotFoundException("Issue not found.");
  const decision = body.decision === "accept" ? "accepted" : body.decision === "decline" ? "declined" : null;
  if (!decision) throw new BadRequestException("Accept it as a snag, or decline it.");
  if (issue.status === decision) return { changed: false };
  if (issue.status !== "to_triage") throw new ConflictException("Someone already triaged this issue. Reload to see it.");
  if (body.version !== issue.version) throw new ConflictException("This issue changed. Reload to see it.");
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > 1000) throw new BadRequestException("Keep the note under 1000 characters.");
  if (decision === "declined") {
    if (!note) throw new BadRequestException("Tell the client why it's declined.");
    await db.query(`UPDATE client_portal_issues SET status = 'declined', decision_note = $3, decided_by = $4, decided_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, issueId, note, userId]);
    await tellClients(db, { workspaceId, caseId: issue.caseId, event: "issue_triaged", recordId: `issue:${issueId}`, title: `${issue.number}`,
      note: `We looked at the issue you reported (${issue.description.slice(0, 120)}). We won't take it up: ${note}` });
    return { changed: true };
  }
  const severity = ["minor", "major", "critical"].includes(String(body.severity)) ? String(body.severity) as "minor" | "major" | "critical" : null;
  if (!severity) throw new BadRequestException("Choose how serious it is.");
  const snag = await raiseSnag(db, workspaceId, { projectId, title: `Client issue ${issue.number}: ${issue.description.split("\n")[0]}`.slice(0, 300), description: issue.description,
    severity, source: "client", actorId: userId });
  if (issue.areaId) await db.query(`UPDATE work_items SET area_id = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, snag.id, issue.areaId]);
  await db.query(
    `UPDATE client_portal_issues SET status = 'accepted', severity = $3, decision_note = $4, decided_by = $5, decided_at = now(), snag_id = $6, version = version + 1
      WHERE workspace_id = $1 AND id = $2`, [workspaceId, issueId, severity, note, userId, snag.id]);
  await tellClients(db, { workspaceId, caseId: issue.caseId, event: "issue_triaged", recordId: `issue:${issueId}`, title: `${issue.number}`,
    note: `We looked at the issue you reported (${issue.description.slice(0, 120)}). We're fixing it.` });
  return { changed: true, snagId: snag.id };
}
