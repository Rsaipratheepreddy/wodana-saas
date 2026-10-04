import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { CrmEnquiryTypesController } from "./crm-enquiry-types.controller";
import { CrmEnquiryTypesService } from "./crm-enquiry-types.service";
import { CrmFlowsController } from "./crm-flows.controller";
import { CrmFlowsService } from "./crm-flows.service";

@Module({ imports: [WorkspacesModule], controllers: [CrmFlowsController, CrmEnquiryTypesController], providers: [CrmFlowsService, CrmEnquiryTypesService] })
export class CrmFlowsModule {}
