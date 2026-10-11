import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { ReminderSettingsController } from "./settings.controller";
import { ReminderSettingsService } from "./settings.service";

/** Firm reminder rules and settings, and personal notification settings (slice A2). */
@Module({ imports: [WorkspacesModule], controllers: [ReminderSettingsController], providers: [ReminderSettingsService], exports: [ReminderSettingsService] })
export class RemindersSettingsModule {}
