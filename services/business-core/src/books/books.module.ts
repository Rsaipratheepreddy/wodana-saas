import { Module } from "@nestjs/common";
import { BooksCaptureModule } from "./capture/capture.module";
import { BooksLedgerModule } from "./ledger/ledger.module";
import { BooksPostingModule } from "./posting/posting.module";
import { BooksProjectModule } from "./project/project.module";
import { BooksReportsModule } from "./reports/reports.module";

/** Wodana Ledger (engine E7, code name books). Each slice fills its own submodule. */
@Module({ imports: [BooksLedgerModule, BooksPostingModule, BooksReportsModule, BooksCaptureModule, BooksProjectModule] })
export class BooksModule {}
