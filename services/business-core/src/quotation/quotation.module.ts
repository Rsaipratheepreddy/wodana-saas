import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { QuotationAiService } from "./quotation-ai.service";
import { QuotationBuilderService } from "./quotation-builder.service";
import { QuotationController } from "./quotation.controller";

@Module({ imports: [WorkspacesModule], controllers: [QuotationController], providers: [QuotationBuilderService, QuotationAiService], exports: [QuotationBuilderService] })
export class QuotationModule {}
