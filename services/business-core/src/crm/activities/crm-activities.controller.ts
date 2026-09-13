import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { CrmActivitiesService } from "./crm-activities.service";
import { CompleteActivityDto, CreateActivityDto, CreateAppointmentDto, ListActivitiesQueryDto, UpdateActivityDto, UpdateAppointmentDto } from "./dto/activities.dto";

@ApiTags("crm-activities")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/crm")
export class CrmActivitiesController {
  constructor(private readonly activities: CrmActivitiesService) {}
  @Get("activities/:activityId") get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("activityId", ParseUUIDPipe) activityId: string) { return this.activities.get(actor, workspaceId, activityId); }
  @Get("activities") list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: ListActivitiesQueryDto) { return this.activities.list(actor, workspaceId, query); }
  @Post("activities") create(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: CreateActivityDto) { return this.activities.create(actor, workspaceId, input); }
  @Patch("activities/:activityId") update(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("activityId", ParseUUIDPipe) activityId: string, @Body() input: UpdateActivityDto) { return this.activities.update(actor, workspaceId, activityId, input); }
  @Post("activities/:activityId/complete") complete(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("activityId", ParseUUIDPipe) activityId: string, @Body() input: CompleteActivityDto) { return this.activities.complete(actor, workspaceId, activityId, input); }
  @Post("activities/:activityId/appointment") appointment(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("activityId", ParseUUIDPipe) activityId: string, @Body() input: CreateAppointmentDto) { return this.activities.createAppointment(actor, workspaceId, activityId, input); }
  @Patch("activities/:activityId/appointment") reschedule(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("activityId", ParseUUIDPipe) activityId: string, @Body() input: UpdateAppointmentDto) { return this.activities.updateAppointment(actor, workspaceId, activityId, input); }
}
