import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { HistoryController } from "./history.controller";
import { HistoryService } from "./history.service";

/** Record history (plan E5): one read over the audit trail for every important record. */
@Module({
  imports: [WorkspacesModule],
  controllers: [HistoryController],
  providers: [HistoryService],
})
export class HistoryModule {}
