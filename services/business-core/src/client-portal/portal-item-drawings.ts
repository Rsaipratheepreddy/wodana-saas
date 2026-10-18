import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { askItemDrawingChanges, lockVersions, signItemDrawings } from "../project-core/project-item-decisions";
import { assertSignable, MAX_SIGN_ITEMS, signingBatchId } from "../project-core/project-item-proof";
import { grantFor, type DecisionContext } from "./portal-decisions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN = ["active", "on_hold"];

function approverOnly(role: string) {
  if (role !== "approver") throw new ForbiddenException("Only the project's decision-maker can decide this. You can still read it.");
}

async function confirmCode(ctx: DecisionContext, purpose: string, body: Record<string, unknown>) {
  const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
  const typed = typeof body.code === "string" ? body.code : "";
  if (!(await ctx.verify(purpose, challengeId, typed))) throw new UnauthorizedException("That code isn't right or has expired. Ask for a new one.");
  return challengeId;
}

/** The browser the client signed on, kept short and printable (the device in the signature's evidence). */
function userAgentOf(value: unknown) {
  const agent = typeof value === "string" ? value.replace(/[^\x20-\x7e]/g, "").slice(0, 500) : "";
  return agent || null;
}

/**
 * The client signs one or several items' shop drawings with the code sent for exactly those versions
 * (`item_drawings:<case>:<batch>:sign`, the batch read from the versions). Signing locks each item.
 */
export async function signItemDrawingsInPortal(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "decisions");
  approverOnly(grant.role);
  if (!row.projectId || !OPEN.includes(row.projectStatus ?? "")) throw new ConflictException("This project is closed.");
  const raw = Array.isArray(body.versionIds) ? body.versionIds : [];
  if (raw.length > MAX_SIGN_ITEMS) throw new BadRequestException(`Sign up to ${MAX_SIGN_ITEMS} items at once.`);
  if (raw.some((id) => typeof id !== "string" || !UUID.test(id))) throw new BadRequestException("Choose the items to sign.");
  const versionIds = (raw as string[]).map((id) => id.toLowerCase());
  await ctx.db.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [ctx.workspaceId, row.projectId]);
  const versions = await lockVersions(ctx.db, ctx.workspaceId, row.projectId, versionIds);
  assertSignable(versionIds, versions);
  const batchId = signingBatchId(row.caseId, versionIds);
  const challengeId = await confirmCode(ctx, `item_drawings:${row.caseId}:${batchId}:sign`, body);
  const signed = await signItemDrawings(ctx.db, { workspaceId: ctx.workspaceId, projectId: row.projectId, caseId: row.caseId, versionIds, batchId, grant: { id: grant.id, name: grant.name },
    challengeId, commandId: String(body.commandId), userAgent: userAgentOf(body.device), versions });
  await ctx.db.query(`UPDATE delivery_projects SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [ctx.workspaceId, row.projectId]);
  return { ok: true, signed: signed.signed, entity: { type: "project", id: row.projectId }, audit: { batchId, versionIds, lines: signed.lines, decision: "sign" } };
}

/** The client asks for changes to one item's drawing, with what to change, confirmed with a code for that version. */
export async function askItemDrawingChangesInPortal(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "decisions");
  approverOnly(grant.role);
  if (!row.projectId || !OPEN.includes(row.projectStatus ?? "")) throw new ConflictException("This project is closed.");
  if (typeof body.versionId !== "string" || !UUID.test(body.versionId)) throw new BadRequestException("Choose the drawing.");
  const versionId = body.versionId.toLowerCase();
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note) throw new BadRequestException("Say what you'd like changed.");
  if (note.length > 1000) throw new BadRequestException("Keep it under 1000 characters.");
  await ctx.db.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [ctx.workspaceId, row.projectId]);
  const [version] = await lockVersions(ctx.db, ctx.workspaceId, row.projectId, [versionId]);
  if (!version || !version.current || version.status !== "with_client")
    throw new ConflictException("This drawing isn't waiting for your decision any more. Reload to see the latest.");
  await confirmCode(ctx, `item_drawing:${row.caseId}:${versionId}:changes`, body);
  await askItemDrawingChanges(ctx.db, { workspaceId: ctx.workspaceId, projectId: row.projectId, version, grant: { id: grant.id, name: grant.name }, note });
  return { ok: true, entity: { type: "project", id: row.projectId }, audit: { versionId, number: version.number, decision: "changes" } };
}
