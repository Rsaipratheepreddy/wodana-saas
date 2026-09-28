import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { DeliveryHealthController } from "./delivery-health.controller";
import { DeliveryHealthService } from "./delivery-health.service";

/** Workspace-wide notification delivery: health for the owner and the test send. */
@Module({ imports: [WorkspacesModule, EmailModule], controllers: [DeliveryHealthController], providers: [DeliveryHealthService], exports: [DeliveryHealthService] })
export class NotificationsModule {}
