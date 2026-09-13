import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createClient } from "redis";
import { Public } from "../auth/public.decorator";
import { DatabaseService } from "../database/database.service";
import { LivenessResponseDto, ReadinessResponseDto } from "../common/system-response.dto";

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
      timestamp: new Date().toISOString(),
    };
    if (criticalFailures.length) {
      throw new ServiceUnavailableException({ ...payload, criticalFailures });
    }
    return payload;
  }
}
