import { Module } from "@nestjs/common";
import { InternalServiceGuard } from "../auth/internal-service.guard";
import { PlatformOperatorGuard } from "../auth/platform-operator.guard";
import { PlatformOperatorPermissionGuard } from "../auth/platform-operator-permission.guard";
import { OperatorNotificationsService } from "../control-plane/operator-notifications.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { IntegrationsController, InternalIntegrationsController, ProviderCapabilitiesController } from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";
import { InternalPlatformIntegrationsController, OperatorPlatformIntegrationsController } from "./platform-credentials/platform-credentials.controller";
import { PlatformCredentialsService } from "./platform-credentials/platform-credentials.service";

@Module({
  imports: [WorkspacesModule],
  controllers: [IntegrationsController, ProviderCapabilitiesController, InternalIntegrationsController,
    OperatorPlatformIntegrationsController, InternalPlatformIntegrationsController],
  providers: [IntegrationsService, PlatformCredentialsService, OperatorNotificationsService, InternalServiceGuard,
    PlatformOperatorGuard, PlatformOperatorPermissionGuard],
})
export class IntegrationsModule {}
