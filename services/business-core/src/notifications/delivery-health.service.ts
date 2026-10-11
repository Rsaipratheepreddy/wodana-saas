import { ConflictException, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { fetchWorkerBeat, type WorkerBeat } from "../health/worker-heartbeat";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { wakeDelivery } from "./default-templates";
import { deliveryAllowlist } from "./delivery-allowlist";
import { readDeliveryMessages, type DeliveryMessagesQuery } from "./delivery-messages";

export const DELIVERY_CHANNELS = ["email", "whatsapp", "push"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
/** Suppressions that mean "couldn't deliver", not a person's choice (a preference, consent or frequency cap). */
export const UNDELIVERED_REASONS = ["destination_missing", "email_not_configured", "not_allowlisted"];
/** The owner is warned when the worker is silent this long, or this many notices wait. */
export const ATTENTION_SILENT_SECONDS = 120;
export const ATTENTION_WAITING = 20;
/** Who sees delivery health: the people who run the workspace's settings and connections. */
export const DELIVERY_HEALTH_PERMISSIONS = ["workspace.settings.manage", "integrations.manage"];

type Row = Record<string, unknown>;
export type ChannelHealth = {
  channel: DeliveryChannel;
  configured: boolean;
  /** email: team email (platform mailer) and client email (Google Workspace); whatsapp: connection status; push: phones. */
  teamEmail?: boolean;
  clientEmail?: boolean;
  connection?: string | null;
  devices?: number;
  lastSuccessAt: string | null;
  lastFailure: { at: string; code: string; message: string | null } | null;
  /** Raised in the last 24 hours and still waiting to go out, and not delivered in the last 24 hours. */
  queued24h: number;
  failed24h: number;
  /** Everything due and not yet sent, of any age, and since when. */
  waiting: number;
  oldestWaitingAt: string | null;
};
export type DeliveryHealth = {
  generatedAt: string;
  worker: { status: WorkerBeat["status"] | "unknown"; lastSeenAt: string | null; delivery: string | null };
  /** A local or UAT guard is on: only listed recipients receive anything. */
  allowlist: boolean;
  channels: ChannelHealth[];
  attention: { reason: "worker" | "backlog" | null; since: string | null };
};

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : typeof value === "string" && value ? new Date(value).toISOString() : null);

/** Workspace delivery health from the notifications and their delivery attempts (FD-2). */
@Injectable()
export class DeliveryHealthService {
  private readonly logger = new Logger(DeliveryHealthService.name);
  /** The worker heartbeat (replaced in tests). */
  workerBeat: () => Promise<WorkerBeat | null> = () => fetchWorkerBeat(this.config.get<string>("REDIS_URL"));

  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly config: ConfigService,
    @Optional() private readonly mailer?: TransactionalEmailService,
  ) {}

  async health(actor: RequestActor, workspaceId: string): Promise<DeliveryHealth> {
    const beat = await this.workerBeat().catch((error: unknown) => {
      this.logger.warn(`Worker heartbeat unavailable: ${error instanceof Error ? error.message : "unknown"}`);
      return undefined;
    });
    return this.access.withAnyPermission(actor, workspaceId, DELIVERY_HEALTH_PERMISSIONS, (client) => this.read(client, workspaceId, beat));
  }

  async read(client: Pick<PoolClient, "query">, workspaceId: string, beat: WorkerBeat | null | undefined): Promise<DeliveryHealth> {
    const channels = [...DELIVERY_CHANNELS];
    const [stats, attempts, suppressed, connections, devices] = await Promise.all([
      client.query<Row>(
        `SELECT channel,
           count(*) FILTER (WHERE status IN ('pending','scheduled','processing') AND scheduled_for<=now() AND created_at>=now()-interval '24 hours')::int AS "queued24h",
           count(*) FILTER (WHERE (status='failed' OR (status='suppressed' AND suppressed_reason=ANY($3))) AND updated_at>=now()-interval '24 hours')::int AS "failed24h",
           count(*) FILTER (WHERE status IN ('pending','scheduled','processing') AND scheduled_for<=now())::int AS waiting,
           min(scheduled_for) FILTER (WHERE status IN ('pending','scheduled','processing') AND scheduled_for<=now()) AS "oldestWaitingAt",
           max(delivered_at) AS "lastSuccessAt"
         FROM notifications
         WHERE workspace_id=$1 AND channel=ANY($2) AND created_at>=now()-interval '30 days'
         GROUP BY channel`,
        [workspaceId, channels, UNDELIVERED_REASONS]),
      client.query<Row>(
        `SELECT DISTINCT ON (notification.channel) notification.channel, COALESCE(attempt.completed_at,attempt.started_at) AS at,
           attempt.error_code AS code, attempt.error_message AS message
         FROM notification_delivery_attempts attempt
         JOIN notifications notification ON notification.workspace_id=attempt.workspace_id AND notification.id=attempt.notification_id
         WHERE attempt.workspace_id=$1 AND attempt.status IN ('retry','permanent_failure') AND attempt.started_at>=now()-interval '30 days'
           -- A retry that will be tried again (a throttled email) isn't a failure; the last one of a failed notice is.
           AND (attempt.status='permanent_failure' OR notification.status='failed')
           AND notification.channel=ANY($2)
         ORDER BY notification.channel, COALESCE(attempt.completed_at,attempt.started_at) DESC`,
        [workspaceId, channels]),
      client.query<Row>(
        `SELECT DISTINCT ON (channel) channel, updated_at AS at, suppressed_reason AS code
         FROM notifications
         WHERE workspace_id=$1 AND channel=ANY($2) AND created_at>=now()-interval '30 days'
           AND status IN ('failed','suppressed') AND suppressed_reason=ANY($3)
         ORDER BY channel, updated_at DESC`,
        [workspaceId, channels, UNDELIVERED_REASONS]),
      client.query<Row>(
        `SELECT provider, status, configuration FROM integration_connections
         WHERE workspace_id=$1 AND provider IN ('google_workspace','whatsapp') ORDER BY updated_at DESC`,
        [workspaceId]),
      client.query<{ count: number }>(`SELECT count(*)::int AS count FROM device_endpoints WHERE workspace_id=$1 AND status='active'`, [workspaceId]),
    ]);

    const google = connections.rows.find((row) => row.provider === "google_workspace" && ["connected", "degraded"].includes(String(row.status)));
    const whatsapp = connections.rows.find((row) => row.provider === "whatsapp");
    const teamEmail = this.mailer?.configured() ?? false;
    const clientEmail = Boolean(google && (google.configuration as Row | null)?.gmailSend === true);
    const phoneCount = Number(devices.rows[0]?.count ?? 0);
    const result: ChannelHealth[] = channels.map((channel) => {
      const stat = stats.rows.find((row) => row.channel === channel);
      const failures = [attempts.rows.find((row) => row.channel === channel), suppressed.rows.find((row) => row.channel === channel)]
        .filter((row): row is Row => Boolean(row?.at))
        .sort((a, b) => Date.parse(String(iso(b.at))) - Date.parse(String(iso(a.at))));
      const failure = failures[0];
      const base = {
        channel,
        lastSuccessAt: iso(stat?.lastSuccessAt),
        lastFailure: failure ? { at: iso(failure.at)!, code: String(failure.code ?? "DELIVERY_FAILED"), message: typeof failure.message === "string" ? failure.message.slice(0, 300) : null } : null,
        queued24h: Number(stat?.queued24h ?? 0),
        failed24h: Number(stat?.failed24h ?? 0),
        waiting: Number(stat?.waiting ?? 0),
        oldestWaitingAt: iso(stat?.oldestWaitingAt),
      };
      if (channel === "email") return { ...base, configured: teamEmail, teamEmail, clientEmail };
      if (channel === "whatsapp") return { ...base, configured: whatsapp?.status === "connected", connection: whatsapp ? String(whatsapp.status) : null };
      return { ...base, configured: phoneCount > 0, devices: phoneCount };
    });

    const worker: DeliveryHealth["worker"] = beat
      ? { status: beat.status, lastSeenAt: beat.at, delivery: beat.adapter }
      : { status: "unknown", lastSeenAt: null, delivery: null };
    const silent = beat ? beat.status === "not-reporting" || (beat.ageSeconds ?? Number.POSITIVE_INFINITY) > ATTENTION_SILENT_SECONDS : false;
    const waiting = result.reduce((sum, channel) => sum + channel.waiting, 0);
    const oldest = result.map((channel) => channel.oldestWaitingAt).filter((value): value is string => Boolean(value)).sort()[0] ?? null;
    const attention: DeliveryHealth["attention"] = silent
      ? { reason: "worker", since: beat?.at ?? oldest }
      : waiting > ATTENTION_WAITING ? { reason: "backlog", since: oldest } : { reason: null, since: null };
    return {
      generatedAt: new Date().toISOString(),
      worker,
      allowlist: deliveryAllowlist(this.config).enabled,
      channels: result,
      attention,
    };
  }

  /** The per-message list (status, reason, attempts, provider id, critical, reminder step, fallback), newest change first. */
  messages(actor: RequestActor, workspaceId: string, query: DeliveryMessagesQuery) {
    return this.access.withAnyPermission(actor, workspaceId, DELIVERY_HEALTH_PERMISSIONS, (client) => readDeliveryMessages(client, workspaceId, query));
  }

  /**
   * "Send me a test": one email, and a push when this person has a phone registered, to the person
   * asking, through the same queue as every notice. At most one test a minute; a repeated request id
   * returns the first answer.
   */
  sendTest(actor: RequestActor, workspaceId: string, input: { requestId: string }) {
    return this.access.withAnyPermission(actor, workspaceId, DELIVERY_HEALTH_PERMISSIONS, async (client, user) => {
      const keyPrefix = `delivery.test:${input.requestId}:`;
      const replay = await client.query<{ channel: string }>(
        `SELECT channel FROM notifications WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 AND idempotency_key LIKE $3`,
        [workspaceId, user.userId, `${keyPrefix}%`]);
      if (replay.rowCount) return { email: "queued", push: replay.rows.some((row) => row.channel === "push") ? "queued" : "no_device", idempotentReplay: true };
      const recent = await client.query(
        `SELECT 1 FROM notifications WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 AND event_type='delivery.test' AND created_at>now()-interval '1 minute' LIMIT 1`,
        [workspaceId, user.userId]);
      if (recent.rowCount) throw new ConflictException("A test was sent a moment ago. Try again in a minute.");
      const workspace = await client.query<{ name: string }>(`SELECT name FROM workspaces WHERE id=$1`, [workspaceId]);
      const name = workspace.rows[0]?.name ?? "your workspace";
      const device = await client.query(`SELECT 1 FROM device_endpoints WHERE workspace_id=$1 AND user_id=$2 AND status='active' LIMIT 1`, [workspaceId, user.userId]);
      const channels = device.rowCount ? ["email", "push"] : ["email"];
      for (const channel of channels) {
        const inserted = await client.query<{ id: string; correlationId: string }>(
          `INSERT INTO notifications (workspace_id, recipient_type, recipient_id, channel, event_type, status, scheduled_for, subject, body, deep_link, idempotency_key, correlation_id)
           VALUES ($1,'user',$2,$3,'delivery.test','pending',now(),$4,$5,'/workspace/settings/delivery',$6,gen_random_uuid())
           RETURNING id, correlation_id AS "correlationId"`,
          [workspaceId, user.userId, channel, `Test message from ${name}`,
            channel === "email" ? `This is a test from ${name}. If you can read it, email reaches your team.` : "If you can see this, notifications reach this phone.",
            `${keyPrefix}${channel}`]);
        await wakeDelivery(client, workspaceId, inserted.rows[0].id, inserted.rows[0].correlationId, channel);
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "notification.delivery_test.sent", entityType: "workspace", entityId: workspaceId, after: { channels } });
      return { email: "queued", push: device.rowCount ? "queued" : "no_device" };
    });
  }
}
