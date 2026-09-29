import { TransactionalEmailService } from "../../email/transactional-email.service";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException, UnprocessableEntityException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { deliveryAllowlist, NOT_ALLOWLISTED } from "../../notifications/delivery-allowlist";
import { staffEmailAction } from "../../notifications/staff-email-actions";
import { createHash } from "node:crypto";
import { PoolClient } from "pg";
import { DatabaseService } from "../../database/database.service";
import { RequestActor } from "../../auth/actor";
import { currentViewAs } from "../../auth/view-as/view-as.context";
import { privateNoticesRemoved } from "../../auth/view-as/view-as.domain";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { ApproveTemplateDto, ClaimNotificationJobsDto, ClaimPushReceiptsDto, CreateNotificationPolicyDto, CreateNotificationTemplateDto, EnqueueNotificationDto, NotificationPolicyStatusDto, NotificationResultDto, PushPreferenceDto, PushReceiptResultDto, RecordDeviceConsentDto, RegisterDeviceEndpointDto, RevokeDeviceEndpointDto, UpsertPreferenceDto } from "./dto/notifications.dto";
import { CrmMessageReceiptService } from "../conversations/crm-message-receipt.service";
import { normalizeTemplateParameter, renderTemplate, templateParametersProblem, templatePlaceholders, type TemplateVariableSource } from "../conversations/inbox/inbox-rules";
import { resolveTemplateSources } from "../conversations/inbox/template-variables";
import { DeviceTokenStoreService } from "./device-token-store.service";
const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
type Row = Record<string, unknown>;
@Injectable()
export class CrmNotificationsService {
  private readonly logger = new Logger(CrmNotificationsService.name);
  constructor(private readonly database: DatabaseService, private readonly access: WorkspaceAccessService, private readonly events: CrmEventsService, private readonly receipts: CrmMessageReceiptService = new CrmMessageReceiptService(), @Optional() private readonly deviceTokens?: DeviceTokenStoreService, @Optional() private readonly mailer?: TransactionalEmailService, @Optional() private readonly config?: ConfigService) {}
  /** Local and UAT: external deliveries only to DELIVERY_ALLOWLIST recipients (webhooks go to systems, not people). */
  private async allowlisted(client: PoolClient, row: Row, destination: Row | null) {
    const allowlist = deliveryAllowlist(this.config ?? { get: (key: string) => process.env[key] });
    if (!allowlist.enabled || row.channel === "webhook" || !destination) return true;
    if (row.channel === "push") {
      // A device token names nobody: the push goes to the member whose email is on the list.
      const user = row.recipientType === "user" ? (await client.query<{ email: string }>(`SELECT primary_email AS email FROM users WHERE id=$1`, [row.recipientId])).rows[0] : undefined;
      return allowlist.allowsEmail(user?.email);
    }
    const value = String(destination.email ?? destination.normalizedValue ?? destination.value ?? "");
    return row.channel === "email" ? allowlist.allowsEmail(value) : allowlist.allowsPhone(value);
  }
  templates(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.notifications.view", async (client) => (await client.query(`SELECT id,code,channel,locale,version_number AS "versionNumber",status,subject_template AS "subjectTemplate",body_template AS "bodyTemplate",variables,provider_template_id AS "providerTemplateId",approved_at AS "approvedAt" FROM notification_templates WHERE workspace_id=$1 ORDER BY code,channel,locale,version_number DESC`, [workspaceId])).rows);
  }
  createTemplate(actor: RequestActor, workspaceId: string, input: CreateNotificationTemplateDto) {
    return this.access.withPermission(actor, workspaceId, "crm.notifications.manage", async (client, actorUser) => {
      this.assertTemplateVariables(input.subjectTemplate ?? "", input.bodyTemplate, input.variables ?? []);
      const next = await client.query<{ next: number }>(`SELECT COALESCE(max(version_number),0)::int+1 AS next FROM notification_templates WHERE workspace_id=$1 AND code=$2 AND channel=$3 AND locale=$4`, [workspaceId, input.code, input.channel, input.locale]);
      const result = await client.query(`INSERT INTO notification_templates (workspace_id,code,channel,locale,version_number,subject_template,body_template,variables,provider_template_id) VALUES ($1,lower($2),$3,$4,$5,$6,$7,$8,$9) RETURNING id,code,channel,locale,version_number AS "versionNumber",status,subject_template AS "subjectTemplate",body_template AS "bodyTemplate",variables,provider_template_id AS "providerTemplateId"`, [workspaceId, input.code, input.channel, input.locale, next.rows[0].next, input.subjectTemplate ?? null, input.bodyTemplate, JSON.stringify([...new Set(input.variables ?? [])]), input.providerTemplateId ?? null]);
      const response = result.rows[0] as Row;
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "notification.template.created.v1", entityType: "notification_template", entityId: String(response.id), after: response });
      return response;
    });
  }
  approveTemplate(actor: RequestActor, workspaceId: string, templateId: string, input: ApproveTemplateDto) {
    return this.access.withPermission(actor, workspaceId, "crm.notifications.manage", async (client, actorUser) => {
      const result = await client.query(`UPDATE notification_templates SET status='approved',approved_at=now(),approved_by=$1 WHERE workspace_id=$2 AND id=$3 AND version_number=$4 AND status='draft' RETURNING id,code,channel,locale,version_number AS "versionNumber",status,approved_at AS "approvedAt"`, [actorUser.userId, workspaceId, templateId, input.versionNumber]);
      if (!result.rowCount) throw new ConflictException("Template changed, was approved, or was not found");
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "notification.template.approved.v1", entityType: "notification_template", entityId: templateId, after: result.rows[0] as Row });
      return result.rows[0];
    });
  }
  createPolicy(actor: RequestActor, workspaceId: string, input: CreateNotificationPolicyDto) {
    return this.access.withPermission(actor, workspaceId, "crm.notifications.manage", async (client, actorUser) => {
      this.validateQuietHours(input.quietHours ?? {}); this.validateFrequency(input.frequencyLimit ?? {});
      const result = await client.query(`INSERT INTO notification_policies (workspace_id,event_type,name,channels,conditions,quiet_hours,frequency_limit) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,event_type AS "eventType",name,channels,conditions,quiet_hours AS "quietHours",frequency_limit AS "frequencyLimit",status,version`, [workspaceId, input.eventType, input.name, JSON.stringify([...new Set(input.channels)]), input.conditions ?? {}, input.quietHours ?? {}, input.frequencyLimit ?? {}]);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "notification.policy.created.v1", entityType: "notification_policy", entityId: String(result.rows[0].id), after: result.rows[0] as Row });
      return result.rows[0];
    });
  }
  policies(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.notifications.view", async (client) => (await client.query(`SELECT id,event_type AS "eventType",name,channels,conditions,quiet_hours AS "quietHours",frequency_limit AS "frequencyLimit",status,version,created_at AS "createdAt",updated_at AS "updatedAt" FROM notification_policies WHERE workspace_id=$1 ORDER BY name`, [workspaceId])).rows);
  }
  setPolicyStatus(actor: RequestActor, workspaceId: string, policyId: string, input: NotificationPolicyStatusDto) {
    return this.access.withPermission(actor, workspaceId, "crm.notifications.manage", async (client, actorUser) => {
      const result = await client.query(`UPDATE notification_policies SET status=$1,version=version+1 WHERE workspace_id=$2 AND id=$3 AND version=$4 RETURNING id,event_type AS "eventType",name,status,version`, [input.status,workspaceId,policyId,input.version]);
      if (!result.rowCount) throw new ConflictException("Notification policy changed or was not found");
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "notification.policy.status_changed.v1", entityType: "notification_policy", entityId: policyId, after: result.rows[0] as Row });
      return result.rows[0];
    });
  }
  preference(actor: RequestActor, workspaceId: string, input: UpsertPreferenceDto) {
    // Your own preferences need only membership (a QS or Finance reviewer mutes their own notices);
    // anyone else's need crm.communications.view, and another person's an administrator.
    return this.access.asMember(actor, workspaceId, async (client, actorUser) => {
      const own = input.recipientType === "user" && input.recipientId === actorUser.userId;
      if (!own && !(await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.communications.view"))) throw new ForbiddenException("Permissions required: crm.communications.view");
      if (input.recipientType === "user" && !own) {
        const admin = await client.query(`SELECT 1 FROM workspace_memberships membership JOIN effective_member_roles assigned ON assigned.membership_id=membership.id JOIN roles role ON role.id=assigned.role_id WHERE membership.workspace_id=$1 AND membership.user_id=$2 AND role.code IN ('owner','administrator')`, [workspaceId, actorUser.userId]);
        if (!admin.rowCount) throw new UnprocessableEntityException("Only administrators may change another user's preference");
      }
      this.validateQuietHours(input.quietHours ?? {});
      const result = await client.query(`INSERT INTO notification_preferences (workspace_id,recipient_type,recipient_id,event_type,channel,enabled,quiet_hours) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (workspace_id,recipient_type,recipient_id,event_type,channel) DO UPDATE SET enabled=EXCLUDED.enabled,quiet_hours=EXCLUDED.quiet_hours,version=notification_preferences.version+1 RETURNING id,recipient_type AS "recipientType",recipient_id AS "recipientId",event_type AS "eventType",channel,enabled,quiet_hours AS "quietHours",version`, [workspaceId, input.recipientType, input.recipientId, input.eventType, input.channel, input.enabled, input.quietHours ?? {}]);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "notification.preference.changed.v1", entityType: "notification_preference", entityId: String(result.rows[0].id), after: result.rows[0] as Row });
      return result.rows[0];
    });
  }
  /** Your own preferences (per event and channel, and quiet hours), for Settings → Notifications. */
  myPreferences(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, actorUser) => (await client.query(
      `SELECT event_type AS "eventType",channel,enabled,quiet_hours AS "quietHours",version FROM notification_preferences
       WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 ORDER BY event_type,channel`, [workspaceId, actorUser.userId])).rows);
  }
  // Your own notices, devices and push settings need only membership: every role is told about its work
  // (QS reviews, Finance verifications…). Every query below is bound to the signed-in user as recipient;
  // templates, policies and anyone else's notices keep their permissions.
  notificationSettings(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, actorUser) => this.mobileSettings(client, workspaceId, actorUser.userId));
  }
  recordDeviceConsent(actor: RequestActor, workspaceId: string, input: RecordDeviceConsentDto) {
    return this.access.asMember(actor, workspaceId, async (client, actorUser) => {
      this.assertTimezone(input.timezone);
      const replay = await client.query<Row>(`SELECT id,permission_status AS "permissionStatus",version FROM notification_device_consents WHERE workspace_id=$1 AND user_id=$2 AND installation_id=$3 AND last_request_id=$4`, [workspaceId, actorUser.userId, input.installationId, input.requestId]);
      if (replay.rowCount) return { ...(await this.mobileSettings(client, workspaceId, actorUser.userId)), idempotentReplay: true };
      const consent = await client.query<Row>(`INSERT INTO notification_device_consents(workspace_id,user_id,installation_id,last_request_id,platform,permission_status,locale,timezone)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(workspace_id,user_id,installation_id) DO UPDATE SET last_request_id=EXCLUDED.last_request_id,platform=EXCLUDED.platform,permission_status=EXCLUDED.permission_status,locale=EXCLUDED.locale,timezone=EXCLUDED.timezone,permission_updated_at=CASE WHEN notification_device_consents.permission_status<>EXCLUDED.permission_status THEN now() ELSE notification_device_consents.permission_updated_at END,last_seen_at=now(),updated_at=now(),version=notification_device_consents.version+1
        RETURNING id,permission_status AS "permissionStatus",version`, [workspaceId, actorUser.userId, input.installationId, input.requestId, input.platform, input.status, input.locale, input.timezone]);
      const allowed = ["granted", "provisional", "ephemeral"].includes(input.status);
      let revoked: Row[] = [];
      if (!allowed) {
        revoked = (await client.query<Row>(`UPDATE device_endpoints SET status='revoked',last_request_id=$1,last_seen_at=now(),updated_at=now(),version=version+1 WHERE workspace_id=$2 AND user_id=$3 AND installation_id=$4 AND status='active' RETURNING encrypted_token_reference AS "tokenReference"`, [input.requestId, workspaceId, actorUser.userId, input.installationId])).rows;
        await this.setPushPreferenceWithClient(client, workspaceId, actorUser.userId, false);
      }
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "notification.device_consent.changed.v1", entityType: "notification_device_consent", entityId: String(consent.rows[0].id), after: { installationId: input.installationId, platform: input.platform, permissionStatus: input.status, revokedEndpoints: revoked.length } });
      await Promise.all(revoked.map((row) => this.deviceTokens?.delete(String(row.tokenReference))));
      return this.mobileSettings(client, workspaceId, actorUser.userId);
    });
  }
  registerDevice(actor: RequestActor, workspaceId: string, input: RegisterDeviceEndpointDto) {
    return this.access.asMember(actor, workspaceId, async (client, actorUser) => {
      if (!this.deviceTokens) throw new ServiceUnavailableException("Push registration is unavailable");
      this.assertTimezone(input.timezone);
      if (!["granted", "provisional", "ephemeral"].includes(input.status)) throw new BadRequestException("Allow notifications on this device before registering push delivery");
      const consent = await client.query<Row>(`SELECT id,permission_status FROM notification_device_consents WHERE workspace_id=$1 AND user_id=$2 AND installation_id=$3`, [workspaceId, actorUser.userId, input.installationId]);
      if (!consent.rowCount || !["granted", "provisional", "ephemeral"].includes(String(consent.rows[0].permission_status))) throw new ConflictException("Record the current notification permission before registering this device");
      const replay = await client.query<Row>(`SELECT id,status,version FROM device_endpoints WHERE workspace_id=$1 AND user_id=$2 AND installation_id=$3 AND last_request_id=$4`, [workspaceId, actorUser.userId, input.installationId, input.requestId]);
      if (replay.rowCount) return { endpoint: replay.rows[0], idempotentReplay: true };
      const tokenHash = createHash("sha256").update(input.token).digest("hex");
      const tokenReference = await this.deviceTokens.put(workspaceId, actorUser.userId, input.token);
      try {
        const displaced = await client.query<Row>(`DELETE FROM device_endpoints WHERE workspace_id=$1 AND token_hash=$2 AND (user_id<>$3 OR installation_id<>$4) RETURNING encrypted_token_reference AS "tokenReference"`, [workspaceId, tokenHash, actorUser.userId, input.installationId]);
        const prior = await client.query<Row>(`SELECT encrypted_token_reference AS "tokenReference" FROM device_endpoints WHERE workspace_id=$1 AND user_id=$2 AND installation_id=$3`, [workspaceId, actorUser.userId, input.installationId]);
        const endpoint = await client.query<Row>(`INSERT INTO device_endpoints(workspace_id,user_id,installation_id,last_request_id,platform,token_type,consent_id,token_hash,encrypted_token_reference,locale,timezone,status)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active')
          ON CONFLICT(workspace_id,user_id,installation_id) DO UPDATE SET last_request_id=EXCLUDED.last_request_id,platform=EXCLUDED.platform,token_type=EXCLUDED.token_type,consent_id=EXCLUDED.consent_id,token_hash=EXCLUDED.token_hash,encrypted_token_reference=EXCLUDED.encrypted_token_reference,locale=EXCLUDED.locale,timezone=EXCLUDED.timezone,status='active',last_seen_at=now(),updated_at=now(),version=device_endpoints.version+1
          RETURNING id,installation_id AS "installationId",platform,token_type AS "tokenType",locale,timezone,status,last_seen_at AS "lastSeenAt",version`, [workspaceId, actorUser.userId, input.installationId, input.requestId, input.platform, input.tokenType, consent.rows[0].id, tokenHash, tokenReference, input.locale, input.timezone]);
        await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "notification.device.registered.v1", entityType: "device_endpoint", entityId: String(endpoint.rows[0].id), after: { installationId: input.installationId, platform: input.platform, tokenType: input.tokenType } });
        await Promise.all([...displaced.rows, ...prior.rows].filter((row) => row.tokenReference !== tokenReference).map((row) => this.deviceTokens?.delete(String(row.tokenReference))));
        return { endpoint: endpoint.rows[0] };
      } catch (error) {
        await this.deviceTokens.delete(tokenReference);
        throw error;
      }
    });
  }
  setPushPreference(actor: RequestActor, workspaceId: string, input: PushPreferenceDto) {
    return this.access.asMember(actor, workspaceId, async (client, actorUser) => {
      if (input.enabled && !(await client.query(`SELECT 1 FROM device_endpoints endpoint JOIN notification_device_consents consent ON consent.id=endpoint.consent_id AND consent.workspace_id=endpoint.workspace_id WHERE endpoint.workspace_id=$1 AND endpoint.user_id=$2 AND endpoint.status='active' AND consent.permission_status IN ('granted','provisional','ephemeral')`, [workspaceId, actorUser.userId])).rowCount) throw new ConflictException("Allow notifications and register this device before enabling push");
      const preference = await this.setPushPreferenceWithClient(client, workspaceId, actorUser.userId, input.enabled);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "notification.push_preference.changed.v1", entityType: "notification_preference", entityId: String(preference.id), after: preference });
      return this.mobileSettings(client, workspaceId, actorUser.userId);
    });
  }
  revokeDevice(actor: RequestActor, workspaceId: string, endpointId: string, input: RevokeDeviceEndpointDto) {
    return this.access.asMember(actor, workspaceId, async (client, actorUser) => {
      const current = await client.query<Row>(`SELECT id,status,version,last_request_id,encrypted_token_reference AS "tokenReference" FROM device_endpoints WHERE workspace_id=$1 AND user_id=$2 AND id=$3 FOR UPDATE`, [workspaceId, actorUser.userId, endpointId]);
      if (!current.rowCount) throw new NotFoundException("Notification device not found");
      if (current.rows[0].last_request_id === input.requestId) return { ...(await this.mobileSettings(client, workspaceId, actorUser.userId)), idempotentReplay: true };
      if (current.rows[0].status !== "active") throw new ConflictException("Notification device was already revoked");
      if (Number(current.rows[0].version) !== input.version) throw new ConflictException("Notification device changed; refresh and try again");
      const result = await client.query<Row>(`UPDATE device_endpoints SET status='revoked',last_request_id=$1,last_seen_at=now(),updated_at=now(),version=version+1 WHERE workspace_id=$2 AND user_id=$3 AND id=$4 AND version=$5 RETURNING id,status,version`, [input.requestId, workspaceId, actorUser.userId, endpointId, input.version]);
      if (!result.rowCount) throw new ConflictException("Notification device changed; refresh and try again");
      if (!(await client.query(`SELECT 1 FROM device_endpoints WHERE workspace_id=$1 AND user_id=$2 AND status='active'`, [workspaceId, actorUser.userId])).rowCount) await this.setPushPreferenceWithClient(client, workspaceId, actorUser.userId, false);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "notification.device.revoked.v1", entityType: "device_endpoint", entityId: endpointId, before: { status: "active", version: input.version }, after: result.rows[0] });
      await this.deviceTokens?.delete(String(current.rows[0].tokenReference));
      return this.mobileSettings(client, workspaceId, actorUser.userId);
    });
  }
  inbox(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, actorUser) => {
      const result = await client.query<Row>(`SELECT id,event_type AS "eventType",status,subject,body,deep_link AS "deepLink",delivered_at AS "deliveredAt",read_at AS "readAt",created_at AS "createdAt",version FROM notifications WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 AND channel='in_app' ORDER BY created_at DESC LIMIT 200`, [workspaceId, actorUser.userId]);
      // The phone opens a notice it has no screen for on the web, in the browser.
      const origin = this.config?.get<string>("WEB_ORIGIN", "")?.split(",")[0]?.trim();
      const webUrl = (link: unknown) => {
        if (!origin || typeof link !== "string" || !link.startsWith("/workspace/")) return null;
        try { return new URL(link, origin).toString(); } catch { return null; }
      };
      // Viewing as someone: their notices, less what stays private (views of them, and leave reasons).
      const rows = currentViewAs() ? privateNoticesRemoved(result.rows) : result.rows;
      return rows.map((row) => ({ ...row, webUrl: webUrl(row.deepLink) }));
    });
  }
  readAll(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, actorUser) => {
      const result = await client.query(`UPDATE notifications SET read_at=now(),version=version+1 WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 AND channel='in_app' AND read_at IS NULL RETURNING id`, [workspaceId, actorUser.userId]);
      return { updated: result.rowCount };
    });
  }
  read(actor: RequestActor, workspaceId: string, notificationId: string) {
    return this.access.asMember(actor, workspaceId, async (client, actorUser) => {
      const result = await client.query(`UPDATE notifications SET read_at=COALESCE(read_at,now()),version=version+1 WHERE workspace_id=$1 AND id=$2 AND recipient_type='user' AND recipient_id=$3 RETURNING id,read_at AS "readAt",version`, [workspaceId, notificationId, actorUser.userId]);
      if (!result.rowCount) throw new NotFoundException("Notification not found"); return result.rows[0];
    });
  }
  open(actor: RequestActor, workspaceId: string, notificationId: string) {
    return this.access.asMember(actor, workspaceId, async (client, actorUser) => {
      const result = await client.query<Row>(`UPDATE notifications SET read_at=COALESCE(read_at,now()),version=version+1 WHERE workspace_id=$1 AND id=$2 AND recipient_type='user' AND recipient_id=$3 AND channel IN ('push','in_app') RETURNING id,deep_link AS "deepLink",read_at AS "readAt",version`, [workspaceId, notificationId, actorUser.userId]);
      if (!result.rowCount) throw new NotFoundException("Notification not found");
      const destination = await this.mobileDestination(client, workspaceId, actorUser.userId, String(result.rows[0].deepLink ?? ""));
      return { id: notificationId, readAt: result.rows[0].readAt, destination: destination ?? { module: "crm", screen: "inbox" }, fallback: !destination };
    });
  }
  enqueueInternal(input: EnqueueNotificationDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, (client) => this.enqueueWithClient(client, input));
  }
  async enqueueWithClient(client: PoolClient, input: EnqueueNotificationDto) {
    const replay = await client.query(`SELECT id,status,scheduled_for AS "scheduledFor",subject,body,deep_link AS "deepLink",suppressed_reason AS "suppressedReason",version FROM notifications WHERE workspace_id=$1 AND idempotency_key=$2`, [input.workspaceId, input.idempotencyKey]);
    if (replay.rowCount) return { ...replay.rows[0], idempotentReplay: true };
    const preference = await client.query<{ enabled: boolean; quiet_hours: Record<string, unknown> }>(`SELECT enabled,quiet_hours FROM notification_preferences WHERE workspace_id=$1 AND recipient_type=$2 AND recipient_id=$3 AND event_type::text IN ($4::text,'*') AND channel=$5 ORDER BY event_type::text=$4::text DESC LIMIT 1`, [input.workspaceId, input.recipientType, input.recipientId, input.eventType, input.channel]);
    if (preference.rowCount && !preference.rows[0].enabled) return this.suppressed(client, input, "recipient_preference");
    if (input.recipientType === "party" && !["in_app", "webhook"].includes(input.channel) && !(await this.hasConsent(client, input))) return this.suppressed(client, input, "consent_missing");
    const policy = await this.findPolicy(client, input);
    if (policy && await this.frequencyExceeded(client, input, policy)) return this.suppressed(client, input, "frequency_limit", String(policy.id));
    const template = await this.findTemplate(client, input);
    const declared = Array.isArray(template.variables) ? template.variables.map(String) : [];
    for (const variable of declared) if (!(variable in input.variables)) throw new UnprocessableEntityException(`Missing template variable: ${variable}`);
    // A provider template with {{1}}…{{n}} (WhatsApp) takes its values from the inbox's variable mapping and the client's records.
    const positions = input.channel === "whatsapp" ? templatePlaceholders(String(template.body_template)) : [];
    let templateParameters: string[] = [];
    if (positions.length) {
      const filled = await this.templateParameters(client, input, String(template.code), positions);
      if (!filled) return this.suppressed(client, input, "template_value_missing");
      templateParameters = filled;
    }
    const subject = template.subject_template ? this.render(String(template.subject_template), input.variables) : null;
    const body = positions.length ? renderTemplate(String(template.body_template), templateParameters) : this.render(String(template.body_template), input.variables);
    let scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : new Date();
    if (Number.isNaN(scheduledFor.getTime())) throw new BadRequestException("scheduledFor is invalid");
    const timezone = await this.recipientTimezone(client, input);
    for (const quietHours of [policy?.quiet_hours, preference.rows[0]?.quiet_hours]) {
      if (quietHours && typeof quietHours === "object") scheduledFor = this.afterQuietHours(scheduledFor, quietHours as Record<string, unknown>, timezone);
    }
    try {
      const result = await client.query(`INSERT INTO notifications (workspace_id,policy_id,template_id,recipient_type,recipient_id,channel,event_type,status,scheduled_for,subject,body,deep_link,idempotency_key,correlation_id,template_parameters) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id,status,scheduled_for AS "scheduledFor",subject,body,deep_link AS "deepLink",version`, [input.workspaceId, policy?.id ?? null, template.id, input.recipientType, input.recipientId, input.channel, input.eventType, input.channel === "in_app" ? "delivered" : scheduledFor > new Date() ? "scheduled" : "pending", scheduledFor, subject, body, input.deepLink ?? null, input.idempotencyKey, input.correlationId, templateParameters]);
      const response = result.rows[0] as Row;
      if (input.channel === "in_app") await client.query(`UPDATE notifications SET delivered_at=now() WHERE id=$1`, [response.id]);
      if (input.channel !== "in_app") await this.events.record(client, { workspaceId: input.workspaceId, actorUserId: null, source: "automation", action: "notification.delivery_requested.v1", entityType: "notification", entityId: String(response.id), correlationId: input.correlationId, after: { ...response, channel: input.channel } });
      return response;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") { const prior = await client.query(`SELECT id,status,scheduled_for AS "scheduledFor",subject,body,deep_link AS "deepLink",version FROM notifications WHERE workspace_id=$1 AND idempotency_key=$2`, [input.workspaceId, input.idempotencyKey]); return { ...prior.rows[0], idempotentReplay: true }; }
      throw error;
    }
  }
  /**
   * Staff emails go out through the platform mailer in the tenant's brand, not a tenant connector,
   * so they work before any integration is connected. Claim, send, record; one bad address never
   * blocks the rest.
   */
  async dispatchStaffEmailsInternal(input: ClaimNotificationJobsDto) {
    // Team members (users) and client portal contacts: both are sent by the platform mailer in the tenant's brand.
    const claimed = await this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const result = await client.query<{ id: string; subject: string | null; body: string; deepLink: string | null; email: string | null; eventType: string; recipientType: string }>(
        `WITH due AS (
           SELECT notification.id, CASE WHEN notification.recipient_type='user' THEN person.primary_email ELSE contact.email END AS email
           FROM notifications notification
           LEFT JOIN users person ON notification.recipient_type='user' AND person.id=notification.recipient_id
           LEFT JOIN client_portal_grants contact ON notification.recipient_type='portal_contact' AND contact.workspace_id=notification.workspace_id
                                                AND contact.id=notification.recipient_id AND contact.active
           WHERE notification.workspace_id=$1 AND notification.recipient_type IN ('user','portal_contact') AND notification.channel='email'
             AND ((notification.status IN ('pending','scheduled') AND notification.scheduled_for<=now())
               OR (notification.status='processing' AND notification.processing_started_at<now()-interval '5 minutes'))
           ORDER BY notification.scheduled_for FOR UPDATE OF notification SKIP LOCKED LIMIT $2)
         UPDATE notifications notification SET status='processing', processing_started_at=now(), version=version+1
         FROM due WHERE notification.id=due.id
         RETURNING notification.id, notification.subject, notification.body, notification.deep_link AS "deepLink", due.email, notification.event_type AS "eventType",
                   notification.recipient_type AS "recipientType"`,
        [input.workspaceId, Math.min(input.limit ?? 50, 100)],
      );
      return result.rows;
    });
    let delivered = 0;
    for (const row of claimed) {
      const actionLabel = staffEmailAction(row.eventType, row.recipientType);
      type Outcome = { status: "sent" | "not_configured" | "failed"; provider: string | null; messageId: string | null; suppressedReason?: string; errorCode?: string };
      const outcome: Outcome = row.email
        ? await (this.mailer ? this.mailer.sendStaffNotice({ workspaceId: input.workspaceId, to: row.email, subject: row.subject ?? "Update", body: row.body, deepLink: row.deepLink, actionLabel }) : Promise.resolve<Outcome>({ status: "not_configured", provider: null, messageId: null })).catch((): Outcome => ({ status: "failed", provider: null, messageId: null, errorCode: "MAILER_ERROR" }))
        : { status: "failed", provider: null, messageId: null };
      const status = outcome.status === "sent" ? "delivered" : outcome.status === "not_configured" ? "suppressed" : "failed";
      const suppressedReason = outcome.suppressedReason ?? "email_not_configured";
      if (status === "delivered") delivered += 1;
      await this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
        await client.query(
          `UPDATE notifications SET status=$1::notification_status, delivered_at=CASE WHEN $1='delivered' THEN now() ELSE delivered_at END,
             suppressed_reason=CASE WHEN $1='suppressed' THEN $5 WHEN $2::boolean THEN 'destination_missing' ELSE suppressed_reason END,
             processing_started_at=NULL, version=version+1 WHERE workspace_id=$3 AND id=$4`,
          [status, !row.email, input.workspaceId, row.id, suppressedReason]);
        // A real send attempt is recorded like the worker's, so delivery health can show when email last
        // worked and why it last failed.
        if (outcome.status !== "not_configured" && row.email) await client.query(
          `INSERT INTO notification_delivery_attempts (workspace_id,notification_id,attempt,provider,status,provider_message_id,error_code,completed_at)
           SELECT $1,$2,COALESCE(max(attempt),0)+1,$3,$4,$5,$6,now() FROM notification_delivery_attempts WHERE workspace_id=$1 AND notification_id=$2`,
          [input.workspaceId, row.id, outcome.provider ?? "mailgun", status === "delivered" ? "delivered" : "permanent_failure", outcome.messageId, status === "delivered" ? null : outcome.errorCode ?? "EMAIL_SEND_FAILED"]);
      });
    }
    return { claimed: claimed.length, delivered };
  }

  claimInternal(input: ClaimNotificationJobsDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const result = await client.query(`WITH due AS (
        SELECT notification.id,
          (SELECT COALESCE(max(attempt.attempt),0)::int + 1 FROM notification_delivery_attempts attempt WHERE attempt.workspace_id=notification.workspace_id AND attempt.notification_id=notification.id) AS attempt
        FROM notifications notification
        WHERE notification.workspace_id=$1
          AND notification.channel<>'in_app'
          AND NOT (notification.recipient_type IN ('user','portal_contact') AND notification.channel='email')
          AND ((notification.status IN ('pending','scheduled') AND notification.scheduled_for<=now())
            OR (notification.status='processing' AND notification.processing_started_at<now()-interval '5 minutes'))
        ORDER BY notification.scheduled_for
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      )
      UPDATE notifications notification
      SET status='processing',processing_started_at=now(),version=version+1
      FROM due WHERE notification.id=due.id
      RETURNING notification.id,notification.recipient_type AS "recipientType",notification.recipient_id AS "recipientId",notification.channel,notification.event_type AS "eventType",notification.subject,notification.body,notification.deep_link AS "deepLink",notification.correlation_id AS "correlationId",notification.idempotency_key AS "idempotencyKey",notification.template_id AS "templateId",notification.template_parameters AS "templateParameters",notification.version,due.attempt`, [input.workspaceId, Math.min(input.limit ?? 50, 100)]);
      const items: Row[] = [];
      for (const row of result.rows as Row[]) {
        const currentInput = { workspaceId: input.workspaceId, recipientType: String(row.recipientType), recipientId: String(row.recipientId), channel: String(row.channel), eventType: String(row.eventType) };
        const preference = await client.query<{ enabled: boolean }>(`SELECT enabled FROM notification_preferences WHERE workspace_id=$1 AND recipient_type=$2 AND recipient_id=$3 AND event_type::text IN ($4::text,'*') AND channel=$5 ORDER BY event_type::text=$4::text DESC LIMIT 1`, [currentInput.workspaceId, currentInput.recipientType, currentInput.recipientId, currentInput.eventType, currentInput.channel]);
        const consentValid = currentInput.recipientType !== "party" || ["in_app", "webhook"].includes(currentInput.channel) || await this.hasConsent(client, currentInput);
        const destination = await this.destination(client, input.workspaceId, row);
        const reason = preference.rows[0]?.enabled === false ? "recipient_preference" : !consentValid ? "consent_withdrawn" : !destination ? "destination_missing"
          : !(await this.allowlisted(client, row, destination)) ? NOT_ALLOWLISTED : null;
        if (reason === NOT_ALLOWLISTED) this.logger.warn(`Notification ${String(row.id)} (${String(row.channel)}) suppressed: ${NOT_ALLOWLISTED}`);
        if (reason) {
          if (row.channel === "push" && row.recipientType === "user") await this.fallbackPushToInbox(client, input.workspaceId, row, reason);
          await client.query(`UPDATE notifications SET status='suppressed',suppressed_reason=$1,processing_started_at=NULL,version=version+1 WHERE workspace_id=$2 AND id=$3`, [reason, input.workspaceId, row.id]);
          continue;
        }
        const template = row.templateId ? await client.query(`SELECT code,locale FROM notification_templates WHERE workspace_id=$1 AND id=$2`, [input.workspaceId, row.templateId]) : { rows: [] };
        items.push({ ...row, workspaceId: input.workspaceId, destination, templateCode: template.rows[0]?.code ?? null, locale: template.rows[0]?.locale ?? null, ...await this.chatDelivery(client, input.workspaceId, row) });
      }
      return { items };
    });
  }
  /**
   * For a chat message on WhatsApp: the number it goes from (the chat's, while that number is connected; else the
   * worker uses the default) and its file, which the worker uploads to WhatsApp and sends with the caption.
   */
  private async chatDelivery(client: PoolClient, workspaceId: string, row: Row): Promise<{ connectionId?: string; media?: Row }> {
    const messageId = /^message:([0-9a-f-]{36})$/i.exec(String(row.idempotencyKey ?? ""))?.[1];
    if (row.channel !== "whatsapp" || !messageId) return {};
    const found = (await client.query<Row>(
      `SELECT (SELECT number.id FROM integration_connections number WHERE number.workspace_id = conversation.workspace_id AND number.id = conversation.connection_id
                  AND number.provider = 'whatsapp' AND number.status = 'connected') AS "connectionId",
              attachment.id AS "attachmentId", attachment.kind, attachment.content_type AS "mimeType", attachment.file_name AS "fileName", message.body_text AS caption
         FROM crm_messages message
         JOIN crm_conversations conversation ON conversation.workspace_id = message.workspace_id AND conversation.id = message.conversation_id
         LEFT JOIN crm_message_attachments attachment ON attachment.workspace_id = message.workspace_id AND attachment.message_id = message.id AND attachment.status = 'stored'
        WHERE message.workspace_id = $1 AND message.id = $2`, [workspaceId, messageId])).rows[0];
    if (!found) return {};
    return {
      ...(found.connectionId ? { connectionId: String(found.connectionId) } : {}),
      ...(found.attachmentId ? { media: { attachmentId: found.attachmentId, kind: found.kind, mimeType: found.mimeType, fileName: found.fileName, caption: found.caption ?? null } } : {}),
    };
  }

  resultInternal(notificationId: string, input: NotificationResultDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const notification = await client.query<Row>(`SELECT * FROM notifications WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [input.workspaceId, notificationId]);
      if (!notification.rowCount) throw new NotFoundException("Notification not found");
      const prior = await client.query(`SELECT status,provider_message_id AS "providerMessageId" FROM notification_delivery_attempts WHERE workspace_id=$1 AND notification_id=$2 AND attempt=$3`, [input.workspaceId, notificationId, input.attempt]);
      if (prior.rowCount) return { id: notificationId, status: notification.rows[0].status, idempotentReplay: true };
      if (input.result === "accepted" && notification.rows[0].channel === "whatsapp") {
        // Meta accepted the message: it is sent (one tick). Only its own delivered/read receipts say more.
        if (!input.providerMessageId) throw new BadRequestException("An accepted WhatsApp message needs the provider's message id");
        await client.query(`INSERT INTO notification_delivery_attempts(workspace_id,notification_id,attempt,provider,status,provider_message_id,completed_at) VALUES($1,$2,$3,$4,'accepted',$5,now())`, [input.workspaceId, notificationId, input.attempt, input.provider, input.providerMessageId]);
        const sent = await client.query(`UPDATE notifications SET status='sent',processing_started_at=NULL,version=version+1 WHERE workspace_id=$1 AND id=$2 RETURNING id,status,version`, [input.workspaceId, notificationId]);
        const messageId = /^message:([0-9a-f-]{36})$/i.exec(String(notification.rows[0].idempotency_key ?? ""))?.[1];
        if (messageId) await this.receipts.record(client, messageId, { workspaceId: input.workspaceId, status: "sent", providerMessageId: input.providerMessageId }, { ignoreMissing: true, ignoreNonOutbound: true });
        return { ...sent.rows[0], providerAccepted: true, delivered: false };
      }
      if (input.result === "accepted") {
        if (notification.rows[0].channel !== "push" || !input.providerMessageId || !input.endpointReference) throw new BadRequestException("Only push delivery may wait for a provider receipt");
        await client.query(`INSERT INTO notification_delivery_attempts(workspace_id,notification_id,attempt,provider,status,provider_message_id,destination_reference,error_code,error_message) VALUES($1,$2,$3,$4,'accepted',$5,$6,$7,$8)`, [input.workspaceId, notificationId, input.attempt, input.provider, input.providerMessageId, input.endpointReference, input.errorCode ?? null, input.errorMessage ?? null]);
        const accepted = await client.query(`UPDATE notifications SET status='processing',processing_started_at=now(),version=version+1 WHERE workspace_id=$1 AND id=$2 RETURNING id,status,version`, [input.workspaceId, notificationId]);
        return { ...accepted.rows[0], providerAccepted: true, delivered: false };
      }
      const retryAt = input.result === "retry" && input.attempt < 8 ? new Date(Date.now() + this.retryDelay(input.attempt)) : null;
      // The worker's own DELIVERY_ALLOWLIST guard refused it: suppressed, not a provider failure.
      const suppressed = input.result === "permanent_failure" && input.errorCode === NOT_ALLOWLISTED;
      const finalStatus = input.result === "delivered" ? "delivered" : retryAt ? "scheduled" : suppressed ? "suppressed" : "failed";
      await client.query(`INSERT INTO notification_delivery_attempts (workspace_id,notification_id,attempt,provider,status,provider_message_id,destination_reference,error_code,error_message,retry_at,completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`, [input.workspaceId, notificationId, input.attempt, input.provider, input.result, input.providerMessageId ?? null, input.endpointReference ?? null, input.errorCode ?? null, input.errorMessage ?? null, retryAt]);
      const result = await client.query(`UPDATE notifications SET status=$1::notification_status,scheduled_for=COALESCE($2,scheduled_for),processing_started_at=NULL,delivered_at=CASE WHEN $1='delivered' THEN now() ELSE delivered_at END,suppressed_reason=CASE WHEN $1='suppressed' THEN $5 ELSE suppressed_reason END,version=version+1 WHERE workspace_id=$3 AND id=$4 RETURNING id,status,scheduled_for AS "scheduledFor",delivered_at AS "deliveredAt",version`, [finalStatus, retryAt, input.workspaceId, notificationId, NOT_ALLOWLISTED]);
      if (input.errorCode === "DeviceNotRegistered" && input.endpointReference) await this.revokeFailedEndpoint(client, input.workspaceId, String(notification.rows[0].recipient_id), input.endpointReference);
      if (finalStatus === "failed" && notification.rows[0].channel === "push") await this.fallbackPushToInbox(client, input.workspaceId, { recipientId: notification.rows[0].recipient_id, eventType: notification.rows[0].event_type, subject: notification.rows[0].subject, body: notification.rows[0].body, deepLink: notification.rows[0].deep_link, idempotencyKey: notification.rows[0].idempotency_key, correlationId: notification.rows[0].correlation_id }, "delivery_failed");
      const key = String(notification.rows[0].idempotency_key ?? "");
      const messageId = /^message:([0-9a-f-]{36})$/i.exec(key)?.[1];
      if (messageId && (finalStatus === "delivered" || finalStatus === "failed" || finalStatus === "suppressed")) {
        await this.receipts.record(client, messageId, {
          workspaceId: input.workspaceId,
          status: finalStatus === "delivered" ? "sent" : "failed",
          providerMessageId: input.providerMessageId,
          failureCode: input.errorCode,
        }, { ignoreMissing: true, ignoreNonOutbound: true });
      }
      if (finalStatus === "failed") await this.events.record(client, { workspaceId: input.workspaceId, actorUserId: null, source: "automation", action: "notification.delivery_failed.v1", entityType: "notification", entityId: notificationId, after: { ...result.rows[0], errorCode: input.errorCode, attempts: input.attempt } });
      return result.rows[0];
    });
  }
  claimPushReceipts(input: ClaimPushReceiptsDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const result = await client.query<Row>(`WITH due AS (
        SELECT attempt.id FROM notification_delivery_attempts attempt
        JOIN notifications notification ON notification.workspace_id=attempt.workspace_id AND notification.id=attempt.notification_id
        WHERE attempt.workspace_id=$1 AND attempt.provider='expo' AND attempt.status='accepted'
          AND attempt.started_at<=now()-interval '15 minutes' AND notification.status='processing'
        ORDER BY attempt.started_at FOR UPDATE SKIP LOCKED LIMIT $2
      ) UPDATE notification_delivery_attempts attempt SET status='checking'
        FROM due WHERE attempt.id=due.id
        RETURNING attempt.notification_id AS "notificationId",attempt.attempt,attempt.provider_message_id AS "providerMessageId"`, [input.workspaceId, Math.min(input.limit ?? 100, 100)]);
      return { items: result.rows };
    });
  }
  pushReceiptResult(notificationId: string, input: PushReceiptResultDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const attempt = await client.query<Row>(`SELECT attempt.id,attempt.status,attempt.destination_reference AS "endpointReference",notification.recipient_id AS "recipientId",notification.event_type AS "eventType",notification.subject,notification.body,notification.deep_link AS "deepLink",notification.idempotency_key AS "idempotencyKey",notification.correlation_id AS "correlationId" FROM notification_delivery_attempts attempt JOIN notifications notification ON notification.workspace_id=attempt.workspace_id AND notification.id=attempt.notification_id WHERE attempt.workspace_id=$1 AND attempt.notification_id=$2 AND attempt.attempt=$3 AND attempt.provider_message_id=$4 FOR UPDATE`, [input.workspaceId, notificationId, input.attempt, input.providerMessageId]);
      if (!attempt.rowCount) throw new NotFoundException("Push delivery receipt was not found");
      if (["delivered", "retry", "permanent_failure"].includes(String(attempt.rows[0].status))) return { id: notificationId, idempotentReplay: true };
      if (!['accepted','checking'].includes(String(attempt.rows[0].status))) throw new ConflictException("Push delivery receipt is not awaiting verification");
      const retryAt = input.result === "retry" && input.attempt < 8 ? new Date(Date.now() + this.retryDelay(input.attempt)) : null;
      const finalStatus = input.result === "delivered" ? "delivered" : retryAt ? "scheduled" : "failed";
      await client.query(`UPDATE notification_delivery_attempts SET status=$1,error_code=$2,error_message=$3,retry_at=$4,completed_at=now() WHERE id=$5`, [input.result, input.errorCode ?? null, input.errorMessage ?? null, retryAt, attempt.rows[0].id]);
      const result = await client.query<Row>(`UPDATE notifications SET status=$1::notification_status,scheduled_for=COALESCE($2,scheduled_for),processing_started_at=NULL,delivered_at=CASE WHEN $1='delivered' THEN now() ELSE delivered_at END,version=version+1 WHERE workspace_id=$3 AND id=$4 RETURNING id,status,scheduled_for AS "scheduledFor",delivered_at AS "deliveredAt",version`, [finalStatus, retryAt, input.workspaceId, notificationId]);
      if (input.errorCode === "DeviceNotRegistered" && attempt.rows[0].endpointReference) await this.revokeFailedEndpoint(client, input.workspaceId, String(attempt.rows[0].recipientId), String(attempt.rows[0].endpointReference));
      if (finalStatus === "failed") await this.fallbackPushToInbox(client, input.workspaceId, attempt.rows[0], "delivery_failed");
      if (finalStatus === "failed") await this.events.record(client, { workspaceId: input.workspaceId, actorUserId: null, source: "automation", action: "notification.delivery_failed.v1", entityType: "notification", entityId: notificationId, after: { ...result.rows[0], errorCode: input.errorCode, attempts: input.attempt, receiptVerified: true } });
      return { ...result.rows[0], receiptVerified: true };
    });
  }
  private async mobileSettings(client: PoolClient, workspaceId: string, userId: string) {
    const [preference, consents, endpoints, unread] = await Promise.all([
      client.query<Row>(`SELECT enabled,quiet_hours AS "quietHours",version FROM notification_preferences WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 AND event_type='*' AND channel='push'`, [workspaceId, userId]),
      client.query<Row>(`SELECT id,installation_id AS "installationId",platform,permission_status AS "permissionStatus",locale,timezone,permission_updated_at AS "permissionUpdatedAt",last_seen_at AS "lastSeenAt",version FROM notification_device_consents WHERE workspace_id=$1 AND user_id=$2 ORDER BY last_seen_at DESC`, [workspaceId, userId]),
      client.query<Row>(`SELECT id,installation_id AS "installationId",platform,token_type AS "tokenType",locale,timezone,status,last_seen_at AS "lastSeenAt",version FROM device_endpoints WHERE workspace_id=$1 AND user_id=$2 ORDER BY last_seen_at DESC`, [workspaceId, userId]),
      client.query<{ count: number }>(`SELECT count(*)::int AS count FROM notifications WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 AND channel='in_app' AND read_at IS NULL`, [workspaceId, userId]),
    ]);
    const pushEnabled = preference.rows[0]?.enabled === true;
    return { pushEnabled, pushAvailable: endpoints.rows.some((row) => row.status === "active"), preference: preference.rows[0] ?? null, consents: consents.rows, devices: endpoints.rows, unreadCount: unread.rows[0]?.count ?? 0 };
  }
  private async setPushPreferenceWithClient(client: PoolClient, workspaceId: string, userId: string, enabled: boolean) {
    const result = await client.query<Row>(`INSERT INTO notification_preferences(workspace_id,recipient_type,recipient_id,event_type,channel,enabled,quiet_hours) VALUES($1,'user',$2,'*','push',$3,'{}'::jsonb) ON CONFLICT(workspace_id,recipient_type,recipient_id,event_type,channel) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now(),version=notification_preferences.version+1 RETURNING id,enabled,version`, [workspaceId, userId, enabled]);
    return result.rows[0];
  }
  private assertTimezone(timezone: string) {
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); }
    catch { throw new BadRequestException("Device timezone is invalid"); }
  }
  private async fallbackPushToInbox(client: PoolClient, workspaceId: string, row: Row, reason: string) {
    await client.query(`INSERT INTO notifications(workspace_id,recipient_type,recipient_id,channel,event_type,status,scheduled_for,subject,body,deep_link,idempotency_key,correlation_id,delivered_at,suppressed_reason)
      VALUES($1,'user',$2,'in_app',$3,'delivered',now(),$4,$5,$6,$7,$8,now(),$9)
      ON CONFLICT(workspace_id,idempotency_key) DO NOTHING`, [workspaceId, row.recipientId, row.eventType, row.subject ?? null, row.body, row.deepLink ?? null, `${row.idempotencyKey}:inbox-fallback`, row.correlationId, `push_${reason}`]);
  }
  private async revokeFailedEndpoint(client: PoolClient, workspaceId: string, userId: string, reference: string) {
    const result = await client.query<Row>(`UPDATE device_endpoints SET status='revoked',last_seen_at=now(),updated_at=now(),version=version+1 WHERE workspace_id=$1 AND user_id=$2 AND encrypted_token_reference=$3 AND status='active' RETURNING id`, [workspaceId, userId, reference]);
    if (result.rowCount) await this.deviceTokens?.delete(reference);
    return result.rowCount;
  }
  private async mobileDestination(client: PoolClient, workspaceId: string, userId: string, deepLink: string): Promise<Row | null> {
    if (!deepLink.startsWith("/workspace/")) return null;
    let url: URL;
    try { url = new URL(deepLink, "https://wodana.invalid"); } catch { return null; }
    const path = url.pathname;
    const leadId = path === "/workspace/crm/leads" ? url.searchParams.get("lead") : null;
    if (path === "/workspace/crm/leads" && await this.access.hasPermission(client, workspaceId, userId, "crm.leads.view")) {
      if (!leadId || (await client.query(`SELECT 1 FROM crm_leads WHERE workspace_id=$1 AND id=$2`, [workspaceId, leadId])).rowCount) return { module: "crm", screen: "leads", recordId: leadId };
      return null;
    }
    if ((path === "/workspace/crm/inbox" || path === "/workspace/crm/conversations") && await this.access.hasPermission(client, workspaceId, userId, "crm.communications.view")) {
      const recordId = url.searchParams.get("conversation") ?? url.searchParams.get("record");
      if (!recordId || (await client.query(`SELECT 1 FROM crm_conversations WHERE workspace_id=$1 AND id=$2`, [workspaceId, recordId])).rowCount) return { module: "crm", screen: "inbox", recordId };
      return null;
    }
    if (path === "/workspace/crm/opportunities" && await this.access.hasPermission(client, workspaceId, userId, "crm.opportunities.view")) {
      const recordId = url.searchParams.get("record");
      if (!recordId || (await client.query(`SELECT 1 FROM crm_opportunities WHERE workspace_id=$1 AND id=$2`, [workspaceId, recordId])).rowCount) return { module: "crm", screen: "deals", recordId };
      return null;
    }
    const job = /^\/workspace\/crm\/jobs\/([0-9a-f-]{36})$/i.exec(path);
    if (job) {
      const links = await client.query<{ type: string; id: string; caseId: string | null }>(`SELECT record_type AS type,record_id AS id,case_id::text AS "caseId" FROM job_identity_links WHERE workspace_id=$1 AND job_id=$2 AND status='active' ORDER BY CASE record_type WHEN 'project' THEN 0 WHEN 'case' THEN 1 WHEN 'opportunity' THEN 2 WHEN 'lead' THEN 3 ELSE 4 END`, [workspaceId, job[1]]);
      for (const link of links.rows) {
        const candidate = link.type === "project" ? `/workspace/projects/${link.id}/overview`
          : link.type === "case" ? `/workspace/pre-projects/cases/${link.id}/overview`
            : link.type === "quote" ? `/workspace/pre-projects/cases/${link.caseId}/quotations?quote=${link.id}`
              : link.type === "opportunity" ? `/workspace/crm/opportunities?record=${link.id}`
                : link.type === "lead" ? `/workspace/crm/leads?lead=${link.id}` : "";
        const resolved = candidate ? await this.mobileDestination(client, workspaceId, userId, candidate) : null;
        if (resolved) return { ...resolved, jobId: job[1] };
      }
      return null;
    }
    const project = /^\/workspace\/projects\/([0-9a-f-]{36})(?:\/([^/?]+))?$/i.exec(path);
    if (project && await this.access.hasPermission(client, workspaceId, userId, "projects.view")) {
      const canManage = await this.access.hasPermission(client, workspaceId, userId, "projects.manage");
      const visible = await client.query(`SELECT 1 FROM delivery_projects project JOIN workspace_memberships membership ON membership.workspace_id=project.workspace_id AND membership.user_id=$3 AND membership.status='active' WHERE project.workspace_id=$1 AND project.id=$2 AND ($4::boolean OR EXISTS(SELECT 1 FROM project_assignments assignment WHERE assignment.workspace_id=project.workspace_id AND assignment.project_id=project.id AND assignment.membership_id=membership.id AND assignment.active))`, [workspaceId, project[1], userId, canManage]);
      if (visible.rowCount) return { module: "projects", screen: project[2] ?? "overview", recordId: project[1], actionId: url.searchParams.get("record") };
      return null;
    }
    const preProject = /^\/workspace\/pre-projects(?:\/cases)?\/([0-9a-f-]{36})(?:\/([^/?]+))?$/i.exec(path);
    if (preProject && await this.access.hasPermission(client, workspaceId, userId, "pre_projects.view")) {
      const visible = await client.query(`SELECT 1 FROM pre_project_cases WHERE workspace_id=$1 AND id=$2 LIMIT 1`, [workspaceId, preProject[1]]);
      if (visible.rowCount) return { module: "pre-project", screen: preProject[2] ?? "overview", recordId: preProject[1], actionId: url.searchParams.get("request") ?? url.searchParams.get("quote") };
    }
    return null;
  }
  private async suppressed(client: PoolClient, input: EnqueueNotificationDto, reason: string, policyId: string | null = null) { const result = await client.query(`INSERT INTO notifications (workspace_id,policy_id,recipient_type,recipient_id,channel,event_type,status,subject,body,deep_link,idempotency_key,correlation_id,suppressed_reason) VALUES ($1,$2,$3,$4,$5,$6,'suppressed',NULL,'Suppressed',$7,$8,$9,$10) ON CONFLICT (workspace_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING id,status,suppressed_reason AS "suppressedReason",version`, [input.workspaceId,policyId,input.recipientType,input.recipientId,input.channel,input.eventType,input.deepLink??null,input.idempotencyKey,input.correlationId,reason]); return result.rows[0]; }
  private async findTemplate(client: import("pg").PoolClient, input: EnqueueNotificationDto): Promise<Row> { const result = await client.query<Row>(`SELECT template.* FROM notification_templates template JOIN workspaces workspace ON workspace.id=template.workspace_id WHERE template.workspace_id=$1 AND template.code=$2 AND template.channel=$3 AND template.status='approved' AND template.locale::text IN ($4::text,split_part($4::text,'-',1),workspace.default_locale::text,'en') ORDER BY CASE WHEN template.locale::text=$4::text THEN 0 WHEN template.locale::text=split_part($4::text,'-',1) THEN 1 WHEN template.locale=workspace.default_locale THEN 2 ELSE 3 END,template.version_number DESC LIMIT 1`, [input.workspaceId,input.templateCode,input.channel,input.locale??"en"]); if (!result.rowCount) throw new UnprocessableEntityException("No approved notification template matches the channel and locale"); return result.rows[0]; }
  /** Explicit `parameters` in the variables win; otherwise each {{n}} is filled through the inbox mapping for this client. Null when one is missing. */
  private async templateParameters(client: PoolClient, input: EnqueueNotificationDto, code: string, positions: number[]): Promise<string[] | null> {
    const explicit = Array.isArray(input.variables.parameters) ? (input.variables.parameters as unknown[]).map((value) => normalizeTemplateParameter(String(value ?? ""))) : null;
    if (explicit) return templateParametersProblem(positions, explicit) ? null : explicit;
    if (input.recipientType !== "party") return null;
    const mapping = await client.query<{ position: number; source: TemplateVariableSource }>(`SELECT position, source FROM crm_template_variables WHERE workspace_id=$1 AND channel='whatsapp' AND template_code=$2`, [input.workspaceId, code]);
    const sources = new Map(mapping.rows.map((row) => [Number(row.position), row.source]));
    if (positions.some((position) => !sources.has(position))) return null;
    const leadId = typeof input.variables.leadId === "string" && /^[0-9a-f-]{36}$/i.test(input.variables.leadId) ? input.variables.leadId : null;
    const values = await resolveTemplateSources(client, { workspaceId: input.workspaceId, partyId: input.recipientId, leadId, staffUserId: null, config: this.config }, sources.values());
    const parameters = positions.map((position) => values[sources.get(position)!] ?? "").map(normalizeTemplateParameter);
    return templateParametersProblem(positions, parameters) ? null : parameters;
  }
  private render(template: string, variables: Record<string, unknown>) { return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_all,key:string) => { const value=variables[key]; return value==null?"":String(value); }); }
  private assertTemplateVariables(subject: string, body: string, declared: string[]) { const found=[...`${subject} ${body}`.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)].map((match)=>match[1]); const missing=[...new Set(found)].filter((key)=>!declared.includes(key)); if(missing.length) throw new UnprocessableEntityException(`Undeclared template variables: ${missing.join(", ")}`); }
  private async hasConsent(client: PoolClient, input: Pick<EnqueueNotificationDto, "workspaceId" | "recipientId" | "eventType" | "channel">) { const consent=await client.query<{ status: string; expires_at: Date | null }>(`SELECT status,expires_at FROM crm_consents WHERE workspace_id=$1 AND party_id=$2 AND purpose IN ($3,'service','marketing') AND channel IN ($4,'all') ORDER BY (purpose=$3) DESC,(channel=$4) DESC,captured_at DESC LIMIT 1`,[input.workspaceId,input.recipientId,input.eventType,input.channel]); const row=consent.rows[0]; return Boolean(row?.status==="granted"&&(!row.expires_at||row.expires_at>new Date())); }
  private async findPolicy(client: PoolClient, input: EnqueueNotificationDto): Promise<Row | null> {
    const result = await client.query<Row>(`SELECT id,event_type,conditions,quiet_hours,frequency_limit FROM notification_policies WHERE workspace_id=$1 AND status='active' AND event_type IN ($2,'*') AND channels ? $3 ORDER BY event_type=$2 DESC,created_at DESC`, [input.workspaceId,input.eventType,input.channel]);
    return result.rows.find((policy) => this.policyMatches(policy.conditions, input)) ?? null;
  }
  private policyMatches(value: unknown, input: EnqueueNotificationDto) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length) return true;
    const conditions = value as Record<string, unknown>;
    if (conditions.recipientType !== undefined && conditions.recipientType !== input.recipientType) return false;
    if (conditions.locale !== undefined && conditions.locale !== (input.locale ?? "en")) return false;
    if (conditions.variableEquals && typeof conditions.variableEquals === "object" && !Array.isArray(conditions.variableEquals)) {
      for (const [key, expected] of Object.entries(conditions.variableEquals as Record<string, unknown>)) if (input.variables[key] !== expected) return false;
    }
    return true;
  }
  private async frequencyExceeded(client: PoolClient, input: EnqueueNotificationDto, policy: Row) {
    const value = policy.frequency_limit;
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length) return false;
    const frequency = value as Record<string, unknown>;
    this.validateFrequency(frequency);
    const result = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM notifications WHERE workspace_id=$1 AND policy_id=$2 AND recipient_type=$3 AND recipient_id=$4 AND channel=$5 AND status NOT IN ('suppressed','failed','cancelled') AND created_at >= now() - ($6::text || ' minutes')::interval`, [input.workspaceId,policy.id,input.recipientType,input.recipientId,input.channel,frequency.windowMinutes]);
    return result.rows[0].count >= Number(frequency.max);
  }
  private async recipientTimezone(client: PoolClient, input: EnqueueNotificationDto) {
    const result = input.recipientType === "party"
      ? await client.query<{ timezone: string | null }>(`SELECT COALESCE(party.preferred_timezone,workspace.default_timezone) AS timezone FROM crm_parties party JOIN workspaces workspace ON workspace.id=party.workspace_id WHERE party.workspace_id=$1 AND party.id=$2`, [input.workspaceId,input.recipientId])
      : input.recipientType === "user"
        ? await client.query<{ timezone: string | null }>(`SELECT COALESCE(account.preferred_timezone,workspace.default_timezone) AS timezone FROM users account CROSS JOIN workspaces workspace WHERE workspace.id=$1 AND account.id=$2`, [input.workspaceId,input.recipientId])
        : await client.query<{ timezone: string | null }>(`SELECT default_timezone AS timezone FROM workspaces WHERE id=$1`, [input.workspaceId]);
    return result.rows[0]?.timezone ?? "UTC";
  }
  private afterQuietHours(value: Date, quietHours: Record<string, unknown>, fallbackTimezone: string) {
    if (!Object.keys(quietHours).length) return value;
    this.validateQuietHours(quietHours);
    const timezone = typeof quietHours.timezone === "string" ? quietHours.timezone : fallbackTimezone;
    let candidate = new Date(value);
    for (let minute = 0; minute <= 1_500; minute += 1) {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(candidate);
      const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
      const localMinute = hour * 60 + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
      const [startHour, startMinute] = String(quietHours.start).split(":").map(Number);
      const [endHour, endMinute] = String(quietHours.end).split(":").map(Number);
      const start = startHour * 60 + startMinute;
      const end = endHour * 60 + endMinute;
      const inside = start < end ? localMinute >= start && localMinute < end : localMinute >= start || localMinute < end;
      if (!inside) return candidate;
      candidate = new Date(candidate.getTime() + 60_000);
    }
    throw new UnprocessableEntityException("Quiet hours do not contain a deliverable window");
  }
  private validateQuietHours(value: Record<string, unknown>) { if(!Object.keys(value).length)return; const pattern=/^(?:[01]\d|2[0-3]):[0-5]\d$/; if(typeof value.start!=="string"||typeof value.end!=="string"||!pattern.test(value.start)||!pattern.test(value.end)||value.start===value.end) throw new UnprocessableEntityException("Quiet hours require different 24-hour start and end values"); if(value.timezone!==undefined){ try { new Intl.DateTimeFormat("en",{timeZone:String(value.timezone)}).format(); } catch { throw new UnprocessableEntityException("Quiet hours timezone is invalid"); } } }
  private validateFrequency(value: Record<string, unknown>) { if(!Object.keys(value).length)return; if(!Number.isInteger(value.max)||Number(value.max)<1||Number(value.max)>1000||!Number.isInteger(value.windowMinutes)||Number(value.windowMinutes)<1) throw new UnprocessableEntityException("Frequency limit requires positive max and windowMinutes"); }
  private retryDelay(attempt: number) { return Math.min(86_400_000, 30_000 * 2 ** Math.max(0,attempt-1)) + Math.floor(Math.random()*5_000); }
  private async destination(client: PoolClient, workspaceId: string, row: Row) {
    if(row.recipientType==="integration" && row.channel==="webhook") { const result=await client.query(`SELECT configuration->>'webhookUrl' AS "webhookUrl" FROM integration_connections WHERE workspace_id=$1 AND id=$2 AND status='active'`,[workspaceId,row.recipientId]); return result.rows[0]?.webhookUrl ? result.rows[0] : null; }
    if(row.recipientType==="user" && row.channel==="push") { const result=await client.query(`SELECT encrypted_token_reference AS "tokenReference",platform FROM device_endpoints WHERE workspace_id=$1 AND user_id=$2 AND status='active' ORDER BY last_seen_at DESC LIMIT 1`,[workspaceId,row.recipientId]); return result.rows[0]??null; }
    if(row.recipientType==="user"){ const result=await client.query(`SELECT primary_email AS email FROM users WHERE id=$1`,[row.recipientId]); return result.rows[0]?.email ? result.rows[0] : null; }
    const result=await client.query(`SELECT raw_value AS value,normalized_value AS "normalizedValue",type FROM crm_contact_points WHERE workspace_id=$1 AND party_id=$2 AND status='active' AND is_primary AND (($3='email' AND type='email') OR ($3 IN ('whatsapp','push') AND type='phone')) ORDER BY verified_at DESC NULLS LAST LIMIT 1`,[workspaceId,row.recipientId,row.channel]); return result.rows[0]??null;
  }
}
