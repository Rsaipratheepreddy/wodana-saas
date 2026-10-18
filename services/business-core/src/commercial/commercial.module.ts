import {UseGuards} from "@nestjs/common";
import {InternalServiceGuard} from "../auth/internal-service.guard";
import {AccountingReconciliationService} from "./accounting-reconciliation.service";
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
import { CatalogSellingPriceService } from "./catalog-selling-price.service";
import { PreProjectsModule } from "../pre-projects/pre-projects.module";
import { ProjectsModule } from "../projects/projects.module";
import { QuotationComposerService } from "./quotation-composer.service";
import { RestoreConfigurationRevisionDto } from "../workspaces/dto/restore-configuration-revision.dto";
@Controller("workspaces/:workspaceId/commercial")
export class CommercialController {
  constructor(
    private readonly service: CommercialService,
    private readonly composer: QuotationComposerService,
  ) {}
  @Get("quotation-templates") quotationTemplates(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string) { return this.service.quotationTemplates(a, w); }
  @Get("quotation-templates/:templateId") prepareQuotationTemplate(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("templateId", ParseUUIDPipe) id: string) { return this.service.prepareQuotationTemplate(a, w, id); }
  @Put("quotation-templates") saveQuotationTemplate(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Body() b: unknown) { return this.service.saveQuotationTemplate(a, w, b); }
  @Get("quotation-templates/:templateId/history") quotationTemplateHistory(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("templateId", ParseUUIDPipe) id: string) { return this.service.templateHistory(a, w, "quotation", id); }
  @Post("quotation-templates/:templateId/archive") archiveQuotationTemplate(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("templateId", ParseUUIDPipe) id: string, @Body() b: unknown) { return this.service.archiveTemplate(a, w, "quotation", id, b); }
  @Post("quotation-templates/:templateId/rollback") rollbackQuotationTemplate(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("templateId", ParseUUIDPipe) id: string, @Body() b: RestoreConfigurationRevisionDto) { return this.service.rollbackTemplate(a, w, "quotation", id, b); }
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
  @Get("payment-templates/:templateId/history") paymentTemplateHistory(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("templateId", ParseUUIDPipe) id: string) { return this.service.templateHistory(a, w, "payment", id); }
  @Post("payment-templates/:templateId/archive") archivePaymentTemplate(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("templateId", ParseUUIDPipe) id: string, @Body() b: unknown) { return this.service.archiveTemplate(a, w, "payment", id, b); }
  @Post("payment-templates/:templateId/rollback") rollbackPaymentTemplate(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Param("templateId", ParseUUIDPipe) id: string, @Body() b: RestoreConfigurationRevisionDto) { return this.service.rollbackTemplate(a, w, "payment", id, b); }
  @Get("cases/:caseId/catalog-context") context(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("caseId", ParseUUIDPipe) c: string,
  ) {
    return this.service.catalogContext(a, w, c);
  }
  @Get("cases/:caseId/quotation-composer") quotationComposer(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("caseId", ParseUUIDPipe) caseId: string,
    @Query("quoteId", ParseUUIDPipe) quoteId: string,
  ) {
    return this.composer.get(actor, workspaceId, caseId, quoteId);
  }
  @Post("cases/:caseId/quotation-proposals") createQuotationProposal(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("caseId", ParseUUIDPipe) caseId: string,
    @Body() body: unknown,
  ) {
    return this.composer.create(actor, workspaceId, caseId, body);
  }
  @Post("cases/:caseId/quotation-proposals/:runId/apply") applyQuotationProposal(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("runId", ParseUUIDPipe) runId: string,
    @Body() body: unknown,
  ) {
    return this.composer.apply(actor, workspaceId, caseId, runId, body);
  }
  @Post("cases/:caseId/quotation-proposals/:runId/dismiss") dismissQuotationProposal(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("runId", ParseUUIDPipe) runId: string,
    @Body() body: unknown,
  ) {
    return this.composer.dismiss(actor, workspaceId, caseId, runId, body);
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
  imports: [WorkspacesModule, PreProjectsModule, ProjectsModule],
  controllers: [InternalAccountingReconciliationController,CommercialController],
  providers: [AccountingReconciliationService,InternalServiceGuard,CatalogSellingPriceService,CommercialService,QuotationComposerService,BrandAssetStorageService],
  exports: [CommercialService],
})
export class CommercialModule {}
