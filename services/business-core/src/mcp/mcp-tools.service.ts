import { ForbiddenException, HttpException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { ToolInputError, ToolQuestion, type AiTool, type Proposal, type RecordRef } from "../ai-tools/ai-tool";
import { AiToolCallsService, type ToolCallCard } from "../ai-tools/ai-tool-calls.service";
import { readAsker, toolContext, type Asker } from "../ai-tools/ai-tool-context";
import { AiToolRegistry } from "../ai-tools/ai-tools.registry";
import { dataBlock, moduleMessage, UUID, validateToolInput } from "../ai-tools/tool-kit";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { runWithCommandOrigin } from "../database/command-origin";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import type { McpScope } from "./mcp-oauth.domain";
import type { McpPrincipal } from "./mcp-oauth.service";
import { McpRateLimitService } from "./mcp-rate-limit.service";

/** An AI app's proposal waits an hour for the person to open Wodana and confirm it. */
export const MCP_PROPOSAL_TTL_MS = 60 * 60_000;
/** The most text one tool result sends back. */
export const MCP_RESULT_CHARS = 60_000;
/** The feature MCP tool calls are recorded under: usage is logged, no AI credits are charged (no model turn). */
export const MCP_USAGE_FEATURE = "mcp.tools";
/** Follows up on a change waiting for the person's OK (offered with the write scope). */
export const ACTION_STATUS_TOOL = "action_status";

export type McpContent =
  | { type: "text"; text: string }
  | { type: "resource_link"; uri: string; name: string; description?: string; mimeType?: string };
export type McpToolResult = { content: McpContent[]; isError?: boolean; structuredContent?: Record<string, unknown> };
export type McpToolDefinition = {
  name: string; description: string; inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
};
/** Asks the person in the AI app itself to confirm (MCP elicitation); null when it could not ask. */
export type Confirmer = (request: { message: string }) => Promise<"accept" | "decline" | "cancel" | null>;

/** AI assistance or AI apps are off, or the person has no access to Woddy: nothing can be called. */
export class McpUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "McpUnavailableError"; }
}

type CallStatus = "ok" | "question" | "waiting" | "executed" | "failed" | "rejected" | "refused" | "error";
type Outcome = { result: McpToolResult; status: CallStatus; commandId: string | null };
type Session = { actor: RequestActor; asker: Asker; readOnly: boolean };

const text = (value: string): McpContent => ({ type: "text", text: value });
const refusal = (message: string): McpToolResult => ({ content: [text(message)], isError: true });

/** The same input always hashes the same, whatever order its keys came in. */
export function inputHash(value: unknown): string {
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable)
    : item && typeof item === "object" ? Object.fromEntries(Object.keys(item as object).sort().map((key) => [key, stable((item as Record<string, unknown>)[key])])) : item;
  return createHash("sha256").update(JSON.stringify(stable(value ?? {}))).digest("hex");
}

/**
 * Woddy's tools for an AI app (W-5). The tools are the registry's, generated per person: those their own
 * permissions allow, narrowed to the token's scopes (read tools need `read`, write tools `write`; drafts belong
 * to Wodana's composer and are not offered). Reads run at once as the person and return the records they read
 * as resource links. Writes never change anything by themselves: each becomes a proposed Woddy action that
 * the person confirms in the app (MCP elicitation) or in Wodana; a confirmed one runs with `via: mcp`.
 *
 * Every call is rate-limited per connection and audited (app, token, tool, input hash, result, command);
 * calls are recorded as usage, with no model turn and no AI credits.
 */
@Injectable()
export class McpToolsService {
  private readonly logger = new Logger(McpToolsService.name);

  constructor(
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
    @Inject(AiToolRegistry) private readonly registry: AiToolRegistry,
    @Inject(AiToolCallsService) private readonly calls: AiToolCallsService,
    @Inject(McpRateLimitService) private readonly limits: McpRateLimitService,
  ) {}

  /** The person the token acts as, already resolved (their identity is the connection's user). */
  actorOf(principal: McpPrincipal): RequestActor {
    return {
      subject: `mcp:${principal.connectionId}`, email: principal.email, displayName: principal.displayName, provider: "mcp",
      mcp: { userId: principal.userId, connectionId: principal.connectionId, tokenId: principal.tokenId, clientName: principal.clientName },
    };
  }

