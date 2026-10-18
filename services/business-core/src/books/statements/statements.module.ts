import { Module, type OnModuleInit } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { BooksPostingModule } from "../posting/posting.module";
import { BooksPostingService } from "../posting/posting.service";
import { BooksSourcesModule } from "../sources/sources.module";
import { ExternalStatementSources } from "../sources/external-statements";
import { BOOKS_SWEEP } from "../reports/books-sweep.port";
import { StatementSourceRegistry } from "./statement-source";
import { BooksStatementsController } from "./statements.controller";
import { BooksStatementsService } from "./statements.service";

/**
 * Company and project statements (P&L and cash flow) through one source interface. Exports the registry that the
 * accounting-system sources (src/books/sources) register into, and the service that reads through it. QuickBooks and
 * Zoho Books register here on init, next to the Ledger and operational-cash sources the service registers.
 */
@Module({
  imports: [WorkspacesModule, BooksPostingModule, BooksSourcesModule],
  controllers: [BooksStatementsController],
  providers: [StatementSourceRegistry, BooksStatementsService, { provide: BOOKS_SWEEP, useExisting: BooksPostingService }],
  exports: [StatementSourceRegistry, BooksStatementsService],
})
export class BooksStatementsModule implements OnModuleInit {
  constructor(private readonly registry: StatementSourceRegistry, private readonly sources: ExternalStatementSources) {}

  onModuleInit() {
    for (const adapter of this.sources.adapters()) this.registry.register(adapter);
  }
}
