import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createClient } from "redis";
import { Public } from "../auth/public.decorator";
import { DatabaseService } from "../database/database.service";
import { LivenessResponseDto, ReadinessResponseDto } from "../common/system-response.dto";

/** Written by the Python worker every loop (wodana_intelligence/worker/runtime.py, CrmWorker.heartbeat_key). */
export const WORKER_HEARTBEAT_KEY = "wodana:worker:heartbeat";
/** The worker loops every few seconds; two minutes without a beat means it has stopped. */
export const WORKER_STALE_SECONDS = 120;

/** "ok", "stale (Ns)" or "not-reporting" (no beat within its one-day expiry: never started, or long gone). */
export function workerHeartbeat(raw: string | null, now = Date.now()) {
  if (!raw) return "not-reporting";
  let at = Number.NaN;
  try { at = Date.parse(String((JSON.parse(raw) as { at?: unknown }).at)); } catch { /* unreadable counts as stale */ }
  const age = Number.isFinite(at) ? Math.max(0, Math.round((now - at) / 1000)) : Number.POSITIVE_INFINITY;
  return age <= WORKER_STALE_SECONDS ? "ok" : `stale (${Number.isFinite(age) ? `${age}s` : "unreadable"})`;
}

@ApiTags("health")
@Controller("health")
@Public()
export class HealthController {
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
    if (redisUrl) {
      const redis = createClient({ url: redisUrl, socket: { connectTimeout: 2_000, reconnectStrategy: false } });
      redis.on("error", () => undefined);
      try {
        await redis.connect();
        await redis.ping();
        checks.redis = "ok";
        checks.worker = workerHeartbeat(await redis.get(WORKER_HEARTBEAT_KEY).catch(() => null));
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
    // The Python worker delivers email, WhatsApp and push and runs every timer. It never makes the API
    // unready, but a stale or silent worker is reported as degraded (in production, silence counts too).
    const production = this.config.get<string>("NODE_ENV") === "production";
    checks.worker ??= "not-configured";
    if (checks.worker.startsWith("stale") || (production && checks.worker === "not-reporting")) degraded.push("worker");

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
