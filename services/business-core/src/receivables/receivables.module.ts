import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ReceivablesController } from "./receivables.controller";
import { ReceivablesService } from "./receivables.service";

@Module({ imports: [WorkspacesModule], controllers: [ReceivablesController], providers: [ReceivablesService] })
export class ReceivablesModule {}
