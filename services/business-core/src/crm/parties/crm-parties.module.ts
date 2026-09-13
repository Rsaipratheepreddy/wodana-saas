import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { CrmPartiesController } from "./crm-parties.controller";
import { CrmPartiesService } from "./crm-parties.service";

@Module({
  imports: [WorkspacesModule],
  controllers: [CrmPartiesController],
  providers: [CrmPartiesService],
  exports: [CrmPartiesService],
})
export class CrmPartiesModule {}
