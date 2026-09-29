import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

export type PreflightCheck = { key: "https" | "number" | "templates" | "code_template" | "webhook"; ok: boolean; detail: string | null };

/**
 * Before the firm relies on WhatsApp (SP-7): the portal is served over HTTPS (Meta's signup and webhooks need it),
 * a number is connected and healthy, templates are approved (with the authentication one the portal's sign-in
 * code needs), and the webhook has delivered a client's message. Read from what the workspace already has.
 */
export async function whatsappPreflight(db: Db, workspaceId: string, webOrigin: string): Promise<PreflightCheck[]> {
  const number = (await db.query<{ status: string; number: string | null; health: string | null }>(
    `SELECT status, configuration->>'displayPhoneNumber' AS number, configuration->'health'->>'state' AS health
       FROM integration_connections WHERE workspace_id = $1 AND provider = 'whatsapp'
      ORDER BY (status = 'connected') DESC, COALESCE((configuration->>'isDefault')::boolean, false) DESC, updated_at DESC LIMIT 1`, [workspaceId])).rows[0];
  const templates = (await db.query<{ approved: number; pending: number; rejected: number; codes: number }>(
    `SELECT count(*) FILTER (WHERE provider_status = 'approved')::int AS approved, count(*) FILTER (WHERE provider_status IN ('pending', 'submitting'))::int AS pending,
            count(*) FILTER (WHERE provider_status = 'rejected')::int AS rejected,
            count(*) FILTER (WHERE provider_status = 'approved' AND provider_category = 'authentication')::int AS codes
       FROM notification_templates WHERE workspace_id = $1 AND channel = 'whatsapp' AND status = 'approved'`, [workspaceId])).rows[0] ?? { approved: 0, pending: 0, rejected: 0, codes: 0 };
  const inbound = (await db.query<{ at: Date | null }>(
    `SELECT max(message.created_at) AS at FROM crm_messages message JOIN crm_conversations conversation ON conversation.workspace_id = message.workspace_id AND conversation.id = message.conversation_id
      WHERE message.workspace_id = $1 AND message.direction = 'inbound' AND conversation.channel = 'whatsapp'`, [workspaceId])).rows[0]?.at ?? null;
  const connected = number?.status === "connected";
  return [
    { key: "https", ok: /^https:\/\//i.test(webOrigin), detail: null },
    { key: "number", ok: connected && number?.health !== "blocked", detail: number?.number ?? null },
    { key: "templates", ok: templates.approved > 0, detail: `${templates.approved}/${templates.pending}/${templates.rejected}` },
    { key: "code_template", ok: templates.codes > 0, detail: null },
    { key: "webhook", ok: Boolean(inbound), detail: inbound ? new Date(inbound).toISOString() : null },
  ];
}

/** An international mobile number: "+" then 8 to 15 digits. */
export const E164 = /^\+[1-9]\d{7,14}$/;
