import { Controller, Delete, Get, Inject, Post, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { Public } from "../auth/public.decorator";
import { protectedResourceMetadataUrl, requestOrigin } from "./mcp-oauth.domain";
import { McpOAuthService } from "./mcp-oauth.service";
import { jsonRpcError, McpSessionsService } from "./mcp-sessions.service";

/**
 * Wodana's MCP endpoint (W-5), Streamable HTTP at /api/v1/mcp on every host. It takes no Wodana sign-in: an
 * AI app presents an OAuth access token Wodana issued for this host's endpoint. Without one it answers 401
 * with where to find the authorization server (RFC 9728), which is how an app starts connecting.
 */
@ApiExcludeController()
@Public()
@Controller("mcp")
export class McpController {
  constructor(@Inject(McpOAuthService) private readonly oauth: McpOAuthService, @Inject(McpSessionsService) private readonly sessions: McpSessionsService) {}

  @Post()
  post(@Req() request: Request, @Res() response: Response) { return this.handle(request, response); }

  @Delete()
  remove(@Req() request: Request, @Res() response: Response) { return this.handle(request, response); }

  /** No server-initiated stream: everything the server sends goes on the response to the app's own request. */
  @Get()
  stream(@Res() response: Response) {
    response.status(405).set("Allow", "POST, DELETE").json(jsonRpcError(-32000, "Method not allowed."));
  }

  private async handle(request: Request, response: Response) {
    const origin = requestOrigin(request.headers);
    if (!origin) { response.status(400).json(jsonRpcError(-32600, "Unknown host.")); return; }
    // Streamed answers must reach the app as they are written (nginx buffers otherwise).
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Accel-Buffering", "no");
    const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? "")?.[1] ?? null;
    const principal = bearer ? await this.oauth.verifyAccessToken(bearer, origin) : null;
    if (!principal) {
      response.setHeader("WWW-Authenticate", `Bearer resource_metadata="${protectedResourceMetadataUrl(origin)}", scope="read write"${bearer ? ', error="invalid_token"' : ""}`);
      response.status(401).json(jsonRpcError(-32001, bearer ? "The access token is not valid. Connect the app again." : "Connect this app to Wodana first."));
      return;
    }
    await this.sessions.handle(request, response, principal, origin);
  }
}
