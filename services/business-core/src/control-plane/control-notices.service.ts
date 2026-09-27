import { Injectable, Logger } from "@nestjs/common";
import type { PoolClient } from "pg";
import { platformOperatorCan, isPlatformOperatorRole, type PlatformOperatorPermission } from "../auth/platform-operator-policy";
import { DatabaseService } from "../database/database.service";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { BASE_DOMAIN } from "../workspaces/domain-policy";
import {
  NOTICE_AUDIENCES,
  noticeDeliveryState,
  type ControlNoticeEvent,
} from "./control-plane.domain";

type SourceType = "lifecycle_version" | "domain" | "billing_document";
type Db = Pick<PoolClient, "query">;

/** Owner templates (seeded per workspace in 0078; tenants edit their copies). */
const OWNER_TEMPLATE: Record<ControlNoticeEvent, string> = {
  "lifecycle.trial_started": "account.trial_started",
  "lifecycle.activated": "account.activated",
  "lifecycle.grace_started": "account.grace_started",
  "lifecycle.suspended": "account.suspended",
  "lifecycle.reactivated": "account.reactivated",
  "lifecycle.archived": "account.archived",
  "billing.past_due": "account.payment_past_due",
  "domain.ownership_lost": "account.domain_ownership_lost",
  "domain.live": "account.domain_live",
};

/** Which operators hear about an event: the ones who can act on it. */
const OPERATOR_PERMISSION: Record<ControlNoticeEvent, PlatformOperatorPermission> = {
  "lifecycle.trial_started": "lifecycle.manage",
  "lifecycle.activated": "lifecycle.manage",
  "lifecycle.grace_started": "billing.manage",
  "lifecycle.suspended": "lifecycle.manage",
  "lifecycle.reactivated": "lifecycle.manage",
  "lifecycle.archived": "lifecycle.manage",
  "billing.past_due": "billing.manage",
  "domain.ownership_lost": "domains.manage",
  "domain.live": "domains.manage",
};

type Variables = { organization: string; date: string; domain: string; address: string };

function operatorMessage(event: ControlNoticeEvent, v: Variables) {
  switch (event) {
    case "lifecycle.grace_started":
      return { subject: `${v.organization} is in grace until ${v.date}`, body: `Payment is past due. ${v.organization} keeps full access until ${v.date}, then it is suspended.` };
    case "lifecycle.suspended":
      return { subject: `${v.organization} is suspended`, body: `Changes are blocked. Reads and exports still work.` };
    case "lifecycle.reactivated":
      return { subject: `${v.organization} is active again`, body: `Full access is restored.` };
    case "lifecycle.archived":
      return { subject: `${v.organization} is archived`, body: `The organization no longer signs in.` };
    case "billing.past_due":
      return { subject: `${v.organization}: payment past due`, body: `An invoice is past due. Grace starts automatically.` };
    case "domain.ownership_lost":
      return { subject: `${v.domain} lost its DNS record`, body: `${v.organization} signs in at ${v.address} until the record is restored.` };
    case "domain.live":
      return { subject: `${v.domain} is live`, body: `${v.organization} signs in at ${v.domain}.` };
    case "lifecycle.trial_started":
      return { subject: `${v.organization} trial started`, body: `The trial runs until ${v.date}.` };
    case "lifecycle.activated":
      return { subject: `${v.organization} is active`, body: `The organization is active.` };
  }
}

const render = (template: string, variables: Record<string, string>) =>
  template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_all, key: string) => variables[key] ?? "");

export type ControlNotice = {
  id: string; eventType: ControlNoticeEvent; sourceType: SourceType; sourceId: string;
  audience: "tenant_owner" | "operator"; channel: "in_app" | "email"; recipient: string;
  subject: string; status: "pending" | "sent" | "failed" | "not_configured" | "skipped";
  attempts: number; lastAttemptedAt: Date | null; createdAt: Date;
};

