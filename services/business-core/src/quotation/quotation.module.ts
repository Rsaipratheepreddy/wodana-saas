import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { QuotationAiService } from "./quotation-ai.service";
import { QuotationCollabService } from "./quotation-collab.service";
import { QuotationBuilderService } from "./quotation-builder.service";
import { QuotationController } from "./quotation.controller";

@Module({ imports: [WorkspacesModule], controllers: [QuotationController], providers: [QuotationBuilderService, QuotationAiService, QuotationCollabService, BrandAssetStorageService], exports: [QuotationBuilderService] })
export class QuotationModule {}
