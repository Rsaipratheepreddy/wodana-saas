import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { GridSettingsController } from "./grid-settings.controller";
import { GridSettingsService } from "./grid-settings.service";

/** Workspace defaults for lists (plan §0.7 R14): hide unused columns per firm. */
@Module({
  imports: [WorkspacesModule],
  controllers: [GridSettingsController],
  providers: [GridSettingsService],
})
export class GridSettingsModule {}
