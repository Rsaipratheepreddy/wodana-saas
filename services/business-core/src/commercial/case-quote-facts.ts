import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/**
 * The quotation number each quote was issued under, by quote id: a family keeps the reference it got when it was first
 * sent (quotation_references), so its revisions read the same number. A quote whose family was never sent has none.
 */
export async function quoteReferences(db: Db, workspaceId: string, caseIds: string[]): Promise<Map<string, Record<string, string>>> {
  const byCase = new Map<string, Record<string, string>>();
  if (!caseIds.length) return byCase;
  const rows = (await db.query<{ caseId: string; quoteId: string; reference: string }>(
    `SELECT quote.case_id AS "caseId", quote.id AS "quoteId", reference.reference
       FROM commercial_quotes quote
       JOIN quotation_references reference ON reference.workspace_id = quote.workspace_id AND reference.case_id = quote.case_id
        AND reference.family_id = coalesce(quote.family_id, quote.id)
      WHERE quote.workspace_id = $1 AND quote.case_id = ANY($2::uuid[])`, [workspaceId, caseIds])).rows;
  for (const row of rows) byCase.set(row.caseId, { ...byCase.get(row.caseId), [row.quoteId]: row.reference });
  return byCase;
}

/** Guide M: an estimate proposal's reference, from its quotation's number (QUO becomes EST); each revision adds "rev n". */
export function estimateReference(quotationReference: string, revision: number) {
  const base = quotationReference.includes("QUO") ? quotationReference.replace("QUO", "EST") : `EST-${quotationReference}`;
  return revision > 0 ? `${base} rev ${revision}` : base;
}

/** The estimate proposal reference of each main quotation with a quotation number, by quote id: its place in its family is its revision. */
export function estimateReferences(quotes: Array<{ id: string; number: number; kind: string; round?: string | null; familyId?: string | null }>, references: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const quote of quotes) {
    const reference = references[quote.id];
    if (!reference || quote.kind !== "quotation" || quote.round === "design") continue;
    const family = quote.familyId ?? quote.id;
    const revision = quotes.filter((other) => (other.familyId ?? other.id) === family && other.number < quote.number).length;
    out[quote.id] = estimateReference(reference, revision);
  }
  return out;
}

/** What a case's stage and next step are read from, for a list of cases: its quotations, its agreement and the references. */
export type CaseQuoteFacts = {
  data: {
    quotes: Array<{ id: string; number: number; kind: string; round: string | null; status: string }>;
    agreement: { quoteId: string; status: string } | null;
  };
  quoteReferences: Record<string, string>;
};

/**
 * The Planning list's summary of each case's commercial record (the case page reads the whole record): enough to
 * name the case's real stage and its next step the same way the case's overview does.
 */
export async function caseQuoteFacts(db: Db, workspaceId: string, caseIds: string[]): Promise<Map<string, CaseQuoteFacts>> {
  const facts = new Map<string, CaseQuoteFacts>();
  if (!caseIds.length) return facts;
  const references = await quoteReferences(db, workspaceId, caseIds);
  const agreements = (await db.query<{ caseId: string; quoteId: string | null; status: string | null }>(
    `SELECT case_id AS "caseId", content->'agreement'->>'quoteId' AS "quoteId", content->'agreement'->>'status' AS status
       FROM commercial_cases WHERE workspace_id = $1 AND case_id = ANY($2::uuid[])`, [workspaceId, caseIds])).rows;
  const quotes = (await db.query<{ caseId: string; id: string; number: number; kind: string; round: string | null; status: string }>(
    `SELECT case_id AS "caseId", id, number, kind, round, status FROM commercial_quotes
      WHERE workspace_id = $1 AND case_id = ANY($2::uuid[]) ORDER BY case_id, sort_order, number`, [workspaceId, caseIds])).rows;
  for (const row of agreements)
    facts.set(row.caseId, { data: { quotes: [], agreement: row.quoteId && row.status ? { quoteId: row.quoteId, status: row.status } : null }, quoteReferences: references.get(row.caseId) ?? {} });
  for (const { caseId, ...quote } of quotes) facts.get(caseId)?.data.quotes.push(quote);
  return facts;
}
