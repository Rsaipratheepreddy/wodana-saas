/**
 * The second pass's scenario queries (factory, logistics, site, finance requests, petty cash, payments, the design fee,
 * planning, the inbox, stock and the portal), in the same shape as scenario-probes.ts: $1 = workspace id, $2 = country
 * code; a short reference of a record in that state, or nothing. Approvals and My day are read through the app's own
 * services instead (scenario-run.ts), as each person sees them.
 */

const TODAY = `(SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date FROM workspaces WHERE id = $1)`;
const REGIONAL = (party: string) => `EXISTS (SELECT 1 FROM crm_contact_points phone WHERE phone.workspace_id = $1 AND phone.party_id = ${party}
  AND phone.type = 'phone' AND phone.status = 'active' AND phone.country_code = $2)`;
const CASE_PARTY = (caseId: string) => `(SELECT opportunity.party_id FROM pre_project_cases pre_case JOIN crm_opportunities opportunity
  ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id WHERE pre_case.workspace_id = $1 AND pre_case.id = ${caseId})`;
const PROJECT_PARTY = (projectId: string) => CASE_PARTY(`(SELECT case_id FROM delivery_projects WHERE workspace_id = $1 AND id = ${projectId})`);
const project = (where: string) => `SELECT project.reference || ' · ' || project.name AS ref FROM delivery_projects project
  WHERE project.workspace_id = $1 AND ${where} AND ${REGIONAL(PROJECT_PARTY("project.id"))} LIMIT 1`;
const workOrder = (where: string) => `SELECT work_order.number || ' · ' || work_order.title AS ref FROM work_orders work_order
  WHERE work_order.workspace_id = $1 AND ${where} AND ${REGIONAL(PROJECT_PARTY("work_order.project_id"))} LIMIT 1`;
const snag = (where: string) => `SELECT '#' || item.number || ' ' || item.title AS ref FROM work_items item
  WHERE item.workspace_id = $1 AND item.type = 'snag' AND ${where} AND ${REGIONAL(PROJECT_PARTY("item.project_id"))} LIMIT 1`;
const designQuote = (where: string) => `SELECT coalesce(nullif(quote.title, ''), 'Design fee') || ' v' || quote.number AS ref FROM commercial_quotes quote
  WHERE quote.workspace_id = $1 AND quote.round = 'design' AND ${where} AND ${REGIONAL(CASE_PARTY("quote.case_id"))} LIMIT 1`;
const planning = (phase: string) => `SELECT party.display_name || ' · ' || pre_case.phase AS ref FROM pre_project_cases pre_case
  JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
  JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
  WHERE pre_case.workspace_id = $1 AND pre_case.status = 'active' AND pre_case.phase = '${phase}' AND ${REGIONAL("opportunity.party_id")} LIMIT 1`;
const financeRequest = (where: string) => `SELECT 'FR-' || request.number || ' · ' || request.kind AS ref FROM finance_requests request WHERE request.workspace_id = $1 AND ${where} LIMIT 1`;

