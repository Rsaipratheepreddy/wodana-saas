import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { AllowWhenReadOnly } from "../auth/tenant-write-block.guard";
import { CatalogV2Service } from "./catalog-v2.service";
import { ItemReadinessService } from "./item-readiness.service";
import { AiCleanDto, ImportItemsDto, ArchiveItemDto, CreateAttributeDto, CreateCatalogDto, CreateCategoryDto, CreatePriceBookDto, ItemDto, MergeCategoryDto, UpdateCategoryDto, PriceBookStatusDto, PriceEntryDto, PricePreviewDto, ReviewPriceDto, SetComponentsDto, VerifyRecipeDto } from "./catalog-v2.dto";

@ApiTags("catalogs")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/catalogs")
export class CatalogV2Controller {
  constructor(private readonly catalogs: CatalogV2Service, private readonly readiness: ItemReadinessService) {}

  // Item readiness: the firm's settings (which columns count, which attributes hold a sheet's materials and labour) and one catalogue's items.
  @Get("readiness/settings") readinessSettings(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string) { return this.readiness.settings(a, w); }
  @Put("readiness/settings") saveReadinessSettings(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Body() body: Record<string, unknown>) { return this.readiness.saveSettings(a, w, body ?? {}); }
  @Get(":catalogId/readiness") catalogReadiness(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string,
    @Query("categoryId") categoryId?: string, @Query("search") search?: string) { return this.readiness.catalog(a, w, c, { categoryId, search }); }

  @Get() list(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string) { return this.catalogs.listCatalogs(a, w); }
  @Post() create(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Body() body: CreateCatalogDto) { return this.catalogs.createCatalog(a, w, body); }
  @Get(":catalogId/structure") structure(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string) { return this.catalogs.structure(a, w, c); }
  @Post(":catalogId/categories") category(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string, @Body() body: CreateCategoryDto) { return this.catalogs.createCategory(a, w, c, body); }
  @Patch(":catalogId/categories/:categoryId") updateCategory(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string,
    @Param("categoryId", ParseUUIDPipe) id: string, @Body() body: UpdateCategoryDto) { return this.catalogs.updateCategory(a, w, c, id, body); }
  @Post(":catalogId/categories/:categoryId/merge") mergeCategory(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string,
    @Param("categoryId", ParseUUIDPipe) id: string, @Body() body: MergeCategoryDto) { return this.catalogs.mergeCategory(a, w, c, id, body); }
  @Delete(":catalogId/categories/:categoryId") deleteCategory(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string,
    @Param("categoryId", ParseUUIDPipe) id: string, @Query("version", ParseIntPipe) version: number) { return this.catalogs.deleteCategory(a, w, c, id, version); }
  @Post(":catalogId/attributes") attribute(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string, @Body() body: CreateAttributeDto) { return this.catalogs.createAttribute(a, w, c, body); }
  @Get(":catalogId/items") items(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string,
    @Query("categoryId") categoryId?: string, @Query("search") search?: string, @Query("itemType") itemType?: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string) {
    return this.catalogs.listItems(a, w, c, { categoryId: categoryId || undefined, search, itemType: itemType || undefined, cursor, limit: limit ? Number(limit) : undefined });
  }
  @Post(":catalogId/items") createItem(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string, @Body() body: ItemDto) { return this.catalogs.createItem(a, w, c, body); }
  @Get(":catalogId/items/:itemId") item(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string, @Param("itemId", ParseUUIDPipe) i: string) { return this.catalogs.getItem(a, w, c, i); }
  @Put(":catalogId/items/:itemId") updateItem(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string, @Param("itemId", ParseUUIDPipe) i: string, @Body() body: ItemDto) { return this.catalogs.updateItem(a, w, c, i, body); }
  @Post(":catalogId/items/:itemId/archive") archive(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string, @Param("itemId", ParseUUIDPipe) i: string, @Body() body: ArchiveItemDto) { return this.catalogs.archiveItem(a, w, c, i, body.version); }
  @Post(":catalogId/items/:itemId/ai-components") aiComponents(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string, @Param("itemId", ParseUUIDPipe) i: string) { return this.catalogs.aiSuggestComponents(a, w, c, i); }
  /** PLM-166: the factory or technical team verifies a recipe, so its quantities are used on projects (or takes that back). */
  @Post(":catalogId/items/:itemId/recipe-verification") verifyRecipe(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string, @Param("itemId", ParseUUIDPipe) i: string, @Body() body: VerifyRecipeDto) { return this.catalogs.verifyRecipe(a, w, c, i, body); }
  @Put(":catalogId/items/:itemId/components") components(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string, @Param("itemId", ParseUUIDPipe) i: string, @Body() body: SetComponentsDto) { return this.catalogs.setComponents(a, w, c, i, body); }
  @Get(":catalogId/price-books") books(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string) { return this.catalogs.listPriceBooks(a, w, c); }
  @Post(":catalogId/price-books") createBook(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string, @Body() body: CreatePriceBookDto) { return this.catalogs.createPriceBook(a, w, c, body); }
  @Patch("price-books/:bookId/status") bookStatus(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("bookId", ParseUUIDPipe) b: string, @Body() body: PriceBookStatusDto) { return this.catalogs.setPriceBookStatus(a, w, b, body); }
  @Put("price-books/:bookId/items/:itemId") savePrice(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("bookId", ParseUUIDPipe) b: string, @Param("itemId", ParseUUIDPipe) i: string, @Body() body: PriceEntryDto) { return this.catalogs.savePrice(a, w, b, i, body); }
  @Post("prices/:entryId/review") review(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("entryId", ParseUUIDPipe) e: string, @Body() body: ReviewPriceDto) { return this.catalogs.reviewPrice(a, w, e, body); }
  @Post(":catalogId/import/ai-clean") aiClean(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string, @Body() body: AiCleanDto) { return this.catalogs.aiCleanImport(a, w, c, body); }
  @Post(":catalogId/import") importItems(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string, @Body() body: ImportItemsDto) { return this.catalogs.importItems(a, w, c, body); }
  @AllowWhenReadOnly() @Post(":catalogId/price-preview") preview(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("catalogId", ParseUUIDPipe) c: string, @Body() body: PricePreviewDto) { return this.catalogs.pricePreview(a, w, c, body); }
}
