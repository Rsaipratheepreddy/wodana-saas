import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AiRateLimitService } from "../ai-gateway/ai-rate-limit.service";
import { DatabaseService } from "../database/database.service";

/** Tool calls one AI app connection may make per minute (every token of the connection counts together). */
export const MCP_CALLS_PER_MINUTE = 60;
/**
 * App registrations one address may make per hour (registration needs no sign-in). Hosted AI apps register
 * from shared addresses, so this is generous; MCP_REGISTRATIONS_PER_HOUR changes it.
 */
export const MCP_REGISTRATIONS_PER_HOUR = 120;
const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Limits for AI apps (W-5). A connection's calls are counted per minute in Redis, shared by every API
 * instance; without Redis they are counted in the workspace's own table (mcp_rate_windows, under RLS).
 * Registrations are counted per address in Redis, or in this process without it.
 */
@Injectable()
export class McpRateLimitService {
  private readonly registrations = new Map<string, number>();

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AiRateLimitService) private readonly shared: Pick<AiRateLimitService, "hit">,
    @Optional() @Inject(ConfigService) private readonly config?: ConfigService,
  ) {}

  get callsPerMinute() { return this.setting("MCP_CALLS_PER_MINUTE", MCP_CALLS_PER_MINUTE); }
  get registrationsPerHour() { return this.setting("MCP_REGISTRATIONS_PER_HOUR", MCP_REGISTRATIONS_PER_HOUR); }

  private setting(key: string, fallback: number) {
    const configured = Number(this.config?.get<string>(key) ?? "");
    return Number.isInteger(configured) && configured > 0 ? configured : fallback;
  }

  /** Counts one tool call; false when the connection has used this minute's calls. */
  async takeCall(workspaceId: string, connectionId: string, now = new Date()): Promise<boolean> {
    const minute = Math.floor(now.getTime() / 60_000);
    let count = await this.shared.hit(`mcp-rate:${connectionId}:${minute}`, 60).catch(() => null);
    if (count === null) {
      const windowStart = new Date(minute * 60_000);
      count = await this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
        await client.query(`DELETE FROM mcp_rate_windows WHERE workspace_id = $1 AND connection_id = $2 AND window_start < $3::timestamptz - interval '5 minutes'`,
          [workspaceId, connectionId, windowStart]);
        const counted = await client.query<{ calls: number }>(
          `INSERT INTO mcp_rate_windows (workspace_id, connection_id, window_start, calls) VALUES ($1, $2, $3, 1)
           ON CONFLICT (workspace_id, connection_id, window_start) DO UPDATE SET calls = mcp_rate_windows.calls + 1 RETURNING calls`,
          [workspaceId, connectionId, windowStart]);
        return counted.rows[0].calls;
      });
    }
    return count <= this.callsPerMinute;
  }

  /** Counts one registration from this address; false past the hourly limit. */
  async takeRegistration(address: string, now = new Date()): Promise<boolean> {
    const hour = Math.floor(now.getTime() / 3_600_000);
    const key = `mcp-register:${address}:${hour}`;
    let count = await this.shared.hit(key, 3_600).catch(() => null);
    if (count === null) {
      for (const existing of this.registrations.keys()) if (!existing.endsWith(`:${hour}`)) this.registrations.delete(existing);
      count = (this.registrations.get(key) ?? 0) + 1;
      this.registrations.set(key, count);
    }
    return count <= this.registrationsPerHour;
  }
}
