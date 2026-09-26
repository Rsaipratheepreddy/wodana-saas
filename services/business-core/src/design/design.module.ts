import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { DesignPackagesController } from "./design-packages.controller";
import { DesignPackagesService } from "./design-packages.service";

@Module({ imports: [WorkspacesModule], controllers: [DesignPackagesController], providers: [DesignPackagesService], exports: [DesignPackagesService] })
export class DesignModule {}
