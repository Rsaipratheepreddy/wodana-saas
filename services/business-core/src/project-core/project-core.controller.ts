import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { ProjectCoreService } from "./project-core.service";

/** Projects: start from an accepted quotation, then stages, team and status. Bodies are validated in the service. */
@ApiTags("projects")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/project-core")
export class ProjectCoreController {
  constructor(private readonly projects: ProjectCoreService) {}

  @Get("settings")
  settings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.projects.settings(actor, workspaceId); }

  @Put("settings")
  saveSettings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) { return this.projects.saveSettings(actor, workspaceId, input ?? {}); }

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

  @Post("projects/:projectId")
  command(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string, @Body() input: Record<string, unknown>) { return this.projects.command(actor, workspaceId, projectId, input ?? {}); }
}
