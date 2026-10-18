import { Module } from "@nestjs/common";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { PettyCashController } from "./petty-cash.controller";
import { PettyCashService } from "./petty-cash.service";

@Module({ imports: [WorkspacesModule], controllers: [PettyCashController], providers: [PettyCashService, BrandAssetStorageService], exports: [PettyCashService] })
export class PettyCashModule {}
