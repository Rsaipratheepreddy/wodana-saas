import { HttpException, Inject, Injectable, Logger } from "@nestjs/common";
import type { RequestActor } from "../auth/actor";
import { AiGatewayService } from "../ai-gateway/ai-gateway.service";
import type { ToolCall } from "../ai-gateway/ai-provider";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { ToolInputError, ToolQuestion, type AiTool, type AiToolContext, type RecordRef } from "./ai-tool";
import { AiToolCallsService, type ToolCallCard } from "./ai-tool-calls.service";
import { AI_USE, readAsker, toolContext } from "./ai-tool-context";
import { AiToolRegistry } from "./ai-tools.registry";
import { agentSystemPrompt, type AgentSurface } from "./agent-prompt";
import { dataBlock, moduleMessage, validateToolInput } from "./tool-kit";

/** A run's caps, so a loop can't run away with credits: model rounds, tokens across rounds, calls per round, cards. */
export const AGENT_LIMITS = { rounds: 6, tokens: 60_000, outputTokens: 1_500, callsPerRound: 4, proposals: 5, resultChars: 12_000 };
export const AGENT_FEATURE = "woddy.agent";

export type AgentMessage = { role: "user" | "assistant"; text: string };
export type AgentAsk = {
  message: string;
  history?: AgentMessage[];
  surface: AgentSurface;
  context?: { type: string; id: string; label?: string | null } | null;
  selection?: { type: string; ids: string[] } | null;
};
export type AgentSource = RecordRef & { key: string };
export type AgentAnswer = {
  runId: string;
  /** The model's words; empty when it only prepared cards (the web then says so in the person's language). */
  answer: string;
  /** Every record Woddy read, keyed S1, S2…; `cited` are the keys the answer names. */
  sources: AgentSource[];
  cited: string[];
  proposals: ToolCallCard[];
  /** A reply for the chat's composer (never sent). */
  draft: { text: string; conversationId: string | null } | null;
  /** Why the run stopped early, when it did. */
  stopped: "rounds" | "tokens" | null;
};

type Part = Record<string, unknown>;

/**
 * Woddy's agent loop (W-1). The model sees only the tools this person may use. Each model turn passes the
 * AI gateway (switch, permission, credits, daily caps, log, metering). Read tools run at once as the person;
 * write tools store a proposal the person confirms; drafts go to the composer. Tool results go back as
 * delimited data blocks. The run stops at the round and token caps.
 */
