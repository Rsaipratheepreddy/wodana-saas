import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ManagementReportsController } from "./management-reports.controller";
import { ManagementReportsService } from "./management-reports.service";

@Module({ imports: [WorkspacesModule], controllers: [ManagementReportsController], providers: [ManagementReportsService] })
export class ManagementReportsModule {}
