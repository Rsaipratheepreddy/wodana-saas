import type { PoolClient } from "pg";
import type { CommercialData } from "./commercial.types";

type Db = Pick<PoolClient, "query">;

/**
 * The only way to read or write a commercial case.
 *
 * Quotes and their lines live in commercial_quotes / commercial_quote_lines; the rest of the case
 * is still the commercial_cases document until it moves to its own tables. commercial_case_save()
 * (migration 0004) is the only write path and commercial_quote_json() (migration 0003) the only read shape.
 */
export const commercialRepository = {
  async load(db: Db, workspaceId: string, caseId: string, options: { forUpdate?: boolean } = {}) {
    if (options.forUpdate) {
      await db.query("SELECT 1 FROM commercial_cases WHERE workspace_id=$1 AND case_id=$2 FOR UPDATE", [workspaceId, caseId]);
    }
    const result = await db.query<{ content: Partial<CommercialData>; revision: number }>(
      "SELECT content, revision FROM commercial_cases_view WHERE workspace_id=$1 AND case_id=$2",
      [workspaceId, caseId],
    );
    return result.rows[0];
  },

  /** Writes the case and synchronises quote rows in the caller's transaction (see commercial_case_save). */
  async save(db: Db, workspaceId: string, caseId: string, data: CommercialData) {
    await db.query("SELECT commercial_case_save($1,$2,$3,$4::jsonb)", [workspaceId, caseId, data.revision, JSON.stringify(data)]);
  },
};
