import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { BrandAssetStorageService } from "../../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../../workspaces/reference-upload";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { CrmOpportunitiesService } from "./crm-opportunities.service";
import { OpportunityDiscoveryService } from "./discovery.service";
import { flowAsks } from "../flows/flow-interpreter";
import { loadFlowFacts } from "./flow-facts";
import { FURNITURE_PATHS, PAYMENT_PROOF_KINDS, type FurniturePath, type PaymentProofKind } from "./flow-gates";

export type UpdateFlowInput = {
  version: number;
  furniturePath?: FurniturePath | null;
  feasibilityConfirmed?: boolean;
  materialsChange?: boolean;
  clientApproved?: boolean;
};

type Row = Record<string, unknown>;

/**
 * PLM-121 / PLM-122: the facts an opportunity's flow asks for that live on the opportunity itself — the furniture
 * sub-path, the factory's feasibility confirmation, a client decision given on the spot — and the payment proof
 * that makes it Won. Every change is version-checked and audited.
 */
@Injectable()
export class OpportunityFlowService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
    private readonly opportunities: CrmOpportunitiesService,
    private readonly storage: BrandAssetStorageService,
    private readonly discovery: OpportunityDiscoveryService,
  ) {}

  update(actor: RequestActor, workspaceId: string, opportunityId: string, input: UpdateFlowInput) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.manage", async (client, user) => {
      const before = await this.lock(client, workspaceId, opportunityId);
      if (Number(before.version) !== input.version) throw new ConflictException("Opportunity changed; reload and try again");
      if (before.status !== "open") throw new UnprocessableEntityException("Reopen the opportunity before changing it");
      const facts = await loadFlowFacts(client, workspaceId, opportunityId, this.discovery, { actorUserId: user.userId });
      const touchesFurniture = input.furniturePath !== undefined || input.feasibilityConfirmed !== undefined || input.materialsChange !== undefined;
      // The sub-path belongs to flows that ask for it (the furniture starter does).
      if (touchesFurniture && !flowAsks(facts.flowDefinition.definition, "sub_path_chosen")) throw new UnprocessableEntityException("Only furniture enquiries have a sub-path");
      if (input.furniturePath !== undefined && input.furniturePath !== null && !FURNITURE_PATHS.includes(input.furniturePath)) throw new UnprocessableEntityException("Choose a furniture sub-path");
      const path = input.furniturePath !== undefined ? input.furniturePath : before.furniture_path as FurniturePath | null;
      // Feasibility is a bespoke question; it is cleared when the sub-path changes away from bespoke.
      const feasibility = path !== "bespoke" ? false : input.feasibilityConfirmed ?? Boolean(before.feasibility_confirmed_at);
      if (input.feasibilityConfirmed && path !== "bespoke") throw new UnprocessableEntityException("Feasibility applies to bespoke pieces only");
      const materialsChange = path === "core_collection_factory" ? input.materialsChange ?? Boolean(before.materials_change) : false;
      const result = await client.query<Row>(
        `UPDATE crm_opportunities SET furniture_path = $3,
           feasibility_confirmed_at = CASE WHEN $4::boolean THEN COALESCE(feasibility_confirmed_at, now()) ELSE NULL END,
           feasibility_confirmed_by = CASE WHEN $4::boolean THEN COALESCE(feasibility_confirmed_by, $8::uuid) ELSE NULL END,
           materials_change = $5,
           client_approved_at = CASE WHEN $6::boolean IS NULL THEN client_approved_at WHEN $6 THEN COALESCE(client_approved_at, now()) ELSE NULL END,
           client_approved_by = CASE WHEN $6::boolean IS NULL THEN client_approved_by WHEN $6 THEN COALESCE(client_approved_by, $8::uuid) ELSE NULL END,
           version = version + 1
         WHERE workspace_id = $1 AND id = $2 AND version = $7 RETURNING *`,
        [workspaceId, opportunityId, path, feasibility, materialsChange, input.clientApproved ?? null, input.version, user.userId]);
      if (!result.rowCount) throw new ConflictException("Opportunity changed; reload and try again");
      const after = result.rows[0];
      await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: "crm.opportunity.flow_updated.v1", entityType: "crm_opportunity", entityId: opportunityId,
        before: this.flowFields(before), after: this.flowFields(after) });
      return { version: after.version, ...this.flowFields(after) };
    });
  }

  /**
   * PLM-122: attaching the payment proof is what wins the deal. The proof is stored and the opportunity moves to the
   * Won column in the same transaction, through the same gates as any move, so a proof never leaves an
   * opportunity half-won and Won never exists without a proof.
   */
  attachProof(actor: RequestActor, workspaceId: string, opportunityId: string, input: { version: number; kind: string; note?: string | null }, file?: ReferenceUpload) {
    return this.access.withPermissions(actor, workspaceId, ["crm.opportunities.manage", "crm.opportunities.transition"], async (client, user) => {
      if (!Number.isInteger(input.version) || input.version < 1) throw new UnprocessableEntityException("Reload the opportunity and try again");
      if (!PAYMENT_PROOF_KINDS.includes(input.kind as PaymentProofKind)) throw new UnprocessableEntityException("Choose what the proof is");
      const note = input.note?.trim() || null;
      if (note && note.length > 1000) throw new UnprocessableEntityException("Keep the note under 1000 characters");
      const before = await this.lock(client, workspaceId, opportunityId);
      if (Number(before.version) !== input.version) throw new ConflictException("Opportunity changed; reload and try again");
      if (before.status !== "open") throw new UnprocessableEntityException("Only an open opportunity can be won");
      const prepared = await prepareReferenceUpload(file);
      const key = ["crm-payment-proofs", workspaceId, opportunityId, prepared.digest].join("/");
      await this.storage.put(`${key}/original`, prepared.body, prepared.mimeType);
      if (prepared.preview) await this.storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
      const proof = (await client.query<Row>(
        `INSERT INTO crm_opportunity_payment_proofs (workspace_id, opportunity_id, kind, storage_key, file_name, mime_type, byte_size, digest, has_preview, note, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id, kind, file_name AS "fileName", mime_type AS "mimeType", byte_size AS "byteSize", note, recorded_at AS "recordedAt"`,
        [workspaceId, opportunityId, input.kind, key, prepared.name, prepared.mimeType, prepared.body.length, prepared.digest, Boolean(prepared.preview), note, user.userId])).rows[0];
      await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: "crm.opportunity.payment_proof_attached.v1", entityType: "crm_opportunity", entityId: opportunityId, after: proof });
      const won = (await client.query<{ id: string }>(
        `SELECT id FROM crm_pipeline_stages WHERE workspace_id = $1 AND pipeline_id = $2 AND code = 'won' AND status = 'active' ORDER BY position LIMIT 1`,
        [workspaceId, before.pipeline_id])).rows[0];
      const opportunity = await this.opportunities.transitionWithin(client, user.userId, workspaceId, opportunityId, {
        version: input.version, stageId: won?.id, status: "won", reason: "Payment proof attached",
      });
      return { opportunity, proof };
    });
  }

  proofFile(actor: RequestActor, workspaceId: string, opportunityId: string, proofId: string, preview: boolean) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.view", async (client) => {
      const proof = (await client.query<{ key: string; name: string; mimeType: string; hasPreview: boolean }>(
        `SELECT storage_key AS key, file_name AS name, mime_type AS "mimeType", has_preview AS "hasPreview"
           FROM crm_opportunity_payment_proofs WHERE workspace_id = $1 AND opportunity_id = $2 AND id = $3`,
        [workspaceId, opportunityId, proofId])).rows[0];
      if (!proof) throw new NotFoundException("Payment proof not found");
      if (preview && !proof.hasPreview) throw new NotFoundException("Preview not available.");
      const stored = await this.storage.read(`${proof.key}/${preview ? "preview.webp" : "original"}`).catch(() => { throw new NotFoundException("This file could not be found in storage."); });
      return { body: stored.body, contentType: preview ? "image/webp" : proof.mimeType, name: proof.name, preview };
    });
  }

  private async lock(client: PoolClient, workspaceId: string, opportunityId: string) {
    const row = (await client.query<Row>(`SELECT * FROM crm_opportunities WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, opportunityId])).rows[0];
    if (!row) throw new NotFoundException("Opportunity not found");
    return row;
  }

  private flowFields(row: Row) {
    return {
      furniturePath: row.furniture_path ?? null, feasibilityConfirmedAt: row.feasibility_confirmed_at ?? null,
      materialsChange: Boolean(row.materials_change), clientApprovedAt: row.client_approved_at ?? null,
    };
  }
}