  /** The tools this person's app may call now. */
  async listTools(principal: McpPrincipal): Promise<McpToolDefinition[]> {
    const session = await this.session(principal);
    const tools = this.allowed(session.asker, principal.scopes).map((tool): McpToolDefinition => ({
      name: tool.name,
      description: tool.kind === "write" ? `${tool.description} Nothing changes until the person confirms it (in the app when it can ask, otherwise in Wodana).` : tool.description,
      inputSchema: tool.parameters as unknown as Record<string, unknown>,
      annotations: { readOnlyHint: tool.kind === "read", destructiveHint: false, idempotentHint: tool.kind === "read", openWorldHint: false },
    }));
    if (principal.scopes.includes("write")) {
      tools.push({
        name: ACTION_STATUS_TOOL,
        description: "Whether a change waiting for the person's OK was confirmed, cancelled, done or expired, and the record it changed.",
        inputSchema: { type: "object", properties: { action_id: { type: "string", description: "The actionId a write tool returned" } }, required: ["action_id"] },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      });
    }
    return tools;
  }

  async callTool(principal: McpPrincipal, name: string, rawArgs: unknown, options: { origin: string; confirm?: Confirmer }): Promise<McpToolResult> {
    const started = Date.now();
    const actor = this.actorOf(principal);
    if (!(await this.limits.takeCall(principal.workspaceId, principal.connectionId))) {
      return refusal("Too many calls. Wait a minute and try again.");
    }
    let session: Session;
    try { session = await this.session(principal); }
    catch (error) {
      const message = error instanceof McpUnavailableError ? error.message : moduleMessage(error, "This app can't use Wodana right now.");
      await this.record(actor, principal, { runId: null, tool: name, args: rawArgs, status: "refused", commandId: null, started, executed: false });
      return refusal(message);
    }
    if (name === ACTION_STATUS_TOOL && principal.scopes.includes("write")) return this.actionStatus(session, principal, rawArgs, options.origin, started);
    const tool = this.allowed(session.asker, principal.scopes).find((item) => item.name === name);
    let args: Record<string, unknown>;
    try {
      if (!tool) throw new ToolInputError(`There is no tool called ${name} for this person.`);
      args = validateToolInput(tool.parameters, rawArgs ?? {});
    } catch (error) {
      await this.record(actor, principal, { runId: null, tool: name, args: rawArgs, status: "refused", commandId: null, started, executed: false });
      return refusal(moduleMessage(error));
    }
    const runId = await this.startRun(session.actor, principal);
    let outcome: Outcome;
    try {
      outcome = await runWithCommandOrigin({ via: "mcp", runId }, () => tool!.kind === "read"
        ? this.read(tool!, session, principal, runId, args, options.origin)
        : this.write(tool!, session, principal, runId, args, options));
    } catch (error) {
      if (error instanceof ToolQuestion) {
        const choices = error.options.map((option) => ({ type: option.type, id: option.id, label: option.label, ...(option.detail ? { detail: option.detail } : {}) }));
        outcome = { result: { content: [text(`Ask the person: ${error.message}`), ...(choices.length ? [text(dataBlock(name, choices))] : [])] }, status: "question", commandId: null };
      } else {
        if (!(error instanceof HttpException) && !(error instanceof ToolInputError)) this.logger.warn(`MCP tool ${name} failed (${(error as Error)?.name ?? "unknown"})`);
        outcome = { result: refusal(moduleMessage(error, "That did not work. It could not be done right now.")), status: "error", commandId: null };
      }
    }
    await this.record(actor, principal, { runId, tool: name, args, status: outcome.status, commandId: outcome.commandId, started, executed: true });
    return outcome.result;
  }

  // ---------- inside ----------

  /** The person in this workspace, if AI and AI apps are on and they may use Woddy. */
  private async session(principal: McpPrincipal): Promise<Session> {
    const actor = this.actorOf(principal);
    return this.access.asMember(actor, principal.workspaceId, async (db, user) => {
      const state = (await db.query<{ aiEnabled: boolean | null; mcpEnabled: boolean | null; status: string }>(
        `SELECT setting.enabled AS "aiEnabled", setting.mcp_enabled AS "mcpEnabled", workspace.status::text AS status
           FROM workspaces workspace LEFT JOIN workspace_ai_settings setting ON setting.workspace_id = workspace.id WHERE workspace.id = $1`,
        [principal.workspaceId])).rows[0];
      if (!state?.aiEnabled) throw new McpUnavailableError("AI assistance is off for this workspace. An owner can turn it on in Settings.");
      if (!state.mcpEnabled) throw new McpUnavailableError("AI apps are off for this workspace. An owner can turn them on in Settings → AI apps.");
      const asker = await readAsker(this.access, db, principal.workspaceId, user.userId, this.registry.permissionCodes).catch((error: unknown) => {
        throw error instanceof ForbiddenException ? new McpUnavailableError("You don't have access to Woddy in this workspace.") : error;
      });
      return { actor, asker, readOnly: state.status !== "active" };
    });
  }

