import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { ActorUser, RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { FILE_KINDS, isOpen, oneOf, uuid } from "./finance-requests";
import { MANAGE, readBoard, readDetail, runCommand, type Ctx } from "./finance-request-commands";
import { addEvent } from "./finance-request-notices";
import { readContext, readQuoteLines, readRequestSettings, saveRequestSettings, searchOptions } from "./finance-request-options";
import { readRequests } from "./finance-requests.store";

/**
 * Finance requests (PLM-107–110, 113): staff ask Finance for an invoice, a refund or a supplier payment from
 * where they are; Finance works them on a board. Each call runs in the workspace's tenant transaction; the rules
 * live in the module's functions, which take what the person may do from the workspace's permissions.
 */
@Injectable()
export class FinanceRequestsService {
  constructor(private readonly access: WorkspaceAccessService, @Optional() private readonly storage?: BrandAssetStorageService) {}

  private ctx(client: PoolClient, workspaceId: string, user: ActorUser): Ctx {
    const known = new Map<string, Promise<boolean>>();
    return { workspaceId, userId: user.userId, can: (code) => {
      if (!known.has(code)) known.set(code, this.access.hasPermission(client, workspaceId, user.userId, code));
      return known.get(code)!;
    } };
  }

  board(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, (client, user) => readBoard(client, this.ctx(client, workspaceId, user)));
  }

  detail(actor: RequestActor, workspaceId: string, id: string) {
    return this.access.asMember(actor, workspaceId, (client, user) => readDetail(client, this.ctx(client, workspaceId, user), id));
  }

  command(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const ctx = this.ctx(client, workspaceId, user);
      return readDetail(client, ctx, await runCommand(client, ctx, body));
    });
  }

  context(actor: RequestActor, workspaceId: string, query: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, (client, user) => readContext(client, this.ctx(client, workspaceId, user), query));
  }

  options(actor: RequestActor, workspaceId: string, query: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, (client, user) => searchOptions(client, this.ctx(client, workspaceId, user), query));
  }

  quoteLines(actor: RequestActor, workspaceId: string, query: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, (client, user) => readQuoteLines(client, this.ctx(client, workspaceId, user), query));
  }

  settings(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, (client, user) => readRequestSettings(client, this.ctx(client, workspaceId, user)));
  }

  saveSettings(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const ctx = this.ctx(client, workspaceId, user);
      await saveRequestSettings(client, ctx, body);
      return readRequestSettings(client, ctx);
    });
  }

  /**
   * A file on the request — the quote or BOQ, the supplier's tax invoice (which clears "Invoice pending"), a
   * proof — by its requester while it's open, or by Finance. The same file again changes nothing.
   */
  async upload(actor: RequestActor, workspaceId: string, id: string, kind: string, file?: ReferenceUpload) {
    const fileKind = oneOf(kind, FILE_KINDS, "Unknown kind of file.");
    const prepared = await prepareReferenceUpload(file);
    if (!prepared.mimeType.startsWith("image/") && prepared.mimeType !== "application/pdf") throw new BadRequestException("Choose a PDF or a photo.");
    const storage = this.storage;
    if (!storage) throw new ConflictException("Files can't be stored here yet.");
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const ctx = this.ctx(client, workspaceId, user);
      await client.query(`SELECT 1 FROM finance_requests WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, uuid(id, "Request")]);
      const row = (await readRequests(client, workspaceId, { id }))[0];
      if (!row) throw new NotFoundException("Request not found.");
      const finance = await ctx.can(MANAGE);
      const mine = row.requestedBy === user.userId || row.salespersonId === user.userId;
      if (!finance && !(mine && isOpen(row.status))) throw new ForbiddenException("Only its requester (while it's open) or Finance adds files.");
      const exists = (await client.query(`SELECT 1 FROM finance_request_files WHERE workspace_id = $1 AND request_id = $2 AND kind = $3 AND sha256 = $4`,
        [workspaceId, id, fileKind, prepared.digest])).rowCount;
      if (!exists) {
        const key = `finance-requests/${workspaceId}/${id}/${prepared.digest}`;
        await storage.put(key, prepared.body, prepared.mimeType);
        const fileId = randomUUID();
        await client.query(`INSERT INTO finance_request_files (id, workspace_id, request_id, kind, name, content_type, storage_key, sha256, uploaded_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [fileId, workspaceId, id, fileKind, prepared.name.slice(0, 255), prepared.mimeType, key, prepared.digest, user.userId]);
        await client.query(`UPDATE finance_requests SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
        await addEvent(client, workspaceId, id, { kind: "file", note: prepared.name.slice(0, 255), actorId: user.userId });
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "finance_request.file_added", entityType: "finance_request", entityId: id,
          after: { fileId, kind: fileKind, name: prepared.name, sha256: prepared.digest } });
      }
      return readDetail(client, ctx, id);
    });
  }

  /** A request's file, for whoever may read the request. */
  file(actor: RequestActor, workspaceId: string, id: string, fileId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await readDetail(client, this.ctx(client, workspaceId, user), id);
      const row = (await client.query<{ key: string; type: string }>(
        `SELECT storage_key AS key, content_type AS type FROM finance_request_files WHERE workspace_id = $1 AND request_id = $2 AND id = $3`,
        [workspaceId, id, uuid(fileId, "File")])).rows[0];
      if (!row || !this.storage) throw new NotFoundException("File not found.");
      const stored = await this.storage.read(row.key).catch(() => null);
      if (!stored) throw new NotFoundException("File not found.");
      return { body: stored.body, contentType: row.type };
    });
  }
}
