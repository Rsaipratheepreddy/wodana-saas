import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { DesignJourneyController } from "./design-journey.controller";
import { DesignJourneyService } from "./design-journey.service";
import { DesignPackagesController } from "./design-packages.controller";
import { DesignPackagesService } from "./design-packages.service";

@Module({ imports: [WorkspacesModule], controllers: [DesignPackagesController, DesignJourneyController], providers: [DesignPackagesService, DesignJourneyService], exports: [DesignPackagesService] })
export class DesignModule {}
