import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { ActorUser, RequestActor } from "../../auth/actor";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import type { BooksCtx } from "./books-common";
import { readOverview, readSettings, runSettingsCommand } from "./books-settings";

/** Who acts and what they may do, asked of the workspace's permissions once per code in a call. */
export function booksCtx(access: WorkspaceAccessService, client: PoolClient, workspaceId: string, user: ActorUser): BooksCtx {
  const known = new Map<string, Promise<boolean>>();
  return { workspaceId, userId: user.userId, can: (code) => {
    if (!known.has(code)) known.set(code, access.hasPermission(client, workspaceId, user.userId, code));
    return known.get(code)!;
  } };
}

/** Settings › Ledger: each call runs in the workspace's tenant transaction; what a person may do comes from their permissions. */
@Injectable()
export class BooksSettingsService {
  constructor(private readonly access: WorkspaceAccessService) {}

  overview(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, (client, user) => readOverview(client, booksCtx(this.access, client, workspaceId, user)));
  }

  company(actor: RequestActor, workspaceId: string, legalEntityId: string) {
    return this.access.asMember(actor, workspaceId, (client, user) => readSettings(client, booksCtx(this.access, client, workspaceId, user), legalEntityId));
  }

  /** One settings command; returns the company's settings as they are after it. */
  command(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const ctx = booksCtx(this.access, client, workspaceId, user);
      return readSettings(client, ctx, await runSettingsCommand(client, ctx, body));
    });
  }
}
