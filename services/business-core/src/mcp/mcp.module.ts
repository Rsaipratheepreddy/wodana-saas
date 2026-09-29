import { Module } from "@nestjs/common";
import { AiToolsModule } from "../ai-tools/ai-tools.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { McpController } from "./mcp.controller";
import { McpOAuthController, McpSettingsController } from "./mcp-oauth.controller";
import { McpOAuthService } from "./mcp-oauth.service";
import { McpRateLimitService } from "./mcp-rate-limit.service";
import { McpSessionsService } from "./mcp-sessions.service";
import { McpToolsService } from "./mcp-tools.service";

/**
 * AI apps through MCP (W-5): Woddy's tools served to an AI app (Claude Desktop, …) at /api/v1/mcp, acting as
 * the person who connected it, with Wodana as the OAuth authorization server.
 */
@Module({
  imports: [WorkspacesModule, AiToolsModule],
  controllers: [McpController, McpOAuthController, McpSettingsController],
  providers: [McpRateLimitService, McpOAuthService, McpToolsService, McpSessionsService],
})
export class McpModule {}
