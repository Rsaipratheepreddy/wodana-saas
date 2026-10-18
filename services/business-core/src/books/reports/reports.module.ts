import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { BooksPostingModule } from "../posting/posting.module";
import { BooksPostingService } from "../posting/posting.service";
import { BOOKS_SWEEP } from "./books-sweep.port";
import { BooksReportsController } from "./reports.controller";
import { BooksReportsService } from "./reports.service";

/**
 * Ledger reports (slice C): trial balance, P&L, balance sheet, VAT, AR/AP ageing, general ledger, accounts and
 * journals. Every read first runs the posting sweep on demand (BOOKS_SWEEP → BooksPostingService.runSweepNow).
 */
@Module({
  imports: [WorkspacesModule, BooksPostingModule],
  controllers: [BooksReportsController],
  providers: [BooksReportsService, { provide: BOOKS_SWEEP, useExisting: BooksPostingService }],
  exports: [BooksReportsService],
})
export class BooksReportsModule {}
