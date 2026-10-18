import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { notifyUserInApp, queueUserEmail, renderNoticeText, wakeDelivery } from "../notifications/default-templates";
import { holders, KIND_NAME, moneyText, projectPeople, readRequests, readSettings, type RequestRow } from "./finance-requests.store";
import type { RequestKind } from "./finance-requests";

type Db = Pick<PoolClient, "query">;

export type RequestNotice = "submitted" | "answered" | "needs_info" | "approved" | "done" | "rejected";

/** Who else hears a request is done, by its kind: the project roles that act on it (generic role keys, never a firm's names). */
const DONE_ROLES: Record<RequestKind, readonly string[]> = {
  invoice: ["account_manager", "quantity_surveyor"],
  refund: ["account_manager"],
  payable: ["procurement"],
};

export const requestLink = (requestId: string) => `/workspace/finance/requests?request=${requestId}`;

/**
 * The module's notices (plan rule 9), each once per transition (`eventKey`) and person, never to who acted:
 * - submitted / answered: Finance in the app, and the workspace's finance inbox by email when one is set;
 * - needs_info, rejected: the requester, in the app and by email;
 * - approved: whoever handles it in Finance (else everyone who works the board);
 * - done: the requester (app and email), and in the app the salesperson and the project's people for the kind.
 */
export async function tellRequest(db: Db, workspaceId: string, requestId: string, notice: RequestNotice, actorUserId: string | null, note: string, eventKey: string) {
  const request = (await readRequests(db, workspaceId, { id: requestId }))[0];
  if (!request) return;
  const actor = actorUserId ? (await db.query<{ name: string }>(`SELECT coalesce(nullif(btrim(display_name), ''), primary_email) AS name FROM users WHERE id = $1`, [actorUserId])).rows[0]?.name ?? "" : "";
  const variables = noticeVariables(request, actor || "Wodana", note);
  const code = `finance_request.${notice}`;
  const inApp = new Set<string>();
  const email = new Set<string>();
  const finance = async () => (request.handledBy ? [request.handledBy] : await holders(db, workspaceId, "finance_requests.manage"));
  if (notice === "submitted" || notice === "answered") (await holders(db, workspaceId, "finance_requests.manage")).forEach((person) => inApp.add(person));
  if (notice === "answered" && request.handledBy) { inApp.clear(); inApp.add(request.handledBy); }
  if (notice === "approved") (await finance()).forEach((person) => inApp.add(person));
  if (notice === "needs_info" || notice === "rejected" || notice === "done") { inApp.add(request.requestedBy); email.add(request.requestedBy); }
  if (notice === "done") {
    if (request.salespersonId) inApp.add(request.salespersonId);
    if (request.projectId) (await projectPeople(db, workspaceId, request.projectId, DONE_ROLES[request.kind])).forEach((person) => inApp.add(person));
  }
  const link = requestLink(requestId);
  for (const userId of inApp) {
    if (userId === actorUserId) continue;
    await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink: link, idempotencyKey: `${code}:${eventKey}:${userId}` });
  }
  for (const userId of email) {
    if (userId === actorUserId) continue;
    await queueUserEmail(db, { workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink: link, idempotencyKey: `${code}:${eventKey}:${userId}:email` });
  }
  if (notice === "submitted" || notice === "answered") await emailFinanceInbox(db, workspaceId, request, variables, eventKey);
}

export function noticeVariables(request: RequestRow, actor: string, note: string) {
  const project = request.projectReference || request.projectName ? [request.projectReference, request.projectName].filter(Boolean).join(" · ") : "";
  return {
    reference: request.reference, kind: KIND_NAME[request.kind], client: (request.kind === "payable" ? request.supplierName : request.clientName) ?? "",
    amount: moneyText(request.kind === "payable" && request.payNow ? request.payNow : request.total, request.currency), project, actor, note: note.slice(0, 480),
  };
}

/**
 * Every submission to the workspace's finance inbox (an address, not a person), when the firm set one. It is
 * queued like any staff email (recipient `finance_inbox`); the mailer renders it with the tenant's brand.
 * Bank details are never part of it.
 */
async function emailFinanceInbox(db: Db, workspaceId: string, request: RequestRow, variables: Record<string, string>, eventKey: string) {
  const settings = await readSettings(db, workspaceId);
  if (!settings.financeInbox) return;
  const template = (await db.query<{ id: string; subject: string | null; body: string }>(
    `SELECT id, subject_template AS subject, body_template AS body FROM notification_templates
      WHERE workspace_id = $1 AND code = 'finance_request.submitted' AND channel = 'email' AND status = 'approved' AND locale = 'en'
      ORDER BY version_number DESC LIMIT 1`, [workspaceId])).rows[0];
  if (!template) return;
  const inserted = (await db.query<{ id: string; correlationId: string }>(
    `INSERT INTO notifications (workspace_id, template_id, recipient_type, recipient_id, channel, event_type, status, scheduled_for, subject, body, deep_link,
       idempotency_key, correlation_id)
     VALUES ($1, $2, 'finance_inbox', $1, 'email', 'finance_request.submitted', 'pending', now(), $3, $4, $5, $6, gen_random_uuid())
     ON CONFLICT (workspace_id, idempotency_key) DO NOTHING RETURNING id, correlation_id AS "correlationId"`,
    [workspaceId, template.id, template.subject ? renderNoticeText(template.subject, variables) : null, renderNoticeText(template.body, variables).replace(/\n{3,}/g, "\n\n"),
      requestLink(request.id), `finance_request.inbox:${eventKey}`])).rows[0];
  if (inserted) await wakeDelivery(db, workspaceId, inserted.id, inserted.correlationId, "email");
}

/** One line of history on the request. */
export async function addEvent(db: Db, workspaceId: string, requestId: string, event: { kind: string; from?: string | null; to?: string | null; note?: string; actorId: string | null }) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO finance_request_events (id, workspace_id, request_id, kind, from_status, to_status, note, actor_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, workspaceId, requestId, event.kind, event.from ?? null, event.to ?? null, (event.note ?? "").slice(0, 2000), event.actorId]);
  return id;
}

/**
 * The request in its client's, deal's and project's history (PLM-094 and the job timeline read audit events by
 * the record's id): raised, done or rejected, with its reference.
 */
export async function recordOnLinkedRecords(db: Db, workspaceId: string, request: Pick<RequestRow, "id" | "reference" | "kind" | "partyId" | "opportunityId" | "projectId" | "total" | "currency">,
  action: "finance_request_raised" | "finance_request_done" | "finance_request_rejected", actorUserId: string | null) {
  const summary = `${request.reference} · ${KIND_NAME[request.kind]} · ${moneyText(request.total, request.currency)}`;
  const links: Array<[string, string | null]> = [["crm_party", request.partyId], ["crm_opportunity", request.opportunityId], ["delivery_project", request.projectId]];
  for (const [entityType, entityId] of links) {
    if (!entityId) continue;
    await recordAudit(db, { workspaceId, actorUserId, source: actorUserId ? "user" : "internal", action, entityType, entityId,
      after: { financeRequest: `${summary} · ${action.replace("finance_request_", "")}` } });
  }
}
