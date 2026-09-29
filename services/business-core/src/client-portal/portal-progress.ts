import { BadRequestException, NotFoundException } from "@nestjs/common";
import { newRequest } from "../commercial/commercial.domain";
import { attach, contactId, ownUploads } from "./portal-files";
import { markRead } from "./portal-messages";
import { caseTeam, tellStaff } from "./portal-notices";
import { grantFor, type DecisionContext } from "./portal-decisions";

/**
 * What a client does on a day's card in the portal: react to it (👍 or ❤️), or ask about it — which opens a
 * conversation with the project team (under Messages) and reaches the project manager in the app and by email.
 */

/** A day the team sent to this client's project. */
async function sentDay(ctx: DecisionContext, caseId: unknown, reportId: unknown) {
  const { grant, row } = await grantFor(ctx, caseId, "progress");
  if (typeof reportId !== "string" || !row.projectId) throw new NotFoundException("This day isn't there any more.");
  const day = (await ctx.db.query<{ id: string; reportDate: string }>(
    `SELECT id, report_date::text AS "reportDate" FROM site_reports WHERE workspace_id = $1 AND project_id = $2 AND id = $3::uuid AND delivery = 'sent'`,
    [ctx.workspaceId, row.projectId, /^[0-9a-f-]{36}$/i.test(reportId) ? reportId : null])).rows[0];
  if (!day) throw new NotFoundException("This day isn't there any more.");
  return { grant, row, day };
}

const projectTitle = (row: { reference: string | null; projectName: string | null; title: string }) => (row.reference ? `${row.reference} · ${row.projectName}` : row.title);

/** 👍 or ❤️ on a day, on or off; the project manager hears the first time each contact reacts to a day. */
export async function reactToDay(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row, day } = await sentDay(ctx, body.caseId, body.reportId);
  const reaction = body.reaction === "love" ? "love" : body.reaction === "like" ? "like" : null;
  if (!reaction) throw new BadRequestException("Choose a reaction.");
  const on = body.on !== false;
  if (on) {
    const added = (await ctx.db.query(`INSERT INTO site_report_reactions (workspace_id, report_id, grant_id, reaction) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [ctx.workspaceId, day.id, grant.id, reaction])).rowCount;
    if (added) await tellStaff(ctx.db, { workspaceId: ctx.workspaceId, recipients: await caseTeam(ctx.db, ctx.workspaceId, row.caseId, ["managers"]), code: "site.client_reacted",
      variables: { title: projectTitle(row), clientName: grant.name, actor: grant.name, note: `${reaction === "love" ? "❤️" : "👍"} on ${day.reportDate}` },
      deepLink: `/workspace/projects/${row.projectId}/site?report=${day.id}`, key: `${day.id}:${grant.id}:${reaction}` });
  } else {
    await ctx.db.query(`DELETE FROM site_report_reactions WHERE workspace_id = $1 AND report_id = $2 AND grant_id = $3 AND reaction = $4`, [ctx.workspaceId, day.id, grant.id, reaction]);
  }
  return { ok: true, entity: { type: "project", id: row.projectId! }, audit: { projectId: row.projectId, reportId: day.id, reaction, on } };
}

/** A question about a day: a conversation with the team (the client reads the answer under Messages); the manager hears it. */
export async function askAboutDay(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row, day } = await sentDay(ctx, body.caseId, body.reportId);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw new BadRequestException("Write your question.");
  if (text.length > 2000) throw new BadRequestException("Keep it under 2000 characters.");
  const files = await ownUploads(ctx.db, ctx.workspaceId, ctx.contact, row.caseId, body.uploadIds);
  const data = await ctx.commercial.load(ctx.db, ctx.workspaceId, row.caseId);
  const request = newRequest(data, `About the progress on ${day.reportDate}`, text, undefined, undefined, { name: grant.name, client: true });
  await ctx.commercial.persist(ctx.db, ctx.workspaceId, row.caseId, data, grant.name, "Client question on the daily progress (portal)");
  await attach(ctx.db, ctx.workspaceId, { caseId: row.caseId, grantId: grant.id, kind: "message", targetId: request.id, files });
  await markRead(ctx.db, ctx.workspaceId, row.caseId, request.id, "client", contactId(grant) ?? grant.id);
  await tellStaff(ctx.db, { workspaceId: ctx.workspaceId, recipients: await caseTeam(ctx.db, ctx.workspaceId, row.caseId, ["managers"]), code: "site.client_question",
    variables: { title: projectTitle(row), clientName: grant.name, actor: grant.name, note: text.slice(0, 480) },
    deepLink: `/workspace/pre-projects/cases/${row.caseId}/variations?request=${encodeURIComponent(request.id)}`, key: request.id, email: true });
  return { ok: true, requestId: request.id, entity: { type: "project", id: row.projectId! }, audit: { projectId: row.projectId, reportId: day.id, requestId: request.id, files: files.length } };
}
