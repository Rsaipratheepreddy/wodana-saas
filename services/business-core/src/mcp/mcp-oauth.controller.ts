import { BadRequestException, Body, Controller, Get, Header, HttpCode, HttpException, Inject, Logger, Param, ParseUUIDPipe, Post, Put, Req, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeController, ApiProperty, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsInt, Min } from "class-validator";
import type { Request, Response } from "express";
import type { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { Public } from "../auth/public.decorator";
import { authorizationServerMetadata, OAuthError, protectedResourceMetadata, requestOrigin } from "./mcp-oauth.domain";
import { McpOAuthService, RedirectableOAuthError } from "./mcp-oauth.service";

const header = (request: Request, name: string) => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/** The origin the person or app used; the web app forwards it for the routes it proxies. */
function originOf(request: Request) {
  const origin = requestOrigin(request.headers, { forwarded: true });
  if (!origin) throw new BadRequestException("Unknown host.");
  return origin;
}

/** An OAuth refusal in the RFC 6749 shape ({ error, error_description }), with its status. */
function oauthFailure(error: unknown, logger: Logger): never {
  if (error instanceof OAuthError) throw new HttpException(error.body, error.status);
  if (error instanceof HttpException) {
    const body = error.getResponse();
    const description = typeof body === "string" ? body : String((body as { message?: unknown })?.message ?? error.message);
    throw new HttpException({ error: error.getStatus() === 403 ? "access_denied" : "invalid_request", error_description: description }, error.getStatus());
  }
  logger.error(`OAuth request failed (${(error as Error)?.name ?? "unknown"})`);
  throw new HttpException({ error: "server_error", error_description: "The request could not be completed." }, 500);
}

/**
 * Wodana as the OAuth 2.1 authorization server for AI apps (W-5). The metadata, registration, token and
 * revocation endpoints are public (an app calls them); the consent is answered for the signed-in person, from
 * the web app's /oauth/authorize page.
 */
@ApiExcludeController()
@Controller("mcp/oauth")
export class McpOAuthController {
  private readonly logger = new Logger(McpOAuthController.name);
  constructor(@Inject(McpOAuthService) private readonly oauth: McpOAuthService) {}

  /** RFC 8414, served at /.well-known/oauth-authorization-server by the web app. */
  @Public() @Get("authorization-server") @Header("Cache-Control", "no-store")
  authorizationServer(@Req() request: Request) { return authorizationServerMetadata(originOf(request)); }

  /** RFC 9728, served at /.well-known/oauth-protected-resource[/api/v1/mcp] by the web app. */
  @Public() @Get("protected-resource") @Header("Cache-Control", "no-store")
  protectedResource(@Req() request: Request) { return protectedResourceMetadata(originOf(request)); }

  /** RFC 7591 dynamic client registration: an AI app registers itself before asking the person. */
  @Public() @Post("register") @HttpCode(201) @Header("Cache-Control", "no-store")
  async register(@Req() request: Request, @Body() body: Record<string, unknown>) {
    try { return await this.oauth.register(body, header(request, "x-real-ip") ?? request.ip ?? "unknown"); }
    catch (error) { oauthFailure(error, this.logger); }
  }

  @Public() @Post("token") @HttpCode(200) @Header("Cache-Control", "no-store") @Header("Pragma", "no-cache")
  async token(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: Record<string, unknown>) {
    try { return await this.oauth.token(body ?? {}, header(request, "authorization")); }
    catch (error) {
      if (error instanceof OAuthError && error.status === 401) response.setHeader("WWW-Authenticate", 'Basic realm="wodana"');
      oauthFailure(error, this.logger);
    }
  }

  /** RFC 7009: always 200 once the client is known, whether or not the token was valid. */
  @Public() @Post("revoke") @HttpCode(200) @Header("Cache-Control", "no-store")
  async revoke(@Req() request: Request, @Body() body: Record<string, unknown>) {
    try { await this.oauth.revoke(body ?? {}, header(request, "authorization")); return {}; }
    catch (error) { oauthFailure(error, this.logger); }
  }

  /** The consent screen's content for the signed-in person (the query is the app's /oauth/authorize query). */
  @Get("authorize") @Header("Cache-Control", "no-store")
  async authorization(@CurrentActor() actor: RequestActor, @Req() request: Request) {
    try { return await this.oauth.authorization(actor, (request.originalUrl ?? request.url).split("?")[1] ?? "", originOf(request)); }
    catch (error) { throw consentFailure(error); }
  }

  /** Allow or deny; the answer is where the browser returns to the app. */
  @Post("authorize") @HttpCode(200) @Header("Cache-Control", "no-store")
  async decide(@CurrentActor() actor: RequestActor, @Req() request: Request, @Body() body: Record<string, unknown>) {
    try { return await this.oauth.decide(actor, body ?? {}, originOf(request)); }
    catch (error) { throw consentFailure(error); }
  }
}

/** A refused authorization request, for the consent screen: the reason, and where the app can be told. */
function consentFailure(error: unknown) {
  if (error instanceof OAuthError) {
    return new BadRequestException({ message: error.description, code: error.error, ...(error instanceof RedirectableOAuthError ? { redirectTo: error.redirectTo } : {}) });
  }
  return error;
}

export class McpSettingsDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty() @IsInt() @Min(0) version!: number;
}

export class RevokeMcpConnectionDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
}

/** Settings → Connections → AI apps: the workspace switch (owners) and connected apps (each person's own; owners all). */
@ApiTags("ai")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/ai/mcp")
export class McpSettingsController {
  constructor(@Inject(McpOAuthService) private readonly oauth: McpOAuthService) {}

  @Get()
  overview(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.oauth.overview(actor, workspaceId);
  }

  @Put()
  setEnabled(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: McpSettingsDto) {
    return this.oauth.setEnabled(actor, workspaceId, body);
  }

  @Post("connections/:connectionId/revoke") @HttpCode(200)
  revoke(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("connectionId", ParseUUIDPipe) connectionId: string, @Body() body: RevokeMcpConnectionDto) {
    return this.oauth.revokeConnection(actor, workspaceId, connectionId, body);
  }
}
