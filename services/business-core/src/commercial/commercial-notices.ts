import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { tellClients } from "../client-portal/portal-notices";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { currencyDecimals } from "../common/currency";
import type { Payment } from "./commercial.types";

type Db = Pick<PoolClient, "query">;

/** Active people who hold a permission (by permission, never by role name). */
export async function permissionHolders(db: Db, workspaceId: string, permission: string, limit = 50): Promise<string[]> {
  return (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId"
       FROM workspace_memberships membership
       JOIN users account ON account.id = membership.user_id AND account.status = 'active'
       JOIN effective_member_roles assigned ON assigned.membership_id = membership.id AND assigned.workspace_id = membership.workspace_id
       JOIN role_permissions granted ON granted.role_id = assigned.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = $2
      WHERE membership.workspace_id = $1 AND membership.status = 'active'
      LIMIT $3`, [workspaceId, permission, limit])).rows.map((row) => row.userId);
}

/**
 * The names of a few people who hold a permission, owners and administrators last (the team member who
 * does this every day is the one to ask), so a screen can say who holds a step.
 */
export async function permissionHolderNames(db: Db, workspaceId: string, permission: string, limit = 3): Promise<string[]> {
  return (await db.query<{ name: string }>(
    `SELECT holder.name FROM (
       SELECT DISTINCT ON (membership.id) coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS name,
              bool_or(role.code IN ('owner', 'administrator')) OVER (PARTITION BY membership.id) AS admin
         FROM workspace_memberships membership
         JOIN users account ON account.id = membership.user_id AND account.status = 'active'
         JOIN effective_member_roles assigned ON assigned.membership_id = membership.id AND assigned.workspace_id = membership.workspace_id
         JOIN roles role ON role.id = assigned.role_id
         JOIN role_permissions granted ON granted.role_id = assigned.role_id
         JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = $2
        WHERE membership.workspace_id = $1 AND membership.status = 'active'
     ) holder ORDER BY holder.admin, lower(holder.name) LIMIT $3`, [workspaceId, permission, limit])).rows.map((row) => row.name);
}

/** "AED 12,500.00" style: the currency code and the exact amount in its minor units. */
export function amountText(amount: number | string, currency: string | undefined) {
  const code = currency?.trim() || "";
  const text = Dec.of(amount).toFixed(code ? currencyDecimals(code) : 2);
  return code ? `${code} ${text}` : text;
}

/**
 * The client-payment hand-offs on a planning case:
 *   reported  → everyone who verifies receipts (commercial.finance.verify), in the app and by email;
 *   verified  → the person who reported it, the case's Account Manager, whoever approves a deal that is
 *               waiting on this money, and the client ("Payment received", branded).
 * The person who acted is never told about their own step. Idempotent per payment and case revision.
 */
export async function noticeReceiptStep(db: Db, input: {
  workspaceId: string; caseId: string; payment: Pick<Payment, "id" | "title" | "amount" | "currency">; step: "reported" | "verified";
  actorUserId: string; revision: number; reporterUserId: string | null; dealWaiting: boolean; demo?: boolean;
}) {
  const facts = (await db.query<{ clientName: string; ownerUserId: string | null }>(
    `SELECT coalesce(party.display_name, opportunity.title) AS "clientName", owner.user_id AS "ownerUserId"
       FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN workspace_memberships owner ON owner.workspace_id = opportunity.workspace_id AND owner.id = opportunity.owner_membership_id AND owner.status = 'active'
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [input.workspaceId, input.caseId])).rows[0];
  if (!facts) return { told: 0 };
  const actor = (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [input.actorUserId])).rows[0]?.name ?? "Someone";
  const amount = amountText(input.payment.amount, input.payment.currency);
  const variables = { title: input.payment.title, clientName: facts.clientName, actor, amount, note: "" };
  const deepLink = `/workspace/pre-projects/cases/${input.caseId}/payment-plan`;
  const code = input.step === "reported" ? "commercial.receipt_reported" : "commercial.receipt_verified";
  const recipients = input.step === "reported"
    ? await permissionHolders(db, input.workspaceId, "commercial.finance.verify")
    : [input.reporterUserId, facts.ownerUserId, ...(input.dealWaiting ? await permissionHolders(db, input.workspaceId, "commercial.deal.approve") : [])];
  let told = 0;
  for (const userId of [...new Set(recipients.filter((id): id is string => Boolean(id) && id !== input.actorUserId))]) {
    const message = { workspaceId: input.workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink };
    const key = `${code}:${input.payment.id}:${input.revision}:${userId}`;
    const result = await notifyUserInApp(db, { ...message, idempotencyKey: key });
    if (result.queued) told += 1;
    if (input.step === "reported") await queueUserEmail(db, { ...message, idempotencyKey: `${key}:email` });
  }
  if (input.step === "verified")
    await tellClients(db, { workspaceId: input.workspaceId, caseId: input.caseId, event: "payment_received", recordId: `${input.payment.id}:${input.revision}`,
      title: `${input.payment.title} · ${amount}`, demo: input.demo });
  return { told };
}
