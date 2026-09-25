import { Global, Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AiGatewayController } from "./ai-gateway.controller";
import { AiGatewayService } from "./ai-gateway.service";

@Global()
@Module({ imports: [WorkspacesModule], controllers: [AiGatewayController], providers: [AiGatewayService], exports: [AiGatewayService] })
export class AiGatewayModule {}
