import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from "class-validator";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { BOOKING_KINDS } from "./team-calendars.domain";
import { TeamCalendarsService } from "./team-calendars.service";

class RangeQuery { @Matches(/^\d{4}-\d{2}-\d{2}$/) from!: string; @Matches(/^\d{4}-\d{2}-\d{2}$/) to!: string; }
class SettingsDto {
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsUUID() connectionId?: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(500) calendarId?: string | null;
  @IsInt() @Min(0) version!: number;
  @IsOptional() @IsInt() @Min(1) @Max(60) designDrawingDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(60) renderDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(60) drawingDays?: number;
}
class BookDto {
  @IsUUID() caseId!: string;
  @IsIn([...BOOKING_KINDS]) kind!: string;
  @IsUUID() assigneeMembershipId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) startsOn!: string;
  @IsOptional() @IsInt() @Min(1) @Max(60) days?: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsUUID() commandId!: string;
}
class ChangeBookingDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) startsOn?: string;
  @IsOptional() @IsInt() @Min(1) @Max(60) days?: number;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
class PushResultDto {
  @IsString() @MaxLength(120) entryKey!: string;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(200) eventId?: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(500) etag?: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(64) fingerprint?: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @Matches(/^\d{4}-\d{2}-\d{2}$/) startsOn?: string | null;
  @IsOptional() @IsBoolean() removed?: boolean;
}
class PushesDto {
  @IsUUID() connectionId!: string;
  @IsString() @MaxLength(500) calendarId!: string;
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => PushResultDto) results!: PushResultDto[];
}

/** Team calendars (PLM-090, PLM-091): the design and the factory/logistics calendars, render and 2D bookings, the Google push. */
@ApiTags("team-calendars")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/team-calendars")
export class TeamCalendarsController {
  constructor(private readonly calendars: TeamCalendarsService) {}

  @Get("settings")
  settings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.calendars.settings(actor, workspaceId); }

  @Get("booking-options")
  bookingOptions(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.calendars.bookingOptions(actor, workspaceId); }

  @Post("bookings")
  book(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: BookDto) { return this.calendars.book(actor, workspaceId, body); }

  @Post("bookings/:bookingId/:action")
  change(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("bookingId", ParseUUIDPipe) bookingId: string,
    @Param("action") action: string, @Body() body: ChangeBookingDto) { return this.calendars.changeBooking(actor, workspaceId, bookingId, action, body); }

  @Get(":team")
  entries(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("team") team: string, @Query() query: RangeQuery) {
    return this.calendars.entries(actor, workspaceId, team, query.from, query.to);
  }

  @Put(":team/settings")
  saveSettings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("team") team: string, @Body() body: SettingsDto) {
    return this.calendars.saveSettings(actor, workspaceId, team, body);
  }

  @Get(":team/push-plan")
  pushPlan(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("team") team: string) { return this.calendars.pushPlan(actor, workspaceId, team); }

  @Post(":team/pushes")
  pushes(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("team") team: string, @Body() body: PushesDto) {
    return this.calendars.recordPushes(actor, workspaceId, team, body);
  }
}
