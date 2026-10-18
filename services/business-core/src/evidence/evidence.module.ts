import { Module } from "@nestjs/common";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { EvidenceController } from "./evidence.controller";
import { EvidenceService } from "./evidence.service";

/** The photo or PDF behind a decision, for every module that records one (§0.3 P0). */
@Module({ imports: [WorkspacesModule], controllers: [EvidenceController], providers: [EvidenceService, BrandAssetStorageService] })
export class EvidenceModule {}
