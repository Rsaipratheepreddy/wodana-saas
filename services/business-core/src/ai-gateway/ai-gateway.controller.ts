import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsInt, Min } from "class-validator";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { AiGatewayService } from "./ai-gateway.service";

export class AiSettingsDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty() @IsInt() @Min(0) version!: number;
}

@ApiTags("ai")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/ai-settings")
export class AiGatewayController {
  constructor(private readonly ai: AiGatewayService) {}
  @Get() get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.ai.settings(actor, workspaceId); }
  @Put() set(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: AiSettingsDto) { return this.ai.setEnabled(actor, workspaceId, body); }
}
