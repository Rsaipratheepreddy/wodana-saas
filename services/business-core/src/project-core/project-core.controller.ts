import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { ProjectCoreService } from "./project-core.service";
import { ProjectWorkService } from "./project-work.service";

/** Projects: start from an accepted quotation, then stages, team and status. Bodies are validated in the service. */
@ApiTags("projects")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/project-core")
export class ProjectCoreController {
  constructor(private readonly projects: ProjectCoreService, private readonly work: ProjectWorkService) {}

  @Get("settings")
  settings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.projects.settings(actor, workspaceId); }

  @Put("settings")
  saveSettings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) { return this.projects.saveSettings(actor, workspaceId, input ?? {}); }

  @Put("work-templates/:supply")
  saveWorkTemplate(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("supply") supply: string, @Body() input: Record<string, unknown>) {
    return this.projects.saveWorkTemplate(actor, workspaceId, supply, input ?? {});
  }

  @Post("routes")
  saveRoute(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) { return this.projects.saveTemplate(actor, workspaceId, input ?? {}); }

  @Post("routes/:templateId/archive")
  archiveRoute(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("templateId", ParseUUIDPipe) templateId: string) { return this.projects.archiveTemplate(actor, workspaceId, templateId); }

  @Get("ready")
  ready(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.projects.ready(actor, workspaceId); }

  @Get("start/:caseId")
  startState(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string) { return this.projects.startState(actor, workspaceId, caseId); }

  @Post("start/:caseId")
  start(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: Record<string, unknown>) { return this.projects.start(actor, workspaceId, caseId, input ?? {}); }

  @Get("projects")
  list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.projects.list(actor, workspaceId); }

  @Get("projects/:projectId")
  get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string) { return this.projects.get(actor, workspaceId, projectId); }

  @Get("projects/:projectId/scope")
  scope(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string) { return this.projects.scope(actor, workspaceId, projectId); }

  @Get("projects/:projectId/materials")
  materials(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string) { return this.projects.materials(actor, workspaceId, projectId); }

  @Get("projects/:projectId/seals/:sealId")
  seal(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string, @Param("sealId", ParseUUIDPipe) sealId: string) { return this.projects.seal(actor, workspaceId, projectId, sealId); }

  @Get("projects/:projectId/lines/:lineId")
  line(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string, @Param("lineId", ParseUUIDPipe) lineId: string) { return this.projects.line(actor, workspaceId, projectId, lineId); }

  @Get("projects/:projectId/close-out")
  closeOut(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string) { return this.projects.closeOut(actor, workspaceId, projectId); }

  @Post("projects/:projectId")
  command(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string, @Body() input: Record<string, unknown>) { return this.projects.command(actor, workspaceId, projectId, input ?? {}); }

  @Get("work")
  openWork(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query("view") view?: string) { return this.work.open(actor, workspaceId, view ?? "mine"); }

  @Get("work/insights")
  workInsights(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query("days") days?: string) { return this.work.insights(actor, workspaceId, days ?? "30"); }

  @Get("projects/:projectId/work")
  board(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string) { return this.work.board(actor, workspaceId, projectId); }

  @Get("projects/:projectId/work/:itemId")
  workItem(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string, @Param("itemId", ParseUUIDPipe) itemId: string) { return this.work.item(actor, workspaceId, projectId, itemId); }

  @Get("projects/:projectId/work/packages/:packageId/plan")
  packagePlan(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string, @Param("packageId", ParseUUIDPipe) packageId: string,
    @Query("startDate") startDate?: string) { return this.work.packagePlan(actor, workspaceId, projectId, packageId, startDate); }

  @Get("projects/:projectId/work/sprints/:sprintId")
  workSprint(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string, @Param("sprintId", ParseUUIDPipe) sprintId: string) {
    return this.work.sprint(actor, workspaceId, projectId, sprintId);
  }

  @Get("projects/:projectId/work/:itemId/ripple")
  workRipple(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string, @Param("itemId", ParseUUIDPipe) itemId: string,
    @Query("startDate") startDate?: string, @Query("dueDate") dueDate?: string) { return this.work.preview(actor, workspaceId, projectId, itemId, { startDate, dueDate }); }

  @Post("projects/:projectId/work")
  workCommand(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string, @Body() input: Record<string, unknown>) { return this.work.command(actor, workspaceId, projectId, input ?? {}); }
}
