import { Body, Controller, Delete, Get, Header, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  Equals, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from "class-validator";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { Public } from "../auth/public.decorator";
import { BookingTypesService } from "./booking-types.service";
import { BookingsService } from "./bookings.service";

class HostDto {
  @IsUUID() membershipId!: string;
  @IsOptional() @IsString() @MaxLength(100) enquiryType?: string | null;
}
class BookingTypeDto {
  @IsOptional() @IsInt() @Min(1) version?: number;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(60) slug?: string;
  @IsOptional() @IsInt() durationMinutes?: number;
  @IsOptional() @IsString() @MaxLength(16) color?: string;
  @IsOptional() @IsIn(["our_location", "client_address", "video", "phone"]) locationKind?: string;
  @IsOptional() @IsString() @MaxLength(500) locationDetail?: string | null;
  @IsOptional() @IsInt() bufferBeforeMinutes?: number;
  @IsOptional() @IsInt() bufferAfterMinutes?: number;
  @IsOptional() @IsInt() minimumNoticeMinutes?: number;
  @IsOptional() @IsInt() windowDays?: number;
  @IsOptional() @IsInt() maxPerDay?: number | null;
  @IsOptional() @IsInt() slotStepMinutes?: number;
  @IsOptional() @IsInt() cancelNoticeMinutes?: number;
  @IsOptional() @IsArray() questions?: unknown[];
  @IsOptional() @IsString() @MaxLength(100) enquiryType?: string | null;
  @IsOptional() @IsString() @MaxLength(100) source?: string;
  @IsOptional() @IsString() @MaxLength(60) channel?: string;
  @IsOptional() @IsIn(["one", "round_robin", "enquiry_type"]) hostsMode?: string;
  @IsOptional() @IsIn(["automatic", "approval"]) confirmation?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => HostDto) hosts?: HostDto[];
}
class OverrideDto {
  @IsUUID() membershipId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) startsOn!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) endsOn!: string;
  @IsIn(["extra", "blocked"]) kind!: "extra" | "blocked";
  @IsOptional() @IsString() @MaxLength(5) startTime?: string | null;
  @IsOptional() @IsString() @MaxLength(5) endTime?: string | null;
  @IsOptional() @IsString() @MaxLength(240) reason?: string | null;
}
class VersionDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
class ListBookingsDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsIn(["pending", "confirmed", "cancelled", "completed", "no_show"]) status?: string;
  @IsOptional() @IsUUID() typeId?: string;
}
class SlotsQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) to!: string;
  @IsOptional() @IsString() @MaxLength(100) enquiryType?: string;
}
class PublicBookingDto {
  @IsUUID() requestId!: string;
  @IsISO8601() start!: string;
  @IsString() @MaxLength(64) timeZone!: string;
  @IsOptional() @IsString() @MaxLength(100) enquiryType?: string;
  @IsObject() answers!: Record<string, string>;
  @IsOptional() @IsObject() consents?: { whatsapp?: boolean; email?: boolean; sms?: boolean };
  @IsBoolean() @Equals(true, { message: "Consent is required before booking" }) serviceConsent!: boolean;
  @IsOptional() @IsObject() link?: { source?: string; channel?: string; placement?: string; utm?: Record<string, string> };
  /** Junk protection: a field people never see, and how long the page was open. */
  @IsOptional() @IsString() @MaxLength(500) website?: string;
  @IsOptional() @IsInt() @Min(0) @Max(86_400_000) elapsedMs?: number;
}
class RescheduleDto {
  @IsInt() @Min(1) version!: number;
  @IsISO8601() start!: string;
  @IsOptional() @IsString() @MaxLength(64) timeZone?: string;
}

@ApiTags("booking")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/booking")
export class BookingController {
  constructor(private readonly types: BookingTypesService, private readonly bookings: BookingsService) {}

  @Get("types") listTypes(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.types.list(actor, workspaceId); }
  @Post("types") createType(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: BookingTypeDto) { return this.types.create(actor, workspaceId, input); }
  @Patch("types/:id") updateType(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: BookingTypeDto) { return this.types.update(actor, workspaceId, id, input); }
  @Get("overrides") listOverrides(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.types.listOverrides(actor, workspaceId); }
  @Post("overrides") createOverride(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: OverrideDto) { return this.types.createOverride(actor, workspaceId, input); }
  @Delete("overrides/:id") removeOverride(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string, @Query("version", ParseIntPipe) version: number) { return this.types.removeOverride(actor, workspaceId, id, version); }

  @Get("bookings") list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: ListBookingsDto) { return this.bookings.list(actor, workspaceId, query); }
  @Post("bookings/:id/confirm") confirm(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: VersionDto) { return this.bookings.confirm(actor, workspaceId, id, input.version); }
  @Post("bookings/:id/decline") decline(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: VersionDto) { return this.bookings.decline(actor, workspaceId, id, input.version, input.reason); }
  @Post("bookings/:id/complete") complete(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: VersionDto) { return this.bookings.complete(actor, workspaceId, id, input.version); }
  @Post("bookings/:id/no-show") noShow(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: VersionDto) { return this.bookings.noShow(actor, workspaceId, id, input.version); }
}

@Public()
@Controller("public/booking")
export class PublicBookingController {
  constructor(private readonly bookings: BookingsService) {}

  @Get(":workspace/manage/:token") manage(@Param("workspace") workspace: string, @Param("token") token: string) { return this.bookings.manageView(workspace, token); }
  @Get(":workspace/manage/:token/ics") @Header("content-type", "text/calendar; charset=utf-8") @Header("content-disposition", "attachment; filename=booking.ics")
  ics(@Param("workspace") workspace: string, @Param("token") token: string) { return this.bookings.manageIcs(workspace, token); }
  @Post(":workspace/manage/:token/cancel") cancel(@Param("workspace") workspace: string, @Param("token") token: string, @Body() input: VersionDto) { return this.bookings.cancelByVisitor(workspace, token, input); }
  @Post(":workspace/manage/:token/reschedule") reschedule(@Param("workspace") workspace: string, @Param("token") token: string, @Body() input: RescheduleDto) { return this.bookings.rescheduleByVisitor(workspace, token, input); }
  @Get(":workspace/:type") type(@Param("workspace") workspace: string, @Param("type") type: string) { return this.bookings.publicType(workspace, type); }
  @Get(":workspace/:type/slots") slots(@Param("workspace") workspace: string, @Param("type") type: string, @Query() query: SlotsQueryDto) { return this.bookings.publicSlots(workspace, type, query); }
  @Post(":workspace/:type") create(@Param("workspace") workspace: string, @Param("type") type: string, @Body() input: PublicBookingDto) { return this.bookings.create(workspace, type, input as never); }
}
