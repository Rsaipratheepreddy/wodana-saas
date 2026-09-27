import { NotFoundException } from "@nestjs/common";
import type { DatabaseService } from "../database/database.service";

export type TenantRegistry = { externalTenantId: string; workspaceId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An organization is addressed by its provisioning ID or by its workspace ID. Organizations an account
 * added later have no provisioning ID; their workspace ID stands in for it in the operator audit.
 */
export async function resolveTenantRegistry(database: Pick<DatabaseService, "query">, key: string): Promise<TenantRegistry> {
  const provisioned = await database.query<TenantRegistry>(
    `SELECT external_tenant_id AS "externalTenantId", workspace_id AS "workspaceId"
       FROM tenant_provisioning_requests WHERE external_tenant_id = $1`, [key],
  );
  if (provisioned.rowCount) return provisioned.rows[0];
  if (UUID.test(key)) {
    const linked = await database.query<TenantRegistry>(
      `SELECT COALESCE(request.external_tenant_id, linked.workspace_id::text) AS "externalTenantId",
              linked.workspace_id AS "workspaceId"
         FROM customer_account_organizations linked
         LEFT JOIN tenant_provisioning_requests request ON request.workspace_id = linked.workspace_id
        WHERE linked.workspace_id = $1::uuid
        ORDER BY request.created_at DESC NULLS LAST LIMIT 1`, [key],
    );
    if (linked.rowCount) return linked.rows[0];
  }
  throw new NotFoundException("Organization was not found");
}
