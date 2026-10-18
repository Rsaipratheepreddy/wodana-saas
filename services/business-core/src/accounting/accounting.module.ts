import { Module } from "@nestjs/common";
import { InternalServiceGuard } from "../auth/internal-service.guard";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AccountingController, InternalAccountingController } from "./accounting.controller";
import { AccountingService } from "./accounting.service";

@Module({ imports: [WorkspacesModule], controllers: [AccountingController, InternalAccountingController], providers: [AccountingService, InternalServiceGuard] })
export class AccountingModule {}
