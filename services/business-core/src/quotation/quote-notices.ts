import type { PoolClient } from "pg";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";

type Db = Pick<PoolClient, "query">;

/**
 * Who hears about a quote: reviewers when it's sent for review, the person who submitted it when it
 * comes back, and the Account Manager (and whoever built it) when the client decides. The person
 * who acted is never told about their own step.
 */
export async function noticeQuoteStep(db: Db, input: {
  workspaceId: string; caseId: string; quoteId: string; number: number; title: string; action: string; actorUserId: string; revision: number; note?: string; decision?: string;
}) {
  const facts = (await db.query<{ clientName: string; ownerUserId: string | null }>(
    `SELECT coalesce(party.display_name, opportunity.title) AS "clientName", owner.user_id AS "ownerUserId"
       FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN workspace_memberships owner ON owner.workspace_id = opportunity.workspace_id AND owner.id = opportunity.owner_membership_id AND owner.status = 'active'
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [input.workspaceId, input.caseId])).rows[0];
  if (!facts) return;
  const actor = (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [input.actorUserId])).rows[0]?.name ?? "Someone";
  const deepLink = `/workspace/pre-projects/cases/${input.caseId}/quotations?quote=${encodeURIComponent(input.quoteId)}`;
  const variables = { title: `Q-${input.number} · ${input.title}`, clientName: facts.clientName, actor, note: input.note?.trim() ?? "" };
  const tell = async (recipients: Array<string | null | undefined>, code: string, email = false) => {
    for (const userId of [...new Set(recipients.filter((id): id is string => Boolean(id) && id !== input.actorUserId))]) {
      const message = { workspaceId: input.workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink };
      await notifyUserInApp(db, { ...message, idempotencyKey: `${code}:${input.quoteId}:${input.revision}:${userId}` });
      if (email) await queueUserEmail(db, { ...message, idempotencyKey: `${code}:${input.quoteId}:${input.revision}:${userId}:email` });
    }
  };
  if (input.action === "submit") {
    const reviewers = (await db.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId"
         FROM workspace_memberships membership
         JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = assigned.role_id
         JOIN permissions permission ON permission.id = granted.permission_id
        WHERE membership.workspace_id = $1 AND membership.status = 'active' AND permission.code IN ('commercial.approve', 'commercial.estimate')
        LIMIT 20`, [input.workspaceId])).rows.map((row) => row.userId);
    await tell(reviewers, "quotation.review_requested", true);
  } else if (input.action === "return") {
    await tell([facts.ownerUserId, ...await editors(db, input)], "quotation.returned");
  } else if (input.action === "record_decision") {
    await tell([facts.ownerUserId, ...await editors(db, input)], input.decision === "accept" ? "quotation.client_accepted" : "quotation.client_changes", input.decision === "accept");
  }
}

/** The people who built the quote's lines. */
async function editors(db: Db, input: { workspaceId: string; caseId: string; quoteId: string }) {
  return (await db.query<{ userId: string }>(
    `SELECT DISTINCT updated_by AS "userId" FROM commercial_quote_lines WHERE workspace_id = $1 AND case_id = $2 AND quote_id = $3 AND updated_by IS NOT NULL LIMIT 10`,
    [input.workspaceId, input.caseId, input.quoteId])).rows.map((row) => row.userId);
}
