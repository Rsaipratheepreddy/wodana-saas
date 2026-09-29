import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from "class-validator";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { AiAgentService } from "./ai-agent.service";
import { AiToolCallsService } from "./ai-tool-calls.service";

export class AgentMessageDto {
  @ApiProperty({ enum: ["user", "assistant"] }) @IsIn(["user", "assistant"]) role!: "user" | "assistant";
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(3000) text!: string;
}

export class AgentContextDto {
  @ApiProperty() @IsIn(["enquiry", "opportunity", "customer", "conversation", "project", "work_item", "crm_task", "quotation"]) type!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120) id!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(240) label?: string;
}

export class AgentSelectionDto {
  @ApiProperty({ enum: ["conversation", "enquiry"] }) @IsIn(["conversation", "enquiry"]) type!: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(50) @IsUUID("all", { each: true }) ids!: string[];
}

export class AgentAskDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(3000) message!: string;
  @ApiPropertyOptional({ type: [AgentMessageDto] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => AgentMessageDto) history?: AgentMessageDto[];
  @ApiProperty({ enum: ["panel", "inbox", "comment", "search"] }) @IsIn(["panel", "inbox", "comment", "search"]) surface!: "panel" | "inbox" | "comment" | "search";
  @ApiPropertyOptional() @IsOptional() @ValidateNested() @Type(() => AgentContextDto) context?: AgentContextDto;
  @ApiPropertyOptional() @IsOptional() @ValidateNested() @Type(() => AgentSelectionDto) selection?: AgentSelectionDto;
}

export class ConfirmToolCallDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional({ type: [String], description: "The items kept ticked on a multi-record card" }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID("all", { each: true }) selection?: string[];
}

export class RejectToolCallDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
}

/** Woddy's tools (W-1): ask, and confirm or cancel what Woddy prepared. */
@ApiTags("ai")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/ai")
export class AiToolsController {
  constructor(private readonly agent: AiAgentService, private readonly calls: AiToolCallsService) {}

  @Post("agent/runs") @HttpCode(200)
  ask(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: AgentAskDto) {
    return this.agent.ask(actor, workspaceId, body);
  }

  @Get("tools")
  tools(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.agent.catalogue(actor, workspaceId);
  }

  @Get("tool-calls/:toolCallId")
  get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("toolCallId", ParseUUIDPipe) toolCallId: string) {
    return this.calls.get(actor, workspaceId, toolCallId);
  }

  @Post("tool-calls/:toolCallId/confirm") @HttpCode(200)
  confirm(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("toolCallId", ParseUUIDPipe) toolCallId: string, @Body() body: ConfirmToolCallDto) {
    return this.calls.confirm(actor, workspaceId, toolCallId, body);
  }

  @Post("tool-calls/:toolCallId/reject") @HttpCode(200)
  reject(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("toolCallId", ParseUUIDPipe) toolCallId: string, @Body() body: RejectToolCallDto) {
    return this.calls.reject(actor, workspaceId, toolCallId, body);
  }
}
