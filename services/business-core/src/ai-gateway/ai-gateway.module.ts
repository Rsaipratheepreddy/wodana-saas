import { Global, Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AiGatewayController, AiGenerateController } from "./ai-gateway.controller";
import { AiGatewayService } from "./ai-gateway.service";
import { AiRateLimitService } from "./ai-rate-limit.service";

@Global()
@Module({ imports: [WorkspacesModule], controllers: [AiGatewayController, AiGenerateController], providers: [AiGatewayService, AiRateLimitService], exports: [AiGatewayService] })
export class AiGatewayModule {}
