import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { decideLedgerChange, ledgerChangeApproval, requestLedgerChangeApproval } from "../change-requests/ledger-change-approval";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { STAGE_LABELS, stageRevisions, type JourneyStage } from "./design-journey.domain";
import { caseFacts, holdsRole, membersWithRole, tellMembers } from "./design-journey.store";
import type { LedgerVersionInput } from "./design-ledger.domain";
import { addEntry, addVersion, archiveEntry, decideVersion, ledgerCatalogChoices, readLedger } from "./design-ledger.store";
import { createPresentation, decideRound, journeyReviewRole, presentedRounds, presentRound, readPresentations, reviewRound, roundReviewed, withdrawRound } from "./design-presentations.store";
import { tellFinishChanged } from "./finishes.store";
import { sampleChoices } from "./samples.store";

export type PresentationInput = { id: string; stage: string; options: Array<{ id: string; title: string; note?: string | null; designId?: string | null; linkUrl?: string | null }> };
export type RoundDecisionInput = { version: number; decision: "chosen" | "changes_requested"; optionId?: string | null; source: string; decidedBy: string; note?: string | null };
export type LedgerEntryInput = LedgerVersionInput & { id: string; versionId: string; kind: string; roomId?: string | null; catalogItemId?: string | null; evidenceAssetId?: string | null;
  categoryKey?: string | null; location?: string | null; installNote?: string | null };
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
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client, user) => this.presentationView(client, workspaceId, caseId, user.userId));
  }

  createPresentation(actor: RequestActor, workspaceId: string, caseId: string, input: PresentationInput) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      if (await createPresentation(client, workspaceId, caseId, input, userId)) {
        await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.presentation_created.v1", entityType: "pre_project_case", entityId: caseId, after: { id: input.id, stage: input.stage, options: input.options.length } });
        // PLM-145: on a reviewed package the reviewer hears there is a round to approve before the client sees it.
        const role = await journeyReviewRole(client, workspaceId, caseId);
        if (role && !(await this.reviews(client, workspaceId, caseId, userId))) {
          const facts = await caseFacts(client, workspaceId, caseId);
          const actorName = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? "";
          await tellMembers(client, workspaceId, await membersWithRole(client, workspaceId, role), "design.presentation_to_review",
            { stage: STAGE_LABELS[input.stage as JourneyStage] ?? input.stage, clientName: facts?.clientName ?? "", actor: actorName },
            `/workspace/pre-projects/cases/${caseId}/designs?stage=${input.stage}`, `design:${caseId}:review:${input.id}`, true, userId);
        }
      }
      return this.presentationView(client, workspaceId, caseId, userId);
    });
  }

  /**
   * PLM-145: on a package with a reviewer (Palm: the Creative Director on "Designed by the Creative Director"), every
   * concept and render round is approved by a member holding the package's review role before the client sees it. A
   * reviewer who shows it approves it as they do. Packages without a reviewer have no review.
   */
  review(actor: RequestActor, workspaceId: string, caseId: string, id: string, input: { version: number }) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view"], async (client, user) => {
      await this.case(client, workspaceId, caseId);
      if (!(await journeyReviewRole(client, workspaceId, caseId))) throw new ConflictException("This package has no review before the client sees it.");
      if (!(await this.reviews(client, workspaceId, caseId, user.userId))) throw new ForbiddenException("Only the package's reviewer approves this.");
      const result = await reviewRound(client, workspaceId, caseId, id, input.version, user.userId);
      if (!result.replayed) await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "design.presentation_reviewed.v1", entityType: "pre_project_case", entityId: caseId, after: { id, stage: result.stage } });
      return this.presentationView(client, workspaceId, caseId, user.userId);
    });
  }

  present(actor: RequestActor, workspaceId: string, caseId: string, id: string, input: { version: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      if (!(await client.query(`SELECT 1 FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rowCount) throw new ConflictException("Start the design stages first");
      const role = await journeyReviewRole(client, workspaceId, caseId);
      const reviewer = role ? await this.reviews(client, workspaceId, caseId, userId) : false;
      if (role && !reviewer && !(await roundReviewed(client, workspaceId, id)))
        throw new ForbiddenException("The design reviewer approves this presentation before the client sees it.");
      const result = await presentRound(client, workspaceId, caseId, id, input.version, userId, { reviewedBy: reviewer ? userId : null });
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.presentation_presented.v1", entityType: "pre_project_case", entityId: caseId, after: { id, ...result } });
      return this.presentationView(client, workspaceId, caseId, userId);
    });
  }

  /** Whether the person reviews this journey's rounds: they hold its review role, or they run Planning (an admin). */
  private async reviews(client: PoolClient, workspaceId: string, caseId: string, userId: string) {
    const role = await journeyReviewRole(client, workspaceId, caseId);
    if (!role) return false;
    const membership = (await client.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, userId])).rows[0]?.id;
    return (await holdsRole(client, workspaceId, membership, role)) || this.access.hasPermission(client, workspaceId, userId, "pre_projects.manage_lifecycle");
  }

  withdraw(actor: RequestActor, workspaceId: string, caseId: string, id: string, input: { version: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      await withdrawRound(client, workspaceId, caseId, id, input.version);
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.presentation_withdrawn.v1", entityType: "pre_project_case", entityId: caseId, after: { id } });
      return this.presentationView(client, workspaceId, caseId, userId);
    });
  }

  /** Staff record the client's decision given outside the portal, with where and who (E5-2). */
  decide(actor: RequestActor, workspaceId: string, caseId: string, id: string, input: RoundDecisionInput) {
    return this.clientDecision(actor, workspaceId, caseId, async (client, userId) => {
      const result = await decideRound(client, workspaceId, caseId, id, { ...input, userId });
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.presentation_decided.v1", entityType: "pre_project_case", entityId: caseId,
        after: { id, decision: input.decision, optionId: input.optionId ?? null, source: input.source, decidedBy: input.decidedBy } });
      return { ...await this.presentationView(client, workspaceId, caseId, userId), completed: result.completed ?? false };
    });
  }

  /**
   * The catalog items a ledger choice can be tied to (so its fit through the site's access is checked), and the sample
   * library's samples first: in stock, the firm's own stock before brands (PLM-144, PLM-157).
   */
  ledgerCatalog(actor: RequestActor, workspaceId: string, caseId: string, search: string) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client) => {
      await this.case(client, workspaceId, caseId, false);
      return { samples: await sampleChoices(client, workspaceId, search), items: await ledgerCatalogChoices(client, workspaceId, caseId, search) };
    });
  }

  ledger(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client, user) => ({
      ...await this.case(client, workspaceId, caseId, false).then(() => readLedger(client, workspaceId, caseId)),
      canEdit: await this.access.hasPermission(client, workspaceId, user.userId, "pre_projects.edit"),
      // PLM-157: the Material Coordinator keeps the materials (not the design choices) without editing the rest of the case.
      canManageMaterials: await this.access.hasPermission(client, workspaceId, user.userId, "pre_projects.edit")
        || await this.access.hasPermission(client, workspaceId, user.userId, "pre_projects.manage_materials"),
      canRecordClient: await this.access.hasPermission(client, workspaceId, user.userId, "pre_projects.record_client_design_decisions"),
      canApprove: await this.access.hasPermission(client, workspaceId, user.userId, "pre_projects.review_designs"),
      // E5-1 on E3: the approval of changes after sign-off (who it waits for, at which step).
      approval: await ledgerChangeApproval(client, workspaceId, caseId),
    }));
  }

  addEntry(actor: RequestActor, workspaceId: string, caseId: string, input: LedgerEntryInput) {
    return this.editMaterials(actor, workspaceId, caseId, async (client, userId, scope) => {
      if (scope === "materials" && input.kind !== "material") throw new ForbiddenException("You keep the materials; the designers record the design choices.");
      const result = await addEntry(client, workspaceId, caseId, input, { userId });
      if (!result.replayed) await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.ledger_entry_added.v1", entityType: "design_ledger_entry", entityId: input.id,
        after: { kind: input.kind, title: input.title, source: input.source, origin: input.origin ?? null, sampleId: input.sampleId ?? null, versionId: input.versionId, afterLock: result.afterLock } });
      if (result.afterLock) await requestLedgerChangeApproval(client, workspaceId, caseId, userId);
      return readLedger(client, workspaceId, caseId);
    });
  }

  addVersion(actor: RequestActor, workspaceId: string, caseId: string, entryId: string, input: LedgerVersionCommand) {
    return this.editMaterials(actor, workspaceId, caseId, async (client, userId, scope) => {
      await this.entryKind(client, workspaceId, caseId, entryId, scope);
      const result = await addVersion(client, workspaceId, caseId, entryId, input, { userId });
      if (!result.replayed) {
        await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.ledger_version_added.v1", entityType: "design_ledger_entry", entityId: entryId,
          after: { versionId: input.versionId, title: input.title, source: input.source, origin: input.origin ?? null, afterLock: result.afterLock } });
        // PLM-146: a finish changed after it went to QS: the QS hears it and the old price is flagged.
        await tellFinishChanged(client, workspaceId, caseId, entryId, { title: input.title ?? "", what: `New version: ${input.title ?? ""}${input.specification ? ` (${input.specification})` : ""}.`, actorUserId: userId });
      }
      if (result.afterLock) await requestLedgerChangeApproval(client, workspaceId, caseId, userId);
      return readLedger(client, workspaceId, caseId);
    });
  }

  archive(actor: RequestActor, workspaceId: string, caseId: string, entryId: string, input: { entryVersion: number }) {
    return this.editMaterials(actor, workspaceId, caseId, async (client, userId, scope) => {
      await this.entryKind(client, workspaceId, caseId, entryId, scope);
      if (await archiveEntry(client, workspaceId, caseId, entryId, input.entryVersion, userId)) {
        await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.ledger_entry_archived.v1", entityType: "design_ledger_entry", entityId: entryId, after: {} });
        const title = (await client.query<{ title: string }>(`SELECT title FROM design_ledger_versions WHERE workspace_id = $1 AND entry_id = $2 ORDER BY number DESC LIMIT 1`, [workspaceId, entryId])).rows[0]?.title ?? "";
        await tellFinishChanged(client, workspaceId, caseId, entryId, { title, what: "Removed from the schedule.", actorUserId: userId });
      }
      await requestLedgerChangeApproval(client, workspaceId, caseId, userId);
      return readLedger(client, workspaceId, caseId);
    });
  }

  /** The entry's kind, for someone who keeps only the materials (they can't change a design choice). */
  private async entryKind(client: PoolClient, workspaceId: string, caseId: string, entryId: string, scope: "all" | "materials") {
    if (scope === "all") return;
    const kind = (await client.query<{ kind: string }>(`SELECT kind FROM design_ledger_entries WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, entryId])).rows[0]?.kind;
    if (kind && kind !== "material") throw new ForbiddenException("You keep the materials; the designers record the design choices.");
  }

  /** The client's confirmation recorded by staff: how (signed document, email, in person…), who, and a note. */
  recordDecision(actor: RequestActor, workspaceId: string, caseId: string, entryId: string, versionId: string, input: LedgerDecisionInput) {
    return this.clientDecision(actor, workspaceId, caseId, async (client, userId) => {
      if (input.method === "portal") throw new ConflictException("Portal confirmations come from the client's portal.");
      const result = await decideVersion(client, workspaceId, caseId, entryId, versionId, { ...input, recordedBy: userId });
      if (!result.replayed) {
        await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.ledger_decided.v1", entityType: "design_ledger_entry", entityId: entryId,
          after: { versionId, decision: input.decision, method: input.method, decidedBy: input.decidedBy } });
        // A material the client turns down after it went to QS: the QS hears it (its price no longer stands).
        if (input.decision === "declined")
          await tellFinishChanged(client, workspaceId, caseId, entryId, { title: result.title, what: `Not approved by the client: ${input.note?.trim() ?? ""}`, actorUserId: userId });
      }
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

  private async presentationView(client: PoolClient, workspaceId: string, caseId: string, userId?: string) {
    const journey = (await client.query<{ included: number; conceptOptionsMax: number | null }>(
      `SELECT included_revisions AS included, concept_options_max AS "conceptOptionsMax" FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0];
    const included = journey?.included ?? null;
    const rounds = await presentedRounds(client, workspaceId, caseId);
    const reviewRole = await journeyReviewRole(client, workspaceId, caseId);
    return {
      presentations: await readPresentations(client, workspaceId, caseId),
      revisions: included === null ? null : Object.fromEntries(["concepts", "space_planning", "material_selection", "renders"].map((stage) =>
        [stage, stageRevisions(rounds.find((item) => item.stage === stage)?.rounds ?? 0, included)])),
      /** PLM-145: whether rounds wait for the reviewer, and whether this person is one; PLM-142: how many concept options. */
      review: reviewRole ? { role: reviewRole, canReview: userId ? await this.reviews(client, workspaceId, caseId, userId) : false } : null,
      conceptOptionsMax: journey?.conceptOptionsMax ?? null,
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

  /**
   * The material log (PLM-157): whoever edits the case, or someone who keeps the materials and samples on cases (the
   * Material Coordinator: `materials` scope, materials only). A released case still takes changes (E5-1).
   */
  private editMaterials<T>(actor: RequestActor, workspaceId: string, caseId: string, work: (client: PoolClient, userId: string, scope: "all" | "materials") => Promise<T>) {
    return this.access.withAnyPermission(actor, workspaceId, ["pre_projects.edit", "pre_projects.manage_materials"], async (client, user) => {
      if (!(await this.access.hasPermission(client, workspaceId, user.userId, "pre_projects.view"))) throw new ForbiddenException("Permissions required: pre_projects.view");
      if (!["active", "released"].includes((await this.case(client, workspaceId, caseId)).status)) throw new ConflictException("Reactivate the case first");
      const scope = await this.access.hasPermission(client, workspaceId, user.userId, "pre_projects.edit") ? "all" as const : "materials" as const;
      return work(client, user.userId, scope);
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
