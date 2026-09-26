import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { QuotationBuilderService } from "./quotation-builder.service";
import { QuotationController } from "./quotation.controller";

@Module({ imports: [WorkspacesModule], controllers: [QuotationController], providers: [QuotationBuilderService], exports: [QuotationBuilderService] })
export class QuotationModule {}
