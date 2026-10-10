/**
 * What an approval request is called while it waits. The request stores the title it was raised with (the
 * notification sent then keeps it), but Home › Approvals and a request's status name the record as it is now: a
 * client, opportunity or case renamed after the request was raised never shows its old title. One SQL expression
 * per subject kind, over the engine's `request` row; a kind without one, or whose record is gone, falls back to the
 * stored title. The modules that raise these requests compose their titles from the same words below.
 */

/** A proposal round's name on an opportunity value request (PLM-101). */
export const PROPOSAL_KIND_TITLE = { design: "Proposal 1 · Design", main: "Proposal 2 · Main" } as const;
/** The first words of a case's "changes after sign-off" request (E5-1). */
export const LEDGER_CHANGE_TITLE = "Material changes after sign-off";
/** A finance request's kind, as its approval names it. */
export const FINANCE_REQUEST_KIND_NAME = { invoice: "Invoice", refund: "Refund", payable: "Payable" } as const;
/** A finance request's reference: FR- and its number on four digits (finance-requests.requestReference). */
export const FINANCE_REQUEST_REFERENCE = { prefix: "FR-", digits: 4 } as const;

/** A developer-written constant as a SQL string literal (never user input). */
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

const financeRequest = `SELECT ${literal(FINANCE_REQUEST_REFERENCE.prefix)} || lpad(finance.number::text, ${FINANCE_REQUEST_REFERENCE.digits}, '0') || ' · '
            || CASE finance.kind WHEN 'invoice' THEN ${literal(FINANCE_REQUEST_KIND_NAME.invoice)}
              WHEN 'refund' THEN ${literal(FINANCE_REQUEST_KIND_NAME.refund)} ELSE ${literal(FINANCE_REQUEST_KIND_NAME.payable)} END
            || ' · ' || coalesce(CASE WHEN finance.kind = 'payable' THEN vendor.display_name ELSE party.display_name END, '')
       FROM finance_requests finance
       LEFT JOIN crm_parties party ON party.workspace_id = finance.workspace_id AND party.id = finance.party_id
       LEFT JOIN workspace_vendors vendor ON vendor.workspace_id = finance.workspace_id AND vendor.id = finance.vendor_id
      WHERE finance.workspace_id = request.workspace_id AND finance.id = request.subject_id`;

/** The current title of each kind's record, by subject kind; a kind not listed keeps the title it was raised with. */
export const LIVE_TITLE_BY_KIND: Readonly<Record<string, string>> = {
  // "{reference} · {client, else the opportunity's title} · {round}", as opportunity-proposals.service composes it.
  opportunity_value: `SELECT opportunity.reference || ' · ' || coalesce(party.display_name, opportunity.title) || ' · '
            || CASE proposal.kind WHEN 'design' THEN ${literal(PROPOSAL_KIND_TITLE.design)} ELSE ${literal(PROPOSAL_KIND_TITLE.main)} END
       FROM crm_opportunity_proposals proposal
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = proposal.workspace_id AND opportunity.id = proposal.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
      WHERE proposal.workspace_id = request.workspace_id AND proposal.id = request.subject_id`,
  // "{case title} · Q-{number}" for the Deal File's review (commercial.service), read through commercial_cases_view.
  deal_file: `SELECT opportunity.title || coalesce(' · Q-' || quote.number::text, '')
       FROM commercial_cases_view commercial
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = commercial.workspace_id AND pre_case.id = commercial.case_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN commercial_quotes quote ON quote.workspace_id = commercial.workspace_id AND quote.case_id = commercial.case_id
            AND quote.id::text = commercial.content->'ownerReview'->>'quoteId'
      WHERE commercial.workspace_id = request.workspace_id AND commercial.content->'ownerReview'->>'id' = request.subject_id::text
      LIMIT 1`,
  // "Material changes after sign-off · {case title}", the case's title as portal-notices.caseTitle reads it.
  ledger_change: `SELECT ${literal(LEDGER_CHANGE_TITLE)} || ' · '
            || coalesce(nullif(coalesce(project.reference || ' · ' || project.name, opportunity.title), ''), party.display_name, opportunity.title)
       FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN delivery_projects project ON project.workspace_id = pre_case.workspace_id AND project.case_id = pre_case.id AND project.started_at IS NOT NULL
      WHERE pre_case.workspace_id = request.workspace_id AND pre_case.id = request.subject_id
      ORDER BY project.started_at LIMIT 1`,
  // "{reference} · {kind} · {client or supplier}" (finance-request-commands.askApproval).
  refund: financeRequest,
  payable_request: financeRequest,
};

/** The request's current title: a SQL expression over the engine's `request` row, within the stored title's length. */
export const LIVE_TITLE_SQL = `left(coalesce(CASE request.subject_kind ${Object.entries(LIVE_TITLE_BY_KIND).map(([kind, sql]) => `WHEN ${literal(kind)} THEN (${sql})`).join(" ")} END, request.title), 300)`;
