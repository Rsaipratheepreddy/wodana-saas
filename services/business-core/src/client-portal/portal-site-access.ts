import { ConflictException } from "@nestjs/common";
import { answerSiteAccess } from "../site/site-access";
import { grantFor, type DecisionContext } from "./portal-decisions";

/**
 * D-29 in the portal: anyone on the client's side confirms site access for a delivery day, or asks to move it with
 * why and the day that suits them.
 */
export async function siteAccess(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "progress");
  if (!row.projectId || row.projectStatus !== "active") throw new ConflictException("This project isn't running.");
  const result = await answerSiteAccess(ctx.db, ctx.workspaceId, { projectId: row.projectId, grantId: grant.id, name: grant.name, body });
  return { ok: true, decision: result.decision, entity: { type: "site_access_request", id: result.request.id }, audit: result.changed ? result.audit : { decision: result.decision, unchanged: true } };
}
