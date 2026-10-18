import { Module } from "@nestjs/common";
import { BooksCaptureModule } from "./capture/capture.module";
import { BooksJournalsModule } from "./journals/manual-journals.module";
import { BooksLedgerModule } from "./ledger/ledger.module";
import { BooksPostingModule } from "./posting/posting.module";
import { BooksProjectModule } from "./project/project.module";
import { BooksReportsModule } from "./reports/reports.module";
import { BooksSettingsModule } from "./settings/books-settings.module";
import { BooksStatementsModule } from "./statements/statements.module";

/** Wodana Ledger (engine E7, code name books). Each slice fills its own submodule. */
@Module({
  imports: [BooksLedgerModule, BooksSettingsModule, BooksJournalsModule, BooksPostingModule, BooksReportsModule, BooksCaptureModule, BooksProjectModule,
    BooksStatementsModule],
})
export class BooksModule {}
