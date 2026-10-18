import { Module } from "@nestjs/common";
import { RemindersDeliveryModule } from "./delivery/delivery.module";
import { RemindersDigestModule } from "./digest/digest.module";
import { RemindersEngineModule } from "./engine/engine.module";
import { RemindersMyDayModule } from "./my-day/my-day.module";
import { RemindersSettingsModule } from "./settings/settings.module";
import { RemindersSourcesModule } from "./sources/sources.module";

/** Reminder engine (E4) and My day (plan §6.24a). Each slice fills its own submodule. */
@Module({ imports: [RemindersEngineModule, RemindersSourcesModule, RemindersDeliveryModule, RemindersMyDayModule, RemindersSettingsModule, RemindersDigestModule] })
export class RemindersModule {}
