import { Module } from "@nestjs/common";
import { InternalServiceGuard } from "../../auth/internal-service.guard";
import { RemindersSourcesModule } from "../sources/sources.module";
import { InternalRemindersController } from "./internal.controller";
import { RemindersEngineService } from "./reminders-engine.service";

/** The sweep: planning, firing, escalation, fallback, digests and the internal sweep endpoint (slices B and E). */
@Module({
  imports: [RemindersSourcesModule],
  controllers: [InternalRemindersController],
  providers: [RemindersEngineService, InternalServiceGuard],
  exports: [RemindersEngineService],
})
export class RemindersEngineModule {}
