import { Module } from "@nestjs/common";
import { CrmActivitiesModule } from "../../crm/activities/crm-activities.module";
import { ProjectCoreModule } from "../../project-core/project-core.module";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { RemindersSourcesModule } from "../sources/sources.module";
import { MyDayController } from "./my-day.controller";
import { MyDayService } from "./my-day.service";
import { ReminderModuleCommands } from "./module-commands";

/** My day: the list, snooze, complete and reassign, and a record's reminder timeline (slice D). */
@Module({
  imports: [WorkspacesModule, RemindersSourcesModule, CrmActivitiesModule, ProjectCoreModule],
  controllers: [MyDayController],
  providers: [MyDayService, ReminderModuleCommands],
  exports: [MyDayService],
})
export class RemindersMyDayModule {}
