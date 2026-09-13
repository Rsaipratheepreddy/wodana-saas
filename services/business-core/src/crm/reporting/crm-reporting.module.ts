import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { CrmReportingController } from "./crm-reporting.controller";
import { CrmReportingService } from "./crm-reporting.service";
@Module({ imports: [WorkspacesModule], controllers: [CrmReportingController], providers: [CrmReportingService] }) export class CrmReportingModule {}
