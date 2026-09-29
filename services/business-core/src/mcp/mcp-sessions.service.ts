import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import type { McpPrincipal } from "./mcp-oauth.service";
import { createMcpServer, type McpSessionState } from "./mcp-server";
import { McpToolsService } from "./mcp-tools.service";

/** A session unused this long is closed; the app starts a new one (it gets a 404 and initializes again). */
export const MCP_SESSION_IDLE_MS = 30 * 60_000;
export const MCP_MAX_SESSIONS = 1_000;

type Entry = { server: Server; transport: StreamableHTTPServerTransport; connectionId: string; state: McpSessionState; lastSeen: number };

export const jsonRpcError = (code: number, message: string) => ({ jsonrpc: "2.0", error: { code, message }, id: null });

/**
 * Streamable HTTP sessions (MCP 2025-06-18) kept in this process: a session belongs to one AI app connection
 * and every request in it presents a valid token of that connection (checked before it gets here), so revoking
 * the app ends the session at its next request. Sessions let a tool call ask the person to confirm (elicitation)
 * on its own response stream.
 */
@Injectable()
export class McpSessionsService implements OnModuleDestroy {
  private readonly logger = new Logger(McpSessionsService.name);
  private readonly entries = new Map<string, Entry>();

  constructor(@Inject(McpToolsService) private readonly tools: McpToolsService) {}

  get size() { return this.entries.size; }

  async handle(request: Request, response: Response, principal: McpPrincipal, origin: string) {
    const header = request.headers["mcp-session-id"];
    const sessionId = Array.isArray(header) ? header[0] : header;
    if (sessionId) {
      const entry = this.entries.get(sessionId);
      if (!entry || entry.connectionId !== principal.connectionId) {
        response.status(404).json(jsonRpcError(-32001, "Session not found. Start a new session."));
        return;
      }
      entry.state.principal = principal;
      entry.state.origin = origin;
      entry.lastSeen = Date.now();
      await entry.transport.handleRequest(request, response, request.body);
      return;
    }
    if (request.method !== "POST" || !isInitializeRequest(request.body)) {
      response.status(400).json(jsonRpcError(-32000, "Start a session with an initialize request."));
      return;
    }
    this.sweep();
    const state: McpSessionState = { principal, origin };
    const server = createMcpServer(this.tools, state);
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => { this.entries.set(id, { server, transport, connectionId: principal.connectionId, state, lastSeen: Date.now() }); },
      onsessionclosed: (id) => { void this.close(id); },
    });
    transport.onclose = () => { if (transport.sessionId) this.entries.delete(transport.sessionId); };
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  }

  async onModuleDestroy() {
    await Promise.all([...this.entries.keys()].map((id) => this.close(id)));
  }

  private async close(id: string) {
    const entry = this.entries.get(id);
    this.entries.delete(id);
    await entry?.server.close().catch((error: unknown) => this.logger.warn(`MCP session close failed (${(error as Error)?.name ?? "unknown"})`));
  }

  /** Closes idle sessions, and the oldest ones when there are too many. */
  private sweep(now = Date.now()) {
    for (const [id, entry] of this.entries) if (now - entry.lastSeen > MCP_SESSION_IDLE_MS) void this.close(id);
    if (this.entries.size < MCP_MAX_SESSIONS) return;
    const oldest = [...this.entries.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen).slice(0, this.entries.size - MCP_MAX_SESSIONS + 1);
    for (const [id] of oldest) void this.close(id);
  }
}
