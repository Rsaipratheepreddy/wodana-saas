import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { FactoryController } from "./factory.controller";
import { FactoryService } from "./factory.service";

@Module({ imports: [WorkspacesModule], controllers: [FactoryController], providers: [FactoryService] })
export class FactoryModule {}
