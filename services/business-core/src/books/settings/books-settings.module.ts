import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { BooksSettingsController } from "./books-settings.controller";
import { BooksSettingsService } from "./books-settings.service";

/** Settings › Ledger (slice A2): templates, dates, chart of accounts, posting roles, payment accounts and tax codes per company. */
@Module({ imports: [WorkspacesModule], controllers: [BooksSettingsController], providers: [BooksSettingsService], exports: [BooksSettingsService] })
export class BooksSettingsModule {}
