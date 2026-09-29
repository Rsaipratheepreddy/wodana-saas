import { HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, type RedisClientType } from "redis";

/** Model calls per workspace per minute, for each feature. Shared by every API instance through Redis. */
export const AI_FEATURE_LIMITS: Record<string, number> = {
  "crm.chat": 12,
  "crm.assist": 8,
  "commercial.assist": 10,
  "quotation.plan": 5,
  // Woddy's tool runs (W-1): one run counts once, however many turns it takes.
  "woddy.agent": 10,
};
const DEFAULT_LIMIT = 10;

export class AiRateLimitedError extends HttpException {
  constructor() { super({ message: "Please wait a minute before asking again.", code: "AI_RATE_LIMITED" }, HttpStatus.TOO_MANY_REQUESTS); }
}

/**
 * A fixed one-minute window per workspace and feature in Redis (every API instance shares it). Without
 * Redis (local runs, tests) the window is kept in this process.
 */
@Injectable()
export class AiRateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(AiRateLimitService.name);
  private client: RedisClientType | null = null;
  private connecting: Promise<RedisClientType | null> | null = null;
  private readonly local = new Map<string, number>();

  constructor(@Optional() private readonly config?: ConfigService) {}

  async take(workspaceId: string, feature: string, now = Date.now()) {
    const limit = AI_FEATURE_LIMITS[feature] ?? DEFAULT_LIMIT;
    const key = `wodana:ai-rate:${workspaceId}:${feature}:${Math.floor(now / 60_000)}`;
    const redis = await this.redis();
    let count: number;
    if (redis) {
      count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 90);
    } else {
      for (const existing of this.local.keys()) if (!existing.endsWith(`:${Math.floor(now / 60_000)}`)) this.local.delete(existing);
      count = (this.local.get(key) ?? 0) + 1;
      this.local.set(key, count);
    }
    if (count > limit) throw new AiRateLimitedError();
  }

  /**
   * One more hit on a shared counter that lives `windowSeconds` (e.g. an AI app's calls this minute), or null
   * when Redis is not there: the caller then counts another way (in the database, or in this process).
   */
  async hit(key: string, windowSeconds: number): Promise<number | null> {
    const redis = await this.redis();
    if (!redis) return null;
    const count = await redis.incr(`wodana:${key}`);
    if (count === 1) await redis.expire(`wodana:${key}`, windowSeconds + 30);
    return count;
  }

  async onModuleDestroy() {
    if (this.client?.isOpen) await this.client.quit().catch(() => this.client?.destroy());
    this.client = null;
  }

  private async redis(): Promise<RedisClientType | null> {
    if (this.client?.isOpen) return this.client;
    if (this.connecting) return this.connecting;
    const url = this.config?.get<string>("REDIS_URL");
    if (!url) return null;
    const client = createClient({ url, socket: { connectTimeout: 2_000, reconnectStrategy: false } });
    client.on("error", () => undefined);
    this.connecting = client.connect().then(() => {
      this.client = client as RedisClientType;
      return this.client;
    }).catch(() => {
      // Redis down: the limit falls back to this process rather than blocking AI entirely.
      this.logger.warn("AI rate limit is using this process: Redis is unavailable");
      client.destroy();
      return null;
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
}
