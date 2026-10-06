import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { decideLedgerChange, ledgerChangeApproval, requestLedgerChangeApproval } from "../change-requests/ledger-change-approval";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { stageRevisions } from "./design-journey.domain";
import type { LedgerVersionInput } from "./design-ledger.domain";
import { addEntry, addVersion, archiveEntry, decideVersion, ledgerCatalogChoices, readLedger } from "./design-ledger.store";
import { createPresentation, decideRound, presentedRounds, presentRound, readPresentations, withdrawRound } from "./design-presentations.store";

export type PresentationInput = { id: string; stage: string; options: Array<{ id: string; title: string; note?: string | null; designId?: string | null; linkUrl?: string | null }> };
export type RoundDecisionInput = { version: number; decision: "chosen" | "changes_requested"; optionId?: string | null; source: string; decidedBy: string; note?: string | null };
export type LedgerEntryInput = LedgerVersionInput & { id: string; versionId: string; kind: string; roomId?: string | null; catalogItemId?: string | null; evidenceAssetId?: string | null };
export type LedgerVersionCommand = LedgerVersionInput & { versionId: string; entryVersion: number; catalogItemId?: string | null; evidenceAssetId?: string | null };
export type LedgerDecisionInput = { decision: "confirmed" | "declined"; method: string; decidedBy: string; note?: string | null };

/**
 * The client-facing decisions of the design flow: concept presentations (rounds with file or link options, the
 * client's choice, the revision counter and its chargeable flag; PLM-049/051/052) and the materials and decisions
 * ledger (PLM-054, E5-1/E5-2). Every command is validated, idempotent by its ids, version-checked and audited.
 */
@Injectable()
export class DesignDecisionsService {
  constructor(private readonly access: WorkspaceAccessService) {}

