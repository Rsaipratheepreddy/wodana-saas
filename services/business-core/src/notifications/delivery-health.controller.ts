import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiTags } from "@nestjs/swagger";
import { IsUUID } from "class-validator";
import type { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { DeliveryHealthService } from "./delivery-health.service";

export class DeliveryTestDto {
  @ApiProperty({ format: "uuid" }) @IsUUID() requestId!: string;
}

@ApiTags("notifications")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/delivery-health")
export class DeliveryHealthController {
  constructor(private readonly delivery: DeliveryHealthService) {}

  /** Per channel: set up or not, last success, last failure and why, and what is queued or failed. */
  @Get() health(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.delivery.health(actor, workspaceId);
  }

  /** Sends the person asking a test email (and a push to their phone, if registered). */
  @Post("test") test(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: DeliveryTestDto) {
    return this.delivery.sendTest(actor, workspaceId, input);
  }
}
