import { ConflictException, Injectable, NotFoundException, Optional, UnprocessableEntityException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { DatabaseService } from "../../database/database.service";
import { notifyUserInApp } from "../../notifications/default-templates";
import { webOrigin } from "../../client-portal/portal-site";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { SubmitStarterPackDto, TemplateSubmittedDto, UpdateClientMessageDto, WhatsAppTemplateSyncDto } from "./dto/whatsapp-templates.dto";
import { CLIENT_EVENTS, clientMessageRule, EMAIL_FALLBACK } from "./inbox/client-messages";
import { templatePlaceholders } from "./inbox/inbox-rules";
import { metaBodyProblem, sampleValues, STARTER_LANGUAGES, STARTER_PACK, starterByName, type StarterEvent, type StarterLanguage } from "./inbox/whatsapp-starter-pack";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
type ProviderStatus = "submitting" | "pending" | "approved" | "rejected" | "paused" | "disabled";

/** Meta's template status in our words. */
export function providerStatusOf(status: string): Exclude<ProviderStatus, "submitting"> {
  switch (status.toUpperCase()) {
    case "APPROVED": return "approved";
    case "REJECTED": return "rejected";
    case "PAUSED": return "paused";
    case "DISABLED": case "DELETED": case "ARCHIVED": return "disabled";
    default: return "pending";
  }
}

/**
 * WhatsApp templates as Meta sees them: the starter pack (one template per client event and language, variables
 * pre-mapped) submitted in one confirm, Meta's status kept current by a daily sync and its webhook, and the person
 * who connected WhatsApp told when a template is rejected or paused. Only an approved template can be sent.
 */
@Injectable()
export class CrmWhatsAppTemplatesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /** Each starter template in each language, and whether the workspace already has it (with its status). */
  starterPack(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client) => {
      const existing = await this.existing(client, workspaceId);
      const language = (await this.region(client, workspaceId)).locale.split("-")[0];
      return {
        languages: STARTER_LANGUAGES, defaultLanguages: STARTER_LANGUAGES.includes(language as StarterLanguage) ? [language] : ["en"],
        items: STARTER_PACK.flatMap((template) => STARTER_LANGUAGES.map((locale) => ({
          key: template.key, event: template.event, name: template.name, language: locale, body: template.bodies[locale],
          status: existing.get(`${template.name}:${locale}`) ?? null,
        }))),
      };
    });
  }

  /** Adds the missing starter templates in the chosen languages; the worker submits them to Meta. Safe to repeat. */
  submitStarterPack(actor: RequestActor, workspaceId: string, input: SubmitStarterPackDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const connected = await client.query(`SELECT 1 FROM integration_connections WHERE workspace_id = $1 AND provider = 'whatsapp' AND status = 'connected'`, [workspaceId]);
      if (!connected.rowCount) throw new UnprocessableEntityException("Connect WhatsApp before adding templates");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${workspaceId}:starter-pack`]);
      const existing = await this.existing(client, workspaceId);
      const added: string[] = [];
      for (const template of STARTER_PACK) {
        await this.mapVariables(client, workspaceId, template.name, template.sources, actorUser.userId);
        for (const language of [...new Set(input.languages)] as StarterLanguage[]) {
          if (existing.has(`${template.name}:${language}`)) continue;
          const body = template.bodies[language];
          const problem = metaBodyProblem(body, template.sources.length);
          if (problem) throw new UnprocessableEntityException(`${template.name}: ${problem}`);
          await client.query(
            `INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, body_template, variables,
               provider_status, provider_category, starter_key)
             VALUES ($1, $2::varchar, 'whatsapp', $3::varchar, COALESCE((SELECT max(version_number) FROM notification_templates WHERE workspace_id = $1 AND code = $2::varchar AND channel = 'whatsapp' AND locale = $3::varchar), 0) + 1,
               'draft', $4, $5, 'submitting', 'utility', $6)`,
            [workspaceId, template.name, language, body, JSON.stringify(template.sources.map((_source, index) => String(index + 1))), template.key]);
          added.push(`${template.name}:${language}`);
        }
      }
      if (added.length) await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.whatsapp.starter_pack.submitted.v1", entityType: "integration_connection", entityId: workspaceId, after: { added, languages: input.languages } });
      return { added: added.length, skipped: STARTER_PACK.length * new Set(input.languages).size - added.length };
    });
  }

  /** The worker's work: templates waiting to be submitted (claimed for 10 minutes) and whether a full sync is due. */
  async dueWorkInternal(workspaceId: string) {
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const region = await this.region(client, workspaceId);
      const claimed = await client.query<{ id: string; code: string; locale: string; body: string; category: string | null; starterKey: string | null }>(
        `UPDATE notification_templates SET provider_submitted_at = now()
          WHERE workspace_id = $1 AND channel = 'whatsapp' AND provider_status = 'submitting'
            AND (provider_submitted_at IS NULL OR provider_submitted_at < now() - interval '10 minutes')
          RETURNING id, code, locale, body_template AS body, provider_category AS category, starter_key AS "starterKey"`, [workspaceId]);
      const submissions = claimed.rows.flatMap((row) => {
        const starter = starterByName(row.code);
        if (!starter) return [];
        return [{ id: row.id, name: row.code, language: row.locale, category: (row.category ?? "utility").toUpperCase(), body: row.body, examples: sampleValues(starter, { ...region, webOrigin: webOrigin(this.config ?? { get: () => undefined }) }) }];
      });
      const sync = await client.query(
        `UPDATE integration_connections SET configuration = configuration || jsonb_build_object('templatesSyncAttemptedAt', now())
          WHERE workspace_id = $1 AND provider = 'whatsapp' AND status = 'connected'
            AND COALESCE((configuration->>'templatesSyncedAt')::timestamptz, '-infinity') < now() - interval '1 day'
            AND COALESCE((configuration->>'templatesSyncAttemptedAt')::timestamptz, '-infinity') < now() - interval '1 hour'
          RETURNING id`, [workspaceId]);
      return { submissions, sync: Boolean(sync.rowCount) };
    });
  }

  /** Meta's answer to a submission: its template id and first status, or why it refused. */
  async submittedInternal(workspaceId: string, templateId: string, input: TemplateSubmittedDto) {
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const status = input.error ? "rejected" : providerStatusOf(input.status ?? "PENDING");
      const updated = await client.query<{ code: string; locale: string }>(
        `UPDATE notification_templates SET provider_template_id = COALESCE($3, provider_template_id), provider_status = $4::varchar, provider_reason = $5,
                status = CASE WHEN $4::varchar = 'approved' THEN 'approved' ELSE 'draft' END, approved_at = CASE WHEN $4::varchar = 'approved' THEN now() ELSE approved_at END,
                provider_synced_at = now()
          WHERE workspace_id = $1 AND id = $2 AND channel = 'whatsapp' RETURNING code, locale`,
        [workspaceId, templateId, input.providerTemplateId ?? null, status, input.error?.slice(0, 500) ?? null]);
      if (!updated.rowCount) throw new NotFoundException("Template not found");
      if (status === "rejected") await this.tellConnector(client, workspaceId, updated.rows[0].code, updated.rows[0].locale, "rejected", input.error ?? null);
      await this.events.record(client, { workspaceId, actorUserId: null, source: "integration", action: "crm.whatsapp.template.submitted.v1", entityType: "notification_template", entityId: templateId, after: { status, providerTemplateId: input.providerTemplateId ?? null, error: input.error ?? null } });
      return { templateId, status };
    });
  }

  /**
   * Meta's list (daily, `full`) or one status change (webhook): statuses, reasons, categories and quality are
   * stored; an approved template we don't have yet is added; rejected or paused ones stop sending and are reported.
   */
  async syncInternal(workspaceId: string, input: WhatsAppTemplateSyncDto) {
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      let changed = 0, added = 0;
      for (const template of input.templates) {
        const status = providerStatusOf(template.status);
        const row = (await client.query<{ id: string; providerStatus: string | null; body: string }>(
          `SELECT id, provider_status AS "providerStatus", body_template AS body FROM notification_templates
            WHERE workspace_id = $1 AND channel = 'whatsapp' AND (provider_template_id = $2 OR (code = $3 AND locale = $4))
            ORDER BY (provider_template_id = $2) DESC, version_number DESC LIMIT 1`,
          [workspaceId, template.id, template.name, template.language])).rows[0];
        const category = template.category ? template.category.toLowerCase() : null;
        if (!row) {
          const positions = template.body ? templatePlaceholders(template.body) : [];
          if (status !== "approved" || !template.body || positions.some((position, index) => position !== index + 1)) continue;
          await client.query(
            `INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, body_template, variables, provider_template_id,
               provider_status, provider_category, provider_quality, provider_synced_at, approved_at)
             VALUES ($1, $2, 'whatsapp', $3, 1, 'approved', $4, $5, $6, 'approved', $7, $8, now(), now())
             ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING`,
            [workspaceId, template.name, template.language, template.body, JSON.stringify(positions.map(String)), template.id,
              ["utility", "marketing", "authentication"].includes(category ?? "") ? category : null, template.quality?.toLowerCase().slice(0, 20) ?? null]);
          added += 1;
          continue;
        }
        await client.query(
          `UPDATE notification_templates SET provider_template_id = $3, provider_status = $4::varchar, provider_reason = $5,
                  provider_category = COALESCE($6, provider_category), provider_quality = COALESCE($7, provider_quality), provider_synced_at = now(),
                  status = CASE WHEN $4::varchar = 'approved' THEN 'approved' ELSE 'draft' END,
                  approved_at = CASE WHEN $4::varchar = 'approved' THEN COALESCE(approved_at, now()) ELSE approved_at END
            WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, row.id, template.id, status, status === "rejected" || status === "paused" ? template.reason?.slice(0, 500) ?? null : null,
            ["utility", "marketing", "authentication"].includes(category ?? "") ? category : null, template.quality?.toLowerCase().slice(0, 20) ?? null]);
        if (row.providerStatus !== status) {
          changed += 1;
          if (status === "rejected" || status === "paused" || status === "disabled") await this.tellConnector(client, workspaceId, template.name, template.language, status, template.reason ?? null);
          await this.events.record(client, { workspaceId, actorUserId: null, source: "integration", action: "crm.whatsapp.template.status_changed.v1", entityType: "notification_template", entityId: row.id, before: { status: row.providerStatus }, after: { status, reason: template.reason ?? null } });
        }
      }
      if (input.full) await client.query(`UPDATE integration_connections SET configuration = configuration || jsonb_build_object('templatesSyncedAt', now()) WHERE workspace_id = $1 AND provider = 'whatsapp' AND status = 'connected'`, [workspaceId]);
      return { changed, added };
    });
  }

  /** Settings → Inbox → Client messages: each event, its template and Meta status, how it goes out, on or off. */
  clientMessages(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client) => {
      const connected = Boolean((await client.query(`SELECT 1 FROM integration_connections WHERE workspace_id = $1 AND provider = 'whatsapp' AND status = 'connected' LIMIT 1`, [workspaceId])).rowCount);
      const rows = [];
      for (const event of CLIENT_EVENTS) {
        const rule = await clientMessageRule(client, workspaceId, event);
        const template = rule.templateCode ? (await client.query<{ body: string; providerStatus: string; approved: boolean }>(
          `SELECT body_template AS body, COALESCE(provider_status, CASE WHEN status = 'approved' THEN 'approved' ELSE 'pending' END) AS "providerStatus",
                  status = 'approved' AND COALESCE(provider_status, 'approved') = 'approved' AS approved
             FROM notification_templates WHERE workspace_id = $1 AND channel = 'whatsapp' AND code = $2
            ORDER BY (status = 'approved') DESC, version_number DESC LIMIT 1`, [workspaceId, rule.templateCode])).rows[0] ?? null : null;
        const whatsapp = rule.enabled && connected && Boolean(template?.approved);
        rows.push({ event, enabled: rule.enabled, templateCode: rule.templateCode, version: rule.version, template, emailFallback: EMAIL_FALLBACK.has(event),
          channel: whatsapp ? "whatsapp" : rule.enabled && EMAIL_FALLBACK.has(event) ? "email" : "none" });
      }
      return { connected, events: rows };
    });
  }

  /** Turns an event on or off, or picks its template (version-checked; the first change creates the rule). */
  setClientMessage(actor: RequestActor, workspaceId: string, event: string, input: UpdateClientMessageDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      if (!(CLIENT_EVENTS as string[]).includes(event)) throw new NotFoundException("Unknown client message");
      const current = await clientMessageRule(client, workspaceId, event as StarterEvent);
      const enabled = input.enabled ?? current.enabled;
      const templateCode = input.templateCode === undefined ? current.templateCode : input.templateCode;
      if (enabled === current.enabled && templateCode === current.templateCode) return { event, ...current };
      if (current.version !== input.version) throw new ConflictException("This client message changed; reload and try again");
      if (templateCode) {
        const exists = await client.query(`SELECT 1 FROM notification_templates WHERE workspace_id = $1 AND channel = 'whatsapp' AND code = $2 LIMIT 1`, [workspaceId, templateCode]);
        if (!exists.rowCount) throw new UnprocessableEntityException("Choose one of your WhatsApp templates");
      }
      const saved = await client.query<{ version: number }>(
        `INSERT INTO crm_client_message_rules (workspace_id, event, enabled, template_code, updated_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (workspace_id, event) DO UPDATE SET enabled = EXCLUDED.enabled, template_code = EXCLUDED.template_code, updated_by = EXCLUDED.updated_by,
           updated_at = now(), version = crm_client_message_rules.version + 1
         RETURNING version`, [workspaceId, event, enabled, templateCode, actorUser.userId]);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.client_message.updated.v1", entityType: "crm_client_message_rule", entityId: workspaceId, before: { event, ...current }, after: { event, enabled, templateCode } });
      return { event, enabled, templateCode, version: saved.rows[0].version };
    });
  }

  private async existing(client: Pick<PoolClient, "query">, workspaceId: string) {
    const rows = await client.query<{ code: string; locale: string; status: string | null; local: string }>(
      `SELECT DISTINCT ON (code, locale) code, locale, provider_status AS status, status AS local FROM notification_templates
        WHERE workspace_id = $1 AND channel = 'whatsapp' ORDER BY code, locale, version_number DESC`, [workspaceId]);
    return new Map(rows.rows.map((row) => [`${row.code}:${row.locale}`, row.status ?? (row.local === "approved" ? "approved" : "pending")]));
  }

  /** The starter mapping is written once; a mapping the firm changed later is kept. */
  private async mapVariables(client: Pick<PoolClient, "query">, workspaceId: string, code: string, sources: string[], userId: string) {
    const mapped = await client.query(`SELECT 1 FROM crm_template_variables WHERE workspace_id = $1 AND channel = 'whatsapp' AND template_code = $2 LIMIT 1`, [workspaceId, code]);
    if (mapped.rowCount) return;
    for (const [index, source] of sources.entries()) {
      await client.query(`INSERT INTO crm_template_variables (workspace_id, channel, template_code, position, source, updated_by) VALUES ($1, 'whatsapp', $2, $3, $4, $5)`, [workspaceId, code, index + 1, source, userId]);
    }
  }

  private async region(client: Pick<PoolClient, "query">, workspaceId: string) {
    const row = (await client.query<{ businessName: string; currency: string; locale: string }>(
      `SELECT coalesce(nullif(btrim(branding.display_name), ''), workspace.name) AS "businessName", trim(workspace.default_currency) AS currency, workspace.default_locale AS locale
         FROM workspaces workspace LEFT JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id WHERE workspace.id = $1`, [workspaceId])).rows[0];
    return { businessName: row?.businessName ?? "", currency: row?.currency || "USD", locale: row?.locale || "en" };
  }

  private async tellConnector(client: Pick<PoolClient, "query">, workspaceId: string, name: string, language: string, status: string, reason: string | null) {
    const owner = await client.query<{ userId: string }>(
      `SELECT connected_by AS "userId" FROM integration_connections WHERE workspace_id = $1 AND provider = 'whatsapp' AND status = 'connected' AND connected_by IS NOT NULL ORDER BY updated_at DESC LIMIT 1`, [workspaceId]);
    if (!owner.rows[0]) return;
    await notifyUserInApp(client, {
      workspaceId, recipientUserId: owner.rows[0].userId, code: "crm.template_status", eventType: "crm.whatsapp.template_status",
      variables: { name: `${name} (${language})`, status, reason: reason ?? "Meta gave no reason." }, deepLink: "/workspace/settings/inbox#inbox-templates",
      idempotencyKey: `crm:template-status:${name}:${language}:${status}:${new Date().toISOString().slice(0, 13)}`,
    });
  }
}
