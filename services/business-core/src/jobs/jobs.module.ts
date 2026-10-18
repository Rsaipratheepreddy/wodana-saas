import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { JobsController } from "./jobs.controller";
import { JobsMyDayController } from "./jobs-my-day.controller";
import { JobsService } from "./jobs.service";

@Module({
  imports: [WorkspacesModule],
  controllers: [JobsMyDayController, JobsController],
  providers: [JobsService],
})
export class JobsModule {}
