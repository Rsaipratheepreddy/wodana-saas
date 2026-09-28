import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from "class-validator";
import type { RequestActor } from "../actor";
import { CurrentActor } from "../current-actor.decorator";
import { RequireRecentMfa } from "../mfa-step-up.decorator";
import { AllowDuringViewAs, HiddenDuringViewAs } from "./view-as.decorators";
import { VIEW_AS_MAX_MINUTES } from "./view-as.domain";
import { ViewAsService } from "./view-as.service";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export class StartViewAsDto {
  @ApiPropertyOptional({ enum: ["person", "role"] }) @IsOptional() @IsIn(["person", "role"]) kind?: "person" | "role";
  @ApiPropertyOptional({ format: "uuid" }) @ValidateIf((input: StartViewAsDto) => input.kind !== "role") @IsUUID() membershipId?: string;
  @ApiPropertyOptional({ format: "uuid" }) @ValidateIf((input: StartViewAsDto) => input.kind === "role") @IsUUID() roleId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(512) returnPath?: string;
  @ApiPropertyOptional({ minimum: 5, maximum: VIEW_AS_MAX_MINUTES }) @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(VIEW_AS_MAX_MINUTES) minutes?: number;
}

export class ViewAsSettingsDto {
  @IsBoolean() notifySubject!: boolean;
  @IsInt() @Min(0) version!: number;
}

@ApiTags("view as")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/view-as")
export class ViewAsController {
  constructor(private readonly viewAs: ViewAsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequireRecentMfa("workspace.view_as")
  @ApiOperation({ summary: "Start a read-only view as a team member, or a preview of a role (recent MFA required)" })
  @ApiOkResponse()
  start(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() input: StartViewAsDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    return this.viewAs.start(actor, workspaceId, input.kind === "role"
      ? { kind: "role", roleId: input.roleId!, returnPath: input.returnPath }
      : { kind: "person", membershipId: input.membershipId!, returnPath: input.returnPath, minutes: input.minutes }, idempotencyKey);
  }

  @Post(":sessionId/exit")
  @HttpCode(HttpStatus.OK)
  @AllowDuringViewAs()
  @ApiOperation({ summary: "Leave the view and return to your own session" })
  @ApiOkResponse()
  exit(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
  ) {
    return this.viewAs.exit(actor, workspaceId, sessionId);
  }

  @Get("about-me")
  @HiddenDuringViewAs()
  @ApiOperation({ summary: "Who viewed the workspace as the signed-in person: who, when and for how long" })
  @ApiOkResponse()
  aboutMe(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.viewAs.aboutMe(actor, workspaceId);
  }

  @Get("settings")
  @ApiOperation({ summary: "Whether people are told after someone viewed as them" })
  @ApiOkResponse()
  settings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.viewAs.settings(actor, workspaceId);
  }

  @Put("settings")
  @ApiOperation({ summary: "Turn the notice after a view on or off (version-checked)" })
  @ApiOkResponse()
  updateSettings(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() input: ViewAsSettingsDto,
  ) {
    return this.viewAs.updateSettings(actor, workspaceId, input);
  }
}
