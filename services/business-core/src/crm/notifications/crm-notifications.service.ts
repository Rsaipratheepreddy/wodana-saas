import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { PoolClient } from "pg";
import { DatabaseService } from "../../database/database.service";
import { RequestActor } from "../../auth/actor";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { ApproveTemplateDto, ClaimNotificationJobsDto, CreateNotificationPolicyDto, CreateNotificationTemplateDto, EnqueueNotificationDto, NotificationPolicyStatusDto, NotificationResultDto, UpsertPreferenceDto } from "./dto/notifications.dto";
import { CrmMessageReceiptService } from "../conversations/crm-message-receipt.service";
const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
type Row = Record<string, unknown>;
@Injectable()
export class CrmNotificationsService {
  constructor(private readonly database: DatabaseService, private readonly access: WorkspaceAccessService, private readonly events: CrmEventsService, private readonly receipts: CrmMessageReceiptService = new CrmMessageReceiptService()) {}
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
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client, actorUser) => {
      if (input.recipientType === "user" && input.recipientId !== actorUser.userId) {
        const admin = await client.query(`SELECT 1 FROM workspace_memberships membership JOIN member_roles assigned ON assigned.membership_id=membership.id JOIN roles role ON role.id=assigned.role_id WHERE membership.workspace_id=$1 AND membership.user_id=$2 AND role.code IN ('owner','administrator')`, [workspaceId, actorUser.userId]);
        if (!admin.rowCount) throw new UnprocessableEntityException("Only administrators may change another user's preference");
      }
      this.validateQuietHours(input.quietHours ?? {});
      const result = await client.query(`INSERT INTO notification_preferences (workspace_id,recipient_type,recipient_id,event_type,channel,enabled,quiet_hours) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (workspace_id,recipient_type,recipient_id,event_type,channel) DO UPDATE SET enabled=EXCLUDED.enabled,quiet_hours=EXCLUDED.quiet_hours,version=notification_preferences.version+1 RETURNING id,recipient_type AS "recipientType",recipient_id AS "recipientId",event_type AS "eventType",channel,enabled,quiet_hours AS "quietHours",version`, [workspaceId, input.recipientType, input.recipientId, input.eventType, input.channel, input.enabled, input.quietHours ?? {}]);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "notification.preference.changed.v1", entityType: "notification_preference", entityId: String(result.rows[0].id), after: result.rows[0] as Row });
      return result.rows[0];
    });
  }
  inbox(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.notifications.view", async (client, actorUser) => {
      const result = await client.query(`SELECT id,status,subject,body,deep_link AS "deepLink",delivered_at AS "deliveredAt",read_at AS "readAt",created_at AS "createdAt",version FROM notifications WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 AND channel='in_app' ORDER BY created_at DESC LIMIT 200`, [workspaceId, actorUser.userId]);
      return result.rows;
    });
  }
  read(actor: RequestActor, workspaceId: string, notificationId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.notifications.view", async (client, actorUser) => {
      const result = await client.query(`UPDATE notifications SET read_at=COALESCE(read_at,now()),version=version+1 WHERE workspace_id=$1 AND id=$2 AND recipient_type='user' AND recipient_id=$3 RETURNING id,read_at AS "readAt",version`, [workspaceId, notificationId, actorUser.userId]);
      if (!result.rowCount) throw new NotFoundException("Notification not found"); return result.rows[0];
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
    const subject = template.subject_template ? this.render(String(template.subject_template), input.variables) : null;
    const body = this.render(String(template.body_template), input.variables);
    let scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : new Date();
    if (Number.isNaN(scheduledFor.getTime())) throw new BadRequestException("scheduledFor is invalid");
    const timezone = await this.recipientTimezone(client, input);
    for (const quietHours of [policy?.quiet_hours, preference.rows[0]?.quiet_hours]) {
      if (quietHours && typeof quietHours === "object") scheduledFor = this.afterQuietHours(scheduledFor, quietHours as Record<string, unknown>, timezone);
    }
    try {
      const result = await client.query(`INSERT INTO notifications (workspace_id,policy_id,template_id,recipient_type,recipient_id,channel,event_type,status,scheduled_for,subject,body,deep_link,idempotency_key,correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id,status,scheduled_for AS "scheduledFor",subject,body,deep_link AS "deepLink",version`, [input.workspaceId, policy?.id ?? null, template.id, input.recipientType, input.recipientId, input.channel, input.eventType, input.channel === "in_app" ? "delivered" : scheduledFor > new Date() ? "scheduled" : "pending", scheduledFor, subject, body, input.deepLink ?? null, input.idempotencyKey, input.correlationId]);
      const response = result.rows[0] as Row;
      if (input.channel === "in_app") await client.query(`UPDATE notifications SET delivered_at=now() WHERE id=$1`, [response.id]);
      if (input.channel !== "in_app") await this.events.record(client, { workspaceId: input.workspaceId, actorUserId: null, source: "automation", action: "notification.delivery_requested.v1", entityType: "notification", entityId: String(response.id), correlationId: input.correlationId, after: { ...response, channel: input.channel } });
      return response;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") { const prior = await client.query(`SELECT id,status,scheduled_for AS "scheduledFor",subject,body,deep_link AS "deepLink",version FROM notifications WHERE workspace_id=$1 AND idempotency_key=$2`, [input.workspaceId, input.idempotencyKey]); return { ...prior.rows[0], idempotentReplay: true }; }
      throw error;
    }
  }
  claimInternal(input: ClaimNotificationJobsDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const result = await client.query(`WITH due AS (
        SELECT notification.id,
          (SELECT COALESCE(max(attempt.attempt),0)::int + 1 FROM notification_delivery_attempts attempt WHERE attempt.workspace_id=notification.workspace_id AND attempt.notification_id=notification.id) AS attempt
        FROM notifications notification
        WHERE notification.workspace_id=$1
          AND notification.channel<>'in_app'
          AND ((notification.status IN ('pending','scheduled') AND notification.scheduled_for<=now())
            OR (notification.status='processing' AND notification.processing_started_at<now()-interval '5 minutes'))
        ORDER BY notification.scheduled_for
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      )
      UPDATE notifications notification
      SET status='processing',processing_started_at=now(),version=version+1
      FROM due WHERE notification.id=due.id
      RETURNING notification.id,notification.recipient_type AS "recipientType",notification.recipient_id AS "recipientId",notification.channel,notification.event_type AS "eventType",notification.subject,notification.body,notification.deep_link AS "deepLink",notification.correlation_id AS "correlationId",notification.idempotency_key AS "idempotencyKey",notification.template_id AS "templateId",notification.version,due.attempt`, [input.workspaceId, Math.min(input.limit ?? 50, 100)]);
      const items: Row[] = [];
      for (const row of result.rows as Row[]) {
        const currentInput = { workspaceId: input.workspaceId, recipientType: String(row.recipientType), recipientId: String(row.recipientId), channel: String(row.channel), eventType: String(row.eventType) };
        const preference = await client.query<{ enabled: boolean }>(`SELECT enabled FROM notification_preferences WHERE workspace_id=$1 AND recipient_type=$2 AND recipient_id=$3 AND event_type::text IN ($4::text,'*') AND channel=$5 ORDER BY event_type::text=$4::text DESC LIMIT 1`, [currentInput.workspaceId, currentInput.recipientType, currentInput.recipientId, currentInput.eventType, currentInput.channel]);
        const consentValid = currentInput.recipientType !== "party" || ["in_app", "webhook"].includes(currentInput.channel) || await this.hasConsent(client, currentInput);
        const destination = await this.destination(client, input.workspaceId, row);
        const reason = preference.rows[0]?.enabled === false ? "recipient_preference" : !consentValid ? "consent_withdrawn" : !destination ? "destination_missing" : null;
        if (reason) {
          await client.query(`UPDATE notifications SET status='suppressed',suppressed_reason=$1,processing_started_at=NULL,version=version+1 WHERE workspace_id=$2 AND id=$3`, [reason, input.workspaceId, row.id]);
          continue;
        }
        const template = row.templateId ? await client.query(`SELECT code,locale FROM notification_templates WHERE workspace_id=$1 AND id=$2`, [input.workspaceId, row.templateId]) : { rows: [] };
        items.push({ ...row, workspaceId: input.workspaceId, destination, templateCode: template.rows[0]?.code ?? null, locale: template.rows[0]?.locale ?? null });
      }
      return { items };
    });
  }
  resultInternal(notificationId: string, input: NotificationResultDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const notification = await client.query<Row>(`SELECT * FROM notifications WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [input.workspaceId, notificationId]);
      if (!notification.rowCount) throw new NotFoundException("Notification not found");
      const prior = await client.query(`SELECT status FROM notification_delivery_attempts WHERE workspace_id=$1 AND notification_id=$2 AND attempt=$3`, [input.workspaceId, notificationId, input.attempt]);
      if (prior.rowCount) return { id: notificationId, status: notification.rows[0].status, idempotentReplay: true };
      const retryAt = input.result === "retry" && input.attempt < 8 ? new Date(Date.now() + this.retryDelay(input.attempt)) : null;
      const finalStatus = input.result === "delivered" ? "delivered" : retryAt ? "scheduled" : "failed";
      await client.query(`INSERT INTO notification_delivery_attempts (workspace_id,notification_id,attempt,provider,status,provider_message_id,error_code,error_message,retry_at,completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`, [input.workspaceId, notificationId, input.attempt, input.provider, input.result, input.providerMessageId ?? null, input.errorCode ?? null, input.errorMessage ?? null, retryAt]);
      const result = await client.query(`UPDATE notifications SET status=$1::notification_status,scheduled_for=COALESCE($2,scheduled_for),processing_started_at=NULL,delivered_at=CASE WHEN $1='delivered' THEN now() ELSE delivered_at END,version=version+1 WHERE workspace_id=$3 AND id=$4 RETURNING id,status,scheduled_for AS "scheduledFor",delivered_at AS "deliveredAt",version`, [finalStatus, retryAt, input.workspaceId, notificationId]);
      const key = String(notification.rows[0].idempotency_key ?? "");
      const messageId = /^message:([0-9a-f-]{36})$/i.exec(key)?.[1];
      if (messageId && (finalStatus === "delivered" || finalStatus === "failed")) {
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
  private async suppressed(client: PoolClient, input: EnqueueNotificationDto, reason: string, policyId: string | null = null) { const result = await client.query(`INSERT INTO notifications (workspace_id,policy_id,recipient_type,recipient_id,channel,event_type,status,subject,body,deep_link,idempotency_key,correlation_id,suppressed_reason) VALUES ($1,$2,$3,$4,$5,$6,'suppressed',NULL,'Suppressed',$7,$8,$9,$10) ON CONFLICT (workspace_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING id,status,suppressed_reason AS "suppressedReason",version`, [input.workspaceId,policyId,input.recipientType,input.recipientId,input.channel,input.eventType,input.deepLink??null,input.idempotencyKey,input.correlationId,reason]); return result.rows[0]; }
  private async findTemplate(client: import("pg").PoolClient, input: EnqueueNotificationDto): Promise<Row> { const result = await client.query<Row>(`SELECT template.* FROM notification_templates template JOIN workspaces workspace ON workspace.id=template.workspace_id WHERE template.workspace_id=$1 AND template.code=$2 AND template.channel=$3 AND template.status='approved' AND template.locale::text IN ($4::text,split_part($4::text,'-',1),workspace.default_locale::text,'en') ORDER BY CASE WHEN template.locale::text=$4::text THEN 0 WHEN template.locale::text=split_part($4::text,'-',1) THEN 1 WHEN template.locale=workspace.default_locale THEN 2 ELSE 3 END,template.version_number DESC LIMIT 1`, [input.workspaceId,input.templateCode,input.channel,input.locale??"en"]); if (!result.rowCount) throw new UnprocessableEntityException("No approved notification template matches the channel and locale"); return result.rows[0]; }
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
