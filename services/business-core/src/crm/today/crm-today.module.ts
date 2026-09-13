import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { CrmTodayController } from "./crm-today.controller";
import { CrmTodayService } from "./crm-today.service";
@Module({ imports: [WorkspacesModule], controllers: [CrmTodayController], providers: [CrmTodayService] }) export class CrmTodayModule {}
