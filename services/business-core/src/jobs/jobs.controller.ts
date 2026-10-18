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

  @Get("overview")
  overview(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query("limit") limit?: string, @Query("offset") offset?: string) {
    return this.jobs.overview(actor, workspaceId, limit, offset);
  }

  @Get("threads")
  threads(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.jobs.threads(actor, workspaceId);
  }

  @Get("now")
  now(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query("records") records?: string) {
    return this.jobs.nowByRecords(actor, workspaceId, records);
  }

  @Get(":jobId")
  get(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("jobId", ParseUUIDPipe) jobId: string,
  ) {
    return this.jobs.get(actor, workspaceId, jobId);
  }

  @Get("by-source/:type/:id")
  bySource(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("type") type: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.jobs.bySource(actor, workspaceId, type, id);
  }

  @Get(":jobId/thread")
  thread(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("jobId", ParseUUIDPipe) jobId: string) {
    return this.jobs.thread(actor, workspaceId, jobId);
  }

  @Post(":jobId/thread")
  post(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("jobId", ParseUUIDPipe) jobId: string, @Body() body: unknown) {
    return this.jobs.post(actor, workspaceId, jobId, body && typeof body === "object" ? body as Record<string, unknown> : {});
  }

  @Post(":jobId/thread/read")
  markRead(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("jobId", ParseUUIDPipe) jobId: string) {
    return this.jobs.markThreadRead(actor, workspaceId, jobId);
  }

  @Get(":jobId/suggestions")
  suggestions(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("jobId", ParseUUIDPipe) jobId: string) {
    return this.jobs.suggestions(actor, workspaceId, jobId);
  }

  @Post(":jobId/suggestions/:suggestionId")
  decideSuggestion(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("jobId", ParseUUIDPipe) jobId: string,
    @Param("suggestionId", ParseUUIDPipe) suggestionId: string, @Body() body: unknown) {
    return this.jobs.decideSuggestion(actor, workspaceId, jobId, suggestionId, body && typeof body === "object" ? body as Record<string, unknown> : {});
  }

  @Get(":jobId/costs")
  costs(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("jobId", ParseUUIDPipe) jobId: string) {
    return this.jobs.costs(actor, workspaceId, jobId);
  }

  @Get(":jobId/money")
  money(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("jobId", ParseUUIDPipe) jobId: string) {
    return this.jobs.money(actor, workspaceId, jobId);
  }

  @Get(":jobId/documents")
  documents(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("jobId", ParseUUIDPipe) jobId: string) {
    return this.jobs.documents(actor, workspaceId, jobId);
  }

  @Get(":jobId/journey")
  journey(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("jobId", ParseUUIDPipe) jobId: string) {
    return this.jobs.journey(actor, workspaceId, jobId);
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
