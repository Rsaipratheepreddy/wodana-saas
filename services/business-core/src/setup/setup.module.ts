import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { SetupController } from "./setup.controller";
import { SetupQuestionnairesService } from "./questionnaires.service";

/** §0.3 P3: the firm's own configuration (questionnaires first). */
@Module({
  imports: [WorkspacesModule],
  controllers: [SetupController],
  providers: [SetupQuestionnairesService],
})
export class SetupModule {}
