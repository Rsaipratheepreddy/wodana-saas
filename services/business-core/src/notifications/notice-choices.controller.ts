import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from "class-validator";
import type { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { NOTICE_CHANNELS, NOTICE_GROUP_IDS, type NoticeChannel, type NoticeGroup } from "./notice-choices";
import { NoticeChoicesService } from "./notice-choices.service";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class NoticeChoiceCellDto {
  @ApiProperty({ enum: NOTICE_GROUP_IDS }) @IsIn(NOTICE_GROUP_IDS as NoticeGroup[]) group!: NoticeGroup;
  @ApiProperty({ enum: NOTICE_CHANNELS }) @IsIn(NOTICE_CHANNELS as unknown as NoticeChannel[]) channel!: NoticeChannel;
  @ApiProperty() @IsBoolean() enabled!: boolean;
}

export class NoticeQuietHoursDto {
  @ApiProperty() @Matches(HHMM) start!: string;
  @ApiProperty() @Matches(HHMM) end!: string;
}

export class NoticeChoicesBodyDto {
  @ApiProperty({ type: [NoticeChoiceCellDto] }) @IsArray() @ArrayMaxSize(32) @ValidateNested({ each: true }) @Type(() => NoticeChoiceCellDto) choices!: NoticeChoiceCellDto[];
  @ApiProperty({ type: NoticeQuietHoursDto, nullable: true }) @IsOptional() @ValidateNested() @Type(() => NoticeQuietHoursDto) quietHours!: NoticeQuietHoursDto | null;
  @ApiProperty() @IsBoolean() digestEnabled!: boolean;
  @ApiProperty({ nullable: true }) @IsOptional() @Matches(HHMM) digestTime!: string | null;
  @ApiProperty({ nullable: true }) @IsOptional() @IsString() @MaxLength(64) timeZone!: string | null;
  @ApiProperty() @IsInt() @Min(0) version!: number;
}

@ApiTags("notifications")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/notification-choices")
export class NoticeChoicesController {
  constructor(private readonly choices: NoticeChoicesService) {}

  /** The signed-in person's channels per group, quiet hours, digest and zone, with the workspace's channels. */
  @Get("me") mine(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.choices.mine(actor, workspaceId);
  }

  /** Saves them in one version-checked, audited command. */
  @Put("me") save(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: NoticeChoicesBodyDto) {
    return this.choices.saveMine(actor, workspaceId, { ...input, quietHours: input.quietHours ?? null, digestTime: input.digestTime ?? null, timeZone: input.timeZone ?? null });
  }
}
