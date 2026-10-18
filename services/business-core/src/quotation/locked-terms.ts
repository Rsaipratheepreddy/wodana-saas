import { BadRequestException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { readProposalKit } from "./proposal-kit";

type Db = Pick<PoolClient, "query">;

/**
 * Guide M: an estimate proposal's terms and conditions are the firm's own and locked; adding clauses after them is the
 * only edit. Applies to main quotations (not the design-fee proposal or a variation) once the firm has written its terms.
 * Returns the clauses added after the firm's terms, or null when nothing changed or nothing is locked.
 */
export function addedClauses(firmTerms: string, previous: string, next: string): string | null {
  const base = firmTerms.replace(/\r\n/g, "\n").trim();
  const after = next.replace(/\r\n/g, "\n").trim();
  if (!base || after === previous.replace(/\r\n/g, "\n").trim()) return null;
  if (!after.startsWith(base)) throw new BadRequestException("The terms and conditions are locked. Add a clause after them.");
  return after.slice(base.length).trim();
}

/** Checks a change of a quote's terms against the firm's locked terms and logs the clauses added. */
export async function guardQuoteTerms(db: Db, input: { workspaceId: string; caseId: string; userId: string; quote: { id: string; kind: string; round?: string | null }; previous: string; next: string }) {
  if (input.quote.kind !== "quotation" || input.quote.round === "design") return;
  const kit = await readProposalKit(db, input.workspaceId);
  const clauses = addedClauses(kit.defaultTerms, input.previous, input.next);
  // Taking up the firm's terms as they are is no addition; anything after them is logged.
  if (!clauses) return;
  await recordAudit(db, { workspaceId: input.workspaceId, actorUserId: input.userId, action: "quotation.terms_clause_added.v1", entityType: "commercial_case", entityId: input.caseId,
    after: { quoteId: input.quote.id, clauses: clauses.slice(0, 4000) } });
}
