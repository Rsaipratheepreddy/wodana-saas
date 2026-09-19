import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query, BadRequestException, Res, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { CatalogService } from "./catalog.service";
import { CatalogAssetsService, CATALOG_ASSET_MAX_BYTES } from "./catalog-assets.service";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { ArchiveCatalogDto, CatalogAssetUploadQueryDto, CatalogTargetDto, CreateCatalogDto, ImportCatalogDto, OrganizeCatalogDto, RecipePreviewDto, SaveCatalogRecordDto, UpdateCatalogAssetDto } from "./catalog.dto";

@ApiTags("workspace-catalog") @ApiBearerAuth()
@Controller("workspaces/:workspaceId/catalog")
export class CatalogController {
  constructor(private readonly service:CatalogService,private readonly assets:CatalogAssetsService) {}
  @Get() list(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Query("overview") overview?:string,@Query("catalogId") catalogId?:string) {
    if (overview && !['true','false'].includes(overview)) throw new BadRequestException('Invalid catalog overview.');
    if (catalogId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(catalogId)) throw new BadRequestException('Invalid catalog identifier.');
    return this.service.list(actor,workspaceId,{overview:overview==='true',catalogId});
  }
  @Post("import") importRecords(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Body() body:ImportCatalogDto) { return this.service.importRecords(actor,workspaceId,body); }
  @Post("preview") preview(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Body() body:RecipePreviewDto) { return this.service.preview(actor,workspaceId,body); }
  @Put("records") save(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Body() body:SaveCatalogRecordDto) { return this.service.save(actor,workspaceId,body); }
  @Patch("records/:id") archive(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Param("id",ParseUUIDPipe) id:string,@Body() body:ArchiveCatalogDto) { return this.service.archive(actor,workspaceId,id,body); }
  @Post("collections") create(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Body() body:CreateCatalogDto){return this.service.createCatalog(actor,workspaceId,body);}
  @Post("organize") organize(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Body() body:OrganizeCatalogDto){return this.service.organize(actor,workspaceId,body);}
  @Post("starter") starter(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Body() body:CatalogTargetDto) { return this.service.installStarter(actor,workspaceId,body.catalogId); }
  @Get("records/:recordId/assets") assetsList(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Param("recordId",ParseUUIDPipe) recordId:string,@Query("includeArchived") includeArchived?:string) {
    if (includeArchived && !["true","false"].includes(includeArchived)) throw new BadRequestException("Invalid archived-file filter.");
    return this.assets.list(actor,workspaceId,recordId,includeArchived==="true");
  }
  @Post("records/:recordId/assets/:assetId")
  @UseInterceptors(FileInterceptor("file",{limits:{fileSize:CATALOG_ASSET_MAX_BYTES,files:1,fields:3}}))
  assetUpload(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Param("recordId",ParseUUIDPipe) recordId:string,@Param("assetId",ParseUUIDPipe) assetId:string,@Query() query:CatalogAssetUploadQueryDto,@UploadedFile() file:{buffer:Buffer;originalname:string;mimetype:string;size:number}) {
    return this.assets.upload(actor,workspaceId,recordId,assetId,query,file);
  }
  @Patch("records/:recordId/assets/:assetId") assetUpdate(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Param("recordId",ParseUUIDPipe) recordId:string,@Param("assetId",ParseUUIDPipe) assetId:string,@Body() body:UpdateCatalogAssetDto) {
    return this.assets.update(actor,workspaceId,recordId,assetId,body);
  }
  @Get("records/:recordId/assets/:assetId/content") async assetContent(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Param("recordId",ParseUUIDPipe) recordId:string,@Param("assetId",ParseUUIDPipe) assetId:string,@Query("preview") preview:string,@Query("view") view:string,@Res({passthrough:true}) response:Response) {
    if (preview && !["0","1"].includes(preview)) throw new BadRequestException("Invalid preview option.");
    if (view && !["0","1"].includes(view)) throw new BadRequestException("Invalid file view option.");
    const file=await this.assets.read(actor,workspaceId,recordId,assetId,preview==="1");
    response.setHeader("Cache-Control","private, no-store");
    response.setHeader("X-Content-Type-Options","nosniff");
    response.setHeader("Content-Security-Policy","sandbox; default-src 'none'");
    return new StreamableFile(file.body,{type:file.contentType,disposition:`${file.preview||(view==="1"&&file.contentType==="application/pdf")?"inline":"attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`});
  }
}
@Module({imports:[WorkspacesModule],controllers:[CatalogController],providers:[CatalogService,CatalogAssetsService,BrandAssetStorageService]})
export class CatalogModule {}
