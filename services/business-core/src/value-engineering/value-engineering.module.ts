import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ValueEngineeringController } from "./value-engineering.controller";
import { ValueEngineeringService } from "./value-engineering.service";

/** PLM-147: value engineering on a job's estimate, led by the lead designer with the QS. */
@Module({ imports: [WorkspacesModule], controllers: [ValueEngineeringController], providers: [ValueEngineeringService] })
export class ValueEngineeringModule {}
