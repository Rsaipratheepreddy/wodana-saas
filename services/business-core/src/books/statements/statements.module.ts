import { Module } from "@nestjs/common";
import { StatementSourceRegistry } from "./statement-source";

/**
 * Company and project statements (P&L and cash flow) through one source interface. Exports the registry that the
 * accounting-system sources (src/books/sources) register into.
 */
@Module({
  providers: [StatementSourceRegistry],
  exports: [StatementSourceRegistry],
})
export class BooksStatementsModule {}
