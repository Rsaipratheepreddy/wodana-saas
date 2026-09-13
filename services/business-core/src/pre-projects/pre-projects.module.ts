import {AssetMarkupService,AssetMarkupController} from './asset-markup.service';
import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ListPreProjectsDto, StartPreProjectDto, StartFromQualifiedLeadDto } from "./pre-projects.dto";
import { CrmOpportunitiesModule } from "../crm/opportunities/crm-opportunities.module";
import { PreProjectsService } from "./pre-projects.service";
import { ItemSpecificationService } from "./item-specification.service";
import { BriefService } from "./brief.service";
import { DesignService } from "./design.service";
import { CaseContentController } from "./case-content.controller";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { SiteController } from "./site.controller";
import { SiteService } from "./site.service";

@ApiTags("pre-projects")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/pre-projects")
export class PreProjectsController {
  constructor(private readonly service: PreProjectsService) {}
  @Get() list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: ListPreProjectsDto) { return this.service.list(actor, workspaceId, query); }
  @Get("candidates") candidates(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: ListPreProjectsDto) { return this.service.candidates(actor, workspaceId, query); }
  @Get("start-options") startOptions(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.service.startOptions(actor, workspaceId); }
  @Post("from-lead") startFromLead(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: StartFromQualifiedLeadDto) { return this.service.startFromLead(actor, workspaceId, body); }
  @Get(":id") get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string) { return this.service.get(actor, workspaceId, id); }
  @Post() start(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: StartPreProjectDto) { return this.service.start(actor, workspaceId, body.opportunityId); }
}
@Module({ imports: [WorkspacesModule, CrmOpportunitiesModule], controllers: [PreProjectsController,CaseContentController,SiteController,AssetMarkupController], providers: [PreProjectsService,BriefService,DesignService,BrandAssetStorageService,ItemSpecificationService,SiteService,AssetMarkupService] })
export class PreProjectsModule {}
