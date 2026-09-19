import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PoolClient } from "pg";
import { ActorUser, RequestActor } from "../auth/actor";
import { IdentityService } from "../auth/identity.service";
import { DatabaseService } from "../database/database.service";
import { tenantModuleForPermission } from "./tenant-operations.domain";

@Injectable()
export class WorkspaceAccessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly identities: IdentityService,
  ) {}

  async asMember<T>(
    actor: RequestActor,
    workspaceId: string,
    work: (client: PoolClient, actor: ActorUser) => Promise<T>,
  ): Promise<T> {
    const actorUser = await this.identities.resolveActor(actor);
    return this.database.tenantTransaction(workspaceId, actorUser.userId, async (client) => {
      await this.assertMembership(client, workspaceId, actorUser.userId);
      return work(client, actorUser);
    });
  }

  async withPermission<T>(
    actor: RequestActor,
    workspaceId: string,
    permission: string,
    work: (client: PoolClient, actor: ActorUser) => Promise<T>,
  ): Promise<T> {
    return this.withPermissions(actor, workspaceId, [permission], work);
  }

  async withAnyPermission<T>(
    actor: RequestActor,
    workspaceId: string,
    permissions: string[],
    work: (client: PoolClient, actor: ActorUser) => Promise<T>,
  ): Promise<T> {
    const actorUser = await this.identities.resolveActor(actor);
    return this.database.tenantTransaction(workspaceId, actorUser.userId, async (client) => {
      await this.assertMembership(client, workspaceId, actorUser.userId);
      const permitted = await this.effectivePermissions(client, workspaceId, permissions);
      if (!permitted.length) throw new ForbiddenException("This module is not included for the organization");
      const result = await client.query<{ granted: number }>(
        `SELECT count(DISTINCT permission.code)::int AS granted
           FROM workspace_memberships membership
           JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
           JOIN role_permissions granted ON granted.role_id = assigned.role_id
           JOIN permissions permission ON permission.id = granted.permission_id
           WHERE membership.workspace_id = $1
             AND membership.user_id = $2
             AND membership.status = 'active'
             AND permission.code = ANY($3::text[])`,
        [workspaceId, actorUser.userId, permitted],
      );

      if (!result.rows[0]?.granted) {
        throw new ForbiddenException(`Any permission required: ${permissions.join(", ")}`);
      }
      return work(client, actorUser);
    });
  }

  async withPermissions<T>(
    actor: RequestActor,
    workspaceId: string,
    permissions: string[],
    work: (client: PoolClient, actor: ActorUser) => Promise<T>,
  ): Promise<T> {
    const actorUser = await this.identities.resolveActor(actor);
    return this.database.tenantTransaction(workspaceId, actorUser.userId, async (client) => {
      await this.assertMembership(client, workspaceId, actorUser.userId);
      const permitted = await this.effectivePermissions(client, workspaceId, permissions);
      if (permitted.length !== new Set(permissions).size) {
        throw new ForbiddenException("A required module is not included for the organization");
      }
      const result = await client.query<{ granted: number }>(
        `SELECT count(DISTINCT permission.code)::int AS granted
           FROM workspace_memberships membership
           JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
           JOIN role_permissions granted ON granted.role_id = assigned.role_id
           JOIN permissions permission ON permission.id = granted.permission_id
           WHERE membership.workspace_id = $1
             AND membership.user_id = $2
             AND membership.status = 'active'
             AND permission.code = ANY($3::text[])`,
        [workspaceId, actorUser.userId, permitted],
      );

      if (result.rows[0]?.granted !== new Set(permissions).size) {
        throw new ForbiddenException(`Permissions required: ${permissions.join(", ")}`);
      }
      return work(client, actorUser);
    });
  }

  async hasPermission(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    permission: string,
  ): Promise<boolean> {
    const permitted = await this.effectivePermissions(client, workspaceId, [permission]);
    if (!permitted.length) return false;
    const result = await client.query(
      `SELECT 1
         FROM workspace_memberships membership
         JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = assigned.role_id
         JOIN permissions permission ON permission.id = granted.permission_id
         WHERE membership.workspace_id = $1
           AND membership.user_id = $2
           AND membership.status = 'active'
           AND permission.code = $3
         LIMIT 1`,
      [workspaceId, userId, permission],
    );
    return Boolean(result.rowCount);
  }

  async effectivePermissions(client: PoolClient, workspaceId: string, permissions: string[]) {
    const configured = await client.query<{ status: string; modules: string[] }>(
      `SELECT status,modules FROM effective_workspace_entitlements WHERE workspace_id=$1`, [workspaceId],
    );
    if (!configured.rowCount) return [...new Set(permissions)];
    const entitlement = configured.rows[0];
    const modules = entitlement.status === "active" ? new Set(entitlement.modules) : new Set(["workspace"]);
    modules.add("workspace");
    return [...new Set(permissions)].filter((permission) => modules.has(tenantModuleForPermission(permission)));
  }

  private async assertMembership(
    client: PoolClient,
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    const membership = await client.query(
      `SELECT 1
       FROM workspace_memberships membership
       JOIN workspaces workspace ON workspace.id = membership.workspace_id
       WHERE membership.workspace_id = $1
         AND membership.user_id = $2
         AND membership.status = 'active'
         AND workspace.status = 'active'`,
      [workspaceId, userId],
    );
    if (!membership.rowCount) {
      throw new NotFoundException("Workspace not found");
    }
  }
}
