import { Global, Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AiCreditsService } from "./ai-credits.service";
import { AiCreditsController, AiGatewayController, AiGenerateController } from "./ai-gateway.controller";
import { AiGatewayService } from "./ai-gateway.service";
import { AiRateLimitService } from "./ai-rate-limit.service";

@Global()
@Module({ imports: [WorkspacesModule], controllers: [AiGatewayController, AiGenerateController, AiCreditsController], providers: [AiGatewayService, AiRateLimitService, AiCreditsService], exports: [AiGatewayService] })
export class AiGatewayModule {}
