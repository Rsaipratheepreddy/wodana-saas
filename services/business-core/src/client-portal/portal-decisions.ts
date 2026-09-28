import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { controlledChangeCanRelease, controlledChangeForQuote } from "../commercial/change-control";
import { actionable, newRequest, quoteDecisionEvidence } from "../commercial/commercial.domain";
import type { ChangeRequest, CommercialData, Quote } from "../commercial/commercial.types";
import { decidePortalDesign, portalReviewDesign } from "../commercial/portal-design-approval";
import { winOpportunityOnAcceptance } from "../commercial/quote-acceptance";
import { splitByPercent } from "../commercial/case-money";
import { validateDeduction } from "../commercial/variation-controls";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { noticeProject } from "../project-core/project-notices";
import { recordMaterialDecision } from "../project-core/project-materials";
import { noticeQuoteStep } from "../quotation/quote-notices";
import { decideHandoverPack } from "../site/handover";
import type { Grant, PortalContact } from "./portal-auth";
import { attach, ownUploads } from "./portal-files";
import { readCase } from "./portal-read";
import { effectiveSections, readProjectAccess, type PortalSettings, type Section } from "./portal-settings";

type Db = PoolClient;
const NIL = "00000000-0000-4000-8000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The commercial record (quotes, requests, payments) as the commercial module loads and saves it. */
export type CommercialStore = {
  load(client: Db, workspaceId: string, caseId: string): Promise<CommercialData>;
  persist(client: Db, workspaceId: string, caseId: string, data: CommercialData, actor: string, action: string, quoteId?: string, note?: string): Promise<void>;
};

export type DefinitionDecider = {
  assertPortalDecisionAvailable(client: Db, workspaceId: string, caseId: string, baselineId: string): Promise<void>;
  decidePortal(client: Db, workspaceId: string, caseId: string, grant: { id: string; name: string; role: string },
    input: { baselineId: string; decision: "accept" | "changes"; note: string; challengeId: string }, verify: () => Promise<string | null>): Promise<unknown>;
};

export type DecisionContext = {
  db: Db; workspaceId: string; contact: PortalContact; settings: PortalSettings; today: string;
  commercial: CommercialStore; definitions: DefinitionDecider;
  /** Checks the code the client typed for exactly this decision; false when it's wrong or used. */
  verify(purpose: string, challengeId: string, code: string): Promise<boolean>;
};

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} isn't valid.`);
  return value;
}

function words(value: unknown, max: number, label: string, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new BadRequestException(label);
  if (text.length > max) throw new BadRequestException(`Keep it under ${max} characters.`);
  return text;
}

/** The client's grant on a project, and the project's own portal state; a paused project or a hidden section can't be acted on. */
export async function grantFor(ctx: Pick<DecisionContext, "db" | "workspaceId" | "contact" | "settings">, caseId: unknown, section: Section) {
  const id = uuid(caseId, "Project");
  const grant = ctx.contact.grants.find((item) => item.caseId === id);
  if (!grant) throw new NotFoundException("This project isn't shared with you.");
  const row = await readCase(ctx.db, ctx.workspaceId, id);
  if (!row) throw new NotFoundException("This project isn't shared with you.");
  const access = row.projectId ? await readProjectAccess(ctx.db, ctx.workspaceId, row.projectId) : null;
  if (access?.paused) throw new ConflictException("Your project page is paused. Your project team will let you know when it's back.");
  if (!effectiveSections(ctx.settings, access)[section]) throw new NotFoundException("This part of your project isn't shared with you.");
  return { grant, row };
}

function decider(grant: Grant) {
  if (grant.role !== "approver") throw new ForbiddenException("Only the project's decision-maker can decide this. You can still read it.");
}

async function code(ctx: DecisionContext, purpose: string, body: Record<string, unknown>) {
  const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
  const typed = typeof body.code === "string" ? body.code : "";
  if (!(await ctx.verify(purpose, challengeId, typed))) throw new UnauthorizedException("That code isn't right or has expired. Ask for a new one.");
  return challengeId;
}

/**
 * Checks, before a code is sent, that this client may take this decision now: the purpose names the kind,
 * the project, the exact record and the decision ("quote:<case>:<quote>:accept").
 */