  private allowed(asker: Asker, scopes: readonly McpScope[]): AiTool[] {
    return this.registry.offered(asker.permissions).filter((tool) => (tool.kind === "read" && scopes.includes("read")) || (tool.kind === "write" && scopes.includes("write")));
  }

  private async read(tool: AiTool, session: Session, principal: McpPrincipal, runId: string, args: Record<string, unknown>, origin: string): Promise<Outcome> {
    const { context, sources } = toolContext({ actor: session.actor, workspaceId: principal.workspaceId, runId, asker: session.asker });
    const { data } = await tool.run!(context, args);
    let block = dataBlock(tool.name, data);
    if (block.length > MCP_RESULT_CHARS) block = dataBlock(tool.name, { truncated: true, note: "Too much to show at once. Narrow the request.", preview: block.slice(0, MCP_RESULT_CHARS / 2) });
    // The records it read, as links the app can show (sources, W-4).
    const links = sources.filter((source) => source.href).map((source): McpContent => ({
      type: "resource_link", uri: absolute(origin, source.href!), name: source.label, description: `${source.type} ${source.key}`, mimeType: "text/html",
    }));
    return { result: { content: [text(block), ...links] }, status: "ok" as const, commandId: null };
  }

  private async write(tool: AiTool, session: Session, principal: McpPrincipal, runId: string, args: Record<string, unknown>, options: { origin: string; confirm?: Confirmer }): Promise<Outcome> {
    if (session.readOnly) return { result: refusal("This organization is read-only while it is suspended."), status: "refused" as const, commandId: null };
    const workspaceId = principal.workspaceId;
    const { context } = toolContext({ actor: session.actor, workspaceId, runId, asker: session.asker });
    const proposal = await tool.propose!(context, args);
    const card = await this.calls.propose(session.actor, workspaceId, { runId, tool: tool.name, proposal, ttlMs: MCP_PROPOSAL_TTL_MS });
    const answer = options.confirm ? await options.confirm({ message: confirmationMessage(proposal) }).catch(() => null) : null;
    if (answer === "accept") {
      const done = await this.calls.confirm(session.actor, workspaceId, card.id, { version: card.version });
      return { result: settledResult(done, options.origin), status: done.status === "executed" ? "executed" as const : "failed" as const, commandId: card.id };
    }
    if (answer === "decline" || answer === "cancel") {
      await this.calls.reject(session.actor, workspaceId, card.id, { version: card.version });
      return { result: { content: [text("The person cancelled it. Nothing was changed.")], structuredContent: { status: "rejected", actionId: card.id } }, status: "rejected" as const, commandId: card.id };
    }
    // The app can't ask: the person confirms the same card in Wodana (Approvals → Waiting for you).
    const link = absolute(options.origin, `/workspace/ai-actions/${card.id}`);
    return {
      result: {
        content: [
          text(`Waiting for your OK in Wodana. Nothing has changed yet. Open ${link} to confirm or cancel: ${proposal.summary}. It expires at ${card.expiresAt}. Use ${ACTION_STATUS_TOOL} with actionId ${card.id} to see what happened.`),
          { type: "resource_link", uri: link, name: "Confirm in Wodana", description: proposal.summary, mimeType: "text/html" } as McpContent,
        ],
        structuredContent: { status: "waiting_for_confirmation", actionId: card.id, url: link, expiresAt: card.expiresAt, summary: proposal.summary },
      },
      status: "waiting" as const,
      commandId: card.id,
    };
  }

  private async actionStatus(session: Session, principal: McpPrincipal, rawArgs: unknown, origin: string, started: number): Promise<McpToolResult> {
    const id = (rawArgs as { action_id?: unknown } | null)?.action_id;
    let result: McpToolResult;
    try {
      if (typeof id !== "string" || !UUID.test(id)) throw new ToolInputError("action_id must be the actionId a write tool returned");
      const card = await this.calls.get(session.actor, principal.workspaceId, id.toLowerCase());
      if (card.surface !== "mcp") throw new NotFoundException("This action was not found.");
      result = card.status === "proposed"
        ? { content: [text(`Still waiting for the person's OK: ${card.summary}. It expires at ${card.expiresAt}.`)], structuredContent: { status: card.status, actionId: card.id } }
        : card.status === "expired" ? { content: [text(`Expired: nothing was changed. ${card.summary}`)], structuredContent: { status: card.status, actionId: card.id } }
        : card.status === "rejected" ? { content: [text(`The person cancelled it. Nothing was changed. ${card.summary}`)], structuredContent: { status: card.status, actionId: card.id } }
        : card.status === "confirmed" ? { content: [text(`Confirmed and running: ${card.summary}`)], structuredContent: { status: card.status, actionId: card.id } }
        : settledResult(card, origin);
    } catch (error) {
      result = refusal(moduleMessage(error, "This action was not found."));
    }
    await this.record(session.actor, principal, { runId: null, tool: ACTION_STATUS_TOOL, args: rawArgs, status: result.isError ? "refused" : "ok", commandId: typeof id === "string" ? id : null, started, executed: false });
    return result;
  }

