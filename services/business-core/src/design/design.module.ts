import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module";
import { CommercialService } from "../commercial/commercial.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { DesignDecisionsController } from "./design-decisions.controller";
import { DesignDecisionsService } from "./design-decisions.service";
import { DesignJourneyController } from "./design-journey.controller";
import { DESIGN_COMMERCIAL_API, DesignJourneyService } from "./design-journey.service";
import { DesignPackagesController } from "./design-packages.controller";
import { DesignPackagesService } from "./design-packages.service";

@Module({
  imports: [WorkspacesModule, CommercialModule],
  controllers: [DesignPackagesController, DesignJourneyController, DesignDecisionsController],
  // The estimate hand-off (PLM-053) calls the commercial API as it is.
  providers: [DesignPackagesService, DesignJourneyService, DesignDecisionsService, { provide: DESIGN_COMMERCIAL_API, useExisting: CommercialService }],
  exports: [DesignPackagesService],
})
export class DesignModule {}
