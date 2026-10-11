import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";
import type { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { REMINDER_CHAIN_LINKS, REMINDER_CHANNELS, REMINDER_UNITS, type ReminderChainLink, type ReminderChannel, type ReminderUnit } from "../reminders-contract";
import { parseVersion, ReminderSettingsService } from "./settings.service";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class HoursWindowDto {
  @ApiProperty() @Matches(HHMM) start!: string;
  @ApiProperty() @Matches(HHMM) end!: string;
}

export class ReminderSettingsBodyDto {
  @ApiProperty() @Matches(HHMM) quietStart!: string;
  @ApiProperty() @Matches(HHMM) quietEnd!: string;
  @ApiProperty() @Matches(HHMM) digestTime!: string;
  @ApiProperty({ type: HoursWindowDto, nullable: true }) @IsOptional() @ValidateNested() @Type(() => HoursWindowDto) clientWindow!: HoursWindowDto | null;
  @ApiProperty() @IsBoolean() criticalBreaksQuiet!: boolean;
  @ApiProperty() @IsInt() @Min(0) version!: number;
}

export class ReminderRuleBodyDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty({ type: [Number] }) @IsArray() @ArrayMaxSize(12) @IsInt({ each: true }) offsets!: number[];
  @ApiProperty({ enum: REMINDER_UNITS }) @IsIn(REMINDER_UNITS) unit!: ReminderUnit;
  @ApiProperty() @IsBoolean() workingDays!: boolean;
  @ApiProperty({ nullable: true }) @IsOptional() @IsInt() @Min(1) @Max(6) escalateAfter!: number | null;
  @ApiProperty({ enum: REMINDER_CHAIN_LINKS, isArray: true }) @IsArray() @ArrayMaxSize(5) @IsIn(REMINDER_CHAIN_LINKS, { each: true }) chain!: ReminderChainLink[];
  @ApiProperty({ enum: REMINDER_CHANNELS, isArray: true }) @IsArray() @ArrayMaxSize(4) @IsIn(REMINDER_CHANNELS, { each: true }) channels!: ReminderChannel[];
  @ApiProperty() @IsBoolean() digest!: boolean;
  @ApiProperty({ type: HoursWindowDto, nullable: true }) @IsOptional() @ValidateNested() @Type(() => HoursWindowDto) quietHours!: HoursWindowDto | null;
  @ApiProperty() @IsInt() @Min(0) version!: number;
}

export class PersonSettingsBodyDto {
  @ApiProperty() @IsBoolean() digestEnabled!: boolean;
  @ApiProperty({ nullable: true }) @IsOptional() @Matches(HHMM) digestTime!: string | null;
  @ApiProperty({ type: HoursWindowDto, nullable: true }) @IsOptional() @ValidateNested() @Type(() => HoursWindowDto) quietHours!: HoursWindowDto | null;
  @ApiProperty({ nullable: true }) @IsOptional() @IsString() @MaxLength(64) timeZone!: string | null;
  @ApiProperty() @IsInt() @Min(0) version!: number;
}

@ApiTags("reminders")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId")
export class ReminderSettingsController {
  constructor(private readonly settings: ReminderSettingsService) {}

  /** Settings › Reminders: the firm's settings and one rule per kind (reminders.manage). */
  @Get("reminders/settings") read(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.settings.settings(actor, workspaceId);
  }

  @Put("reminders/settings") save(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: ReminderSettingsBodyDto) {
    return this.settings.saveSettings(actor, workspaceId, { ...input, clientWindow: input.clientWindow ?? null });
  }

  @Put("reminders/rules/:kind") saveRule(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("kind") kind: string,
    @Body() input: ReminderRuleBodyDto) {
    return this.settings.saveRule(actor, workspaceId, kind, { ...input, escalateAfter: input.escalateAfter ?? null, quietHours: input.quietHours ?? null });
  }

  /** The kind back to its default (the firm's row removed). */
  @Delete("reminders/rules/:kind") resetRule(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("kind") kind: string,
    @Query("version") version: string) {
    return this.settings.resetRule(actor, workspaceId, kind, parseVersion(version));
  }

  /** Settings › Notifications: the signed-in person's digest, quiet hours and time zone. */
  @Get("notification-person-settings/me") person(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.settings.personSettings(actor, workspaceId);
  }

  @Put("notification-person-settings/me") savePerson(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: PersonSettingsBodyDto) {
    return this.settings.savePersonSettings(actor, workspaceId, { ...input, digestTime: input.digestTime ?? null, quietHours: input.quietHours ?? null, timeZone: input.timeZone ?? null });
  }
}
