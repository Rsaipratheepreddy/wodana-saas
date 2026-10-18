import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { postJobEvent } from "../jobs/job-thread";

type Db = Pick<PoolClient, "query">;

/** The documents a firm sends a client, as the job's documents list names them. */
export type DocumentKind = "quotation" | "invoice" | "signature_request" | "change_request" | "design_completed";
export type SendState = "failed" | "sent" | "delivered" | "opened" | "signed";

/**
 * §0.3 P4: records one send of a document on one channel. A send that couldn't leave is recorded too (with why), so
 * the team sees it on the job instead of in a log. The message or notification it created gives its later states.
 */
export async function recordSend(db: Db, input: {
  workspaceId: string; caseId: string; kind: DocumentKind; ref: string; title: string; channel: "whatsapp" | "email"; recipient?: string | null;
  status: "sent" | "failed"; reason?: string | null; messageId?: string | null; notificationId?: string | null; esignRequestId?: string | null; sentBy?: string | null;
}) {
  await db.query(
    `INSERT INTO document_sends (workspace_id, id, case_id, document_kind, document_ref, title, channel, recipient, status, reason, message_id, notification_id, esign_request_id, sent_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [input.workspaceId, randomUUID(), input.caseId, input.kind, input.ref.slice(0, 120), input.title.slice(0, 300), input.channel, (input.recipient ?? "").slice(0, 200), input.status,
      (input.reason ?? "").slice(0, 300), input.messageId ?? null, input.notificationId ?? null, input.esignRequestId ?? null, input.sentBy ?? null]);
  // The job's team sees it in the thread, once per document and channel.
  const what = SEND_WORDS[input.kind];
  const channel = input.channel === "whatsapp" ? "WhatsApp" : "email";
  await postJobEvent(db, input.workspaceId, { record: { type: "case", id: input.caseId }, code: input.status === "sent" ? "document_sent" : "document_failed",
    ref: `${input.kind}:${input.ref}:${input.channel}:${input.status}`,
    body: input.status === "sent" ? `${what} sent by ${channel}${input.recipient ? ` to ${input.recipient}` : ""}: ${input.title}`
      : `${what} couldn't be sent by ${channel}: ${input.reason ?? ""}`.trim() });
}

/** How the thread names each document. */
const SEND_WORDS: Record<DocumentKind, string> = { quotation: "Quotation", invoice: "Invoice", signature_request: "Signing link", change_request: "Change request",
  design_completed: "Design completion notice" };

/** A send's state now: signed beats opened beats delivered beats sent; a failure on its channel says failed. */
export function sendState(row: { status: string; messageStatus: string | null; notificationStatus: string | null; openedAt: string | null; signedAt: string | null }): SendState {
  if (row.signedAt) return "signed";
  if (row.status === "failed" || row.messageStatus === "failed" || row.notificationStatus === "failed") return "failed";
  if (row.openedAt || row.messageStatus === "read") return "opened";
  if (row.messageStatus === "delivered" || row.notificationStatus === "delivered") return "delivered";
  return "sent";
}

/** The device a signer used, in a few words ("Chrome on iPhone"), read from the browser's own description. */
export function deviceLabel(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const os = /iPhone/.test(userAgent) ? "iPhone" : /iPad/.test(userAgent) ? "iPad" : /Android/.test(userAgent) ? "Android" : /Mac OS X|Macintosh/.test(userAgent) ? "macOS"
    : /Windows/.test(userAgent) ? "Windows" : /Linux/.test(userAgent) ? "Linux" : null;
  const browser = /Edg\//.test(userAgent) ? "Edge" : /OPR\//.test(userAgent) ? "Opera" : /Firefox\//.test(userAgent) ? "Firefox" : /CriOS|Chrome\//.test(userAgent) ? "Chrome"
    : /Safari\//.test(userAgent) ? "Safari" : null;
  return [browser, os].filter(Boolean).join(" on ") || null;
}

export type CaseDocuments = {
  sends: Array<{ id: string; kind: string; title: string; channel: "whatsapp" | "email"; recipient: string; state: SendState; reason: string; sentAt: string; sentBy: string | null;
    openedAt: string | null; signedAt: string | null }>;
  signatures: Array<{ id: string; title: string; signer: string; signedAt: string; method: "esign" | "portal_code"; verifiedBy: string | null; device: string | null;
    fingerprint: string | null; decision: string | null }>;
};

/** Code-confirmed client decisions in the portal (each one is a signature by code). */
const CODE_DECISIONS: Record<string, string> = {
  "client_portal.quote_decision": "Quotation", "client_portal.materials_decision": "Material list", "client_portal.drawings_decision": "Drawings",
  "client_portal.handover_decision": "Handover",
};

/** §0.3 P4: a job's documents: every send with its state now, and every signature (e-signature or portal code). */
export async function readCaseDocuments(db: Db, workspaceId: string, caseId: string): Promise<CaseDocuments> {
  const sends = (await db.query<{ id: string; kind: string; title: string; channel: "whatsapp" | "email"; recipient: string; status: string; reason: string; sentAt: Date; sentBy: string | null;
    messageStatus: string | null; notificationStatus: string | null; openedAt: Date | null; signedAt: Date | null }>(
    `SELECT send.id, send.document_kind AS kind, send.title, send.channel, send.recipient, send.status, send.reason, send.sent_at AS "sentAt", person.display_name AS "sentBy",
            message.status::text AS "messageStatus", notice.status::text AS "notificationStatus", request.opened_at AS "openedAt", request.signed_at AS "signedAt"
       FROM document_sends send
       LEFT JOIN users person ON person.id = send.sent_by
       LEFT JOIN crm_messages message ON message.workspace_id = send.workspace_id AND message.id = send.message_id
       LEFT JOIN notifications notice ON notice.workspace_id = send.workspace_id AND notice.id = send.notification_id
       LEFT JOIN esign_requests request ON request.workspace_id = send.workspace_id AND request.id = send.esign_request_id
      WHERE send.workspace_id = $1 AND send.case_id = $2 ORDER BY send.sent_at DESC LIMIT 200`, [workspaceId, caseId])).rows;
  const signed = (await db.query<{ id: string; title: string | null; signer: string; signedAt: Date; codeChannel: string | null; device: string | null; fingerprint: string | null }>(
    `SELECT request.id, document.title, request.signed_name AS signer, request.signed_at AS "signedAt", request.code_channel AS "codeChannel",
            coalesce(request.signer_device, request.signer_user_agent) AS device, request.signed_sha256 AS fingerprint
       FROM esign_requests request LEFT JOIN quote_documents document ON document.workspace_id = request.workspace_id AND document.id = request.document_id
      WHERE request.workspace_id = $1 AND request.case_id = $2 AND request.status = 'signed' ORDER BY request.signed_at DESC`, [workspaceId, caseId])).rows;
  const decided = (await db.query<{ id: string; action: string; at: Date; signer: string | null; decision: string | null }>(
    `SELECT audit.id::text, audit.action, audit.occurred_at AS at, coalesce(grant_row.confirmed_name, grant_row.name) AS signer, audit.after->>'decision' AS decision
       FROM audit_events audit
       JOIN client_portal_grants grant_row ON grant_row.workspace_id = audit.workspace_id AND grant_row.id::text = audit.after->>'grantId'
      WHERE audit.workspace_id = $1 AND grant_row.case_id = $2 AND audit.action = ANY($3::text[]) ORDER BY audit.occurred_at DESC LIMIT 100`,
    [workspaceId, caseId, Object.keys(CODE_DECISIONS)])).rows;
  // Shop drawings per item, signed in the portal with a code: who, when, the device and the signed file's fingerprint.
  const items = (await db.query<{ id: string; title: string; number: number; signer: string; at: Date; device: string | null; fingerprint: string }>(
    `SELECT signature.id, line.title, version.number, signature.signer_name AS signer, signature.signed_at AS at, coalesce(signature.signer_device, signature.signer_user_agent) AS device,
            signature.file_sha256 AS fingerprint
       FROM project_item_drawing_signatures signature
       JOIN project_item_drawing_versions version ON version.workspace_id = signature.workspace_id AND version.id = signature.version_id
       JOIN project_boq_lines line ON line.workspace_id = signature.workspace_id AND line.id = signature.line_id
      WHERE signature.workspace_id = $1 AND signature.case_id = $2 ORDER BY signature.signed_at DESC LIMIT 200`, [workspaceId, caseId])).rows;
  return {
    sends: sends.map((row) => ({ id: row.id, kind: row.kind, title: row.title, channel: row.channel, recipient: row.recipient, reason: row.reason, sentBy: row.sentBy,
      sentAt: new Date(row.sentAt).toISOString(), openedAt: row.openedAt ? new Date(row.openedAt).toISOString() : null, signedAt: row.signedAt ? new Date(row.signedAt).toISOString() : null,
      state: sendState({ ...row, openedAt: row.openedAt ? String(row.openedAt) : null, signedAt: row.signedAt ? String(row.signedAt) : null }) })),
    signatures: [
      ...signed.map((row) => ({ id: row.id, title: row.title ?? "", signer: row.signer, signedAt: new Date(row.signedAt).toISOString(), method: "esign" as const,
        verifiedBy: row.codeChannel, device: row.device, fingerprint: row.fingerprint, decision: null })),
      ...decided.map((row) => ({ id: row.id, title: CODE_DECISIONS[row.action], signer: row.signer ?? "", signedAt: new Date(row.at).toISOString(), method: "portal_code" as const,
        verifiedBy: "code", device: null, fingerprint: null, decision: row.decision })),
      ...items.map((row) => ({ id: row.id, title: `Shop drawing · ${row.title} · V${row.number}`, signer: row.signer, signedAt: new Date(row.at).toISOString(), method: "portal_code" as const,
        verifiedBy: "code", device: row.device, fingerprint: row.fingerprint, decision: "sign" })),
    ].sort((a, b) => b.signedAt.localeCompare(a.signedAt)),
  };
}
