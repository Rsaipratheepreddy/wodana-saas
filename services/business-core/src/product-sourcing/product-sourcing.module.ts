import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { AllowWhenReadOnly } from "../auth/tenant-write-block.guard";
import { CatalogV2Service } from "../catalog-core/catalog-v2.service";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { CANVA_CONNECT, CanvaConnectNotConfigured } from "./canva";
import { FitCheckService } from "./fit-check.service";
import { LinkPreviewService } from "./link-preview.service";
import { ProductClipService } from "./product-clip.service";
import { AccessPointDto, FitCheckDto, FitOverrideDto, ItemDimensionsDto, LinkPreviewDto, ReadClipDto, SaveClipDto, VersionDto } from "./product-sourcing.dto";

function image(response: Response, file: { body: Buffer; contentType: string }) {
  response.setHeader("Cache-Control", "private, max-age=300");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  return new StreamableFile(file.body, { type: file.contentType, disposition: "inline" });
}

@ApiTags("product-sourcing")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/product-sourcing")
export class ProductSourcingController {
  constructor(private readonly clips: ProductClipService, private readonly previews: LinkPreviewService, private readonly fits: FitCheckService) {}

  @Post("clips") read(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Body() body: ReadClipDto) { return this.clips.read(a, w, body); }
  @Get("clips/:clipId") get(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("clipId", ParseUUIDPipe) c: string) { return this.clips.get(a, w, c); }
  @Post("clips/:clipId/save") save(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("clipId", ParseUUIDPipe) c: string, @Body() body: SaveClipDto) { return this.clips.save(a, w, c, body); }
  @Post("clips/:clipId/discard") discard(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("clipId", ParseUUIDPipe) c: string, @Body() body: VersionDto) { return this.clips.discard(a, w, c, body.version); }
  @Get("clips/:clipId/images/:imageId") async clipImage(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("clipId", ParseUUIDPipe) c: string,
    @Param("imageId", ParseUUIDPipe) i: string, @Query("preview") preview: string, @Res({ passthrough: true }) response: Response) {
    return image(response, await this.clips.image(a, w, c, i, preview === "1"));
  }

  @Get("items/:itemId/source") source(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("itemId", ParseUUIDPipe) i: string) { return this.clips.itemSource(a, w, i); }
  @Put("items/:itemId/dimensions") dimensions(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("itemId", ParseUUIDPipe) i: string, @Body() body: ItemDimensionsDto) { return this.clips.saveDimensions(a, w, i, body); }

  @Post("link-previews") preview(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Body() body: LinkPreviewDto) { return this.previews.preview(a, w, body.url); }
  @Get("link-previews/:previewId/image") async previewImage(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("previewId", ParseUUIDPipe) p: string, @Res({ passthrough: true }) response: Response) {
    return image(response, await this.previews.image(a, w, p));
  }

  @Get("cases/:caseId/access-points") points(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("caseId", ParseUUIDPipe) c: string) { return this.fits.accessPoints(a, w, c); }
  @Put("cases/:caseId/access-points/:pointId") savePoint(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("caseId", ParseUUIDPipe) c: string,
    @Param("pointId", ParseUUIDPipe) p: string, @Body() body: AccessPointDto) { return this.fits.saveAccessPoint(a, w, c, p, body); }
  @Post("cases/:caseId/access-points/:pointId/archive") archivePoint(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("caseId", ParseUUIDPipe) c: string,
    @Param("pointId", ParseUUIDPipe) p: string, @Body() body: VersionDto) { return this.fits.archiveAccessPoint(a, w, c, p, body.version); }
  @AllowWhenReadOnly() @Post("cases/:caseId/fit-checks") check(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("caseId", ParseUUIDPipe) c: string, @Body() body: FitCheckDto) {
    return this.fits.check(a, w, c, body.itemIds);
  }
  @Post("cases/:caseId/fit-checks/overrides") override(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("caseId", ParseUUIDPipe) c: string, @Body() body: FitOverrideDto) {
    return this.fits.override(a, w, c, body);
  }
}

@Module({
  imports: [WorkspacesModule],
  controllers: [ProductSourcingController],
  providers: [ProductClipService, LinkPreviewService, FitCheckService, CatalogV2Service, BrandAssetStorageService, { provide: CANVA_CONNECT, useClass: CanvaConnectNotConfigured }],
  exports: [FitCheckService],
})
export class ProductSourcingModule {}
