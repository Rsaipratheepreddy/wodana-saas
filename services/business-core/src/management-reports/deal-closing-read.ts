import type { PoolClient } from "pg";
import { closingEventFor, closingRows, inferClosing, loadClosingRules, TEMPLATE_CLOSING, type ClosingRule } from "../crm/flows/flow-closing";
import { flowVersionById, latestFlowVersion, type ResolvedFlow } from "../crm/flows/flow-store";
import { starterFlow } from "../crm/flows/starter-flows";
import { closingFacts, closingState, type DealClosing } from "../crm/opportunities/deal-closing";
import type { FurniturePath } from "../crm/opportunities/flow-gates";

type Db = Pick<PoolClient, "query">;

/**
 * Deal Closed for a report, read-only (PLM-102): the same rule and records as the deal itself
 * (`loadDealClosing`), without the side effects that view has on first use (it pins the job's flow version and seeds
 * the flow's closing rules). The flow is the job's pinned version when it is still the enquiry type's flow, else the
 * type's latest published flow, else the built-in starter; its closing rules are the firm's recorded ones, else the
 * product default for that flow.
 */
export async function readDealClosing(db: Db, workspaceId: string, opportunity: {
  id: string; flowCode: string | null; flowVersionId: string | null; furniturePath: FurniturePath | null; caseId: string | null;
}): Promise<DealClosing> {
  const code = opportunity.flowCode || "basic";
  const pinned = opportunity.flowVersionId ? await flowVersionById(db, workspaceId, opportunity.flowVersionId) : null;
  const flow: ResolvedFlow | null = pinned && pinned.code === code ? pinned
    : await latestFlowVersion(db, workspaceId, code) ?? (code === "basic" ? null : await latestFlowVersion(db, workspaceId, "basic"));
  let rules: ClosingRule[] = flow?.flowId ? await loadClosingRules(db, workspaceId, flow.flowId) : [];
  if (!rules.length) {
    const starter = flow ? null : starterFlow(code);
    const closing = TEMPLATE_CLOSING[flow?.code ?? starter!.code] ?? inferClosing(flow?.definition ?? starter!.definition);
    rules = closingRows(closing).map((row) => ({ ...row, version: 1 }));
  }
  const event = closingEventFor(rules, opportunity.furniturePath);
  return closingState(event, await closingFacts(db, workspaceId, opportunity.id, opportunity.caseId), opportunity.furniturePath);
}
