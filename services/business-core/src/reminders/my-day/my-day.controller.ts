import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiTags } from "@nestjs/swagger";
import { IsInt, IsISO8601, IsString, IsUUID, MaxLength, Min } from "class-validator";
import type { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { REMINDER_MODULES, type ReminderModule } from "../reminders-contract";
import { MY_DAY_URGENCIES, type MyDayFilter, type MyDayUrgency } from "./my-day";
import { MyDayService } from "./my-day.service";

export class MyDaySnoozeDto {
  @ApiProperty({ format: "date-time" }) @IsISO8601() until!: string;
  @ApiProperty() @IsString() @MaxLength(300) reason!: string;
  @ApiProperty() @IsInt() @Min(1) version!: number;
}
export class MyDayVersionDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
}
export class MyDayReassignDto {
  @ApiProperty({ format: "uuid" }) @IsUUID() membershipId!: string;
  @ApiProperty() @IsInt() @Min(1) version!: number;
}

/** The query of GET /my-day, checked here (scope, urgency, module, limit). */
export function parseMyDayQuery(query: Record<string, unknown>): MyDayFilter {
  const scope = query.scope === undefined || query.scope === "" ? "me" : query.scope;
  if (scope !== "me" && scope !== "team") throw new BadRequestException("Scope is me or team.");
  const urgency = query.urgency === undefined || query.urgency === "" ? undefined : query.urgency;
  if (urgency !== undefined && !(MY_DAY_URGENCIES as readonly unknown[]).includes(urgency)) throw new BadRequestException("Unknown urgency.");
  const module = query.module === undefined || query.module === "" ? undefined : query.module;
  if (module !== undefined && !(REMINDER_MODULES as readonly unknown[]).includes(module)) throw new BadRequestException("Unknown module.");
  const limit = query.limit === undefined || query.limit === "" ? undefined : Number(query.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 500)) throw new BadRequestException("Limit is 1 to 500.");
  return { scope, urgency: urgency as MyDayUrgency | undefined, module: module as ReminderModule | undefined, limit };
}

@ApiTags("reminders")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId")
export class MyDayController {
  constructor(private readonly myDay: MyDayService) {}

  /** The person's (or, with reminders.team, the team's) list of what is due: counts and items grouped by job. */
  @Get("my-day") list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: Record<string, unknown>) {
    return this.myDay.myDay(actor, workspaceId, parseMyDayQuery(query ?? {}));
  }

  @Post("my-day/:subjectId/snooze") snooze(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("subjectId", ParseUUIDPipe) subjectId: string, @Body() input: MyDaySnoozeDto) {
    return this.myDay.snooze(actor, workspaceId, subjectId, input);
  }

  @Post("my-day/:subjectId/unsnooze") unsnooze(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("subjectId", ParseUUIDPipe) subjectId: string, @Body() input: MyDayVersionDto) {
    return this.myDay.unsnooze(actor, workspaceId, subjectId, input);
  }

  @Post("my-day/:subjectId/complete") complete(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("subjectId", ParseUUIDPipe) subjectId: string, @Body() input: MyDayVersionDto) {
    return this.myDay.complete(actor, workspaceId, subjectId, input);
  }

  @Get("my-day/:subjectId/assignees") assignees(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("subjectId", ParseUUIDPipe) subjectId: string) {
    return this.myDay.assignees(actor, workspaceId, subjectId);
  }

  @Post("my-day/:subjectId/reassign") reassign(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("subjectId", ParseUUIDPipe) subjectId: string, @Body() input: MyDayReassignDto) {
    return this.myDay.reassign(actor, workspaceId, subjectId, input);
  }

  /** The reminders of one record: its subjects and their steps (the timeline). */
  @Get("reminders/subjects") subjects(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query("sourceKey") sourceKey: string) {
    return this.myDay.subjects(actor, workspaceId, String(sourceKey ?? ""));
  }
}
