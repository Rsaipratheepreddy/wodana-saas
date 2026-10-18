import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { JobsService } from "./jobs.service";
import { readJobsMyDay, type JobsMyDay } from "./my-day";

/**
 * `GET workspaces/:workspaceId/jobs/my-day`: the job steps that are mine now (my-day.ts). Registered before the jobs
 * controller so "my-day" is never read as a job id.
 */
@ApiTags("jobs")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/jobs")
export class JobsMyDayController {
  constructor(private readonly jobs: JobsService, private readonly access: WorkspaceAccessService) {}

  @Get("my-day")
  myDay(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string): Promise<JobsMyDay> {
    return readJobsMyDay({ jobs: this.jobs, access: this.access }, actor, workspaceId);
  }
}
