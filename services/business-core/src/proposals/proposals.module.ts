import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module";
import { EmailModule } from "../email/email.module";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { EsignService } from "./esign.service";
import { ProposalDocumentsService } from "./proposal-documents.service";
import { EsignController, IntroDeckService, ProposalsController, QuotationNumberingService } from "./proposals.controller";
import { TaxNumberingService } from "../workspaces/tax-numbering.service";
import { QsReviewService } from "./qs-review.service";

/** P3 quotation side (plan §6.9a): proposals, quotation documents, the QS hand-off, e-sign and the intro deck. */
@Module({
  imports: [WorkspacesModule, CommercialModule, EmailModule],
  controllers: [ProposalsController, EsignController],
  providers: [ProposalDocumentsService, EsignService, QsReviewService, IntroDeckService, QuotationNumberingService, TaxNumberingService, BrandAssetStorageService],
})
export class ProposalsModule {}
