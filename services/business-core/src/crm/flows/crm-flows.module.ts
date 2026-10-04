import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { CrmFlowsController } from "./crm-flows.controller";
import { CrmFlowsService } from "./crm-flows.service";

@Module({ imports: [WorkspacesModule], controllers: [CrmFlowsController], providers: [CrmFlowsService] })
export class CrmFlowsModule {}