export async function assertDecisionOpen(ctx: DecisionContext, purpose: string) {
  const [kind, caseId, recordId, decision, ...rest] = purpose.split(":");
  const allowed: Record<string, string[]> = { quote: ["accept", "changes", "decline"], design: ["accept", "changes", "decline"], definition: ["accept", "changes"],
    materials: ["submit"], handover: ["accept", "refuse"] };
  if (rest.length || !allowed[kind]?.includes(decision)) throw new BadRequestException("This decision isn't valid.");
  const { grant, row } = await grantFor(ctx, caseId, "decisions");
  decider(grant);
  uuid(recordId, "Decision");
  if (kind === "quote") {
    const quote = (await ctx.commercial.load(ctx.db, ctx.workspaceId, row.caseId)).quotes.find((item) => item.id === recordId);
    if (!quote || quote.approverId !== grant.id) throw new ForbiddenException("This quotation was sent to another decision-maker.");
    actionable(quote);
  } else if (kind === "design") await portalReviewDesign(ctx.db, ctx.workspaceId, row.caseId, recordId);
  else if (kind === "definition") await ctx.definitions.assertPortalDecisionAvailable(ctx.db, ctx.workspaceId, row.caseId, recordId);
  else if (kind === "materials") {
    const revision = row.projectId ? (await ctx.db.query<{ id: string; status: string }>(
      `SELECT id, status FROM project_material_revisions WHERE workspace_id = $1 AND project_id = $2 ORDER BY number DESC LIMIT 1`, [ctx.workspaceId, row.projectId])).rows[0] : undefined;
    if (!revision || revision.id !== recordId || revision.status !== "sent") throw new ConflictException("This material list isn't waiting for your decision any more. Reload to see the latest.");
  } else {
    const pack = row.projectId ? (await ctx.db.query<{ status: string }>(`SELECT status FROM handover_packs WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
      [ctx.workspaceId, row.projectId, recordId])).rows[0] : undefined;
    if (!pack || pack.status !== "issued") throw new ConflictException("This handover isn't waiting for your decision any more. Reload to see the latest.");
  }
}

// ---------- quotations and variations ----------

/**
 * The client accepts (with the options they choose), asks for changes or declines the exact issued
 * revision. Keeps the commercial rules: a controlled change case is decided whole, an accepted variation
 * adds its payment milestones or credit, and changes open a request for the team.
 */
export async function decideQuote(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "decisions");
  decider(grant);
  const data = await ctx.commercial.load(ctx.db, ctx.workspaceId, row.caseId);
  const q = data.quotes.find((item) => item.id === body.quoteId);
  if (!q || q.approverId !== grant.id) throw new ForbiddenException("This quotation was sent to another decision-maker.");
  const decision = body.decision;
  if (decision !== "accept" && decision !== "changes" && decision !== "decline") throw new BadRequestException("Choose accept, ask for changes or decline.");
  const note = words(body.note, 6000, decision === "changes" ? "Say what you'd like changed." : "Say why you're declining.", decision !== "accept");
  // The decision is bound to the exact revision the client read.
  if (typeof body.hash === "string" && q.hash && body.hash !== q.hash) throw new ConflictException("This quotation changed since you opened it. Reload to read the latest.");
  const target = decision === "accept" ? "accepted" : decision === "changes" ? "changes_requested" : "declined";
  const requested = quoteDecisionEvidence(q, decision, body.selectedOptionLineIds ?? [], grant.name, q.decidedAt ?? new Date().toISOString(), note);
  if (q.status === target && q.clientDecision && q.clientDecision.quoteHash === requested.quoteHash
    && JSON.stringify(q.clientDecision.selectedOptionLineIds) === JSON.stringify(requested.selectedOptionLineIds))
    return { ok: true, replayed: true };
  const controlled = controlledChangeForQuote(data, q.id);
  if (controlled && !controlled.control!.quoteIds.every((id) => data.quotes.some((quote) => quote.id === id && quote.status === "issued")))
    throw new ConflictException("Your project team is still preparing the rest of this change. You'll be told when it's ready to decide.");
  actionable(q);
  // Photos of what they'd like changed go with the decision (never with an acceptance).
  const files = decision === "accept" ? [] : await ownUploads(ctx.db, ctx.workspaceId, ctx.contact, row.caseId, body.uploadIds);
  const challengeId = await code(ctx, `quote:${row.caseId}:${q.id}:${decision}`, body);
  q.decidedAt = new Date().toISOString();
  q.decidedBy = grant.name;
  q.decisionChallengeId = challengeId;
  q.clientDecision = quoteDecisionEvidence(q, decision, body.selectedOptionLineIds ?? [], grant.name, q.decidedAt, note);
  if (decision === "accept") validateDeduction(data, q);
  q.status = target;
  const acceptedForEffects = new Map([[q.id, q]]);
  if (decision === "accept") {
    for (const id of q.requestIds ?? []) {
      const request = data.requests.find((item) => item.id === id);
      if (!request || ["declined", "withdrawn", "resolved"].includes(request.status)) continue;
      if (!request.control) { request.status = "resolved"; request.resolution = `Applied in accepted V${q.number}`; continue; }
      const caseQuotes = request.control.quoteIds.map((id) => data.quotes.find((quote) => quote.id === id)).filter((quote): quote is Quote => Boolean(quote));
      if (caseQuotes.length === request.control.quoteIds.length && caseQuotes.every((quote) => quote.status === "accepted")) {
        if (!controlledChangeCanRelease(data, request.id)) throw new ConflictException("Your project team still has to finish preparing this change. Please try again later.");
        request.status = "resolved";
        request.resolution = `Applied through accepted Change Case C${request.number}`;
        for (const quote of caseQuotes) acceptedForEffects.set(quote.id, quote);
      } else {
        acceptedForEffects.delete(q.id);
        request.status = "awaiting_decision";
        request.resolution = "";
      }
    }
  } else if (controlled) {
    controlled.status = "under_review";
    controlled.resolution = "";
  }
  const asked = decision === "changes" && !controlled ? newRequest(data, `Changes to quotation V${q.number}`, note, q.id) : null;
  if (decision === "accept")
    for (const accepted of acceptedForEffects.values()) {
      if (accepted.kind === "variation" && accepted.direction !== "deduction" && data.agreement && !data.payments.some((payment) => payment.sourceQuoteId === accepted.id)) {
        // Milestones split exactly in the currency's minor units; the last one takes what's left so they add up to the accepted total.
        const terms = accepted.paymentTerms ?? [];
        const shares = splitByPercent(accepted.clientDecision?.acceptedTotal ?? accepted.total, terms.map((term) => term.percent), data.financeContext?.currency ?? accepted.currency);
        for (const [index, term] of terms.entries()) {
          data.payments.push({ id: randomUUID(), sourceQuoteId: accepted.id, legalEntityId: data.financeContext?.legalEntityId, currency: data.financeContext?.currency,
            agreementReference: data.agreement.reference, title: `Variation V${accepted.number} · ${term.title}`, trigger: term.trigger, amount: shares[index], dueDate: "",
            requiredForRelease: term.requiredForRelease, requiredForProduction: term.requiredForProduction === true, status: "pending", proof: "", reference: "" });
        }
      }
      if (accepted.kind === "variation" && accepted.direction === "deduction" && !data.credits?.some((credit) => credit.quoteId === accepted.id)) {
        data.credits ??= [];
        data.credits.push({ id: randomUUID(), quoteId: accepted.id, legalEntityId: data.financeContext?.legalEntityId, amount: accepted.clientDecision?.acceptedTotal ?? accepted.total,
          currency: accepted.currency, status: "pending", reference: "", evidence: "" });
      }
    }
  // The client's acceptance is the sale: the opportunity is Won and the case moves to Agree, with no manual step.
  if (decision === "accept" && q.kind === "quotation")
    await winOpportunityOnAcceptance(ctx.db, { workspaceId: ctx.workspaceId, caseId: row.caseId, quoteNumber: q.number, round: q.round ?? null, actorUserId: null, source: "client_portal", grantId: grant.id });
  await ctx.commercial.persist(ctx.db, ctx.workspaceId, row.caseId, data, grant.name, `Client ${decision} (portal)`, q.id, note);
  // The change request the team works from carries the photos; a decline keeps them on the decision.
  await attach(ctx.db, ctx.workspaceId, { caseId: row.caseId, grantId: grant.id, kind: asked ? "message" : "decision", targetId: asked ? asked.id : `quote:${q.id}`, files });
  // The account manager and whoever built it hear the client's decision.
  await noticeQuoteStep(ctx.db, { workspaceId: ctx.workspaceId, caseId: row.caseId, quoteId: q.id, number: q.number, title: q.title, action: "record_decision",
    actorUserId: NIL, revision: data.revision, note, decision });
  return { ok: true, entity: { type: "pre_project_case", id: row.caseId }, audit: { quoteId: q.id, number: q.number, decision, hash: q.hash, options: q.clientDecision.selectedOptionLineIds } };
}

// ---------- designs and the requirements definition ----------

export async function decideDesign(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "decisions");
  decider(grant);
  const versionId = uuid(body.versionId, "Design");
  const decision = typeof body.decision === "string" ? body.decision : "";
  const note = words(body.note, 5000, "Add a note.");
  const files = decision === "accept" ? [] : await ownUploads(ctx.db, ctx.workspaceId, ctx.contact, row.caseId, body.uploadIds);
  const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
  const result = await decidePortalDesign(ctx.db, ctx.workspaceId, row.caseId, grant, { versionId, decision, note, challengeId },
    async () => ((await ctx.verify(`design:${row.caseId}:${versionId}:${decision}`, challengeId, typeof body.code === "string" ? body.code : "")) ? ctx.contact.phone : null));
  if ("invalidCode" in result) throw new UnauthorizedException("That code isn't right or has expired. Ask for a new one.");
  await attach(ctx.db, ctx.workspaceId, { caseId: row.caseId, grantId: grant.id, kind: "decision", targetId: `design:${versionId}`, files });
  return { ok: true, entity: { type: "pre_project_case", id: row.caseId }, audit: { versionId, decision, files: files.length } };
}

export async function decideDefinition(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "decisions");
  decider(grant);
  const baselineId = uuid(body.baselineId, "Definition");
  const decision = body.decision === "accept" ? "accept" as const : body.decision === "changes" ? "changes" as const : null;
  if (!decision) throw new BadRequestException("Confirm it, or ask for changes.");
  const note = words(body.note, 5000, "Say what should change.", decision === "changes");
  const files = decision === "changes" ? await ownUploads(ctx.db, ctx.workspaceId, ctx.contact, row.caseId, body.uploadIds) : [];
  const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
  const result = await ctx.definitions.decidePortal(ctx.db, ctx.workspaceId, row.caseId, grant, { baselineId, decision, note, challengeId },
    async () => ((await ctx.verify(`definition:${row.caseId}:${baselineId}:${decision}`, challengeId, typeof body.code === "string" ? body.code : "")) ? ctx.contact.phone : null));
  if (result && typeof result === "object" && "invalidCode" in result) throw new UnauthorizedException("That code isn't right or has expired. Ask for a new one.");
  await attach(ctx.db, ctx.workspaceId, { caseId: row.caseId, grantId: grant.id, kind: "decision", targetId: `definition:${baselineId}`, files });
  return { ok: true, entity: { type: "pre_project_case", id: row.caseId }, audit: { baselineId, decision, files: files.length } };
}

/** A decision the team asked for (one of the choices they offered), answered once. */
export async function answerRequest(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "decisions");
  decider(grant);
  const data = await ctx.commercial.load(ctx.db, ctx.workspaceId, row.caseId);
  const request = data.requests.find((item) => item.id === body.requestId);
  if (!request?.decisionRequest) throw new NotFoundException("This question isn't there any more.");
  if (request.decisionRequest.clientApproverGrantId !== grant.id) throw new ForbiddenException("This question was sent to another decision-maker.");
  const choice = request.decisionRequest.allowedChoices.find((item) => item.id === body.choiceId);
  if (!choice) throw new BadRequestException("Choose one of the answers.");
  const note = words(body.note, 6000, "");
  if (request.decisionRequest.decision) {
    if (request.decisionRequest.decision.choiceId === choice.id && request.decisionRequest.decision.note === note) return { ok: true, replayed: true };
    throw new ConflictException("This question was already answered.");
  }
  if (request.status !== "awaiting_decision") throw new ConflictException("This question isn't waiting for an answer any more.");
  if (request.dueDate && request.dueDate < ctx.today) throw new ConflictException("The time to answer has passed. Ask your project team to send it again.");
  const asked = request.decisionRequest.target;
  const available = asked.type === "quotation"
    ? data.quotes.some((item) => item.id === asked.id && item.number === asked.revision && !["superseded", "withdrawn"].includes(item.status))
    : data.materialApprovals?.some((item) => item.id === asked.id && item.revision === asked.revision && item.status === "client_review");
  if (!available) throw new ConflictException("What this question is about has changed. Your project team will send a new one.");
  request.decisionRequest.decision = { responseId: randomUUID(), choiceId: choice.id, choiceLabel: choice.label, note, decidedAt: new Date().toISOString(), decidedBy: grant.name,
    clientGrantId: grant.id };
  request.status = "resolved";
  request.resolution = `${choice.label}${note ? ` · ${note}` : ""}`;
  await ctx.commercial.persist(ctx.db, ctx.workspaceId, row.caseId, data, grant.name, "Client answered (portal)");
  return { ok: true, entity: { type: "pre_project_case", id: row.caseId }, audit: { requestId: request.id, choice: choice.id } };
}

// ---------- the material list ----------

/**
 * The client approves or rejects each material on the revision they were sent (a rejection says what they
 * want instead). All approved signs the list off; the team is told either way.
 */
export async function decideMaterials(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "decisions");
  decider(grant);
  if (!row.projectId || !["active", "on_hold"].includes(row.projectStatus ?? "")) throw new ConflictException("This project is closed.");
  const revisionId = uuid(body.revisionId, "Material list");
  await ctx.db.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [ctx.workspaceId, row.projectId]);
  const current = (await ctx.db.query<{ status: string; decidedByGrant: string | null }>(
    `SELECT status, decided_by_grant_id AS "decidedByGrant" FROM project_material_revisions WHERE workspace_id = $1 AND id = $2 AND project_id = $3`,
    [ctx.workspaceId, revisionId, row.projectId])).rows[0];
  if (!current) throw new NotFoundException("This material list isn't there any more.");
  // Two decision-makers: the first decision stands and the other sees it.
  if (current.status !== "sent") throw new ConflictException(current.decidedByGrant === grant.id ? "You already decided this list." : "Someone on your side already decided this list. Reload to see it.");
  const files = await ownUploads(ctx.db, ctx.workspaceId, ctx.contact, row.caseId, body.uploadIds);
  await code(ctx, `materials:${row.caseId}:${revisionId}:submit`, body);
  const decisions = (Array.isArray(body.decisions) ? body.decisions : []).map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    return { itemId: item.itemId, decision: item.decision, note: typeof item.note === "string" ? item.note.trim().slice(0, 1000) : "" };
  });
  const result = await recordMaterialDecision(ctx.db, ctx.workspaceId, row.projectId, { decisions, note: words(body.note, 2000, "") }, null,
    { grantId: grant.id, name: grant.name, revisionId });
  await attach(ctx.db, ctx.workspaceId, { caseId: row.caseId, grantId: grant.id, kind: "decision", targetId: `materials:${revisionId}`, files });
  const team = (await ctx.db.query<{ id: string }>(`SELECT membership_id AS id FROM project_assignments WHERE workspace_id = $1 AND project_id = $2 AND active`,
    [ctx.workspaceId, row.projectId])).rows.map((member) => member.id);
  await noticeProject(ctx.db, { workspaceId: ctx.workspaceId, projectId: row.projectId, key: `materials:${result.number}`, actorUserId: NIL, notice: result.signedOff
    ? { code: "project.materials_signed_off", revision: `R${result.number}`, note: "", memberships: team }
    : { code: "project.materials_changes", revision: `R${result.number}`, note: result.note, memberships: team } });
  return { ok: true, entity: { type: "project", id: row.projectId }, audit: { revisionId, number: result.number, signedOff: result.signedOff } };
}

// ---------- handover ----------

/** The client accepts the issued pack (listing anything still to finish) or refuses it with why. */
export async function decideHandover(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "decisions");
  decider(grant);
  if (!row.projectId || !["active", "on_hold"].includes(row.projectStatus ?? "")) throw new ConflictException("This project is closed.");
  const packId = uuid(body.packId, "Handover");
  const decision = body.decision === "accept" ? "accept" as const : body.decision === "refuse" ? "refuse" as const : null;
  if (!decision) throw new BadRequestException("Accept the handover, or say why not.");
  await ctx.db.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [ctx.workspaceId, row.projectId]);
  const pack = (await ctx.db.query<{ id: string; revision: number; title: string; areaIds: string[]; status: string; issuedBy: string; contentHash: string }>(
    `SELECT id, revision, title, area_ids AS "areaIds", status, issued_by AS "issuedBy", content_hash AS "contentHash" FROM handover_packs
      WHERE workspace_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`, [ctx.workspaceId, row.projectId, packId])).rows[0];
  if (!pack) throw new NotFoundException("This handover isn't there any more.");
  if (pack.status !== "issued") throw new ConflictException("This handover was already decided. Reload to see it.");
  const reason = words(body.reason, 1000, "Say why you're not accepting it yet.", decision === "refuse");
  const outstanding = decision === "accept" && Array.isArray(body.outstanding)
    ? body.outstanding.map((item) => (typeof item === "string" ? item.trim().slice(0, 300) : "")).filter(Boolean).slice(0, 30) : [];
  const files = await ownUploads(ctx.db, ctx.workspaceId, ctx.contact, row.caseId, body.uploadIds);
  await code(ctx, `handover:${row.caseId}:${packId}:${decision}`, body);
  // Snags from the portal are recorded under the project manager, or whoever issued the pack.
  const staffId = (await ctx.db.query<{ userId: string }>(
    `SELECT membership.user_id AS "userId" FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND assignment.is_manager LIMIT 1`, [ctx.workspaceId, row.projectId])).rows[0]?.userId ?? pack.issuedBy;
  const decided = await decideHandoverPack(ctx.db, ctx.workspaceId, row.projectId, pack, { decision, decidedOn: ctx.today, decidedByName: grant.name, method: "portal",
    outstanding, reason, recordedBy: null, grantId: grant.id, staffId });
  await attach(ctx.db, ctx.workspaceId, { caseId: row.caseId, grantId: grant.id, kind: "decision", targetId: `handover:${packId}`, files });
  await tellTeam(ctx.db, ctx.workspaceId, row.projectId, decision === "accept" ? "handover.accepted" : "handover.refused", grant.name,
    decision === "accept" ? `${grant.name} accepted R${pack.revision} in the portal${outstanding.length ? ` with ${outstanding.length} item${outstanding.length === 1 ? "" : "s"} outstanding` : ""}.` : reason,
    `${decision}:${pack.id}`, "/handover", false);
  return { ok: true, entity: { type: "project", id: row.projectId }, audit: { packId, revision: pack.revision, hash: pack.contentHash, decision, outstanding: outstanding.length, next: decided.next } };
}

// ---------- warranty ----------

/** The client reports a problem under warranty: a claim for the project manager to decide, with the client contact as its author. */
export async function claimWarranty(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "warranty");
  if (!row.projectId || !["active", "on_hold", "completed"].includes(row.projectStatus ?? "")) throw new ConflictException("This project can't take warranty claims.");
  const description = words(body.description, 2000, "Say what's wrong.", true);
  const lineId = body.lineId ? uuid(body.lineId, "Item") : null;
  const areaId = body.areaId ? uuid(body.areaId, "Area") : null;
  const covered = (await ctx.db.query<{ lineId: string; areaId: string | null }>(
    `SELECT item.boq_line_id AS "lineId", line.area_id AS "areaId" FROM warranty_items item
       JOIN project_boq_lines line ON line.workspace_id = item.workspace_id AND line.id = item.boq_line_id
      WHERE item.workspace_id = $1 AND item.project_id = $2 AND item.months > 0 AND $3::date BETWEEN item.starts_on AND item.ends_on`,
    [ctx.workspaceId, row.projectId, ctx.today])).rows;
  if (!covered.length) throw new ConflictException("Nothing on this project is under warranty today. Call your project team for help.");
  if (lineId && !covered.some((item) => item.lineId === lineId)) throw new BadRequestException("Choose an item that's under warranty.");
  if (areaId && !covered.some((item) => item.areaId === areaId)) throw new BadRequestException("Choose an area that's under warranty.");
  const files = await ownUploads(ctx.db, ctx.workspaceId, ctx.contact, row.caseId, body.uploadIds, 6);
  await ctx.db.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [ctx.workspaceId, row.projectId]);
  const id = randomUUID();
  const number = (await ctx.db.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM warranty_claims WHERE workspace_id = $1 AND project_id = $2`,
    [ctx.workspaceId, row.projectId])).rows[0].next;
  await ctx.db.query(
    `INSERT INTO warranty_claims (id, workspace_id, project_id, number, raised_on, raised_by_name, channel, description, area_id, boq_line_id, created_by, client_grant_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'portal', $7, $8, $9, NULL, $10)`,
    [id, ctx.workspaceId, row.projectId, number, ctx.today, grant.name.slice(0, 200), description, areaId, lineId, grant.id]);
  await attach(ctx.db, ctx.workspaceId, { caseId: row.caseId, grantId: grant.id, kind: "warranty_claim", targetId: id, files });
  await tellTeam(ctx.db, ctx.workspaceId, row.projectId, "warranty.claim", grant.name, `${grant.name}: ${description}${files.length ? ` (${files.length} photo${files.length === 1 ? "" : "s"})` : ""}`,
    `claim:${id}`, "/handover?view=warranty", true);
  return { ok: true, claimId: id, number, entity: { type: "project", id: row.projectId }, audit: { claimId: id, number, files: files.length } };
}

// ---------- messages (portal-messages.ts) ----------

/**
 * The case owner, the engagement owner and, once the project has started, its managers hear a client's
 * request or reply in-app (and by email from the portal), once per message (the key is the request or comment
 * id). The link opens that request thread on the planning case, where the team reads and replies.
 */
export async function noticeClientMessage(db: Db, workspaceId: string, row: { caseId: string; projectId: string | null; title: string; reference: string | null; projectName: string | null },
  input: { code: "request.client_raised" | "request.client_replied"; actor: string; request: Pick<ChangeRequest, "id" | "number" | "title">; note: string; key: string; email?: boolean }) {
  const facts = (await db.query<{ clientName: string; ownerUserId: string | null; engagementOwnerUserId: string | null }>(
    `SELECT coalesce(party.display_name, opportunity.title) AS "clientName", owner.user_id AS "ownerUserId", engagement_owner.user_id AS "engagementOwnerUserId"
       FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN workspace_memberships owner ON owner.workspace_id = opportunity.workspace_id AND owner.id = opportunity.owner_membership_id AND owner.status = 'active'
       LEFT JOIN workspace_memberships engagement_owner ON engagement_owner.workspace_id = pre_case.workspace_id AND engagement_owner.id = pre_case.owner_membership_id
                                                        AND engagement_owner.status = 'active'
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, row.caseId])).rows[0];
  if (!facts) return;
  const team = row.projectId ? (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND assignment.is_manager`, [workspaceId, row.projectId])).rows.map((member) => member.userId) : [];
  const people = [...new Set([facts.ownerUserId, facts.engagementOwnerUserId, ...team].filter((id): id is string => Boolean(id)))];
  const title = row.projectId ? `${row.reference} · ${row.projectName}` : row.title;
  const variables = { title, clientName: facts.clientName, actor: input.actor, request: `CR-${String(input.request.number).padStart(3, "0")} · ${input.request.title}`, note: input.note.slice(0, 480) };
  const deepLink = `/workspace/pre-projects/cases/${row.caseId}/variations?request=${encodeURIComponent(input.request.id)}`;
  for (const userId of people) {
    await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: input.code, eventType: input.code, variables, deepLink, idempotencyKey: `${input.code}:${input.key}:${userId}` });
    if (input.email)
      await queueUserEmail(db, { workspaceId, recipientUserId: userId, code: input.code, eventType: input.code, variables, deepLink, idempotencyKey: `${input.code}:${input.key}:${userId}:email` });
  }
}

/** The project manager (and the account manager for claims) hear what the client did, in-app and, for claims, by email. */
async function tellTeam(db: Db, workspaceId: string, projectId: string, code: string, actor: string, note: string, key: string, path: string, email: boolean) {
  const facts = (await db.query<{ title: string; clientName: string }>(
    `SELECT project.reference || ' · ' || project.name AS title, coalesce(party.display_name, opportunity.title) AS "clientName"
       FROM delivery_projects project
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
      WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, projectId])).rows[0];
  const people = (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active
        AND (assignment.is_manager OR ($3::boolean AND 'account_manager' = ANY(assignment.role_keys)))`, [workspaceId, projectId, code === "warranty.claim"])).rows;
  for (const person of people) {
    const message = { workspaceId, recipientUserId: person.userId, code, eventType: code, variables: { title: facts?.title ?? "", clientName: facts?.clientName ?? "", actor, note: note.slice(0, 480) },
      deepLink: `/workspace/projects/${projectId}${path}` };
    await notifyUserInApp(db, { ...message, idempotencyKey: `${code}:${key}:${person.userId}` });
    if (email) await queueUserEmail(db, { ...message, idempotencyKey: `${code}:${key}:${person.userId}:email` });
  }
}
