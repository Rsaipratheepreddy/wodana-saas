import { Global, Module } from "@nestjs/common";
import { CrmEventsService } from "./crm-events.service";

@Global()
@Module({
  providers: [CrmEventsService],
  exports: [CrmEventsService],
})
export class CrmSharedModule {}
