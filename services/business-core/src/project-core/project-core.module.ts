import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ProjectCoreController } from "./project-core.controller";
import { ProjectCoreService } from "./project-core.service";
import { ProjectWorkService } from "./project-work.service";

@Module({ imports: [WorkspacesModule], controllers: [ProjectCoreController], providers: [ProjectCoreService, ProjectWorkService] })
export class ProjectCoreModule {}
