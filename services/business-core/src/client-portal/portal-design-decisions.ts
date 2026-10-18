import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { decideVersion, readLedger } from "../design/design-ledger.store";
import { decideRound, readPresentations } from "../design/design-presentations.store";
import { readStepRevisions } from "../design/design-revisions.store";
import { STAGE_LABELS } from "../design/design-journey.domain";
import type { Grant } from "./portal-auth";
import { grantFor, type DecisionContext } from "./portal-decisions";
import { offerAlternatives, readAlternatives } from "./portal-alternatives";

type Db = Pick<PoolClient, "query">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The client's design choices in their portal (plan §6.7a): the presentations shown to them, where they pick one
 * concept or ask for changes, and the materials and decisions list where they confirm each choice (E5-2: the
 * contact who confirmed is the evidence). Drafts and internal notes never reach the client.
 */
export async function readDesignChoices(db: Db, workspaceId: string, grant: Grant, caseId: string, caseActive: boolean, choicesOpen = caseActive) {
  const decider = grant.role === "approver" && caseActive;
  // Choices stay open once the project exists: a change after sign-off is confirmed here too (E5-1), as ledgerDecision allows.
  const chooser = grant.role === "approver" && choicesOpen;
  // PLM-049/051: once a step's free revisions are used, asking for changes again is a paid change (a change request).
  const revisions = await readStepRevisions(db, workspaceId, caseId);
  const paidNext = (stage: string) => { const state = revisions?.[stage as keyof typeof revisions]; return Boolean(state && state.used >= state.included); };
  const presentations = (await readPresentations(db, workspaceId, caseId)).filter((item) => item.status !== "draft" && item.status !== "withdrawn")
    .map((item) => ({
      id: item.id, stage: item.stage, label: STAGE_LABELS[item.stage], round: item.round, status: item.status, version: item.version, presentedAt: item.presentedAt,
      chosenOptionId: item.chosenOptionId, decidedAt: item.decidedAt, decidedByName: item.decidedByName, decisionNote: item.decisionNote,
      canDecide: decider && item.status === "presented",
      paidChanges: paidNext(item.stage),
      options: item.options.map((option) => ({ id: option.id, title: option.title, note: option.note, linkUrl: option.linkUrl, versionId: option.versionId,
        versionNumber: option.versionNumber, mimeType: option.mimeType, hasPreview: option.hasPreview })),
    }));
  const ledger = await readLedger(db, workspaceId, caseId);
  // R2: alternatives offered on a choice the client declined, until one is picked or the team moves the choice on.
  const offers = await readAlternatives(db, workspaceId, caseId);
  const choices = ledger.entries.filter((entry) => !entry.archivedAt && entry.current).map((entry) => {
    const current = entry.current!;
    return {
      entryId: entry.id, kind: entry.kind, room: entry.roomName, versionId: current.id, number: current.number, title: current.title, specification: current.specification,
      quantity: current.quantity, unit: current.unit, unitPrice: current.unitPrice, currency: current.currency, priceImpact: current.priceImpact, timeImpactDays: current.timeImpactDays,
      afterLock: current.afterLock, status: current.status, confirmedAt: current.confirmedAt, confirmedByName: current.confirmedByName,
      // E5-4: a choice replaced after the client saw it is marked as changed.
      changed: current.number > 1,
      recordedAt: current.recordedAt,
      canDecide: chooser && current.status === "proposed",
      alternatives: current.status === "declined" ? (offers.get(current.id) ?? []).map((item) => ({ id: item.id, title: item.title, unit: item.unit, unitPrice: item.unitPrice,
        currency: item.currency, lineTotal: item.lineTotal, inStock: item.inStock, inBudget: item.inBudget, fromPastJobs: item.source === "past_job",
        canChoose: chooser })) : [],
    };
  });
  // The extra revisions' change requests once the team sent them (a draft or one being approved inside the firm stays with the team).
  const extraIds = revisions ? Object.values(revisions).map((state) => state.extra?.changeRequestId).filter((id): id is string => Boolean(id)) : [];
  const sent = extraIds.length ? (await db.query<{ id: string }>(
    `SELECT id FROM change_requests WHERE workspace_id = $1 AND case_id = $2 AND id = ANY($3::uuid[]) AND status IN ('with_client', 'approved', 'applied', 'declined')`,
    [workspaceId, caseId, extraIds])).rows.map((row) => row.id) : [];
  const extraRevisions = revisions ? Object.entries(revisions).filter(([, state]) => state.extra?.changeRequestId && sent.includes(state.extra.changeRequestId))
    .map(([stage, state]) => ({ stage, label: STAGE_LABELS[stage as keyof typeof STAGE_LABELS], changeId: state.extra!.changeRequestId! })) : [];
  return { presentations, choices, locked: Boolean(ledger.lock), currency: ledger.currency, extraRevisions };
}

