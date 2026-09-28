import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, Max, Min } from "class-validator";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { AiGatewayService } from "./ai-gateway.service";
import { AI_FEATURE_LIMITS } from "./ai-rate-limit.service";

export class AiSettingsDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty() @IsInt() @Min(0) version!: number;
}

export class AiGenerateDto {
  @ApiProperty({ enum: Object.keys(AI_FEATURE_LIMITS) }) @IsIn(Object.keys(AI_FEATURE_LIMITS)) feature!: string;
  @ApiProperty({ description: "The provider request without the model: systemInstruction, contents and generationConfig" }) @IsObject() request!: Record<string, unknown>;
  @ApiPropertyOptional({ minimum: 5000, maximum: 110000 }) @IsOptional() @IsInt() @Min(5000) @Max(110000) timeoutMs?: number;
}

@ApiTags("ai")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/ai-settings")
export class AiGatewayController {
  constructor(private readonly ai: AiGatewayService) {}
  @Get() get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.ai.settings(actor, workspaceId); }
  @Put() set(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: AiSettingsDto) { return this.ai.setEnabled(actor, workspaceId, body); }
}

/** The web assistants call the model only through here: the workspace's AI switch, permission, limit and log apply. */
@ApiTags("ai")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/ai")
export class AiGenerateController {
  constructor(private readonly ai: AiGatewayService) {}
  @Post("generate") @HttpCode(200) generate(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: AiGenerateDto) { return this.ai.generate(actor, workspaceId, body); }
}
