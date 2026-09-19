import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { JobsService } from "./jobs.service";
import { RepairJobLinkDto } from "./dto/repair-job-link.dto";
import { SetJobStageDto } from "./dto/set-job-stage.dto";

@ApiTags("jobs")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/jobs")
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.jobs.list(actor, workspaceId, limit, offset);
  }

  @Get(":jobId")
  get(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("jobId", ParseUUIDPipe) jobId: string,
  ) {
    return this.jobs.get(actor, workspaceId, jobId);
  }

  @Get(":jobId/tree")
  tree(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("jobId", ParseUUIDPipe) jobId: string,
  ) {
    return this.jobs.tree(actor, workspaceId, jobId);
  }

  @Put(":jobId/stage")
  setStage(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("jobId", ParseUUIDPipe) jobId: string,
    @Body() input: SetJobStageDto,
  ) {
    return this.jobs.setStage(actor, workspaceId, jobId, input);
  }

  @Post(":jobId/links/repair")
  repair(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("jobId", ParseUUIDPipe) jobId: string,
    @Body() input: RepairJobLinkDto,
  ) {
    return this.jobs.repair(actor, workspaceId, jobId, input);
  }
}
