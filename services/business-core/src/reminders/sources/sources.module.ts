import { Module } from "@nestjs/common";
import { ReminderSourceRegistryService } from "./registry.service";

/**
 * The source adapters, one per kind (slice C). Other modules import this module and register their own source with
 * ReminderSourceRegistryService.register (see registry.service.ts).
 */
@Module({ providers: [ReminderSourceRegistryService], exports: [ReminderSourceRegistryService] })
export class RemindersSourcesModule {}
