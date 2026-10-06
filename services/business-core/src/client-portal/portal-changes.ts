import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { createChange, decideChange, readChanges, type ChangeRow } from "../change-requests/change-request.store";
import type { Grant } from "./portal-auth";
import { grantFor, type DecisionContext } from "./portal-decisions";

type Db = Pick<PoolClient, "query">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Change requests in the client's portal (plan §6.20, R11): the changes the team sent them (each priced line, the
 * price and handover impact, the design note) to approve with a code or decline, and the changes they asked for
 * themselves (shown as "with your team" until assessed). A change the team is still assessing, its internal approval,
 * its approvers and a withdrawal's reason never reach the client.
 */
export type PortalChange = ReturnType<typeof portalChange>;

const SHOWN_TO_CLIENT = new Set(["with_client", "approved", "declined"]);

function portalChange(change: ChangeRow & { sharedAt: string | null }, grant: Grant, caseOpen: boolean) {
  const assessed = SHOWN_TO_CLIENT.has(change.status) || (change.status === "withdrawn" && Boolean(change.sharedAt));
  // What the client reads as its state: with the team (being assessed), waiting for them, approved, declined, withdrawn.
  const status = change.status === "draft" || change.status === "pending_approval" ? "with_team" as const
    : change.status === "with_client" ? "waiting" as const : change.status as "approved" | "declined" | "withdrawn";
  return {
    id: change.id, reference: change.reference, title: change.title, description: change.description, status,
    raisedByClient: change.raisedByClient, mine: change.raisedByGrantId === grant.id,
    createdAt: change.createdAt, sharedAt: change.sharedAt,
    // The assessment once the team sent it: what changes, at what price, and the handover it gives.
    currency: assessed ? change.currency : null, priceImpact: assessed ? change.priceImpact : null, timeImpactDays: assessed ? change.timeImpactDays : null,
    handoverBefore: assessed ? change.handoverBefore : null, handoverAfter: assessed ? change.handoverAfter : null, designImpact: assessed ? change.designImpact : "",
    lines: assessed ? change.lines.map((line) => ({ id: line.id, action: line.action, title: line.title, room: line.roomName, quantity: line.quantity, unit: line.unit,
      unitPrice: line.unitPrice, amount: line.amount })) : [],
    decidedAt: change.decidedAt, decidedBy: change.decidedByName, method: change.decisionMethod, declineNote: change.status === "declined" ? change.declineNote : null,
    version: change.version,
    signed: change.status === "approved" && change.decisionMethod === "signed_link",
    canDecide: grant.role === "approver" && change.status === "with_client" && caseOpen,
  };
}

/** The changes this client may see on a project, newest first. */
export async function readPortalChanges(db: Db, workspaceId: string, grant: Grant, caseId: string, caseOpen: boolean) {
  const changes = await readChanges(db, workspaceId, caseId);
  if (!changes.length) return [];
  const shared = new Map((await db.query<{ id: string; at: string }>(
    `SELECT change_request_id AS id, min(at) AS at FROM change_request_events WHERE workspace_id = $1 AND change_request_id = ANY($2::uuid[]) AND event = 'approved_internal'
      GROUP BY change_request_id`, [workspaceId, changes.map((change) => change.id)])).rows.map((row) => [row.id, new Date(row.at).toISOString()]));
  return changes
    .map((change) => ({ ...change, sharedAt: shared.get(change.id) ?? null }))
    .filter((change) => change.raisedByClient || SHOWN_TO_CLIENT.has(change.status) || (change.status === "withdrawn" && change.sharedAt))
    .map((change) => portalChange(change, grant, caseOpen));
}

function decider(grant: Grant) {
  if (grant.role !== "approver") throw new ForbiddenException("Only the project's decision-maker can decide this. You can still read it.");
}

const open = (status: string) => ["active", "released"].includes(status);

/** A change the client asks for, in their own words; the team assesses its price and time and sends it back to decide. */
export async function raiseChange(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "decisions");
  if (grant.role !== "approver") throw new ForbiddenException("Only the project's decision-maker can ask for a change. You can send the team a message.");
  if (!open(row.caseStatus)) throw new ConflictException("This project isn't taking changes.");
  if (typeof body.id !== "string" || !UUID.test(body.id)) throw new BadRequestException("Try that again.");
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) throw new BadRequestException("Say what you'd like to change.");
  const detail = typeof body.description === "string" ? body.description.trim().slice(0, 4000) : "";
  const result = await createChange(ctx.db, ctx.workspaceId, row.caseId, { id: body.id, title, description: detail }, { grantId: grant.id, name: grant.name });
  return { ok: true, changeId: result.change.id, entity: { type: "change_request", id: result.change.id }, audit: { title, replayed: result.replayed } };
}

/** The OTP purpose that approves exactly this change at this version. */
export const changePurpose = (caseId: string, changeId: string) => `change:${caseId}:${changeId}:accept`;

/** Before a code is sent: the change still waits for this decision-maker. */
export async function assertChangeOpen(ctx: DecisionContext, caseId: string, changeId: string) {
  const { grant, row } = await grantFor(ctx, caseId, "decisions");
  decider(grant);
  const change = (await ctx.db.query<{ status: string }>(`SELECT status FROM change_requests WHERE workspace_id = $1 AND case_id = $2 AND id = $3`,
    [ctx.workspaceId, row.caseId, changeId])).rows[0];
  if (!change || change.status !== "with_client") throw new ConflictException("This change isn't waiting for your decision any more. Reload to see the latest.");
}

/**
 * The client approves a change (with a code bound to it, like every high-stakes decision) or declines it saying why.
 * The first decision-maker's decision stands; the other sees it. A stale version is refused.
 */
export async function decidePortalChange(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "decisions");
  decider(grant);
  if (!open(row.caseStatus)) throw new ConflictException("This project isn't taking decisions any more.");
  if (typeof body.changeId !== "string" || !UUID.test(body.changeId)) throw new BadRequestException("Choose a change.");
  const decision = body.decision === "accept" ? "approve" as const : body.decision === "decline" ? "decline" as const : null;
  if (!decision) throw new BadRequestException("Approve or decline.");
  const visible = (await readPortalChanges(ctx.db, ctx.workspaceId, grant, row.caseId, true)).find((change) => change.id === body.changeId);
  if (!visible) throw new NotFoundException("This change isn't shared with you.");
  if (decision === "approve") {
    const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
    const typed = typeof body.code === "string" ? body.code : "";
    if (!(await ctx.verify(changePurpose(row.caseId, visible.id), challengeId, typed))) throw new UnauthorizedException("That code isn't right or has expired. Ask for a new one.");
  }
  const result = await decideChange(ctx.db, ctx.workspaceId, row.caseId, visible.id, { decision, note: typeof body.note === "string" ? body.note : null, method: "portal",
    name: grant.name, grantId: grant.id, version: typeof body.version === "number" ? body.version : null });
  return { ok: true, entity: { type: "change_request", id: visible.id }, audit: { decision, replayed: result.replayed, status: result.change.status } };
}
