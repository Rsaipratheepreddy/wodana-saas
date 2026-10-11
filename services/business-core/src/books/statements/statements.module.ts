import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { BooksPostingModule } from "../posting/posting.module";
import { BooksPostingService } from "../posting/posting.service";
import { BOOKS_SWEEP } from "../reports/books-sweep.port";
import { StatementSourceRegistry } from "./statement-source";
import { BooksStatementsController } from "./statements.controller";
import { BooksStatementsService } from "./statements.service";

/**
 * Company and project statements (P&L and cash flow) through one source interface. Exports the registry that the
 * accounting-system sources (src/books/sources) register into, and the service that reads through it.
 */
@Module({
  imports: [WorkspacesModule, BooksPostingModule],
  controllers: [BooksStatementsController],
  providers: [StatementSourceRegistry, BooksStatementsService, { provide: BOOKS_SWEEP, useExisting: BooksPostingService }],
  exports: [StatementSourceRegistry, BooksStatementsService],
})
export class BooksStatementsModule {}
