import { ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { RequestActor } from "../auth/actor";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import type { ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { addEvidence, EVIDENCE_KINDS, evidenceRow, isEvidenceKind } from "./decision-evidence";

/** Adds and opens the photo or PDF behind a decision (§0.3 P0), by the permissions of the decision's module. */
@Injectable()
export class EvidenceService {
  constructor(private readonly access: WorkspaceAccessService, @Optional() private readonly storage?: BrandAssetStorageService) {}

  add(actor: RequestActor, workspaceId: string, kind: unknown, file: ReferenceUpload | undefined) {
    if (!isEvidenceKind(kind)) throw new NotFoundException("Choose what the file is for.");
    return this.access.withAnyPermission(actor, workspaceId, [...EVIDENCE_KINDS[kind].add], (client, user) => addEvidence(client, this.storage, workspaceId, user.userId, kind, file));
  }

  open(actor: RequestActor, workspaceId: string, id: string, preview: boolean) {
    return this.access.withAnyPermission(actor, workspaceId, [...new Set(Object.values(EVIDENCE_KINDS).flatMap((kind) => kind.open))], async (client, user) => {
      const row = await evidenceRow(client, workspaceId, id);
      const allowed = row.subjectId === null ? row.uploadedBy === user.userId
        : (await Promise.all(EVIDENCE_KINDS[row.kind].open.map((permission) => this.access.hasPermission(client, workspaceId, user.userId, permission)))).some(Boolean);
      if (!allowed) throw new ForbiddenException("You can't open this file.");
      if (preview && !row.hasPreview) throw new NotFoundException("Preview not available.");
      if (!this.storage) throw new NotFoundException("This file could not be found in storage.");
      const stored = await this.storage.read(`${row.key}/${preview ? "preview.webp" : "original"}`).catch(() => { throw new NotFoundException("This file could not be found in storage."); });
      return { body: stored.body, contentType: preview ? "image/webp" : row.mimeType, name: row.name };
    });
  }
}
