import { Injectable, NotFoundException } from "@nestjs/common";
import { portalQuote } from "../client-portal/portal-quote";
import { readPortalSettings } from "../client-portal/portal-settings";
import { readSite } from "../client-portal/portal-site";
import { commercialRepository } from "../commercial/commercial-repository";
import type { CommercialData } from "../commercial/commercial.types";
import { DatabaseService } from "../database/database.service";
import { printSecret, readPrintToken } from "./portal-print";
import { portalQuoteExtras } from "./proposal-data";

const PRINT_ACTOR = "00000000-0000-4000-8000-000000000000";

/**
 * What the portal's print page shows for a print link (portal-print.ts): the quotation exactly as the client's portal
 * gives it (the same fields, nothing internal), the client's name and the firm's site. Only the snapshot the link
 * names, only once it was sent, only for three minutes.
 */
@Injectable()
export class ProposalPrintService {
  constructor(private readonly db: DatabaseService) {}

  view(token: string) {
    const target = readPrintToken(printSecret(), token);
    if (!target) throw new NotFoundException("This print link has expired.");
    return this.db.tenantTransaction(target.workspaceId, PRINT_ACTOR, async (client) => {
      const data = (await commercialRepository.load(client, target.workspaceId, target.caseId))?.content as CommercialData | undefined;
      const quote = data?.quotes.find((item) => item.id === target.quoteId);
      if (!quote?.issuedAt || (quote.hash ?? null) !== target.quoteHash) throw new NotFoundException("This quotation isn't available.");
      const extras = (await portalQuoteExtras(client, target.workspaceId, target.caseId, [quote])).get(quote.id);
      const customer = (await client.query<{ name: string | null }>(
        `SELECT coalesce(party.display_name, opportunity.title) AS name FROM pre_project_cases pre_case
           JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
           LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
          WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [target.workspaceId, target.caseId])).rows[0]?.name ?? "";
      const site = await readSite(client, target.workspaceId, await readPortalSettings(client, target.workspaceId), false);
      return { quote: { ...portalQuote(quote, "", "viewer"), reference: extras?.reference ?? null, disclosure: extras?.disclosure ?? null }, customer, site };
    });
  }
}
