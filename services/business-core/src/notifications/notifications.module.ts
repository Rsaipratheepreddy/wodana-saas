import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { DeliveryHealthController } from "./delivery-health.controller";
import { DeliveryHealthService } from "./delivery-health.service";
import { NoticeChoicesController } from "./notice-choices.controller";
import { NoticeChoicesService } from "./notice-choices.service";

/** Workspace-wide notification delivery: health for the owner and the test send; each person's own notification choices. */
@Module({ imports: [WorkspacesModule, EmailModule], controllers: [DeliveryHealthController, NoticeChoicesController], providers: [DeliveryHealthService, NoticeChoicesService], exports: [DeliveryHealthService] })
export class NotificationsModule {}
