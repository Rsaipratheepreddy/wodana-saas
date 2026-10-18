import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/** Copies the builder's own rows (each line's build-up and the quote's discounts) into a new revision. Lines keep their ids. */
export async function copyBuilderData(db: Db, workspaceId: string, caseId: string, fromQuoteId: string, toQuoteId: string) {
  await db.query(
    `INSERT INTO commercial_quote_line_components (workspace_id, case_id, quote_id, line_id, position, kind, catalog_item_id, name, quantity_formula, quantity, unit, unit_cost, rate, waste_percent, supplied_by_client)
     SELECT component.workspace_id, component.case_id, $4, component.line_id, component.position, component.kind, component.catalog_item_id, component.name, component.quantity_formula,
            component.quantity, component.unit, component.unit_cost, component.rate, component.waste_percent, component.supplied_by_client
       FROM commercial_quote_line_components component
       JOIN commercial_quote_lines line ON line.workspace_id = component.workspace_id AND line.case_id = component.case_id AND line.quote_id = $4 AND line.id = component.line_id
      WHERE component.workspace_id = $1 AND component.case_id = $2 AND component.quote_id = $3`, [workspaceId, caseId, fromQuoteId, toQuoteId]);
  await db.query(
    `INSERT INTO commercial_quote_discounts (workspace_id, case_id, quote_id, scope, target_key, kind, value, reason, created_by)
     SELECT workspace_id, case_id, $4, scope, target_key, kind, value, reason, created_by FROM commercial_quote_discounts
      WHERE workspace_id = $1 AND case_id = $2 AND quote_id = $3
     ON CONFLICT (workspace_id, case_id, quote_id, scope, target_key) DO NOTHING`, [workspaceId, caseId, fromQuoteId, toQuoteId]);
  await db.query(
    `UPDATE commercial_quotes target SET total = source.total, discount = source.discount,
            detail = target.detail || jsonb_strip_nulls(jsonb_build_object('pricing', source.detail->'pricing'))
       FROM commercial_quotes source
      WHERE target.workspace_id = $1 AND target.case_id = $2 AND target.id = $4 AND source.workspace_id = $1 AND source.case_id = $2 AND source.id = $3`,
    [workspaceId, caseId, fromQuoteId, toQuoteId]);
}
