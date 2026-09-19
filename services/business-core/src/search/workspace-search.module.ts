import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { WorkspaceSearchController } from "./workspace-search.controller";
import { WorkspaceSearchService } from "./workspace-search.service";

@Module({
  imports: [WorkspacesModule],
  controllers: [WorkspaceSearchController],
  providers: [WorkspaceSearchService],
})
export class WorkspaceSearchModule {}
