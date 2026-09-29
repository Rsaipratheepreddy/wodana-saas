import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createClient } from "redis";
import { Public } from "../auth/public.decorator";
import { DatabaseService } from "../database/database.service";
import { LivenessResponseDto, ReadinessResponseDto } from "../common/system-response.dto";
import { readWorkerBeat, WORKER_HEARTBEAT_KEY, WORKER_STARTUP_GRACE_SECONDS, type WorkerBeat } from "./worker-heartbeat";

export { WORKER_HEARTBEAT_KEY, WORKER_STALE_SECONDS, workerHeartbeat } from "./worker-heartbeat";

@ApiTags("health")
@Controller("health")
@Public()
export class HealthController {
  /** Seconds since this process started (replaced in tests). */
  uptimeSeconds: () => number = () => process.uptime();

  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  @Get("live")
  @ApiOperation({ summary: "Process liveness probe" })
  @ApiOkResponse({ type: LivenessResponseDto })
  live() {
    return { status: "ok", service: "business-core" };
  }

  @Get("ready")
  @ApiOperation({ summary: "Service readiness probe" })
  @ApiOkResponse({ type: ReadinessResponseDto })
  async ready() {
    const checks: Record<string, string> = {};
    const criticalFailures: string[] = [];
    const degraded: string[] = [];
    try {
      await this.database.query("SELECT 1");
      checks.postgres = "ok";
    } catch {
      checks.postgres = "unavailable";
      criticalFailures.push("postgres");
    }

    if (checks.postgres === "ok") {
      try {
        const outbox = await this.database.query<{ pending: string; oldestSeconds: string | null }>(
          `SELECT count(*) FILTER (WHERE status = 'pending' AND available_at <= now())::text AS pending,
                  extract(epoch FROM now() - min(created_at) FILTER (WHERE status = 'pending' AND available_at <= now()))::text AS "oldestSeconds"
           FROM outbox_events`,
        );
        const pending = Number(outbox.rows[0]?.pending ?? 0);
        const oldestSeconds = Number(outbox.rows[0]?.oldestSeconds ?? 0);
        checks.outbox = pending ? `${pending} pending` : "ok";
        checks.outboxWorker = oldestSeconds > 300 ? `stale (${Math.round(oldestSeconds)}s)` : "ok";
        if (oldestSeconds > 300) criticalFailures.push("outboxWorker");

        // Integration rows are FORCE-RLS tenant data. Their health is exposed in each
        // authenticated workspace summary instead of bypassing tenant isolation here.
        checks.providerConnections = "tenant-scoped";
      } catch {
        checks.outbox = "unavailable";
        checks.outboxWorker = "unknown";
        checks.providerConnections = "unknown";
        criticalFailures.push("outbox");
      }
    }

    const redisUrl = this.config.get<string>("REDIS_URL");
    let beat: WorkerBeat | null = null;
    if (redisUrl) {
      const redis = createClient({ url: redisUrl, socket: { connectTimeout: 2_000, reconnectStrategy: false } });
      redis.on("error", () => undefined);
      try {
        await redis.connect();
        await redis.ping();
        checks.redis = "ok";
        beat = readWorkerBeat(await redis.get(WORKER_HEARTBEAT_KEY).catch(() => null));
        await redis.quit();
      } catch {
        checks.redis = "unavailable";
        criticalFailures.push("redis");
        if (redis.isOpen) redis.destroy();
      }
    } else {
      checks.redis = "not-configured";
      if (this.config.get<string>("NODE_ENV") === "production") criticalFailures.push("redis");
    }
    // The Python worker delivers email, WhatsApp and push and runs every timer, SLA and reminder. In
    // production nothing reaches anyone without it, so a stale or silent worker makes the service not
    // ready (a deploy that leaves no live worker fails its readiness step). A freshly started core waits
    // out a short grace first, so the worker that starts after it can report. Elsewhere it's degraded only.
    const production = this.config.get<string>("NODE_ENV") === "production";
    checks.worker = beat?.label ?? "not-configured";
    if (beat?.release) checks.workerRelease = beat.release;
    if (beat?.adapter) checks.workerDelivery = beat.adapter;
    const workerSilent = beat?.status !== "ok";
    if (production && workerSilent) {
      if (this.uptimeSeconds() < WORKER_STARTUP_GRACE_SECONDS) degraded.push("worker");
      else criticalFailures.push("worker");
    } else if (workerSilent && checks.worker.startsWith("stale")) {
      degraded.push("worker");
    }
    // A production worker that doesn't deliver live sends nothing (the worker refuses to start that way).
    if (production && beat?.status === "ok" && beat.adapter && beat.adapter !== "live") criticalFailures.push("workerDelivery");

    const intelligenceUrl = this.config.get<string>("INTELLIGENCE_API_URL");
    if (intelligenceUrl) {
      try {
        const response = await fetch(`${intelligenceUrl.replace(/\/$/, "")}/health/live`, {
          signal: AbortSignal.timeout(2_500),
        });
        if (!response.ok) throw new Error("not ready");
        checks.intelligenceApi = "ok";
      } catch {
        checks.intelligenceApi = "unavailable";
        criticalFailures.push("intelligenceApi");
      }
    } else {
      checks.intelligenceApi = "not-configured";
      if (this.config.get<string>("NODE_ENV") === "production") criticalFailures.push("intelligenceApi");
    }

    const payload = {
      status: criticalFailures.length ? "not-ready" : "ready",
      service: "business-core",
      releaseId: this.config.get<string>("WODANA_RELEASE_ID") ?? "local-development",
      checks,
      ...(degraded.length ? { degraded } : {}),
      timestamp: new Date().toISOString(),
    };
    if (criticalFailures.length) {
      throw new ServiceUnavailableException({ ...payload, criticalFailures });
    }
    return payload;
  }
}