/**
 * The control plane's notices (§6.1, §6.24): each lifecycle, billing or domain event tells the tenant's
 * owners (in-app and email, from the workspace's own templates in its brand) and the operators who can act
 * (email, Wodana brand). Every notice is a row with its own delivery state; "sent" means a provider receipt.
 */
@Injectable()
export class ControlNoticesService {
  private readonly logger = new Logger(ControlNoticesService.name);

  constructor(private readonly database: DatabaseService, private readonly email: TransactionalEmailService) {}

  /**
   * Queues every notice for one event inside the caller's tenant transaction. Returns the notices that are
   * sent directly once the transaction commits (operator email, and owner email when no owner has joined).
   */
  async queue(client: Db, input: {
    workspaceId: string; event: ControlNoticeEvent; sourceType: SourceType; sourceId: string;
    actorUserId: string | null; date?: Date | null; domain?: string | null;
  }): Promise<string[]> {
    const workspace = await client.query<{ name: string; slug: string; locale: string; timezone: string; accountId: string | null }>(
      `SELECT workspace.name, workspace.slug, workspace.default_locale AS locale, workspace.default_timezone AS timezone,
              linked.account_id AS "accountId"
         FROM workspaces workspace
         LEFT JOIN customer_account_organizations linked ON linked.workspace_id = workspace.id
        WHERE workspace.id = $1`, [input.workspaceId],
    );
    if (!workspace.rowCount) return [];
    const org = workspace.rows[0];
    const variables: Variables = {
      organization: org.name,
      date: input.date ? this.formatDate(input.date, org.locale, org.timezone) : "",
      domain: input.domain ?? "",
      address: `${org.slug}.${BASE_DOMAIN}`,
    };
    const base = `control:${input.event}:${input.sourceId}`;
    const direct: string[] = [];
    const audiences = NOTICE_AUDIENCES[input.event];

    if (audiences.includes("tenant_owner")) {
      const code = OWNER_TEMPLATE[input.event];
      const owners = await client.query<{ userId: string; email: string }>(
        `SELECT DISTINCT membership.user_id AS "userId", app_user.primary_email AS email
           FROM workspace_memberships membership
           JOIN users app_user ON app_user.id = membership.user_id
           JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
           JOIN roles role ON role.id = assigned.role_id AND role.code = 'owner'
          WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [input.workspaceId],
      );
      const templates = await this.templates(client, input.workspaceId, code, variables);
      for (const owner of owners.rows) {
        const key = `${base}:${owner.userId}`;
        if (templates.in_app) {
          const result = await notifyUserInApp(client, { workspaceId: input.workspaceId, recipientUserId: owner.userId,
            code, eventType: code, variables, deepLink: "/workspace", idempotencyKey: key });
          await this.record(client, { ...input, audience: "tenant_owner", channel: "in_app", userId: owner.userId,
            email: owner.email, key, subject: templates.in_app.subject, body: templates.in_app.body,
            notificationKey: result.queued ? key : null,
            status: result.queued ? "sent" : result.reason === "already_sent" ? null : "skipped",
            skipReason: result.queued ? null : result.reason });
        }
        if (templates.email) {
          const emailKey = `${key}:email`;
          const result = await queueUserEmail(client, { workspaceId: input.workspaceId, recipientUserId: owner.userId,
            code, eventType: code, variables, deepLink: "/workspace", idempotencyKey: emailKey });
          await this.record(client, { ...input, audience: "tenant_owner", channel: "email", userId: owner.userId,
            email: owner.email, key: emailKey, subject: templates.email.subject, body: templates.email.body,
            notificationKey: result.queued ? emailKey : null,
            status: result.queued ? "pending" : result.reason === "already_sent" ? null : "skipped",
            skipReason: result.queued ? null : result.reason });
        }
      }
      if (!owners.rowCount && templates.email) {
        // Nobody has joined yet: the invited owner (or the contract contact) hears by email directly.
        const fallback = await client.query<{ email: string }>(
          `SELECT email::text FROM (
             SELECT invitation.email::text AS email, 0 AS rank, invitation.created_at
               FROM workspace_invitations invitation WHERE invitation.workspace_id = $1 AND invitation.status = 'pending'
             UNION ALL
             SELECT account.contract_contact_email::text, 1, account.created_at
               FROM customer_account_organizations linked JOIN customer_accounts account ON account.id = linked.account_id
              WHERE linked.workspace_id = $1 AND account.contract_contact_email IS NOT NULL
           ) candidate ORDER BY rank, created_at LIMIT 1`, [input.workspaceId],
        );
        if (fallback.rowCount) {
          const id = await this.record(client, { ...input, audience: "tenant_owner", channel: "email", userId: null,
            email: fallback.rows[0].email, key: `${base}:contact:email`, subject: templates.email.subject,
            body: templates.email.body, notificationKey: null, status: "pending", skipReason: null });
          if (id) direct.push(id);
        }
      }
    }

    if (audiences.includes("operator")) {
      const message = operatorMessage(input.event, variables);
      const operators = await client.query<{ userId: string; email: string; role: string }>(
        `SELECT operator.user_id AS "userId", app_user.primary_email AS email, operator.role
           FROM platform_administrators operator
           JOIN users app_user ON app_user.id = operator.user_id AND app_user.status = 'active'
          WHERE operator.status = 'active'`,
      );
      for (const operator of operators.rows) {
        if (operator.userId === input.actorUserId) continue;
        if (!isPlatformOperatorRole(operator.role) || !platformOperatorCan(operator.role, OPERATOR_PERMISSION[input.event])) continue;
        const id = await this.record(client, { ...input, audience: "operator", channel: "email", userId: operator.userId,
          email: operator.email, key: `${base}:operator:${operator.userId}`, subject: message.subject, body: message.body,
          notificationKey: null, status: "pending", skipReason: null });
        if (id) direct.push(id);
      }
    }
    return direct;
  }

  /** Sends the direct notices after the command committed, and records each provider receipt. */
  async deliver(workspaceId: string, noticeIds: readonly string[], actorUserId: string | null) {
    if (!noticeIds.length) return;
    const actor = actorUserId ?? SERVICE_ACTOR_ID;
    const notices = await this.database.tenantTransaction(workspaceId, actor, (client) => client.query<{
      id: string; audience: string; email: string; subject: string; body: string; accountId: string | null;
    }>(
      `SELECT notice.id, notice.audience, notice.recipient_email::text AS email, notice.subject, notice.body,
              linked.account_id AS "accountId"
         FROM tenant_control_notices notice
         LEFT JOIN customer_account_organizations linked ON linked.workspace_id = notice.workspace_id
        WHERE notice.workspace_id = $1 AND notice.id = ANY($2::uuid[]) AND notice.status = 'pending'
          AND notice.notification_id IS NULL`, [workspaceId, noticeIds],
    ));
    for (const notice of notices.rows) {
      const result = await (notice.audience === "operator"
        ? this.email.sendOperatorNotice({ to: notice.email, subject: notice.subject, body: notice.body,
          consolePath: notice.accountId ? `/internal/accounts/${notice.accountId}?org=${workspaceId}` : "/internal" })
        : this.email.sendStaffNotice({ workspaceId, to: notice.email, subject: notice.subject, body: notice.body,
          deepLink: "/login", actionLabel: "Sign in" })
      ).catch((error: unknown) => {
        this.logger.error(`Control notice ${notice.id} failed: ${(error as Error).message}`);
        return { status: "failed" as const, provider: null, messageId: null };
      });
      await this.database.tenantTransaction(workspaceId, actor, (client) => client.query(
        `UPDATE tenant_control_notices SET status = $3, provider = $4, provider_message_id = $5,
           attempts = attempts + 1, last_attempted_at = now(), version = version + 1, updated_at = now()
         WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, notice.id, result.status, result.provider, result.messageId],
      ));
    }
  }

  /** Notices for an organization, newest first, each with the delivery state its channel reports. */
  async list(client: Db, workspaceId: string, sourceIds?: readonly string[]): Promise<ControlNotice[]> {
    const rows = await client.query<ControlNotice>(
      `SELECT notice.id, notice.event_type AS "eventType", notice.source_type AS "sourceType",
              notice.source_id AS "sourceId", notice.audience, notice.channel,
              COALESCE(notice.recipient_email::text, '') AS recipient, notice.subject,
              CASE
                WHEN notification.id IS NULL THEN notice.status
                WHEN notification.status = 'delivered' THEN 'sent'
                WHEN notification.status IN ('pending', 'scheduled', 'processing') THEN 'pending'
                WHEN notification.status = 'suppressed' AND notification.suppressed_reason = 'email_not_configured' THEN 'not_configured'
                WHEN notification.status = 'suppressed' THEN 'skipped'
                ELSE 'failed' END AS status,
              notice.attempts, COALESCE(notification.delivered_at, notice.last_attempted_at) AS "lastAttemptedAt",
              notice.created_at AS "createdAt"
         FROM tenant_control_notices notice
         LEFT JOIN notifications notification ON notification.id = notice.notification_id
        WHERE notice.workspace_id = $1 AND ($2::uuid[] IS NULL OR notice.source_id = ANY($2::uuid[]))
        ORDER BY notice.created_at DESC, notice.id LIMIT 200`, [workspaceId, sourceIds ?? null],
    );
    return rows.rows;
  }

  /** One delivery state per source (a lifecycle change, a domain event). */
  async deliveryStates(client: Db, workspaceId: string, sourceIds: readonly string[]) {
    const notices = await this.list(client, workspaceId, sourceIds);
    return new Map(sourceIds.map((id) => [id, noticeDeliveryState(notices.filter((notice) => notice.sourceId === id)
      .map((notice) => notice.status))]));
  }

  private async templates(client: Db, workspaceId: string, code: string, variables: Variables) {
    const found = await client.query<{ channel: "in_app" | "email"; subject: string | null; body: string }>(
      `SELECT DISTINCT ON (channel) channel, subject_template AS subject, body_template AS body
         FROM notification_templates
        WHERE workspace_id = $1 AND code = $2 AND channel IN ('in_app', 'email') AND status = 'approved' AND locale = 'en'
        ORDER BY channel, version_number DESC`, [workspaceId, code],
    );
    const values = variables as unknown as Record<string, string>;
    const result: Partial<Record<"in_app" | "email", { subject: string; body: string }>> = {};
    for (const row of found.rows) {
      result[row.channel] = { subject: render(row.subject ?? code, values).slice(0, 200), body: render(row.body, values) };
    }
    return result;
  }

  private async record(client: Db, input: {
    workspaceId: string; event: ControlNoticeEvent; sourceType: SourceType; sourceId: string; actorUserId: string | null;
    audience: "tenant_owner" | "operator"; channel: "in_app" | "email"; userId: string | null; email: string | null;
    key: string; subject: string; body: string; notificationKey: string | null;
    status: "pending" | "sent" | "skipped" | null; skipReason: string | null;
  }): Promise<string | null> {
    // A replayed event ("already sent") keeps the notice it created the first time.
    if (input.status === null) return null;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO tenant_control_notices
         (workspace_id, event_type, source_type, source_id, audience, channel, recipient_user_id, recipient_email,
          notification_id, subject, body, status, skip_reason, idempotency_key, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
          (SELECT id FROM notifications WHERE workspace_id = $1 AND idempotency_key = $9), $10, $11, $12, $13, $14, $15)
       ON CONFLICT (workspace_id, idempotency_key) DO NOTHING RETURNING id`,
      [input.workspaceId, input.event, input.sourceType, input.sourceId, input.audience, input.channel, input.userId,
        input.email, input.notificationKey, input.subject, input.body, input.status, input.skipReason, input.key,
        input.actorUserId],
    );
    return inserted.rows[0]?.id ?? null;
  }

  private formatDate(value: Date, locale: string, timeZone: string) {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(value);
    } catch {
      return value.toISOString().slice(0, 10);
    }
  }
}

export const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
