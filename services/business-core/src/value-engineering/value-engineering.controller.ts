import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength, ValidateIf } from "class-validator";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { ValueEngineeringService } from "./value-engineering.service";

class StartDto {
  @IsString() @MinLength(1) @MaxLength(120) quoteId!: string;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(2000) note?: string | null;
}
class OptionsDto { @IsInt() @Min(1) version!: number; @IsString() @MinLength(1) @MaxLength(4000) note!: string; }
class MeetingDto {
  @IsInt() @Min(1) version!: number;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}T/) startsAt!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}T/) endsAt!: string;
  @IsString() @MaxLength(64) timezone!: string;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(500) address?: string | null;
}
class DecisionDto { @IsInt() @Min(1) version!: number; @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(2000) note?: string | null; }
class WithdrawDto { @IsInt() @Min(1) version!: number; @IsString() @MinLength(1) @MaxLength(2000) note!: string; }

/** PLM-147: value engineering on a job's estimate, led by the lead designer with the QS. */
@ApiTags("quotations")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/pre-projects/:caseId/value-engineering")
export class ValueEngineeringController {
  constructor(private readonly service: ValueEngineeringService) {}

  @Get()
  view(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Query("quote") quote?: string) {
    return this.service.view(actor, workspaceId, caseId, quote ?? null);
  }

  @Post("start")
  start(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: StartDto) {
    return this.service.start(actor, workspaceId, caseId, input);
  }

  @Post(":roundId/options")
  options(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("roundId", ParseUUIDPipe) roundId: string, @Body() input: OptionsDto) {
    return this.service.agree(actor, workspaceId, caseId, roundId, input);
  }

  @Post(":roundId/meeting")
  meeting(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("roundId", ParseUUIDPipe) roundId: string, @Body() input: MeetingDto) {
    return this.service.meeting(actor, workspaceId, caseId, roundId, input);
  }

  @Post(":roundId/keep-price")
  keepPrice(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("roundId", ParseUUIDPipe) roundId: string, @Body() input: DecisionDto) {
    return this.service.keepPrice(actor, workspaceId, caseId, roundId, input);
  }

  @Post(":roundId/withdraw")
  withdraw(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("roundId", ParseUUIDPipe) roundId: string, @Body() input: WithdrawDto) {
    return this.service.withdraw(actor, workspaceId, caseId, roundId, input);
  }
}
