import { Module } from "@nestjs/common";
import { ExternalStatementSources } from "./external-statements";
import { ProviderReportsClient } from "./provider-reports.client";

/** QuickBooks and Zoho Books as financial statement sources; the Ledger's statements module imports it. */
@Module({ providers: [ProviderReportsClient, ExternalStatementSources], exports: [ExternalStatementSources] })
export class BooksSourcesModule {}
