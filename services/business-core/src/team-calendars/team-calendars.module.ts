import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { TeamCalendarsController } from "./team-calendars.controller";
import { TeamCalendarsService } from "./team-calendars.service";

@Module({
  imports: [WorkspacesModule],
  controllers: [TeamCalendarsController],
  providers: [TeamCalendarsService],
})
export class TeamCalendarsModule {}
