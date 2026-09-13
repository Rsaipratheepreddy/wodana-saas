import { Module } from "@nestjs/common";
import { InternalServiceGuard } from "../auth/internal-service.guard";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { IntegrationsController, InternalIntegrationsController } from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";

@Module({
  imports: [WorkspacesModule],
  controllers: [IntegrationsController, InternalIntegrationsController],
  providers: [IntegrationsService, InternalServiceGuard],
})
export class IntegrationsModule {}
