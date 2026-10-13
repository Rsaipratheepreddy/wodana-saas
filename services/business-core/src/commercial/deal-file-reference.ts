import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/**
 * QA-003 (plan §4.4): a Deal File's reference is the next number of its company's Deal File numbering (Settings ›
 * Numbering; created the first time as CODE-DEAL-{YYYY}-00001, gap-free like every document number). Allocated inside
 * the approval's transaction, so a refused approval leaves no gap. Without a company the case names it, as before.
 */
export async function dealFileReference(db: Db, workspaceId: string, legalEntityId: string | null, caseId: string, year: string) {
  if (!legalEntityId) return `DF-${year}-${caseId.slice(0, 8).toUpperCase()}`;
  await db.query(
    `INSERT INTO document_sequences (workspace_id, legal_entity_id, document_type, prefix, padding, reset_policy, next_number)
     SELECT $1, entity.id, 'DEAL_FILE', entity.code || '-DEAL-{YYYY}-', 5, 'annual', 1 FROM legal_entities entity
      WHERE entity.workspace_id = $1 AND entity.id = $2
     ON CONFLICT (legal_entity_id, document_type) DO NOTHING`, [workspaceId, legalEntityId]);
  return (await db.query<{ number: string }>(`SELECT allocate_document_number($1, $2, 'DEAL_FILE') AS number`, [workspaceId, legalEntityId])).rows[0].number;
}
