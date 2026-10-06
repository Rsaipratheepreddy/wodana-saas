import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { budgetTracker, type BudgetSource } from "../change-requests/change-request.domain";
import type { PortalChange } from "./portal-changes";

type Db = Pick<PoolClient, "query">;

/**
 * R1, the client's budget tracker: the agreed value (accepted quotations), plus approved changes (accepted variation
 * quotes and approved change requests, each linked to the decision it came from), plus allowance spend beyond what
 * was included, is the forecast final price. Changes still waiting for the client are shown beside it. Only the
 * client's prices are read (totals, rates of allowance lines): never a cost, a markup or a margin. Nothing when no
 * quotation is accepted yet.
 */
export async function readBudget(db: Db, workspaceId: string, caseId: string, currency: string | null, changes: PortalChange[]) {
  const quotes = (await db.query<{ id: string; number: number; title: string; kind: string; direction: string | null; total: string; accepted: string | null; decidedAt: string | null; currency: string }>(
    `SELECT id, number, title, kind, direction, total::text AS total, detail->'clientDecision'->>'acceptedTotal' AS accepted,
            detail->'clientDecision'->>'decidedAt' AS "decidedAt", currency
       FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND status = 'accepted' ORDER BY number`, [workspaceId, caseId])).rows;
  const contract = quotes.filter((quote) => quote.kind === "quotation" && quote.direction !== "deduction");
  if (!contract.length) return null;
  const amount = (quote: (typeof quotes)[number]) => (quote.accepted && /^-?\d+(\.\d+)?$/.test(quote.accepted) ? quote.accepted : quote.total);
  const allowanceLines = (await db.query<{ lineId: string; title: string; included: string }>(
    `SELECT line.id AS "lineId", line.title, round(line.quantity * line.rate, 2)::text AS included
       FROM commercial_quote_lines line
      WHERE line.workspace_id = $1 AND line.case_id = $2 AND line.quote_id = ANY($3::text[]) AND line.kind = 'allowance' AND line.optional IS NOT TRUE
      ORDER BY line.sort_order`, [workspaceId, caseId, contract.map((quote) => quote.id)])).rows;
  const draws = (await db.query<{ lineId: string; spent: string }>(
    `SELECT line.quote_line_id AS "lineId", sum(line.amount)::text AS spent FROM change_request_lines line
       JOIN change_requests change ON change.workspace_id = line.workspace_id AND change.id = line.change_request_id AND change.status = 'approved'
      WHERE line.workspace_id = $1 AND change.case_id = $2 AND line.source = 'allowance' GROUP BY line.quote_line_id`, [workspaceId, caseId])).rows;
  const approved = changes.filter((change) => change.status === "approved" && change.priceImpact !== null);
  const drawOf = (change: PortalChange) => change.lines.filter((line) => line.action === "draw").reduce((sum, line) => sum.add(line.amount), Dec.ZERO).toFixed(2);
  const source: BudgetSource = {
    currency: currency ?? contract[0].currency,
    agreed: contract.map((quote) => ({ id: quote.id, title: quote.title, amount: amount(quote), decidedAt: quote.decidedAt })),
    variations: quotes.filter((quote) => quote.kind === "variation").map((quote) => ({ id: quote.id, title: quote.title,
      amount: quote.direction === "deduction" ? Dec.of(amount(quote)).abs().neg().toFixed(2) : amount(quote), decidedAt: quote.decidedAt })),
    changes: approved.map((change) => ({ id: change.id, reference: change.reference, title: change.title, amount: change.priceImpact!, draw: drawOf(change),
      decidedAt: change.decidedAt ?? change.createdAt, method: change.method ?? "portal" })),
    pending: changes.filter((change) => change.status === "waiting" && change.priceImpact !== null).map((change) => ({ id: change.id, reference: change.reference, title: change.title,
      amount: change.priceImpact!, status: "with_client" as const })),
    allowances: allowanceLines.map((line) => ({ lineId: line.lineId, title: line.title, included: line.included, spent: draws.find((draw) => draw.lineId === line.lineId)?.spent ?? "0" })),
  };
  return budgetTracker(source);
}
