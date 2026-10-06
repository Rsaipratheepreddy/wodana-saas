import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { FulfilmentController } from "./fulfilment.controller";
import { FulfilmentService } from "./fulfilment.service";

@Module({ imports: [WorkspacesModule], controllers: [FulfilmentController], providers: [FulfilmentService], exports: [FulfilmentService] })
export class FulfilmentModule {}