export const PASS_TWO_PROBES: Record<string, string> = {
  "sales.message.unanswered": `SELECT party.display_name || ' · ' || conversation.channel AS ref FROM crm_conversations conversation
    JOIN crm_parties party ON party.workspace_id = conversation.workspace_id AND party.id = conversation.party_id
    WHERE conversation.workspace_id = $1 AND conversation.status = 'open' AND conversation.waiting_since IS NOT NULL AND ${REGIONAL("conversation.party_id")} LIMIT 1`,
  "sales.enquiry.converted": `SELECT party.display_name || ' · planning' AS ref FROM crm_leads lead JOIN crm_parties party ON party.workspace_id = lead.workspace_id AND party.id = lead.party_id
    WHERE lead.workspace_id = $1 AND lead.status = 'qualified' AND EXISTS (SELECT 1 FROM crm_opportunities opportunity JOIN pre_project_cases pre_case
      ON pre_case.workspace_id = opportunity.workspace_id AND pre_case.opportunity_id = opportunity.id WHERE opportunity.workspace_id = lead.workspace_id AND opportunity.lead_id = lead.id)
      AND ${REGIONAL("lead.party_id")} LIMIT 1`,
  "design.fee.sent": designQuote(`quote.status = 'issued'`),
  "design.fee.accepted": designQuote(`quote.status = 'accepted'`),
  "design.fee.paid": designQuote(`EXISTS (SELECT 1 FROM commercial_payments payment WHERE payment.workspace_id = quote.workspace_id AND payment.case_id = quote.case_id
    AND payment.source_quote_id = quote.id AND payment.status = 'verified')`),
  "design.moodboard": `SELECT 'Moodboard · ' || count(*) || ' ideas shared' AS ref FROM pre_project_moodboard_shares share WHERE share.workspace_id = $1
    AND ${REGIONAL(CASE_PARTY("share.case_id"))} GROUP BY share.case_id LIMIT 1`,
  "design.site_visit": `SELECT record.title AS ref FROM pre_project_site_records record WHERE record.workspace_id = $1 AND record.kind = 'visit' AND record.status = 'completed'
    AND ${REGIONAL(CASE_PARTY("record.case_id"))} LIMIT 1`,
  "planning.requirements": planning("discover"),
  "planning.scope": planning("define"),
  "planning.ready": planning("price"),
  "stock.low": `SELECT item.name || ' (reorder at ' || point.reorder_at || ')' AS ref FROM stock_reorder_points point JOIN stock_items item ON item.workspace_id = point.workspace_id AND item.id = point.item_id
    WHERE point.workspace_id = $1 AND coalesce((SELECT sum(balance.on_hand) FROM stock_balances balance WHERE balance.workspace_id = point.workspace_id AND balance.item_id = point.item_id
      AND balance.project_id IS NULL AND (point.location_id IS NULL OR balance.location_id = point.location_id)), 0) <= point.reorder_at LIMIT 1`,
  "factory.planned": workOrder(`work_order.status = 'planned'`),
  "factory.in_production": workOrder(`work_order.status = 'in_production'`),
  "factory.done": workOrder(`work_order.status = 'ready'`),
  "factory.shortage": workOrder(`work_order.status = 'planned' AND EXISTS (SELECT 1 FROM work_order_materials material WHERE material.workspace_id = work_order.workspace_id
    AND material.work_order_id = work_order.id AND material.status = 'active'
    AND material.quantity > coalesce((SELECT sum(balance.on_hand) FROM stock_balances balance WHERE balance.workspace_id = material.workspace_id AND balance.item_id = material.item_id
      AND balance.project_id = work_order.project_id), 0))`),
  "logistics.delivery_booked": project(`project.status = 'active' AND project.delivery_on IS NOT NULL`),
  "logistics.installation_scheduled": project(`project.status = 'active' AND project.installation_on IS NOT NULL`),
  "logistics.permit_expiring": `SELECT permit.permit_number || ' until ' || permit.valid_to AS ref FROM building_permits permit WHERE permit.workspace_id = $1 AND permit.status = 'collected'
    AND permit.valid_to BETWEEN ${TODAY} AND ${TODAY} + 30 AND permit.project_id IS NOT NULL AND ${REGIONAL(PROJECT_PARTY("permit.project_id"))} LIMIT 1`,
  "site.report.approved": `SELECT 'Site report ' || report.report_date AS ref FROM site_reports report WHERE report.workspace_id = $1 AND report.status = 'approved'
    AND ${REGIONAL(PROJECT_PARTY("report.project_id"))} LIMIT 1`,
  "site.report.missing": project(`project.status = 'active' AND project.site_started_on IS NOT NULL AND project.site_finished_on IS NULL
    AND EXISTS (SELECT 1 FROM generate_series(greatest(project.site_started_on, ${TODAY} - 7), ${TODAY} - 1, interval '1 day') day
      WHERE extract(isodow FROM day) < 6 AND NOT EXISTS (SELECT 1 FROM site_reports report WHERE report.workspace_id = project.workspace_id AND report.project_id = project.id
        AND report.report_date = day::date AND report.status IN ('submitted', 'approved')))`),
  "site.snag.open": snag(`item.status NOT IN ('done', 'cancelled')`),
  "site.snag.critical": snag(`item.status NOT IN ('done', 'cancelled') AND item.severity = 'critical'`),
  "site.snag.closed": snag(`item.status = 'done'`),
  "site.progress_photos": `SELECT 'Daily progress ' || report.report_date || ' (' || count(photo.id) || ' photos)' AS ref FROM site_reports report
    JOIN site_report_photos photo ON photo.workspace_id = report.workspace_id AND photo.report_id = report.id
    WHERE report.workspace_id = $1 AND report.status = 'approved' AND ${REGIONAL(PROJECT_PARTY("report.project_id"))} GROUP BY report.id, report.report_date LIMIT 1`,
  "refund.requested": financeRequest(`request.kind = 'refund' AND request.status IN ('new', 'in_progress', 'needs_info')`),
  "finance_request.waiting": financeRequest(`request.status = 'new'`),
  "petty_cash.claim": `SELECT claim.number || ' · ' || claim.description AS ref FROM petty_cash_claims claim WHERE claim.workspace_id = $1 AND claim.status <> 'draft'
    AND ${REGIONAL(PROJECT_PARTY("claim.project_id"))} LIMIT 1`,
  "supplier.payment": `SELECT coalesce(nullif(payment.reference, ''), 'Payment') || ' · ' || payment.amount AS ref FROM supplier_payments payment JOIN workspaces workspace ON workspace.id = payment.workspace_id
    WHERE payment.workspace_id = $1 AND payment.status = 'recorded' AND payment.currency = workspace.default_currency LIMIT 1`,
  "portal.access": `SELECT grant_row.name || ' · portal' AS ref FROM client_portal_grants grant_row WHERE grant_row.workspace_id = $1 AND grant_row.active AND grant_row.role = 'approver'
    AND EXISTS (SELECT 1 FROM delivery_projects project WHERE project.workspace_id = grant_row.workspace_id AND project.case_id = grant_row.case_id AND project.status = 'active')
    AND ${REGIONAL(CASE_PARTY("grant_row.case_id"))} LIMIT 1`,
  "portal.decision.quote": `SELECT coalesce(nullif(quote.title, ''), 'Quotation') || ' v' || quote.number AS ref FROM commercial_quotes quote WHERE quote.workspace_id = $1
    AND quote.status = 'issued' AND (quote.valid_until IS NULL OR quote.valid_until >= ${TODAY}) AND quote.detail->>'approverId' IS NOT NULL
    AND ${REGIONAL(CASE_PARTY("quote.case_id"))} LIMIT 1`,
  "portal.decision.design": `SELECT design.title AS ref FROM pre_project_designs design JOIN pre_project_cases pre_case ON pre_case.workspace_id = design.workspace_id AND pre_case.id = design.case_id
    JOIN LATERAL (SELECT status, client_review_expires_at FROM pre_project_design_versions version WHERE version.workspace_id = design.workspace_id AND version.design_id = design.id
      ORDER BY number DESC LIMIT 1) version ON true
    WHERE design.workspace_id = $1 AND pre_case.status = 'active' AND version.status = 'client_review' AND (version.client_review_expires_at IS NULL OR version.client_review_expires_at > now())
      AND ${REGIONAL(CASE_PARTY("design.case_id"))} LIMIT 1`,
  "portal.decision.change": `SELECT 'CR-' || lpad(change.number::text, 3, '0') || ' · ' || change.title AS ref FROM change_requests change WHERE change.workspace_id = $1
    AND change.status = 'with_client' AND ${REGIONAL(CASE_PARTY("change.case_id"))} LIMIT 1`,
};
