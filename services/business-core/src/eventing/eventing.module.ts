import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { LiveEventsController } from "./live-events.controller";
import { LiveEventsService } from "./live-events.service";
import { OutboxPublisherService } from "./outbox-publisher.service";

@Module({ imports: [WorkspacesModule], controllers: [LiveEventsController], providers: [OutboxPublisherService, LiveEventsService] })
export class EventingModule {}
