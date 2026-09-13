import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query, BadRequestException } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { CatalogService } from "./catalog.service";
import { ArchiveCatalogDto, CatalogTargetDto, CreateCatalogDto, ImportCatalogDto, OrganizeCatalogDto, SaveCatalogRecordDto } from "./catalog.dto";

@ApiTags("workspace-catalog") @ApiBearerAuth()
@Controller("workspaces/:workspaceId/catalog")
export class CatalogController {
  constructor(private readonly service:CatalogService) {}
  @Get() list(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Query("overview") overview?:string,@Query("catalogId") catalogId?:string) {
    if (overview && !['true','false'].includes(overview)) throw new BadRequestException('Invalid catalog overview.');
    if (catalogId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(catalogId)) throw new BadRequestException('Invalid catalog identifier.');
    return this.service.list(actor,workspaceId,{overview:overview==='true',catalogId});
  }
  @Post("import") importRecords(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Body() body:ImportCatalogDto) { return this.service.importRecords(actor,workspaceId,body); }
  @Put("records") save(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Body() body:SaveCatalogRecordDto) { return this.service.save(actor,workspaceId,body); }
  @Patch("records/:id") archive(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Param("id",ParseUUIDPipe) id:string,@Body() body:ArchiveCatalogDto) { return this.service.archive(actor,workspaceId,id,body); }
  @Post("collections") create(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Body() body:CreateCatalogDto){return this.service.createCatalog(actor,workspaceId,body);}
  @Post("organize") organize(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Body() body:OrganizeCatalogDto){return this.service.organize(actor,workspaceId,body);}
  @Post("starter") starter(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Body() body:CatalogTargetDto) { return this.service.installStarter(actor,workspaceId,body.catalogId); }
}
@Module({imports:[WorkspacesModule],controllers:[CatalogController],providers:[CatalogService]})
export class CatalogModule {}
