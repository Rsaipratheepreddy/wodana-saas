import type { PoolClient } from "pg";
import { syncProposalsFromQuotes } from "../crm/opportunities/opportunity-proposals";
import { commercialRepository } from "./commercial-repository";
import type { CommercialData, Quote } from "./commercial.types";
import { dealAmount } from "./deal-file-approval";

type Db = Pick<PoolClient, "query">;

/**
 * Guide J: each proposal's value is its round's sent quotation (the accepted one once accepted), linked, never typed.
 * One place for it, run wherever a case's quotations change (the commercial commands, the quotation builder, the client
 * portal) and when an opportunity's proposals are read, so a job whose quotations went out another way is linked too.
 */
export async function syncCaseProposals(db: Db, workspaceId: string, caseId: string, actorUserId: string | null, quotes?: Quote[]) {
  const opportunityId = (await db.query<{ id: string | null }>(`SELECT opportunity_id::text AS id FROM pre_project_cases WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, caseId])).rows[0]?.id;
  if (!opportunityId) return false;
  const list = quotes ?? ((await commercialRepository.load(db as PoolClient, workspaceId, caseId))?.content as CommercialData | undefined)?.quotes ?? [];
  const sent = list.filter((quote) => quote.kind === "quotation" && !quote.changeRequestId && ["issued", "accepted", "changes_requested"].includes(quote.status) && quote.currency);
  const byRound = new Map<"design" | "main", Quote>();
  for (const quote of sent) {
    const round = quote.round === "design" ? "design" : "main";
    const held = byRound.get(round);
    if (!held || (quote.status === "accepted" && held.status !== "accepted") || (held.status !== "accepted" && quote.number > held.number)) byRound.set(round, quote);
  }
  if (!byRound.size) return false;
  return syncProposalsFromQuotes(db, { workspaceId, opportunityId, actorUserId, quotes: [...byRound].map(([round, quote]) => ({
    id: quote.id, number: quote.number, round, amount: quote.status === "accepted" ? dealAmount(quote) : quote.total, currencyCode: quote.currency })) });
}

/** The same for every case of an opportunity (its proposals card reads them linked). */
export async function syncOpportunityProposals(db: Db, workspaceId: string, opportunityId: string, actorUserId: string | null) {
  const cases = (await db.query<{ id: string }>(`SELECT id::text FROM pre_project_cases WHERE workspace_id = $1 AND opportunity_id = $2`, [workspaceId, opportunityId])).rows;
  let changed = false;
  for (const row of cases) changed = (await syncCaseProposals(db, workspaceId, row.id, actorUserId)) || changed;
  return changed;
}
