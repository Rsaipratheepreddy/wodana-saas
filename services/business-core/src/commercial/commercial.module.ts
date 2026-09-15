import {UseGuards} from "@nestjs/common";
import {InternalServiceGuard} from "../auth/internal-service.guard";
import {AccountingReconciliationService} from "./accounting-reconciliation.service";
import { StreamableFile } from "@nestjs/common";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import {
  Body,
  Controller,
  Get,
  Headers,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { CurrentActor } from "../auth/current-actor.decorator";
import type { RequestActor } from "../auth/actor";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { CommercialService } from "./commercial.service";
import { ClientPortalService } from "./client-portal.service";
import { CatalogSellingPriceService } from "./catalog-selling-price.service";
@Controller("workspaces/:workspaceId/commercial")
export class CommercialController {
  constructor(private readonly service: CommercialService) {}
  @Get("quotation-templates") quotationTemplates(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string) { return this.service.quotationTemplates(a, w); }
  @Get("quotation-templates/:templateId") prepareQuotationTemplate(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("templateId", ParseUUIDPipe) id: string) { return this.service.prepareQuotationTemplate(a, w, id); }
  @Put("quotation-templates") saveQuotationTemplate(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Body() b: unknown) { return this.service.saveQuotationTemplate(a, w, b); }
  @Post("cases/:caseId/invoice") invoice(@CurrentActor() a:RequestActor,@Param("workspaceId",ParseUUIDPipe) w:string,@Param("caseId",ParseUUIDPipe) c:string,@Body() b:unknown,@Headers("authorization") authorization:string){return this.service.syncInvoice(a,w,c,b,authorization);}
  @Get("cases/:caseId/catalog-options") catalogOptions(@CurrentActor() a:RequestActor,@Param("workspaceId",ParseUUIDPipe) w:string,@Param("caseId",ParseUUIDPipe) c:string,@Query() q:Record<string,string>){return this.service.catalogOptions(a,w,c,q);}
  @Get("cases/:caseId/master-catalog") masterCatalog(@CurrentActor() a:RequestActor,@Param("workspaceId",ParseUUIDPipe) w:string,@Param("caseId",ParseUUIDPipe) c:string){return this.service.masterCatalog(a,w,c);}
  @Get("cases/:caseId/catalog-item-context") catalogItemContext(@CurrentActor() a:RequestActor,@Param("workspaceId",ParseUUIDPipe) w:string,@Param("caseId",ParseUUIDPipe) c:string,@Query("workId",ParseUUIDPipe) work:string){return this.service.catalogItemContext(a,w,c,work);}
  @Post("cases/:caseId/catalog-price") catalogPrice(@CurrentActor() a:RequestActor,@Param("workspaceId",ParseUUIDPipe) w:string,@Param("caseId",ParseUUIDPipe) c:string,@Body() b:unknown){return this.service.catalogPrice(a,w,c,b);}
  @Get("payment-templates") templates(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
  ) {
    return this.service.paymentTemplates(a, w);
  }
  @Put("payment-templates") saveTemplate(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Body() b: unknown,
  ) {
    return this.service.savePaymentTemplate(a, w, b);
  }
  @Get("cases/:caseId/catalog-context") context(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("caseId", ParseUUIDPipe) c: string,
  ) {
    return this.service.catalogContext(a, w, c);
  }
  @Get("portal-settings") settings(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
  ) {
    return this.service.settings(actor, w);
  }
  @Put("portal-settings") saveSettings(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Body() body: unknown,
  ) {
    return this.service.saveSettings(actor, w, body);
  }
  @Get("cases/:caseId") state(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("caseId", ParseUUIDPipe) c: string,
  ) {
    return this.service.state(actor, w, c);
  }
  @Post("cases/:caseId") command(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("caseId", ParseUUIDPipe) c: string,
    @Body() body: unknown,
  ) {
    return this.service.command(actor, w, c, body);
  }
  @Put("cases/:caseId/contacts") contact(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("caseId", ParseUUIDPipe) c: string,
    @Body() body: unknown,
  ) {
    return this.service.contact(actor, w, c, body);
  }
}
@Public()
@Controller("client-portal/:slug")
export class ClientPortalController {
  constructor(private readonly service: ClientPortalService) {}
  @Get("brand") brand(@Param("slug") slug: string) {
    return this.service.branding(slug);
  }
  @Post("challenge") challenge(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @Headers("authorization") auth = "",
  ) {
    return this.service.challenge(slug, body, auth.replace(/^Bearer /, ""));
  }
  @Post("login") login(@Param("slug") slug: string, @Body() body: unknown) {
    return this.service.login(slug, body);
  }
  @Get("project-files/:projectId/:fileId") async projectFile(@Param("slug") slug:string,@Param("projectId",ParseUUIDPipe) p:string,@Param("fileId",ParseUUIDPipe) f:string,@Headers("authorization") auth=""){const file=await this.service.projectFile(slug,auth.replace(/^Bearer /,""),p,f);return new StreamableFile(file.body,{type:file.mimeType,disposition:'inline'});}
  @Get("designs/:versionId") async design(@Param("slug") slug:string,@Param("versionId",ParseUUIDPipe) id:string,@Headers("authorization") auth=""){const file=await this.service.designAsset(slug,auth.replace(/^Bearer /,""),id);return new StreamableFile(file.body,{type:file.mimeType,disposition:'inline'});}
  @Get("data") data(
    @Param("slug") slug: string,
    @Headers("authorization") auth = "",
  ) {
    return this.service.data(slug, auth.replace(/^Bearer /, ""));
  }
  @Post("action") action(
    @Param("slug") slug: string,
    @Headers("authorization") auth = "",
    @Body() body: unknown,
  ) {
    return this.service.command(slug, auth.replace(/^Bearer /, ""), body);
  }
  @Post("logout") logout(
    @Param("slug") slug: string,
    @Headers("authorization") auth = "",
  ) {
    return this.service.logout(slug, auth.replace(/^Bearer /, ""));
  }
}
@Public()
@UseGuards(InternalServiceGuard)
@Controller("internal/commercial/reconciliation")
export class InternalAccountingReconciliationController {
 constructor(private readonly service:AccountingReconciliationService){}
 @Post("claim") claim(){return this.service.claim();}
 @Post("result") result(@Body() b:unknown){return this.service.finish(b);}
}
@Module({
  imports: [WorkspacesModule],
  controllers: [InternalAccountingReconciliationController,CommercialController, ClientPortalController],
  providers: [AccountingReconciliationService,InternalServiceGuard,CatalogSellingPriceService,CommercialService, ClientPortalService, BrandAssetStorageService],
})
export class CommercialModule {}
