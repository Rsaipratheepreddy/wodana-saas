import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import { ApiHeader, ApiTags } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsUUID } from "class-validator";
import { InternalServiceGuard } from "../auth/internal-service.guard";
import { PlatformOperatorGuard, type OperatorRequest } from "../auth/platform-operator.guard";
import { Public } from "../auth/public.decorator";
import { OperatorNotificationsService } from "./operator-notifications.service";

export class MarkOperatorNotificationsReadDto {
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID("all", { each: true }) ids?: string[];
  @IsOptional() @IsBoolean() all?: boolean;
}

/** The signed-in operator's own notices in Wodana Control (every operator has them; no permission beyond a session). */
@ApiTags("operator console")
@Public()
@UseGuards(InternalServiceGuard, PlatformOperatorGuard)
@ApiHeader({ name: "x-wodana-internal-token", required: true })
@ApiHeader({ name: "x-wodana-operator-session", required: true })
@Controller("internal/operator/notifications")
export class OperatorNotificationsController {
  constructor(private readonly notifications: OperatorNotificationsService) {}

  @Get()
  list(@Req() request: OperatorRequest) {
    return this.notifications.list(request.platformOperator!.userId);
  }

  @Post("read")
  @HttpCode(HttpStatus.OK)
  markRead(@Body() input: MarkOperatorNotificationsReadDto, @Req() request: OperatorRequest) {
    return this.notifications.markRead(request.platformOperator!.userId, input);
  }
}
