import type { PoolClient } from "pg";
import type { WorkspaceAccessService } from "./workspace-access.service";

/**
 * Who sees which amounts (QA-006). A record is the same for everyone who may open it; its amounts go only to people
 * whose permissions name money, and are left out (null) on the server for everyone else, so neither the screen nor
 * the API shows them to a site supervisor, a factory hand or a designer.
 */

/** What stock is worth (its valuation, average cost and a movement's cost): cost readers, people who see supplier prices, Finance. */
export const STOCK_COST_READERS = ["commercial.costs.view", "purchasing.view", "supplier_offers.view", "payables.view", "books.view"] as const;

/** What an order to a supplier is worth (its total, line prices): the same people as stock costs. */
export const ORDER_VALUE_READERS = STOCK_COST_READERS;

/** Whether the person holds any of these permissions (view-as narrowing applies, as for every check). */
export async function holdsAny(client: PoolClient, access: Pick<WorkspaceAccessService, "hasPermission">, workspaceId: string, userId: string, permissions: readonly string[]) {
  for (const permission of permissions) if (await access.hasPermission(client, workspaceId, userId, permission)) return true;
  return false;
}
