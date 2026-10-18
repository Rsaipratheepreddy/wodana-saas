import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { ManualJournalsController } from "./manual-journals.controller";
import { ManualJournalsService } from "./manual-journals.service";

/** Manual and opening journals (slice A2): drafts, approval through E3, posting with a JV number, opening balances from a file. */
@Module({ imports: [WorkspacesModule], controllers: [ManualJournalsController], providers: [ManualJournalsService], exports: [ManualJournalsService] })
export class BooksJournalsModule {}
