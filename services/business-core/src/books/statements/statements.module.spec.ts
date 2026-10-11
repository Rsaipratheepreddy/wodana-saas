import { describe, expect, it } from "vitest";
import type { ExternalStatementSources } from "../sources/external-statements";
import { StatementSourceRegistry } from "./statement-source";
import { BooksStatementsModule } from "./statements.module";

describe("company statements module", () => {
  it("registers QuickBooks and Zoho Books next to the Ledger's own sources on init", () => {
    const registry = new StatementSourceRegistry();
    const adapter = (source: "quickbooks" | "zoho_books") => ({ source, availability: async () => ({ available: false, label: null }), provider: () => ({}) as never });
    const sources = { adapters: () => [adapter("zoho_books"), adapter("quickbooks")] } as unknown as ExternalStatementSources;
    new BooksStatementsModule(registry, sources).onModuleInit();
    expect(registry.list().map((entry) => entry.source).sort()).toEqual(["quickbooks", "zoho_books"]);
  });
});