export type PortalDesignChoices = Awaited<ReturnType<typeof readDesignChoices>>;

function decider(grant: Grant) {
  if (grant.role !== "approver") throw new ForbiddenException("Only the project's decision-maker can decide this. You can still read it.");
}

/** The client picks one option of a presentation (or asks for changes); the design team hears it. */
export async function presentationChoice(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "decisions");
  decider(grant);
  if (row.caseStatus !== "active") throw new ConflictException("This project isn't taking design decisions any more.");
  if (typeof body.presentationId !== "string" || !UUID.test(body.presentationId)) throw new BadRequestException("Choose a presentation.");
  const decision = body.decision === "changes" ? "changes_requested" : body.decision === "choose" ? "chosen" : null;
  if (!decision) throw new BadRequestException("Choose an option or ask for changes.");
  if (typeof body.version !== "number") throw new BadRequestException("Reload and try again.");
  const optionId = decision === "chosen" ? (typeof body.optionId === "string" && UUID.test(body.optionId) ? body.optionId : null) : null;
  if (decision === "chosen" && !optionId) throw new BadRequestException("Choose an option.");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
  const visible = (await readPresentations(ctx.db, ctx.workspaceId, row.caseId)).find((item) => item.id === body.presentationId && item.status !== "draft" && item.status !== "withdrawn");
  if (!visible) throw new NotFoundException("This presentation isn't shared with you.");
  const result = await decideRound(ctx.db, ctx.workspaceId, row.caseId, visible.id, { version: body.version, decision, optionId, source: "portal", decidedBy: grant.name, note: note || null, grantId: grant.id });
  return { ok: true, entity: { type: "pre_project_case", id: row.caseId },
    audit: { presentationId: visible.id, decision, optionId, replayed: result.replayed, extra: "extra" in result ? result.extra : null } };
}

/** The client confirms (or declines, saying what they want instead) the latest version of a choice. */
export async function ledgerDecision(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "decisions");
  decider(grant);
  if (!["active", "released"].includes(row.caseStatus)) throw new ConflictException("This project isn't taking decisions any more.");
  const id = (value: unknown, label: string) => { if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} isn't valid.`); return value; };
  const entryId = id(body.entryId, "Choice");
  const versionId = id(body.versionId, "Version");
  const decision = body.decision === "confirm" ? "confirmed" : body.decision === "decline" ? "declined" : null;
  if (!decision) throw new BadRequestException("Confirm or decline.");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
  const result = await decideVersion(ctx.db, ctx.workspaceId, row.caseId, entryId, versionId, { decision, method: "portal", decidedBy: grant.name, note: note || null, grantId: grant.id });
  if (decision === "declined") await offerAlternatives(ctx.db, ctx.workspaceId, row.caseId, entryId, versionId);
  return { ok: true, entity: { type: "design_ledger_entry", id: entryId }, audit: { versionId, decision, replayed: result.replayed } };
}