  /** A tool call is a run of its own, on the `mcp` surface (no model turn: rounds and tokens stay 0). */
  private startRun(actor: RequestActor, principal: McpPrincipal) {
    return this.access.asMember(actor, principal.workspaceId, async (db, user) => (await db.query<{ id: string }>(
      `INSERT INTO ai_agent_runs (workspace_id, requested_by, surface, context_type, context_id) VALUES ($1, $2, 'mcp', 'mcp_connection', $3) RETURNING id`,
      [principal.workspaceId, user.userId, principal.connectionId])).rows[0].id);
  }

  /** Audits the call (app, token, tool, input hash, result, command) and records its usage; never fails the call. */
  private async record(actor: RequestActor, principal: McpPrincipal, entry: {
    runId: string | null; tool: string; args: unknown; status: CallStatus; commandId: string | null; started: number; executed: boolean;
  }) {
    const work = () => this.access.asMember(actor, principal.workspaceId, async (db, user) => {
      if (entry.runId) {
        await db.query(`UPDATE ai_agent_runs SET status = $3, finished_at = now() WHERE workspace_id = $1 AND id = $2`,
          [principal.workspaceId, entry.runId, entry.status === "error" ? "failed" : "answered"]);
      }
      if (entry.executed) {
        await db.query(
          `INSERT INTO ai_usage_events (workspace_id, feature, provider, model, input_tokens, output_tokens, status, latency_ms, created_by)
           VALUES ($1, $2, 'mcp', $3, 0, 0, $4, $5, $6)`,
          [principal.workspaceId, MCP_USAGE_FEATURE, entry.tool.slice(0, 80), entry.status === "error" || entry.status === "failed" ? "failed" : "ok", Date.now() - entry.started, user.userId]);
      }
      await recordAudit(db, {
        workspaceId: principal.workspaceId, actorUserId: user.userId, action: "ai.mcp.tool_called", entityType: "mcp_connection", entityId: principal.connectionId,
        after: { client: principal.clientName, clientId: principal.clientId, tokenId: principal.tokenId, tool: entry.tool.slice(0, 80), inputHash: inputHash(entry.args),
          result: entry.status, commandId: entry.commandId, runId: entry.runId },
      });
    });
    try {
      await (entry.runId ? runWithCommandOrigin({ via: "mcp", runId: entry.runId }, work) : work());
    } catch (error) {
      this.logger.error(`MCP call to ${entry.tool} could not be audited (${(error as Error)?.name ?? "unknown"})`);
    }
  }
}

function absolute(origin: string, href: string) {
  return /^https?:\/\//i.test(href) ? href : `${origin}${href.startsWith("/") ? "" : "/"}${href}`;
}

/** What the app shows the person before they confirm: what happens, and each field it sets or changes. */
export function confirmationMessage(proposal: Proposal): string {
  const preview = proposal.preview;
  const fields = preview.fields.map((field) => `${field.label}: ${field.before !== undefined ? `${field.before ?? "—"} → ` : ""}${field.after ?? "—"}`);
  const targets = preview.kind === "targets" ? preview.items.map((item) => `• ${item.label}${item.now ? ` (now ${item.now})` : ""}`) : [];
  const quoted = preview.kind === "text" ? [`“${preview.text}”`] : [];
  return [`${proposal.summary}.`, ...targets, ...quoted, ...fields, "", "Confirm to make this change in Wodana as you."].join("\n").slice(0, 4000);
}

function settledResult(card: ToolCallCard, origin: string): McpToolResult {
  if (card.status === "failed") return { content: [text(`Not done: ${card.error ?? "The action could not be completed."}`)], isError: true, structuredContent: { status: "failed", actionId: card.id } };
  const link = (record: RecordRef | null): McpContent[] => record?.href ? [{ type: "resource_link", uri: absolute(origin, record.href), name: record.label, mimeType: "text/html" }] : [];
  const failures = card.failures.map((item) => `${item.label}: ${item.message}`);
  return {
    content: [text([`Done: ${card.summary}.`, ...(failures.length ? ["Some items were not changed:", ...failures] : [])].join("\n")), ...link(card.record)],
    structuredContent: { status: card.status, actionId: card.id, ...(card.record ? { record: card.record } : {}) },
  };
}
