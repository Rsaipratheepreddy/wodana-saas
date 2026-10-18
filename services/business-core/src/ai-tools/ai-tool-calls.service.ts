import { ConflictException, ForbiddenException, GoneException, HttpException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { runWithCommandOrigin } from "../database/command-origin";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { ItemsFailedError, type Phrase, type Proposal, type ProposalPreview, type RecordRef, type StoredProposal } from "./ai-tool";
import { AI_USE, readAsker, toolContext, type Asker } from "./ai-tool-context";
import { AiToolRegistry } from "./ai-tools.registry";
import { moduleMessage } from "./tool-kit";

/** A proposal waits this long for the person; after it, it can only be asked for again. */
export const PROPOSAL_TTL_MS = 15 * 60_000;

export type ToolCallStatus = "proposed" | "confirmed" | "executed" | "rejected" | "failed" | "expired";
/** Where the proposal was asked for: Woddy in Wodana, or an AI app through MCP (W-5). */
export type ToolCallSurface = "panel" | "inbox" | "comment" | "search" | "mcp";
/** What the web shows as a confirmation card. */
export type ToolCallCard = {
  id: string; runId: string; tool: string; status: ToolCallStatus; title: Phrase; summary: string; preview: ProposalPreview;
  target: RecordRef | null; expiresAt: string; version: number; selection: string[] | null;
  record: RecordRef | null; failures: Array<{ id: string; label: string; message: string }>; error: string | null;
  surface: ToolCallSurface | null;
  /** The AI app that prepared it, when it came through MCP. */
  clientName: string | null;
};

type CallOrigin = { surface: ToolCallSurface; connectionId: string | null; clientName: string | null } | null;
type CallRow = {
  id: string; runId: string; tool: string; status: ToolCallStatus; requestedBy: string; targetType: string | null; targetId: string | null; targetVersion: number | null;
  summary: string; preview: ProposalPreview; command: Record<string, unknown>; selection: string[] | null; idempotencyKey: string; result: Record<string, unknown> | null;
  errorMessage: string | null; expiresAt: Date; version: number; expired: boolean; origin?: CallOrigin;
};
const COLUMNS = `id, run_id AS "runId", tool, status, requested_by AS "requestedBy", target_type AS "targetType", target_id AS "targetId", target_version AS "targetVersion",
  summary, preview, command, selection, idempotency_key AS "idempotencyKey", result, error_message AS "errorMessage", expires_at AS "expiresAt", version,
  (status = 'proposed' AND expires_at <= now()) AS expired,
  (SELECT jsonb_build_object('surface', run.surface, 'connectionId', CASE WHEN run.surface = 'mcp' THEN run.context_id END, 'clientName', connection.client_name)
     FROM ai_agent_runs run
     LEFT JOIN mcp_connections connection ON run.surface = 'mcp' AND connection.workspace_id = run.workspace_id AND connection.id::text = run.context_id
    WHERE run.workspace_id = ai_tool_calls.workspace_id AND run.id = ai_tool_calls.run_id) AS origin`;

const cardOf = (row: CallRow): ToolCallCard => {
  const result = row.result ?? {};
  return {
    id: row.id, runId: row.runId, tool: row.tool, status: row.expired ? "expired" : row.status, title: (row.preview as { title?: Phrase }).title ?? { key: row.summary }, summary: row.summary, preview: row.preview,
    target: row.targetType && row.targetId ? { type: row.targetType, id: row.targetId, label: String((row.preview as { targetLabel?: string }).targetLabel ?? row.summary), href: (row.preview as { targetHref?: string | null }).targetHref ?? null } : null,
    expiresAt: new Date(row.expiresAt).toISOString(), version: row.version, selection: row.selection,
    record: (result.record as RecordRef | undefined) ?? null, failures: (result.failures as ToolCallCard["failures"] | undefined) ?? [], error: row.errorMessage,
    surface: row.origin?.surface ?? null, clientName: row.origin?.clientName ?? null,
  };
};

/**
 * Whether an AI app's proposal may still run: the workspace keeps AI and AI apps on, and the person has not
 * revoked the app (W-5). Checked again when the person confirms, wherever they confirm.
 */
async function mcpStillAllowed(client: PoolClient, workspaceId: string, connectionId: string | null) {
  const found = await client.query(
    `SELECT 1 FROM workspace_ai_settings setting
      WHERE setting.workspace_id = $1 AND setting.enabled AND setting.mcp_enabled
        AND EXISTS (SELECT 1 FROM mcp_connections connection WHERE connection.workspace_id = $1 AND connection.id::text = $2 AND connection.revoked_at IS NULL)`,
    [workspaceId, connectionId ?? ""]);
  return Boolean(found.rowCount);
}

/**
 * Proposed actions (W-1): stored when a write tool proposes, and moved on only by the person who asked.
 * proposed → confirmed → executed | failed; or proposed → rejected | expired (15 minutes for Woddy, an hour
 * for an AI app). Confirming runs the module's own command as that person, with the proposal's idempotency
 * key and the record's version, inside a command origin that marks its audit rows `via: woddy` (or `mcp`
 * for an AI app's proposal) with the run id.
 */
@Injectable()
export class AiToolCallsService {
  private readonly logger = new Logger(AiToolCallsService.name);
  constructor(@Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService, @Inject(AiToolRegistry) private readonly registry: AiToolRegistry) {}

  /** Stores a write tool's proposal, in the person's own tenant transaction. */
  async propose(actor: RequestActor, workspaceId: string, input: { runId: string; tool: string; proposal: Proposal; now?: Date; ttlMs?: number }): Promise<ToolCallCard> {
    const { proposal } = input;
    const expiresAt = new Date((input.now ?? new Date()).getTime() + (input.ttlMs ?? PROPOSAL_TTL_MS));
    // The card shows the target as the tool named it; the snapshot keeps it with the preview.
    const preview = { ...proposal.preview, title: proposal.title, ...(proposal.target ? { targetLabel: proposal.target.label, targetHref: proposal.target.href ?? null } : {}) };
    return this.access.withPermission(actor, workspaceId, AI_USE, async (client, user) => {
      const row = (await client.query<CallRow>(
        `INSERT INTO ai_tool_calls (workspace_id, run_id, tool, requested_by, target_type, target_id, target_version, summary, preview, command, idempotency_key, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12) RETURNING ${COLUMNS}`,
        [workspaceId, input.runId, input.tool, user.userId, proposal.target?.type ?? null, proposal.target?.id ?? null, proposal.target?.version ?? null,
          proposal.summary.slice(0, 500), JSON.stringify(preview), JSON.stringify(proposal.command), randomUUID(), expiresAt])).rows[0];
      return cardOf(row);
    });
  }

  get(actor: RequestActor, workspaceId: string, id: string) {
    return this.access.withPermission(actor, workspaceId, AI_USE, async (client, user) => cardOf(await this.expireIfDue(client, workspaceId, await this.mine(client, workspaceId, id, user.userId, false))));
  }

  async reject(actor: RequestActor, workspaceId: string, id: string, input: { version: number }) {
    const outcome = await this.access.withPermission(actor, workspaceId, AI_USE, async (client, user) => {
      const row = await this.expireIfDue(client, workspaceId, await this.mine(client, workspaceId, id, user.userId, true));
      if (row.status === "rejected") return { card: cardOf(row) };
      if (row.status === "expired") return { card: cardOf(row), expired: true };
      if (row.status !== "proposed") throw new ConflictException(`This action was already ${row.status}.`);
      if (row.version !== input.version) throw new ConflictException("This card changed; reload it.");
      const updated = await this.move(client, workspaceId, id, "rejected", user.userId, {});
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "ai.tool_call.rejected", entityType: "ai_tool_call", entityId: id, after: { tool: row.tool, runId: row.runId } });
      return { card: cardOf(updated) };
    });
    if (outcome.expired) throw expiredError();
    return outcome.card;
  }

  /**
   * Confirms and runs a proposal. A proposal runs once: a repeated confirm returns what happened. The
   * person may untick items of a multi-record proposal (`selection`), never add new ones.
   */
  async confirm(actor: RequestActor, workspaceId: string, id: string, input: { version: number; selection?: string[] }) {
    type Claim = { done: ToolCallCard } | { expired: true } | { row: CallRow; asker: Asker; via: "woddy" | "mcp" };
    const claimed = await this.access.withPermission(actor, workspaceId, AI_USE, async (client, user): Promise<Claim> => {
      const row = await this.expireIfDue(client, workspaceId, await this.mine(client, workspaceId, id, user.userId, true));
      if (row.status === "executed" || row.status === "failed") return { done: cardOf(row) };
      if (row.status === "expired") return { expired: true as const };
      if (row.status !== "proposed") throw new ConflictException(row.status === "confirmed" ? "This action is already running." : `This action was ${row.status}.`);
      if (row.version !== input.version) throw new ConflictException("This card changed; reload it.");
      const selection = selectionFor(row.preview, input.selection);
      // An AI app's proposal runs only while the workspace allows AI apps and the app is still connected.
      const via = row.origin?.surface === "mcp" ? "mcp" as const : "woddy" as const;
      if (via === "mcp" && !(await mcpStillAllowed(client, workspaceId, row.origin?.connectionId ?? null))) {
        throw new ForbiddenException({ message: "AI apps are off for this workspace, or the app was disconnected.", code: "AI_APP_UNAVAILABLE" });
      }
      const confirmed = await this.move(client, workspaceId, id, "confirmed", user.userId, { selection });
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "ai.tool_call.confirmed", entityType: "ai_tool_call", entityId: id,
        after: { tool: row.tool, runId: row.runId, via, targetType: row.targetType, targetId: row.targetId, targetVersion: row.targetVersion, selection } });
      const asker = await readAsker(this.access, client, workspaceId, user.userId, this.registry.permissionCodes);
      return { row: confirmed, asker, via };
    });
    if ("expired" in claimed) throw expiredError();
    if ("done" in claimed) return claimed.done;
    const { row, asker, via } = claimed;
    const tool = this.registry.get(row.tool);
    let outcome: { status: "executed" | "failed"; result: Record<string, unknown>; error: string | null; code: string | null };
    try {
      if (!tool?.execute) throw new UnprocessableEntityException("This action is no longer available.");
      const { context } = toolContext({ actor, workspaceId, runId: row.runId, asker });
      const stored: StoredProposal = { id: row.id, runId: row.runId, tool: row.tool, targetType: row.targetType, targetId: row.targetId, targetVersion: row.targetVersion,
        command: row.command, selection: row.selection, idempotencyKey: row.idempotencyKey };
      // The module's command, as this person, marked in its audit rows as coming from Woddy or an AI app.
      const execution = await runWithCommandOrigin({ via, runId: row.runId }, () => tool.execute!(context, stored));
      outcome = { status: "executed", result: { ...execution.result, record: execution.record, failures: execution.failures ?? [] }, error: null, code: null };
    } catch (error) {
      if (!(error instanceof HttpException) && !(error instanceof ItemsFailedError)) this.logger.error(`Woddy action ${row.id} (${row.tool}) failed: ${(error as Error)?.name ?? "unknown"}`);
      outcome = { status: "failed", result: error instanceof ItemsFailedError ? { failures: error.failures } : {}, error: moduleMessage(error).slice(0, 1000),
        code: error instanceof HttpException ? String(error.getStatus()) : (error as Error)?.name?.slice(0, 80) ?? null };
    }
    return this.access.withPermission(actor, workspaceId, AI_USE, async (client, user) => {
      const settled = await this.move(client, workspaceId, id, outcome.status, user.userId, { result: outcome.result, error: outcome.error, code: outcome.code });
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `ai.tool_call.${outcome.status}`, entityType: "ai_tool_call", entityId: id,
        after: { tool: row.tool, runId: row.runId, ...(outcome.error ? { error: outcome.error } : { result: outcome.result }) } });
      return cardOf(settled);
    });
  }

  /** The person's own proposal: nobody else can see, confirm or cancel it. */
  private async mine(client: PoolClient, workspaceId: string, id: string, userId: string, lock: boolean) {
    const row = (await client.query<CallRow>(`SELECT ${COLUMNS} FROM ai_tool_calls WHERE workspace_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [workspaceId, id])).rows[0];
    if (!row) throw new NotFoundException("This Woddy action was not found.");
    if (row.requestedBy !== userId) throw new ForbiddenException("Only the person who asked Woddy can confirm or cancel this.");
    return row;
  }

  private async expireIfDue(client: PoolClient, workspaceId: string, row: CallRow): Promise<CallRow> {
    if (!row.expired) return row;
    return (await client.query<CallRow>(
      `UPDATE ai_tool_calls SET status = 'expired', version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2 RETURNING ${COLUMNS.replace("(status = 'proposed' AND expires_at <= now())", "false")}`,
      [workspaceId, row.id])).rows[0];
  }

  private async move(client: PoolClient, workspaceId: string, id: string, status: ToolCallStatus, userId: string,
    change: { selection?: string[] | null; result?: Record<string, unknown>; error?: string | null; code?: string | null }) {
    return (await client.query<CallRow>(
      `UPDATE ai_tool_calls SET status = $3::varchar, version = version + 1, updated_at = now(),
              decided_by = CASE WHEN $3::varchar IN ('confirmed', 'rejected') THEN $4::uuid ELSE decided_by END,
              decided_at = CASE WHEN $3::varchar IN ('confirmed', 'rejected') THEN now() ELSE decided_at END,
              selection = CASE WHEN $3::varchar = 'confirmed' THEN $5::jsonb ELSE selection END,
              executed_at = CASE WHEN $3::varchar = 'executed' THEN now() ELSE executed_at END,
              result = COALESCE($6::jsonb, result), error_message = COALESCE($7::varchar, error_message), error_code = COALESCE($8::varchar, error_code)
        WHERE workspace_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
      [workspaceId, id, status, userId, change.selection === undefined ? null : JSON.stringify(change.selection), change.result ? JSON.stringify(change.result) : null, change.error ?? null, change.code ?? null])).rows[0];
  }
}

function expiredError() {
  return new GoneException({ message: "This suggestion expired. Ask Woddy again.", code: "AI_TOOL_CALL_EXPIRED" });
}

/** The ticked items of a multi-record proposal: a subset of what was proposed, never empty; null means all. */
function selectionFor(preview: ProposalPreview, selection: string[] | undefined): string[] | null {
  if (preview.kind !== "targets" || !preview.selectable || selection === undefined) return null;
  const proposed = new Set(preview.items.map((item) => item.id));
  const kept = [...new Set(selection)];
  if (!kept.length) throw new UnprocessableEntityException("Tick at least one item, or cancel.");
  if (kept.some((item) => !proposed.has(item))) throw new UnprocessableEntityException("Only items on the card can be confirmed.");
  return kept.length === proposed.size ? null : kept;
}