@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly access: WorkspaceAccessService,
    private readonly calls: AiToolCallsService,
    @Inject(AiToolRegistry) private readonly registry: AiToolRegistry,
  ) {}

  /** The tools this person would be offered (W-5 lists the same through MCP). */
  catalogue(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const asker = await readAsker(this.access, client, workspaceId, user.userId, this.registry.permissionCodes);
      return { tools: this.registry.describe(this.registry.offered(asker.permissions)) };
    });
  }

  async ask(actor: RequestActor, workspaceId: string, input: AgentAsk, now = new Date()): Promise<AgentAnswer> {
    const record = input.context ? { type: input.context.type, id: input.context.id } : null;
    const { asker, runId } = await this.access.asMember(actor, workspaceId, async (client, user) => {
      const asker = await readAsker(this.access, client, workspaceId, user.userId, this.registry.permissionCodes);
      const run = await client.query<{ id: string }>(
        `INSERT INTO ai_agent_runs (workspace_id, requested_by, surface, context_type, context_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [workspaceId, user.userId, input.surface, record?.type ?? null, record?.id ?? null]);
      return { asker, runId: run.rows[0].id };
    });
    const { context, sources } = toolContext({ actor, workspaceId, runId, asker, now, record, selection: input.selection ?? null });
    const offered = this.registry.offered(asker.permissions);
    const byName = new Map(offered.map((tool) => [tool.name, tool]));
    const request = {
      systemInstruction: { parts: [{ text: agentSystemPrompt({ now, timeZone: asker.timeZone, surface: input.surface, record: input.context ?? null, selection: input.selection ?? null }) }] },
      tools: [{ functionDeclarations: AiToolRegistry.declarations(offered) }],
      generationConfig: { temperature: 0, maxOutputTokens: AGENT_LIMITS.outputTokens },
    };
    const contents: Array<{ role: string; parts: Part[] }> = [
      ...(input.history ?? []).slice(-10).map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.text }] })),
      { role: "user", parts: [{ text: input.message }] },
    ];
    const proposals: ToolCallCard[] = [];
    let draft: AgentAnswer["draft"] = null;
    let answer = "";
    let stopped: AgentAnswer["stopped"] = null;
    let rounds = 0, inputTokens = 0, outputTokens = 0;
    let status: "answered" | "stopped" | "failed" = "failed";
    try {
      for (;;) {
        if (rounds >= AGENT_LIMITS.rounds) { stopped = "rounds"; break; }
        if (inputTokens + outputTokens >= AGENT_LIMITS.tokens) { stopped = "tokens"; break; }
        const turn = await this.gateway.turn(actor, workspaceId, { feature: AGENT_FEATURE, request: { ...request, contents }, takeLimit: rounds === 0 });
        rounds += 1;
        inputTokens += turn.usage.input_tokens;
        outputTokens += turn.usage.output_tokens;
        if (turn.text) answer = turn.text;
        if (!turn.calls.length) break;
        contents.push({ role: "model", parts: turn.parts as Part[] });
        const responses: Part[] = [];
        for (const [index, call] of turn.calls.entries()) {
          const response = index >= AGENT_LIMITS.callsPerRound
            ? { error: "Too many tool calls at once. Call the rest in your next turn." }
            : await this.callTool(byName.get(call.name), call, context, { runId, proposals, onDraft: (value) => { draft = value; } });
          responses.push({ functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response } });
        }
        contents.push({ role: "user", parts: responses });
      }
      status = stopped ? "stopped" : "answered";
    } finally {
      await this.finish(actor, workspaceId, runId, { status, rounds, inputTokens, outputTokens, stopped }).catch((error) =>
        this.logger.error(`Woddy run ${runId} could not be closed (${(error as Error)?.name ?? "unknown"})`));
    }
    const cited = [...new Set([...answer.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]))].filter((key) => sources.some((source) => source.key === key));
    return { runId, answer, sources, cited, proposals, draft, stopped };
  }

  /** One tool call, answered as data: a read's result, a proposal's card number, a question to ask, or an error. */
  private async callTool(tool: AiTool | undefined, call: ToolCall, context: AiToolContext,
    run: { runId: string; proposals: ToolCallCard[]; onDraft: (draft: { text: string; conversationId: string | null }) => void }): Promise<Record<string, unknown>> {
    if (!tool) return { error: `There is no tool called ${call.name} for this person.` };
    try {
      const args = validateToolInput(tool.parameters, call.args);
      if (tool.kind === "read") {
        const { data } = await tool.run!(context, args);
        const block = dataBlock(tool.name, data);
        return { result: block.length > AGENT_LIMITS.resultChars ? dataBlock(tool.name, { truncated: true, note: "Too much to show at once. Narrow the request.", preview: block.slice(0, AGENT_LIMITS.resultChars / 2) }) : block };
      }
      if (tool.kind === "draft") {
        const draft = await tool.draft!(context, args);
        run.onDraft(draft);
        return { status: "in_composer", note: "The draft is in the chat's composer for the person to edit and send. Nothing was sent." };
      }
      if (run.proposals.length >= AGENT_LIMITS.proposals) return { error: "Enough changes are waiting for confirmation. Ask the person to confirm those first." };
      const proposal = await tool.propose!(context, args);
      const card = await this.calls.propose(context.actor, context.workspaceId, { runId: run.runId, tool: tool.name, proposal, now: context.now });
      run.proposals.push(card);
      return { status: "waiting_for_confirmation", card: run.proposals.length, summary: proposal.summary, note: "A confirmation card is shown to the person. Nothing has changed yet." };
    } catch (error) {
      if (error instanceof ToolQuestion) {
        const options = error.options.map((option) => ({ ...(option.href ? { source: context.cite(option) } : {}), type: option.type, id: option.id, label: option.label, ...(option.detail ? { detail: option.detail } : {}) }));
        return { question: error.message, ...(options.length ? { options: dataBlock(tool.name, options) } : {}) };
      }
      if (error instanceof ToolInputError || error instanceof HttpException) return { error: moduleMessage(error) };
      this.logger.warn(`Woddy tool ${tool.name} failed (${(error as Error)?.name ?? "unknown"})`);
      return { error: "That did not work. Tell the person it could not be done right now." };
    }
  }

  private finish(actor: RequestActor, workspaceId: string, runId: string, run: { status: string; rounds: number; inputTokens: number; outputTokens: number; stopped: string | null }) {
    return this.access.withPermission(actor, workspaceId, AI_USE, (client) => client.query(
      `UPDATE ai_agent_runs SET status = $3, rounds = $4, input_tokens = $5, output_tokens = $6, stop_reason = $7, finished_at = now() WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, runId, run.status, run.rounds, run.inputTokens, run.outputTokens, run.stopped]));
  }
}
