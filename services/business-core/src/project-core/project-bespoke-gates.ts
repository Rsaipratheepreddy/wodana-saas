import type { PoolClient } from "pg";
import { qsRequirement } from "../proposals/qs-requirement";
import { bespokeOrder } from "./project-drawing-needs";
import { factoryRequirementsConfirmed, readLineRequirements } from "./project-factory-requirements";
import { technicalHandoverAccepted } from "./project-technical-handover";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-174: the path E checks before production on a bespoke (made-to-order) job: the technical handover pack accepted
 * (PLM-165), every custom line's factory requirements confirmed or its recipe verified (PLM-166), and the quotation past
 * its QS step (the deal's existing QS price step). Each is read from the records; a route check or a factory setting
 * decides whether it holds. On a job that isn't bespoke there is nothing to hold (`null`).
 */
export type BespokeGates = { technicalHandoverAccepted: boolean; factoryRequirementsConfirmed: boolean; qsApproved: boolean };

/** The QS rules' reasons for skipping a quotation: there is no QS step to wait for. */
const QS_SKIPPED = new Set(["off", "no_boq", "design_fee", "standard_only", "not_quotation"]);

/** The project's quotation passed its QS step (internal approval, then issued and accepted), or the firm's QS rules skip it. */
export async function qsApproved(db: Db, workspaceId: string, caseId: string, quoteId: string) {
  const quote = (await db.query<{ status: string }>(`SELECT status FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, quoteId])).rows[0];
  if (!quote) return false;
  if (["internal_approved", "issued", "accepted"].includes(quote.status)) return true;
  const requirement = await qsRequirement(db, workspaceId, caseId, quoteId);
  return !requirement.required && QS_SKIPPED.has(requirement.reason.code);
}

/** The three checks of a bespoke job, or null when the job isn't bespoke. */
export async function bespokeGates(db: Db, workspaceId: string, project: { id: string; caseId: string; quoteId: string }): Promise<BespokeGates | null> {
  if (!(await bespokeOrder(db, workspaceId, project.id))) return null;
  return {
    technicalHandoverAccepted: await technicalHandoverAccepted(db, workspaceId, project.id),
    factoryRequirementsConfirmed: await factoryRequirementsConfirmed(db, workspaceId, project.id),
    qsApproved: await qsApproved(db, workspaceId, project.caseId, project.quoteId),
  };
}

/** One line's requirements are settled: its recipe verified or its factory record confirmed (a line not made needs none). */
export async function lineRequirementsSettled(db: Db, workspaceId: string, projectId: string, lineId: string) {
  const row = (await readLineRequirements(db, workspaceId, projectId, lineId))[0];
  return { settled: !row || ["verified", "confirmed", "not_needed"].includes(row.state), state: row?.state ?? "not_needed" };
}
