import { Module } from "@nestjs/common";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { MeetingMinutesController } from "./meeting-minutes.controller";
import { MeetingMinutesService } from "./meeting-minutes.service";

/** PLM-153: minutes of client meetings, shared through the client portal. */
@Module({ imports: [WorkspacesModule], controllers: [MeetingMinutesController], providers: [MeetingMinutesService, BrandAssetStorageService] })
export class MeetingsModule {}