  presentations(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client) => this.presentationView(client, workspaceId, caseId));
  }

  createPresentation(actor: RequestActor, workspaceId: string, caseId: string, input: PresentationInput) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      if (await createPresentation(client, workspaceId, caseId, input, userId))
        await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.presentation_created.v1", entityType: "pre_project_case", entityId: caseId, after: { id: input.id, stage: input.stage, options: input.options.length } });
      return this.presentationView(client, workspaceId, caseId);
    });
  }

  /** PLM-052: on a package reviewed by the Creative Director (the package's reviewer role), only a reviewer presents. */
  present(actor: RequestActor, workspaceId: string, caseId: string, id: string, input: { version: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      const reviewer = (await client.query<{ role: string | null }>(`SELECT reviewer_role_code AS role FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0];
      if (!reviewer) throw new ConflictException("Start the design stages first");
      if (reviewer.role && !(await this.access.hasPermission(client, workspaceId, userId, "pre_projects.review_designs")))
        throw new ForbiddenException("The design reviewer approves this presentation before the client sees it.");
      const result = await presentRound(client, workspaceId, caseId, id, input.version, userId);
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.presentation_presented.v1", entityType: "pre_project_case", entityId: caseId, after: { id, ...result } });
      return this.presentationView(client, workspaceId, caseId);
    });
  }

  withdraw(actor: RequestActor, workspaceId: string, caseId: string, id: string, input: { version: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      await withdrawRound(client, workspaceId, caseId, id, input.version);
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.presentation_withdrawn.v1", entityType: "pre_project_case", entityId: caseId, after: { id } });
      return this.presentationView(client, workspaceId, caseId);
    });
  }

  /** Staff record the client's decision given outside the portal, with where and who (E5-2). */
  decide(actor: RequestActor, workspaceId: string, caseId: string, id: string, input: RoundDecisionInput) {
    return this.clientDecision(actor, workspaceId, caseId, async (client, userId) => {
      const result = await decideRound(client, workspaceId, caseId, id, { ...input, userId });
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.presentation_decided.v1", entityType: "pre_project_case", entityId: caseId,
        after: { id, decision: input.decision, optionId: input.optionId ?? null, source: input.source, decidedBy: input.decidedBy } });
      return { ...await this.presentationView(client, workspaceId, caseId), completed: result.completed ?? false };
    });
  }

  /** The catalog items a ledger choice can be tied to (so its fit through the site's access is checked). */
  ledgerCatalog(actor: RequestActor, workspaceId: string, caseId: string, search: string) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client) => {
      await this.case(client, workspaceId, caseId, false);
      return { items: await ledgerCatalogChoices(client, workspaceId, caseId, search) };
    });
  }

  ledger(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client, user) => ({
      ...await this.case(client, workspaceId, caseId, false).then(() => readLedger(client, workspaceId, caseId)),
      canEdit: await this.access.hasPermission(client, workspaceId, user.userId, "pre_projects.edit"),
      canRecordClient: await this.access.hasPermission(client, workspaceId, user.userId, "pre_projects.record_client_design_decisions"),
      canApprove: await this.access.hasPermission(client, workspaceId, user.userId, "pre_projects.review_designs"),
      // E5-1 on E3: the approval of changes after sign-off (who it waits for, at which step).
      approval: await ledgerChangeApproval(client, workspaceId, caseId),
    }));
  }

  addEntry(actor: RequestActor, workspaceId: string, caseId: string, input: LedgerEntryInput) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      const result = await addEntry(client, workspaceId, caseId, input, { userId });
      if (!result.replayed) await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.ledger_entry_added.v1", entityType: "design_ledger_entry", entityId: input.id,
        after: { kind: input.kind, title: input.title, source: input.source, versionId: input.versionId, afterLock: result.afterLock } });
      if (result.afterLock) await requestLedgerChangeApproval(client, workspaceId, caseId, userId);
      return readLedger(client, workspaceId, caseId);
    });
  }

  addVersion(actor: RequestActor, workspaceId: string, caseId: string, entryId: string, input: LedgerVersionCommand) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      const result = await addVersion(client, workspaceId, caseId, entryId, input, { userId });
      if (!result.replayed) await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.ledger_version_added.v1", entityType: "design_ledger_entry", entityId: entryId,
        after: { versionId: input.versionId, title: input.title, source: input.source, afterLock: result.afterLock } });
      if (result.afterLock) await requestLedgerChangeApproval(client, workspaceId, caseId, userId);
      return readLedger(client, workspaceId, caseId);
    });
  }

  archive(actor: RequestActor, workspaceId: string, caseId: string, entryId: string, input: { entryVersion: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      if (await archiveEntry(client, workspaceId, caseId, entryId, input.entryVersion, userId))
        await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.ledger_entry_archived.v1", entityType: "design_ledger_entry", entityId: entryId, after: {} });
      await requestLedgerChangeApproval(client, workspaceId, caseId, userId);
      return readLedger(client, workspaceId, caseId);
    });
  }

  /** The client's confirmation recorded by staff: how (signed document, email, in person…), who, and a note. */
  recordDecision(actor: RequestActor, workspaceId: string, caseId: string, entryId: string, versionId: string, input: LedgerDecisionInput) {
    return this.clientDecision(actor, workspaceId, caseId, async (client, userId) => {
      if (input.method === "portal") throw new ConflictException("Portal confirmations come from the client's portal.");
      const result = await decideVersion(client, workspaceId, caseId, entryId, versionId, { ...input, recordedBy: userId });
      if (!result.replayed) await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.ledger_decided.v1", entityType: "design_ledger_entry", entityId: entryId,
        after: { versionId, decision: input.decision, method: input.method, decidedBy: input.decidedBy } });
      return readLedger(client, workspaceId, caseId);
    });
  }

  /**
   * E5-1: changes made after the lock, all confirmed by the client, are approved on E3 (kind ledger_change: the
   * firm's policy says who, in order) and the list is locked again once the request is fully approved.
   */
  approveChanges(actor: RequestActor, workspaceId: string, caseId: string, input: { lockNumber: number; note?: string | null; decision?: "approve" | "return" | "reject"; commandId?: string | null; approvalVersion?: number | null }) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view"], async (client, user) => {
      await this.case(client, workspaceId, caseId);
      await decideLedgerChange(client, workspaceId, caseId, user.userId, { decision: input.decision, note: input.note, lockNumber: input.lockNumber,
        commandId: input.commandId, expectedVersion: input.approvalVersion });
      return { ...await readLedger(client, workspaceId, caseId), approval: await ledgerChangeApproval(client, workspaceId, caseId) };
    });
  }

  private async presentationView(client: PoolClient, workspaceId: string, caseId: string) {
    const included = (await client.query<{ included: number }>(`SELECT included_revisions AS included FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0]?.included ?? null;
    const rounds = await presentedRounds(client, workspaceId, caseId);
    return {
      presentations: await readPresentations(client, workspaceId, caseId),
      revisions: included === null ? null : Object.fromEntries(["concepts", "space_planning", "material_selection", "renders"].map((stage) =>
        [stage, stageRevisions(rounds.find((item) => item.stage === stage)?.rounds ?? 0, included)])),
    };
  }

  private async case(client: PoolClient, workspaceId: string, caseId: string, lock = true) {
    const found = await client.query<{ status: string }>(`SELECT status FROM pre_project_cases WHERE workspace_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [workspaceId, caseId]);
    if (!found.rowCount) throw new NotFoundException("Case not found");
    return found.rows[0];
  }

  private edit<T>(actor: RequestActor, workspaceId: string, caseId: string, work: (client: PoolClient, userId: string) => Promise<T>) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.edit"], async (client, user) => {
      // A released case (the project exists) still takes changes: after the lock they wait for approval (E5-1).
      if (!["active", "released"].includes((await this.case(client, workspaceId, caseId)).status)) throw new ConflictException("Reactivate the case first");
      return work(client, user.userId);
    });
  }

  private clientDecision<T>(actor: RequestActor, workspaceId: string, caseId: string, work: (client: PoolClient, userId: string) => Promise<T>) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.record_client_design_decisions"], async (client, user) => {
      // A released case (the project exists) still takes changes: after the lock they wait for approval (E5-1).
      if (!["active", "released"].includes((await this.case(client, workspaceId, caseId)).status)) throw new ConflictException("Reactivate the case first");
      return work(client, user.userId);
    });
  }
}
