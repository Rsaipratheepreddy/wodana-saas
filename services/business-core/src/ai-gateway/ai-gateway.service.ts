import { ConflictException, Injectable, ServiceUnavailableException, UnprocessableEntityException } from "@nestjs/common";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";

export type AiCall<T> = {
  feature: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Checks and normalizes the model's JSON; throw to reject it. */
  validate: (value: unknown) => T;
};
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export class AiUnavailableError extends ServiceUnavailableException {}

/**
 * The one door to AI models. A workspace must turn AI on; the person needs ai.suggestions.use.
 * The model call happens outside any database transaction; every call is logged. Output is JSON,
 * validated by the calling feature before anyone sees it, and always shown as a suggestion.
 */
@Injectable()
export class AiGatewayService {
  private fetcher: Fetcher = (url, init) => fetch(url, init);
  constructor(private readonly access: WorkspaceAccessService) {}

  /** Tests replace the HTTP call. */
  useFetcher(fetcher: Fetcher) { this.fetcher = fetcher; return this; }

  get configured() {
    return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  }

  settings(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client) => {
      const row = await client.query<{ enabled: boolean; version: number; changedAt: string }>(
        `SELECT enabled, version, changed_at AS "changedAt" FROM workspace_ai_settings WHERE workspace_id = $1`, [workspaceId]);
      return { enabled: row.rows[0]?.enabled ?? false, version: row.rows[0]?.version ?? 0, available: this.configured };
    });
  }

  setEnabled(actor: RequestActor, workspaceId: string, input: { enabled: boolean; version: number }) {
    return this.access.withPermission(actor, workspaceId, "workspace.settings.manage", async (client, user) => {
      const current = await client.query<{ version: number; enabled: boolean }>(`SELECT version, enabled FROM workspace_ai_settings WHERE workspace_id = $1 FOR UPDATE`, [workspaceId]);
      if ((current.rows[0]?.version ?? 0) !== input.version) throw new ConflictException("AI settings changed; reload and try again");
      await client.query(
        `INSERT INTO workspace_ai_settings (workspace_id, enabled, changed_by) VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id) DO UPDATE SET enabled = EXCLUDED.enabled, changed_by = EXCLUDED.changed_by, changed_at = now(), version = workspace_ai_settings.version + 1`,
        [workspaceId, input.enabled, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: input.enabled ? "ai.enabled" : "ai.disabled", entityType: "workspace", entityId: workspaceId,
        before: { enabled: current.rows[0]?.enabled ?? false }, after: { enabled: input.enabled } });
      return { enabled: input.enabled, version: (current.rows[0]?.version ?? 0) + 1, available: this.configured };
    });
  }

  async run<T>(actor: RequestActor, workspaceId: string, call: AiCall<T>): Promise<T> {
    const userId = await this.access.withPermission(actor, workspaceId, "ai.suggestions.use", async (client, user) => {
      const setting = await client.query<{ enabled: boolean }>(`SELECT enabled FROM workspace_ai_settings WHERE workspace_id = $1`, [workspaceId]);
      if (!setting.rows[0]?.enabled) throw new AiUnavailableError("AI assistance is off for this workspace. An admin can turn it on in Settings.");
      return user.userId;
    });
    if (!this.configured) throw new AiUnavailableError("AI assistance is not set up yet.");
    const model = process.env.AI_MODEL?.trim() || "claude-sonnet-5";
    const started = Date.now();
    let status: "ok" | "invalid_output" | "failed" | "timeout" = "failed";
    let usage = { input_tokens: 0, output_tokens: 0 };
    try {
      const response = await this.fetcher("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!.trim(), "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model, max_tokens: call.maxTokens ?? 4000, temperature: 0,
          system: `${call.system}\nReply with one JSON value only. No prose, no code fences.`,
          messages: [{ role: "user", content: call.prompt }],
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new AiUnavailableError("The AI service did not answer. Try again, or continue manually.");
      const body = await response.json() as { content?: Array<{ type: string; text?: string }>; usage?: typeof usage };
      usage = body.usage ?? usage;
      const text = (body.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { status = "invalid_output"; throw new UnprocessableEntityException("The AI answer could not be read. Try again, or continue manually."); }
      try { const result = call.validate(parsed); status = "ok"; return result; }
      catch (error) { status = "invalid_output"; throw error instanceof UnprocessableEntityException ? error : new UnprocessableEntityException("The AI answer did not fit. Try again, or continue manually."); }
    } catch (error) {
      if ((error as Error)?.name === "TimeoutError") { status = "timeout"; throw new AiUnavailableError("The AI service took too long. Try again, or continue manually."); }
      throw error;
    } finally {
      await this.access.withPermission(actor, workspaceId, "ai.suggestions.use", (client) => client.query(
        `INSERT INTO ai_usage_events (workspace_id, feature, provider, model, input_tokens, output_tokens, status, latency_ms, created_by)
         VALUES ($1, $2, 'anthropic', $3, $4, $5, $6, $7, $8)`,
        [workspaceId, call.feature, model, usage.input_tokens ?? 0, usage.output_tokens ?? 0, status, Date.now() - started, userId])).catch(() => undefined);
    }
  }
}
