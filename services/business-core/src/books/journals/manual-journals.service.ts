import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../../auth/actor";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import type { BooksCtx } from "../settings/books-common";
import { booksCtx } from "../settings/books-settings.service";
import { journalOptions, listJournals, previewOpening, readJournal, runJournalCommand } from "./manual-journals";

/** Manual and opening journals: each call runs in the workspace's tenant transaction. */
@Injectable()
export class ManualJournalsService {
  constructor(private readonly access: WorkspaceAccessService) {}

  private run<T>(actor: RequestActor, workspaceId: string, work: (client: PoolClient, ctx: BooksCtx) => Promise<T>) {
    return this.access.asMember(actor, workspaceId, (client, user) => work(client, booksCtx(this.access, client, workspaceId, user)));
  }

  list(actor: RequestActor, workspaceId: string, query: Record<string, unknown>) {
    return this.run(actor, workspaceId, (client, ctx) => listJournals(client, ctx, query));
  }

  detail(actor: RequestActor, workspaceId: string, id: string) {
    return this.run(actor, workspaceId, (client, ctx) => readJournal(client, ctx, id));
  }

  options(actor: RequestActor, workspaceId: string, query: Record<string, unknown>) {
    return this.run(actor, workspaceId, (client, ctx) => journalOptions(client, ctx, query));
  }

  previewOpening(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.run(actor, workspaceId, (client, ctx) => previewOpening(client, ctx, body));
  }

  /** One journal command; returns the journal as it is after it. */
  command(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.run(actor, workspaceId, async (client, ctx) => readJournal(client, ctx, await runJournalCommand(client, ctx, body)));
  }
}
