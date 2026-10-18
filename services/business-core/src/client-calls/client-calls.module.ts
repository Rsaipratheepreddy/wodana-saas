import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ClientCallsController } from "./client-calls.controller";
import { ClientCallsService } from "./client-calls.service";

@Module({
  imports: [WorkspacesModule],
  controllers: [ClientCallsController],
  providers: [ClientCallsService],
})
export class ClientCallsModule {}
