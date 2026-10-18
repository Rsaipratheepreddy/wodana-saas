import { BadRequestException, ConflictException, HttpException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { approvalStatus, canDecideApproval, cancelApproval, requestApproval, type ApprovalDecision, type ApprovalStatus } from "../approvals/approval-engine.api";
import { recordAudit } from "../audit/record-audit";
import { contactEmailSql } from "../client-portal/contact-email";
import { Dec } from "../catalog-core/decimal";
import { splitByPercent } from "../commercial/case-money";
import { commercialRepository } from "../commercial/commercial-repository";
import { acceptedQuoteValue, emptyCommercial, freezeHash, parsePaymentTerms, quoteDecisionEvidence } from "../commercial/commercial.domain";
import type { CommercialData, Payment, Quote } from "../commercial/commercial.types";
import { effectivePortalBrand } from "../commercial/effective-brand";
import { canonicalHash } from "../crm/shared/crm-types";
import { raiseStageInvoiceRequests } from "../finance-requests/stage-invoice-requests";
import { ensureJobForSource } from "../jobs/job-identity.store";
import { noticeWork, workspaceDay } from "../project-core/project-notices";
import { readProject, type ProjectRow } from "../project-core/project-core.store";
import { suggestMaterials } from "../project-core/project-materials";
import { suggestedSupply } from "../project-core/project-scope";
import { readProjectLinks, workEvent } from "../project-core/project-work";
import { sealVariation } from "../project-core/variation-seal";
import { readCalendar, workdays } from "../project-core/work-calendar";
import { pricingHash } from "../proposals/qs-review.domain";
import { qsRequirement } from "../proposals/qs-requirement";
import { quotationEntityId } from "../proposals/quote-issue";
import { acceptedScope, quotePricingSnapshot } from "../quotation/quotation-builder.service";
import { readLetterhead } from "../workspaces/entity-letterhead";
import {
  allowedActions, cleanProjectDraft, nextStep, variationOps, variationPaymentTerms,
  type ChangeRights, type PaymentRule, type QsState, type ScopeLine,
} from "./change-request-flow";
import {
  noticeProjectChangeBlocked, noticeProjectChangeDecided, noticeProjectChangeRaised, noticeProjectChangeReady, noticeProjectChangeSent,
  type ApplyOutcome, type ProjectChangeNotice,
} from "./change-request-notices";
import { cleanStageImpacts, scheduleImpact, ScheduleRuleError, type SchedulePreview, type StageImpactInput } from "./change-request-schedule";
import { ChangeRuleError, changeReference, nextStatus, type ChangeKind, type CleanLine } from "./change-request.domain";
import { closeLinks, event, readChangeById, writeLines, type ChangeActor, type ChangeRow, type ClientDecision } from "./change-request.store";

type Db = Pick<PoolClient, "query">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The quotation builder's line commands, run in the caller's transaction (QuotationBuilderService.applyOps). */
export type LineOpsRunner = { applyOps(client: PoolClient, workspaceId: string, caseId: string, quoteId: string, userId: string, ops: unknown): Promise<string[]> };

function rule<T>(work: () => T): T {
  try { return work(); } catch (error) {
    if (error instanceof ChangeRuleError) throw error.code === "conflict" ? new ConflictException(error.message) : new UnprocessableEntityException(error.message);
    if (error instanceof ScheduleRuleError) throw new UnprocessableEntityException(error.message);
    throw error;
  }
}

export const changeLink = (projectId: string, id: string) => `/workspace/projects/${projectId}/changes/${id}`;

// ---------------------------------------------------------------- the project and its firm's rules

/** The started project a change is on (its row locked when asked). */
export async function changeProject(db: Db, workspaceId: string, projectId: string, lock = false): Promise<ProjectRow> {
  const project = await readProject(db, workspaceId, projectId, lock);
  if (!project) throw new NotFoundException("Project not found.");
  return project;
}

/** The started project of a planning record that takes priced changes: running, with its scope sealed. */
export async function projectForChanges(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ id: string }>(
    `SELECT project.id FROM delivery_projects project
      WHERE project.workspace_id = $1 AND project.case_id = $2 AND project.started_at IS NOT NULL AND project.status IN ('active', 'on_hold')
        AND EXISTS (SELECT 1 FROM project_scope_seals seal WHERE seal.workspace_id = project.workspace_id AND seal.project_id = project.id AND seal.kind = 'baseline')
      ORDER BY project.started_at LIMIT 1`, [workspaceId, caseId])).rows[0]?.id ?? null;
}

export type ChangeSettings = { paymentRule: PaymentRule; requireVariationPayment: boolean; validityDays: number };

export async function changeSettings(db: Db, workspaceId: string): Promise<ChangeSettings> {
  const row = (await db.query<{ paymentRule: PaymentRule | null; requireVariationPayment: boolean | null; validityDays: number | null }>(
    `SELECT project.variation_payment_rule AS "paymentRule", project.require_variation_payment AS "requireVariationPayment", quotation.validity_days AS "validityDays"
       FROM workspaces workspace
       LEFT JOIN workspace_project_settings project ON project.workspace_id = workspace.id
       LEFT JOIN workspace_quotation_settings quotation ON quotation.workspace_id = workspace.id
      WHERE workspace.id = $1`, [workspaceId])).rows[0];
  return { paymentRule: row?.paymentRule ?? "before_work", requireVariationPayment: row?.requireVariationPayment ?? false, validityDays: row?.validityDays ?? 30 };
}

async function today(db: Db, workspaceId: string) {
  return (await db.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`,
    [workspaceId])).rows[0].today;
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function userName(db: Db, userId: string | null) {
  if (!userId) return "Someone";
  return (await db.query<{ name: string }>(`SELECT coalesce(display_name, primary_email) AS name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? "Someone";
}

// ---------------------------------------------------------------- the commercial case (the variation quotation)

async function loadCommercial(db: Db, workspaceId: string, caseId: string): Promise<CommercialData> {
  const loaded = await commercialRepository.load(db, workspaceId, caseId, { forUpdate: true });
  if (!loaded) throw new ConflictException("This project's planning record has no quotation.");
  const stored = loaded.content as Partial<CommercialData>;
  return { ...emptyCommercial(), ...stored, revision: loaded.revision, quotes: stored.quotes ?? [], payments: stored.payments ?? [], credits: stored.credits ?? [],
    requests: stored.requests ?? [], audit: stored.audit ?? [] } as CommercialData;
}

async function persistCommercial(db: Db, workspaceId: string, caseId: string, data: CommercialData, actor: string, action: string, quoteId: string, note = "") {
  data.revision += 1;
  data.audit.push({ id: randomUUID(), at: new Date().toISOString(), actor, action, quoteId, note });
  await commercialRepository.save(db, workspaceId, caseId, data);
}

function variationOf(data: CommercialData, change: ChangeRow) {
  const quote = change.quoteId ? data.quotes.find((item) => item.id === change.quoteId && item.kind === "variation") : undefined;
  if (!quote) throw new ConflictException("This change isn't priced yet.");
  return quote;
}

/** The project's next milestone the client hasn't paid yet (the variation's money can go with it). */
function nextMilestone(data: CommercialData, baselineQuoteId: string, onOrAfter: string): Payment | null {
  const open = data.payments.filter((payment) => payment.sourceQuoteId === baselineQuoteId && payment.status !== "verified");
  return open.filter((payment) => !payment.dueDate || payment.dueDate >= onOrAfter).sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"))[0] ?? open[0] ?? null;
}

// ---------------------------------------------------------------- the schedule

export async function readStageImpacts(db: Db, workspaceId: string, changeId: string): Promise<StageImpactInput[]> {
  return (await db.query<StageImpactInput>(
    `SELECT impact.stage_id AS "stageId", impact.days FROM change_request_stage_impacts impact
       JOIN project_stages stage ON stage.workspace_id = impact.workspace_id AND stage.id = impact.stage_id
      WHERE impact.workspace_id = $1 AND impact.change_request_id = $2 ORDER BY stage.position`, [workspaceId, changeId])).rows;
}

async function writeStageImpacts(db: Db, workspaceId: string, changeId: string, impacts: StageImpactInput[]) {
  await db.query(`DELETE FROM change_request_stage_impacts WHERE workspace_id = $1 AND change_request_id = $2`, [workspaceId, changeId]);
  for (const impact of impacts)
    await db.query(`INSERT INTO change_request_stage_impacts (workspace_id, change_request_id, stage_id, days) VALUES ($1, $2, $3, $4)`, [workspaceId, changeId, impact.stageId, impact.days]);
}

/** The project's real plan: its stages in route order, its work with dates and links, the work calendar and the handover. */
export async function scheduleInputs(db: Db, workspaceId: string, projectId: string) {
  const stages = (await db.query<{ id: string; position: number; name: string; status: string; ownerRole: string | null }>(
    `SELECT id, position, name, status, owner_role AS "ownerRole" FROM project_stages WHERE workspace_id = $1 AND project_id = $2 ORDER BY position`, [workspaceId, projectId])).rows;
  const items = (await db.query<{ id: string; number: number; title: string; status: string; stageId: string | null; assigneeId: string | null; startDate: string | null; dueDate: string | null }>(
    `SELECT id, number, title, status, stage_id AS "stageId", assignee_membership_id AS "assigneeId", start_date::text AS "startDate", due_date::text AS "dueDate"
       FROM work_items WHERE workspace_id = $1 AND project_id = $2 ORDER BY number`, [workspaceId, projectId])).rows;
  const promise = (await db.query<{ promiseDate: string | null }>(`SELECT promise_date::text AS "promiseDate" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, projectId])).rows[0]?.promiseDate ?? null;
  return { stages, items, links: await readProjectLinks(db, workspaceId, projectId), calendar: await readCalendar(db, workspaceId), promiseDate: promise };
}

/** What a change's days would do to the plan now, without changing anything. */
export async function previewFor(db: Db, workspaceId: string, projectId: string, impacts: StageImpactInput[]): Promise<SchedulePreview> {
  return scheduleImpact({ ...(await scheduleInputs(db, workspaceId, projectId)), impacts });
}

// ---------------------------------------------------------------- the raised lines

type RaisedInput = { title?: unknown; reason?: unknown; description?: unknown; lines?: unknown; stageImpacts?: unknown };

/** Each raised line belongs to this project: its catalogue item, its live-scope line (enough of it left), its room. */
async function resolveScopeLines(db: Db, workspaceId: string, project: ProjectRow, lines: ScopeLine[]) {
  for (const line of lines) {
    if (line.roomId && !(await db.query(`SELECT 1 FROM pre_project_rooms WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, project.caseId, line.roomId])).rowCount)
      throw new BadRequestException(`"${line.title}": choose a room of this project.`);
    if (line.catalogItemId) {
      const item = (await db.query<{ unit: string }>(`SELECT unit_code AS unit FROM catalog_items WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, line.catalogItemId])).rows[0];
      if (!item) throw new BadRequestException(`"${line.title}": choose an item from the catalogue.`);
      if (!line.unit) line.unit = item.unit ?? "";
    }
    if (line.boqLineId) {
      const scope = (await db.query<{ quantity: string; unit: string; areaId: string | null; status: string }>(
        `SELECT quantity::text AS quantity, unit, area_id AS "areaId", status FROM project_boq_lines WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
        [workspaceId, project.id, line.boqLineId])).rows[0];
      if (!scope || scope.status !== "active") throw new BadRequestException(`"${line.title}" isn't in the project's scope any more.`);
      if (line.quantity && Dec.of(line.quantity).cmp(scope.quantity) > 0) throw new BadRequestException(`"${line.title}": only ${Dec.of(scope.quantity).toString()} ${scope.unit} is in the scope.`);
      if (line.action === "move" && line.roomId === scope.areaId) throw new BadRequestException(`"${line.title}": choose a different room to move it to.`);
      if (!line.unit) line.unit = scope.unit;
    }
  }
  return lines;
}

const storedLine = (line: ScopeLine): CleanLine => ({
  id: line.id, source: line.source, action: line.action, quoteId: null, quoteLineId: null, ledgerEntryId: null, ledgerVersionId: null, roomId: line.roomId,
  title: line.title, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice, amount: "0.00", catalogItemId: line.catalogItemId, boqLineId: line.boqLineId,
});

/** What kind of change the lines make (the record's label; prices come from the variation quotation). */
function kindOf(lines: ScopeLine[], impacts: StageImpactInput[]): ChangeKind {
  const adds = lines.some((line) => line.action === "add" || line.action === "replace");
  const removes = lines.some((line) => line.action === "omit" || line.action === "replace");
  if (adds && removes) return "replacement";
  if (removes) return "deduction";
  if (adds) return "addition";
  if (lines.some((line) => line.action === "move")) return "move";
  return impacts.length ? "schedule" : "addition";
}

const scopeLinesOf = (change: ChangeRow): ScopeLine[] => change.lines.filter((line) => ["custom", "catalog", "boq_line"].includes(line.source)).map((line) => ({
  id: line.id, source: line.source as ScopeLine["source"], action: line.action as ScopeLine["action"], title: line.title, quantity: line.quantity, unit: line.unit,
  unitPrice: line.unitPrice, roomId: line.roomId, catalogItemId: line.catalogItemId ?? null, boqLineId: line.boqLineId ?? null,
}));

const noticeOf = (change: ChangeRow): ProjectChangeNotice => ({ id: change.id, projectId: change.projectId!, caseId: change.caseId, reference: change.reference, title: change.title,
  currency: change.currency, priceImpact: change.priceImpact, timeImpactDays: change.timeImpactDays, raisedBy: change.raisedBy, submittedBy: change.submittedBy });

export async function readProjectChange(db: Db, workspaceId: string, projectId: string, id: string, lock = false) {
  const change = await readChangeById(db, workspaceId, id, lock);
  if (!change || change.projectId !== projectId) throw new NotFoundException("This change request isn't on this project.");
  return change;
}

const REASON_NAME: Record<string, string> = { client_request: "Client request", site_condition: "Site condition", design_change: "Design change", error: "Error" };

// ---------------------------------------------------------------- raise and edit

/**
 * Raises a change on a started project: its words, why, what changes and the days it adds per stage. From the client
 * (portal) it is their words only; the team prices it. Idempotent by its id. Its time impact is worked out on the real
 * plan straight away, so the record shows the handover it would give.
 */
export async function raiseProjectChange(db: Db, workspaceId: string, projectId: string, input: RaisedInput & { id?: unknown }, actor: ChangeActor) {
  if (typeof input.id !== "string" || !UUID.test(input.id)) throw new BadRequestException("Send the change's id.");
  const id = input.id.toLowerCase();
  const fromClient = "grantId" in actor;
  const draft = rule(() => cleanProjectDraft(fromClient ? { title: input.title, description: input.description, reason: "client_request" } : input));
  const existing = (await db.query<{ projectId: string | null; title: string }>(`SELECT project_id AS "projectId", title FROM change_requests WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id])).rows[0];
  if (existing) {
    if (existing.projectId !== projectId || existing.title !== draft.title) throw new ConflictException("This change id is already in use.");
    return { replayed: true, change: await readProjectChange(db, workspaceId, projectId, id) };
  }
  const project = await changeProject(db, workspaceId, projectId, true);
  if (!["active", "on_hold"].includes(project.status)) throw new ConflictException("This project isn't taking changes.");
  await db.query(`SELECT 1 FROM pre_project_cases WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, project.caseId]);
  const lines = await resolveScopeLines(db, workspaceId, project, draft.lines);
  const inputs = await scheduleInputs(db, workspaceId, projectId);
  const impacts = fromClient ? [] : rule(() => cleanStageImpacts(input.stageImpacts, inputs.stages));
  const preview = scheduleImpact({ ...inputs, impacts });
  const number = (await db.query<{ next: number }>(`SELECT COALESCE(max(number), 0) + 1 AS next FROM change_requests WHERE workspace_id = $1 AND case_id = $2`,
    [workspaceId, project.caseId])).rows[0].next;
  await db.query(
    `INSERT INTO change_requests (id, workspace_id, case_id, project_id, number, kind, reason, title, description, currency, price_impact, time_impact_days, handover_before, handover_after,
                                  raised_by, raised_by_grant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, $12, $13, $14, $15)`,
    [id, workspaceId, project.caseId, projectId, number, kindOf(lines, impacts), draft.reason, draft.title, draft.description, project.currency, Math.min(365, preview.finishDelay),
      preview.handoverBefore, preview.handoverAfter, "userId" in actor ? actor.userId : null, fromClient ? actor.grantId : null]);
  await writeLines(db, workspaceId, id, lines.map(storedLine));
  await writeStageImpacts(db, workspaceId, id, impacts);
  await event(db, workspaceId, id, "raised", actor, fromClient ? draft.description || null : null);
  await recordAudit(db, { workspaceId, actorUserId: "userId" in actor ? actor.userId : null, source: fromClient ? "client_portal" : "user", action: "change_request.raised.v1",
    entityType: "change_request", entityId: id, after: { projectId, caseId: project.caseId, number, title: draft.title, reason: draft.reason, lines: lines.length, stageImpacts: impacts,
      handoverBefore: preview.handoverBefore, handoverAfter: preview.handoverAfter, byClient: fromClient } });
  const change = await readProjectChange(db, workspaceId, projectId, id);
  const raisedName = fromClient ? actor.name : await userName(db, actor.userId);
  await noticeProjectChangeRaised(db, workspaceId, noticeOf(change), { userId: "userId" in actor ? actor.userId : null, name: raisedName },
    [REASON_NAME[draft.reason], draft.description].filter(Boolean).join(". "));
  return { replayed: false, change };
}

/**
 * Saves a change's words, why and its days per stage against the version the editor saw; while it's a draft, its lines
 * too (once priced, what changes is the variation quotation's lines). The time impact is worked out again.
 */
export async function saveProjectChange(db: Db, workspaceId: string, projectId: string, id: string, input: RaisedInput & { version?: unknown }, userId: string) {
  const current = await readProjectChange(db, workspaceId, projectId, id, true);
  rule(() => nextStatus(current.status, "edit", "project"));
  if (Number(input.version) !== current.version) throw new ConflictException("This change was edited in another window. Reload and try again.");
  const project = await changeProject(db, workspaceId, projectId);
  const draft = rule(() => cleanProjectDraft({ ...input, lines: current.status === "draft" ? input.lines : [] }));
  const lines = current.status === "draft" ? await resolveScopeLines(db, workspaceId, project, draft.lines) : scopeLinesOf(current);
  const inputs = await scheduleInputs(db, workspaceId, projectId);
  const impacts = input.stageImpacts === undefined ? await readStageImpacts(db, workspaceId, id) : rule(() => cleanStageImpacts(input.stageImpacts, inputs.stages));
  const preview = scheduleImpact({ ...inputs, impacts });
  if (current.status === "draft") await writeLines(db, workspaceId, id, lines.map(storedLine));
  await writeStageImpacts(db, workspaceId, id, impacts);
  await db.query(
    `UPDATE change_requests SET title = $3, reason = $4, description = $5, kind = $6, time_impact_days = $7, handover_before = $8, handover_after = $9, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, draft.title, draft.reason, draft.description, kindOf(lines, impacts), Math.min(365, preview.finishDelay), preview.handoverBefore, preview.handoverAfter]);
  await event(db, workspaceId, id, "edited", { userId });
  await recordAudit(db, { workspaceId, actorUserId: userId, action: "change_request.edited.v1", entityType: "change_request", entityId: id,
    before: { version: current.version, title: current.title, timeImpactDays: current.timeImpactDays }, after: { title: draft.title, reason: draft.reason, lines: lines.length, stageImpacts: impacts } });
  return readProjectChange(db, workspaceId, projectId, id);
}

// ---------------------------------------------------------------- price

/**
 * "Price it": the change becomes a variation quotation of the project's sealed quotation, priced by the shared engine
 * (catalogue prices, markup, the firm's tax), its raised lines on it: new work and catalogue items as lines, removed
 * scope as credits at what the client paid, moves with their labour. Payment terms follow the firm's rule. The same
 * command twice prices it once.
 */
export async function priceProjectChange(db: Db, workspaceId: string, projectId: string, id: string, input: { version?: unknown }, userId: string, builder: LineOpsRunner) {
  const current = await readProjectChange(db, workspaceId, projectId, id, true);
  if (current.status === "pricing" && current.quoteId) return { replayed: true, change: current };
  rule(() => nextStatus(current.status, "price", "project"));
  if (Number(input.version) !== current.version) throw new ConflictException("This change was edited in another window. Reload and try again.");
  const project = await changeProject(db, workspaceId, projectId, true);
  if (!["active", "on_hold"].includes(project.status)) throw new ConflictException("This project isn't taking changes.");
  const data = await loadCommercial(db, workspaceId, project.caseId);
  const baseline = data.quotes.find((quote) => quote.id === project.quoteId) ?? data.quotes.find((quote) => quote.kind === "quotation" && quote.status === "accepted");
  if (!baseline || baseline.status !== "accepted") throw new ConflictException("The project's quotation isn't accepted.");
  const settings = await changeSettings(db, workspaceId);
  const now = new Date().toISOString();
  const day = await today(db, workspaceId);
  const quote: Quote = {
    id: randomUUID(), number: Math.max(0, ...data.quotes.map((item) => item.number)) + 1, kind: "variation", direction: "addition", round: baseline.round,
    baselineId: baseline.id, status: "draft", title: `${current.reference} · ${current.title}`.slice(0, 240), cover: baseline.cover ? structuredClone(baseline.cover) : undefined,
    presentation: baseline.presentation ? structuredClone(baseline.presentation) : undefined, inclusions: "", currency: baseline.currency, validUntil: addDays(day, settings.validityDays),
    discount: 0, taxRate: baseline.taxRate, terms: baseline.terms, exclusions: baseline.exclusions, lines: [], requestIds: [],
    paymentTerms: variationPaymentTerms(settings.paymentRule, "1", nextMilestone(data, baseline.id, day)), rooms: [], createdAt: now, total: 0, changeRequestId: id,
  };
  data.quotes.push(quote);
  await persistCommercial(db, workspaceId, project.caseId, data, await userName(db, userId), `Priced ${current.reference}`, quote.id);
  await ensureJobForSource(db as PoolClient, workspaceId, { type: "quote", id: quote.id, caseId: project.caseId }, userId);
  const ops = variationOps(scopeLinesOf(current));
  if (ops.length) await builder.applyOps(db as PoolClient, workspaceId, project.caseId, quote.id, userId, ops);
  await db.query(`UPDATE change_requests SET status = 'pricing', quote_id = $3, payment_rule = $4, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, quote.id, settings.paymentRule]);
  await event(db, workspaceId, id, "priced", { userId });
  await recordAudit(db, { workspaceId, actorUserId: userId, action: "change_request.priced.v1", entityType: "change_request", entityId: id,
    after: { quoteId: quote.id, quoteNumber: quote.number, baselineId: baseline.id, lines: ops.length, paymentRule: settings.paymentRule } });
  return { replayed: false, change: await readProjectChange(db, workspaceId, projectId, id) };
}

/** Whether the variation needs the QS (the firm's rules), and where that stands against the pricing as it is now. */
export async function qsStateOf(db: Db, workspaceId: string, caseId: string, quoteId: string): Promise<QsState> {
  const requirement = await qsRequirement(db, workspaceId, caseId, quoteId);
  if (!requirement.required) return "not_needed";
  const review = (await db.query<{ status: string; pricingHash: string | null }>(
    `SELECT status, pricing_hash AS "pricingHash" FROM quote_qs_reviews WHERE workspace_id = $1 AND case_id = $2 AND quote_id = $3 ORDER BY requested_at DESC, id DESC LIMIT 1`,
    [workspaceId, caseId, quoteId])).rows[0];
  if (review?.status === "with_qs") return "with_qs";
  if (review?.status === "confirmed" && review.pricingHash === pricingHash((await quotePricingSnapshot(db as PoolClient, workspaceId, caseId, quoteId)).lines)) return "confirmed";
  return "needed";
}

/** The variation as priced: its lines (what each does), the totals from the one engine, its payment terms. */
export async function priceOf(db: Db, workspaceId: string, caseId: string, quoteId: string) {
  const scope = await acceptedScope(db as PoolClient, workspaceId, caseId, quoteId);
  const header = (await db.query<{ status: string; hash: string | null; validUntil: string | null }>(
    `SELECT status, hash, valid_until::text AS "validUntil" FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, quoteId])).rows[0];
  const areas = new Map(scope.areas.map((area) => [area.id, area.name]));
  const credit = scope.lines.filter((line) => line.changeOp === "omit").reduce((sum, line) => sum.add(line.total), Dec.ZERO);
  return {
    quoteId, number: scope.quote.number, status: header?.status ?? "draft", hash: header?.hash ?? null, validUntil: header?.validUntil ?? null,
    currency: scope.quote.currency, decimals: scope.quote.decimals, pricesIncludeTax: scope.quote.pricesIncludeTax,
    lines: scope.lines.map((line) => ({ id: line.id, op: (line.changeOp ?? "add") as "add" | "omit" | "move", title: line.title, area: line.areaId ? areas.get(line.areaId) ?? null : null,
      fromArea: line.fromAreaId ? areas.get(line.fromAreaId) ?? null : null, quantity: line.quantity, unit: line.unit, rate: line.rate, net: line.net, total: line.total, boqLineId: line.boqLineId })),
    subtotal: scope.pricing.subtotal, discounts: scope.pricing.discounts, net: scope.pricing.net, tax: scope.pricing.tax, taxes: scope.pricing.taxes, total: scope.pricing.total,
    credit: credit.toFixed(scope.quote.decimals), paymentTerms: scope.paymentTerms as Array<{ id: string; title: string; percent: number; requiredForRelease: boolean }>,
  };
}

// ---------------------------------------------------------------- approval inside the firm

/**
 * Sends the priced change for approval on E3 (kind change_request, at the variation's size): its lines must be priced
 * and the QS must have confirmed them where the firm's rules ask. The variation goes into review (no more edits).
 */
export async function submitProjectChange(db: Db, workspaceId: string, projectId: string, id: string, input: { version?: unknown }, userId: string) {
  const current = await readProjectChange(db, workspaceId, projectId, id, true);
  rule(() => nextStatus(current.status, "submit", "project"));
  if (Number(input.version) !== current.version) throw new ConflictException("This change was edited in another window. Reload and try again.");
  const project = await changeProject(db, workspaceId, projectId);
  const data = await loadCommercial(db, workspaceId, project.caseId);
  const quote = variationOf(data, current);
  if (quote.status !== "draft") throw new ConflictException("This variation was already sent for review.");
  const price = await priceOf(db, workspaceId, project.caseId, quote.id);
  const impacts = await readStageImpacts(db, workspaceId, id);
  if (!price.lines.length && !impacts.length) throw new UnprocessableEntityException("Add what changes: lines on the price, or days on the timeline.");
  const unpriced = (await quotePricingSnapshot(db as PoolClient, workspaceId, project.caseId, quote.id)).lines
    .find((line) => !line.optional && line.changeOp !== "omit" && line.changeOp !== "move" && line.kind !== "client_supplied" && Dec.of(line.rate).cmp(0) <= 0);
  if (unpriced) throw new UnprocessableEntityException(`Price "${unpriced.title}" first.`);
  const qs = await qsStateOf(db, workspaceId, project.caseId, quote.id);
  if (qs === "needed" || qs === "with_qs") throw new ConflictException(qs === "with_qs" ? "The QS is pricing this change." : "Send it to the QS first: the firm's QS rules name this change.");
  const settings = await changeSettings(db, workspaceId);
  const positive = Dec.of(price.total).cmp(0) > 0;
  quote.paymentTerms = positive ? (quote.paymentTerms.length ? quote.paymentTerms : variationPaymentTerms(current.paymentRule ?? settings.paymentRule, price.total,
    nextMilestone(data, project.quoteId, await today(db, workspaceId)))) : [];
  try { parsePaymentTerms(quote.paymentTerms, false); } catch (error) { if (error instanceof HttpException) throw new UnprocessableEntityException(`Payment terms: ${error.message}`); throw error; }
  quote.status = "internal_review";
  quote.total = Dec.of(price.total).toNumber();
  await persistCommercial(db, workspaceId, project.caseId, data, await userName(db, userId), `Submitted ${current.reference}`, quote.id);
  await db.query(`UPDATE change_requests SET status = 'pending_approval', price_impact = $3::numeric, submitted_by = $4, submitted_at = now(), version = version + 1, updated_at = now()
                   WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, Dec.of(price.total).toFixed(2), userId]);
  const approval = await requestApproval(db, { workspaceId, kind: "change_request", subjectId: id, title: `${current.reference} · ${current.title}`.slice(0, 300), href: changeLink(projectId, id),
    amount: Dec.of(price.total).abs().toFixed(2), currency: price.currency, requesterUserId: userId });
  await event(db, workspaceId, id, "submitted", { userId });
  await recordAudit(db, { workspaceId, actorUserId: userId, action: "change_request.submitted.v1", entityType: "change_request", entityId: id,
    after: { approvalId: approval.id, quoteId: quote.id, total: price.total, net: price.net, tax: price.tax, currency: price.currency, qs } });
  return readProjectChange(db, workspaceId, projectId, id);
}

/**
 * What an E3 decision does to a project change: fully approved → ready to send (the variation is approved); returned →
 * back to pricing (the variation is a draft again); rejected → withdrawn. A step approved midway changes nothing.
 */
export async function projectApprovalOutcome(db: Db, workspaceId: string, current: ChangeRow, approval: ApprovalStatus, decision: ApprovalDecision, userId: string, note: string | null) {
  if (current.status !== "pending_approval") return;
  if (decision === "approve" && approval.status !== "approved") return;
  const step = decision === "approve" ? "internal_approved" as const : decision === "return" ? "returned" as const : "rejected" as const;
  const status = rule(() => nextStatus(current.status, step, "project"));
  const data = await loadCommercial(db, workspaceId, current.caseId);
  const quote = variationOf(data, current);
  if (step === "internal_approved") { quote.status = "internal_approved"; quote.approvedBy = await userName(db, userId); }
  else if (step === "returned") { quote.status = "draft"; delete quote.approvedBy; }
  else quote.status = "withdrawn";
  await persistCommercial(db, workspaceId, current.caseId, data, await userName(db, userId), `${step} ${current.reference}`, quote.id, note ?? "");
  await db.query(`UPDATE change_requests SET status = $3::varchar, withdrawn_at = CASE WHEN $3::varchar = 'withdrawn' THEN now() ELSE withdrawn_at END,
            withdraw_reason = CASE WHEN $3::varchar = 'withdrawn' THEN $4::text ELSE withdraw_reason END, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, current.id, status, note]);
  await event(db, workspaceId, current.id, step === "internal_approved" ? "approved_internal" : step, { userId }, note);
  await recordAudit(db, { workspaceId, actorUserId: userId, action: `change_request.${step}.v1`, entityType: "change_request", entityId: current.id, after: { status, note, quoteId: quote.id } });
  if (status === "to_send") await noticeProjectChangeReady(db, workspaceId, noticeOf(current), userId);
}

// ---------------------------------------------------------------- send to the client

/**
 * Sends the approved change to the client: the variation is issued and frozen (its hash), the time impact is frozen
 * with it, and the client's decision-maker hears it in the portal (and by their message channel); the project manager
 * too. Returns the decision-maker so the caller can also send a signing link.
 */
export async function sendProjectChange(db: Db, workspaceId: string, projectId: string, id: string, input: { version?: unknown; grantId?: unknown }, userId: string) {
  const current = await readProjectChange(db, workspaceId, projectId, id, true);
  rule(() => nextStatus(current.status, "send", "project"));
  if (Number(input.version) !== current.version) throw new ConflictException("This change was updated in another window. Reload and try again.");
  const project = await changeProject(db, workspaceId, projectId);
  const grantId = typeof input.grantId === "string" && UUID.test(input.grantId) ? input.grantId : null;
  const signer = (await db.query<{ id: string; name: string; phone: string; email: string | null }>(
    `SELECT grant_row.id, coalesce(grant_row.confirmed_name, grant_row.name) AS name, grant_row.phone, ${contactEmailSql("grant_row")} AS email
       FROM client_portal_grants grant_row WHERE grant_row.workspace_id = $1 AND grant_row.case_id = $2 AND grant_row.active AND grant_row.role = 'approver'
        AND ($3::uuid IS NULL OR grant_row.id = $3) ORDER BY grant_row.created_at LIMIT 1`, [workspaceId, project.caseId, grantId])).rows[0];
  if (!signer) throw new ConflictException("Add the client's decision-maker to the project first.");
  const data = await loadCommercial(db, workspaceId, project.caseId);
  const quote = variationOf(data, current);
  if (quote.status !== "internal_approved") throw new ConflictException("Approve the change inside the firm first.");
  const day = await today(db, workspaceId);
  const settings = await changeSettings(db, workspaceId);
  if (!quote.validUntil || quote.validUntil < day) quote.validUntil = addDays(day, settings.validityDays);
  quote.status = "issued";
  quote.issuedAt = new Date().toISOString();
  quote.approverId = signer.id;
  quote.brand = await effectivePortalBrand(db, workspaceId);
  quote.letterhead = await readLetterhead(db, workspaceId, await quotationEntityId(db, workspaceId, project.caseId, quote.familyId ?? quote.id));
  quote.hash = freezeHash(quote);
  await persistCommercial(db, workspaceId, project.caseId, data, await userName(db, userId), `Sent ${current.reference}`, quote.id);
  const preview = await previewFor(db, workspaceId, projectId, await readStageImpacts(db, workspaceId, id));
  const snapshot = { quoteHash: quote.hash, total: Dec.of(quote.total).toFixed(2), handoverBefore: preview.handoverBefore, handoverAfter: preview.handoverAfter,
    finishDelay: preview.finishDelay, stages: preview.stages, items: preview.items.length, sentAt: quote.issuedAt };
  const issuedHash = canonicalHash({ change: { id, reference: current.reference, title: current.title, description: current.description, reason: current.reason }, ...snapshot, sentAt: undefined });
  await db.query(
    `UPDATE change_requests SET status = 'with_client', sent_by = $3, sent_at = now(), schedule_snapshot = $4::jsonb, issued_hash = $5, time_impact_days = $6, handover_before = $7,
            handover_after = $8, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, userId, JSON.stringify(snapshot), issuedHash, Math.min(365, preview.finishDelay), preview.handoverBefore, preview.handoverAfter]);
  await event(db, workspaceId, id, "sent", { userId });
  await recordAudit(db, { workspaceId, actorUserId: userId, action: "change_request.sent.v1", entityType: "change_request", entityId: id,
    after: { quoteId: quote.id, quoteHash: quote.hash, issuedHash, signer: signer.name, handoverBefore: preview.handoverBefore, handoverAfter: preview.handoverAfter } });
  const change = await readProjectChange(db, workspaceId, projectId, id);
  const told = await noticeProjectChangeSent(db, workspaceId, noticeOf(change), userId, change.version);
  return { change, signer, told };
}

// ---------------------------------------------------------------- the client's decision

/**
 * The client's decision on a project change (portal with a code, or a signed link). Approved: the variation is accepted
 * on its frozen hash, its payment milestones (or the client's credit) are created by the firm's rule, and the change is
 * applied to the project in the same transaction when it can be; when it can't (the project closed, its scope changed),
 * it stays approved and the project manager hears why and applies it. Declined: the change and its variation are
 * declined and stay as history. The first decision stands.
 */
export async function decideProjectChange(db: Db, workspaceId: string, current: ChangeRow, input: ClientDecision) {
  const decision = input.decision;
  rule(() => nextStatus(current.status, decision === "approve" ? "client_approved" : "client_declined", "project"));
  if (input.version !== undefined && input.version !== null && input.version !== current.version) throw new ConflictException("This change was updated. Reload to see the latest.");
  const note = (input.note ?? "").trim().slice(0, 2000);
  if (decision === "decline" && !note) throw new BadRequestException("Say why you're declining.");
  const name = input.name.trim().slice(0, 200);
  if (!name) throw new BadRequestException("Say who decided.");
  const data = await loadCommercial(db, workspaceId, current.caseId);
  const quote = variationOf(data, current);
  if (quote.status !== "issued") throw new ConflictException("This change isn't waiting for the client.");
  const decidedAt = new Date().toISOString();
  quote.decidedAt = decidedAt;
  quote.decidedBy = name;
  // Bound to the frozen variation the client read: a changed one is refused (assertQuoteSnapshot).
  quote.clientDecision = { ...quoteDecisionEvidence(quote, decision === "approve" ? "accept" : "decline", [], name, decidedAt, note),
    ...(input.method === "signed_link" ? { method: "signed_document" as const } : {}) };
  quote.status = decision === "approve" ? "accepted" : "declined";
  if (decision === "approve") {
    const total = Dec.of(String(acceptedQuoteValue(quote)));
    const project = await changeProject(db, workspaceId, current.projectId!);
    const day = await today(db, workspaceId);
    if (total.cmp(0) > 0 && !data.payments.some((item) => item.sourceQuoteId === quote.id)) {
      const terms = quote.paymentTerms ?? [];
      const next = nextMilestone(data, project.quoteId, day);
      const shares = splitByPercent(total.toString(), terms.map((term) => term.percent), data.financeContext?.currency ?? quote.currency);
      for (const [index, term] of terms.entries())
        data.payments.push({ id: randomUUID(), sourceQuoteId: quote.id, legalEntityId: data.financeContext?.legalEntityId, currency: data.financeContext?.currency ?? quote.currency,
          agreementReference: data.agreement?.reference, title: `${current.reference} · ${term.title}`.slice(0, 160), trigger: term.trigger, amount: shares[index],
          // Before the work: due now. With the next milestone: due when it is.
          dueDate: term.requiredForRelease ? day : next?.dueDate ?? "", requiredForRelease: term.requiredForRelease, requiredForProduction: term.requiredForProduction === true,
          status: "pending", proof: "", reference: "" });
    } else if (total.cmp(0) < 0 && !(data.credits ?? []).some((credit) => credit.quoteId === quote.id)) {
      data.credits = [...(data.credits ?? []), { id: randomUUID(), quoteId: quote.id, legalEntityId: data.financeContext?.legalEntityId, amount: total.abs().toNumber(), currency: quote.currency,
        status: "pending", reference: "", evidence: "" }];
    }
  }
  await persistCommercial(db, workspaceId, current.caseId, data, name, `Client ${decision} ${current.reference} (${input.method === "signed_link" ? "signed" : "portal"})`, quote.id, note);
  await db.query(
    `UPDATE change_requests SET status = $3::varchar, decided_at = now(), decided_by_name = $4, decided_by_grant_id = $5, decision_method = $6, decline_note = $7, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, current.id, decision === "approve" ? "approved" : "declined", name, input.grantId, input.method, decision === "decline" ? note : null]);
  await closeLinks(db, workspaceId, current.id, input.method === "signed_link" ? current.esignRequestId : null);
  const actor: ChangeActor | null = input.grantId ? { grantId: input.grantId, name } : null;
  await event(db, workspaceId, current.id, decision === "approve" ? "approved" : "declined", actor, note || null);
  await recordAudit(db, { workspaceId, actorUserId: null, source: "client_portal", action: `change_request.${decision === "approve" ? "approved" : "declined"}.v1`, entityType: "change_request",
    entityId: current.id, after: { by: name, grantId: input.grantId, method: input.method, quoteId: quote.id, quoteHash: quote.hash, total: quote.clientDecision.acceptedTotal ?? null, note } });
  if (decision === "decline") {
    const change = await readChangeById(db, workspaceId, current.id);
    await noticeProjectChangeDecided(db, workspaceId, { ...noticeOf(change!), status: change!.status, declineNote: change!.declineNote, decidedByName: change!.decidedByName }, null);
    return { replayed: false, change: change! };
  }
  // Applied in the same transaction when it can be; a refusal keeps the client's approval and goes to the project manager.
  await db.query("SAVEPOINT change_request_apply");
  try {
    await applyProjectChange(db, workspaceId, current.id, null);
    await db.query("RELEASE SAVEPOINT change_request_apply");
  } catch (error) {
    await db.query("ROLLBACK TO SAVEPOINT change_request_apply");
    const problem = (error instanceof HttpException ? error.message : "Applying it failed. Apply it again from the change.").slice(0, 2000);
    await db.query(`UPDATE change_requests SET apply_problem = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, current.id, problem]);
    await event(db, workspaceId, current.id, "apply_blocked", null, problem);
    const change = await readChangeById(db, workspaceId, current.id);
    await noticeProjectChangeDecided(db, workspaceId, { ...noticeOf(change!), status: change!.status, declineNote: null, decidedByName: change!.decidedByName }, null);
    await noticeProjectChangeBlocked(db, workspaceId, noticeOf(change!), problem);
  }
  return { replayed: false, change: (await readChangeById(db, workspaceId, current.id))! };
}

// ---------------------------------------------------------------- apply

/** New lines a variation added go into the package for their room and way of delivery (made when there is none). */
async function packageNewLines(db: Db, workspaceId: string, projectId: string, sealId: string) {
  const lines = (await db.query<{ id: string; kind: string; areaId: string | null; areaName: string | null; itemType: string | null }>(
    `SELECT line.id, line.kind, line.area_id AS "areaId", room.name AS "areaName", item.item_type AS "itemType"
       FROM project_boq_lines line
       JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = project.case_id AND room.id = line.area_id
       LEFT JOIN catalog_items item ON item.workspace_id = line.workspace_id AND item.id = line.catalog_item_id
      WHERE line.workspace_id = $1 AND line.project_id = $2 AND line.origin_seal_id = $3 AND line.status = 'active' AND line.package_id IS NULL`, [workspaceId, projectId, sealId])).rows;
  const supplies = new Set<string>();
  for (const line of lines) {
    const supply = suggestedSupply(line.kind, line.itemType);
    supplies.add(supply);
    let packageId = (await db.query<{ id: string }>(`SELECT id FROM project_packages WHERE workspace_id = $1 AND project_id = $2 AND area_id IS NOT DISTINCT FROM $3::uuid AND supply = $4 ORDER BY position LIMIT 1`,
      [workspaceId, projectId, line.areaId, supply])).rows[0]?.id;
    if (!packageId) {
      packageId = randomUUID();
      const position = (await db.query<{ next: number }>(`SELECT coalesce(max(position) + 1, 0)::int AS next FROM project_packages WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows[0].next;
      await db.query(`INSERT INTO project_packages (id, workspace_id, project_id, name, area_id, supply, position) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [packageId, workspaceId, projectId, (line.areaName ?? "General").slice(0, 200), line.areaId, supply, position]);
    }
    await db.query(`UPDATE project_boq_lines SET package_id = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, line.id, packageId]);
  }
  // The supplies of everything the variation added (packaged now or already): who makes or buys it.
  const all = (await db.query<{ supply: string }>(
    `SELECT DISTINCT package.supply FROM project_boq_lines line JOIN project_packages package ON package.workspace_id = line.workspace_id AND package.id = line.package_id
      WHERE line.workspace_id = $1 AND line.project_id = $2 AND line.origin_seal_id = $3`, [workspaceId, projectId, sealId])).rows.map((row) => row.supply);
  for (const supply of all) supplies.add(supply);
  return supplies;
}

/** Orders on the project that hold a line this variation removed or reduced: listed for the buyer, never changed (M-5). */
async function ordersOnRemovedLines(db: Db, workspaceId: string, changeId: string, projectId: string, boqLineIds: string[]) {
  if (!boqLineIds.length) return [];
  const found = (await db.query<{ id: string; number: string; status: string; matchedOn: string }>(
    `SELECT DISTINCT ON (po.id) po.id, po.number, po.status, line.description AS "matchedOn"
       FROM purchase_orders po
       JOIN purchase_order_lines line ON line.workspace_id = po.workspace_id AND line.order_id = po.id AND line.project_id = $2
       LEFT JOIN project_material_items material ON material.workspace_id = line.workspace_id AND material.id = line.material_item_id
      WHERE po.workspace_id = $1 AND po.status IN ('draft', 'pending_approval', 'approved', 'sent', 'confirmed', 'partly_received')
        AND (line.boq_line_id = ANY($3::uuid[]) OR material.boq_line_ids && $3::uuid[])
      ORDER BY po.id, line.position`, [workspaceId, projectId, boqLineIds])).rows;
  for (const order of found)
    await db.query(`INSERT INTO change_request_po_impacts (workspace_id, change_request_id, purchase_order_id, number, status, matched_on) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [workspaceId, changeId, order.id, order.number, order.status, order.matchedOn.slice(0, 240)]);
  return found;
}

/**
 * Applies an approved change to its project in one command (version-checked when a person runs it, audited): the
 * variation is sealed as VO-n (the contract value is the sealed quotation plus the sealed variations; the sealed
 * quotation never changes) and the live scope follows it; new lines go into packages, so the factory's "to make" list
 * and purchasing's needs carry them; the material list picks them up; orders on removed lines are listed for the buyer;
 * the stage work and the handover move as the preview said; finance's invoice request is raised where the firm asks
 * for them. Applying an applied change returns it unchanged.
 */
export async function applyProjectChange(db: Db, workspaceId: string, id: string, actorUserId: string | null, options: { version?: number } = {}) {
  const current = await readChangeById(db, workspaceId, id, true);
  if (!current || !current.projectId) throw new NotFoundException("This change request isn't on a project.");
  if (current.status === "applied") return { replayed: true, change: current, outcome: null };
  rule(() => nextStatus(current.status, "apply", "project"));
  if (options.version !== undefined && options.version !== current.version) throw new ConflictException("This change was updated in another window. Reload and try again.");
  const projectId = current.projectId;
  const project = await changeProject(db, workspaceId, projectId, true);
  if (!["active", "on_hold"].includes(project.status)) throw new ConflictException("The project is closed; this change can't move it any more.");
  const actor = actorUserId ?? current.submittedBy ?? current.raisedBy ?? (await db.query<{ userId: string }>(`SELECT created_by AS "userId" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, projectId])).rows[0].userId;
  const data = await loadCommercial(db, workspaceId, project.caseId);
  const quote = variationOf(data, current);
  // What finance bills or credits for it: its milestones (made when the client accepted it) or the client's credit.
  const payment = [...data.payments.filter((item) => item.sourceQuoteId === quote.id)
    .map((item) => `${item.requiredForRelease ? "Bill before the work starts" : `Bill ${item.title}`}: ${Dec.of(item.amount).toFixed(2)} ${item.currency ?? quote.currency}`),
    ...(data.credits ?? []).filter((credit) => credit.quoteId === quote.id).map((credit) => `Credit the client ${Dec.of(credit.amount).toFixed(2)} ${credit.currency}`)].join(". ");
  const seal = await sealVariation(db, { workspaceId, projectId, caseId: project.caseId, quote, actorUserId: actor });
  const supplies = await packageNewLines(db, workspaceId, projectId, seal.sealId);

  // The dates: the stage work and the handover move as the change says, on today's plan.
  const inputs = await scheduleInputs(db, workspaceId, projectId);
  const preview = scheduleImpact({ ...inputs, impacts: await readStageImpacts(db, workspaceId, id) });
  const moved: Array<{ id: string; number: number; title: string; dueDate: string | null; startDate: string | null; assigneeId: string | null }> = [];
  for (const move of preview.items) {
    const row = (await db.query<{ assigneeId: string | null }>(
      `UPDATE work_items SET start_date = $3, due_date = $4, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2 AND status NOT IN ('done', 'cancelled')
       RETURNING assignee_membership_id AS "assigneeId"`, [workspaceId, move.id, move.startDate, move.dueDate])).rows[0];
    if (!row) continue;
    await workEvent(db, workspaceId, move.id, "dates", { startDate: move.startDate, dueDate: move.dueDate, fromStart: move.fromStart, fromDue: move.fromDue, change: current.reference }, actor);
    moved.push({ id: move.id, number: move.number, title: move.title, dueDate: move.dueDate, startDate: move.startDate, assigneeId: row.assigneeId });
  }
  if (preview.handoverAfter && preview.handoverAfter !== project.promiseDate)
    await db.query(`UPDATE delivery_projects SET promise_date = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId, preview.handoverAfter]);

  // The material list takes the new lines (unless the client has it to decide: then it waits for their answer).
  let materials = "added";
  await db.query("SAVEPOINT change_request_materials");
  try { await suggestMaterials(db, workspaceId, projectId); await db.query("RELEASE SAVEPOINT change_request_materials"); }
  catch (error) {
    if (!(error instanceof HttpException)) throw error;
    await db.query("ROLLBACK TO SAVEPOINT change_request_materials");
    materials = error.message;
  }
  const removedLines = seal.lines.filter((line) => line.changeOp === "omit" && line.boqLineId).map((line) => line.boqLineId!);
  const orders = await ordersOnRemovedLines(db, workspaceId, id, projectId, removedLines);
  // Finance's invoice request for what is due now, where the firm has finance raise them by stage (PLM-108).
  const stageRequests = (await db.query<{ on: boolean }>(`SELECT stage_invoice_requests AS on FROM finance_request_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.on ?? false;
  if (stageRequests) {
    await db.query("SAVEPOINT change_request_invoice");
    try { await raiseStageInvoiceRequests(db as PoolClient, workspaceId); await db.query("RELEASE SAVEPOINT change_request_invoice"); }
    catch { await db.query("ROLLBACK TO SAVEPOINT change_request_invoice"); }
  }
  const applied = { seal: seal.label, sealId: seal.sealId, total: seal.total, net: seal.net, currency: seal.currency, handoverBefore: preview.handoverBefore, handoverAfter: preview.handoverAfter,
    finishDelay: preview.finishDelay, stages: preview.stages, items: moved.map(({ assigneeId: _assignee, ...move }) => move), materials, orders: orders.map((order) => order.number),
    frozenHandoverAfter: (current.scheduleSnapshot as { handoverAfter?: string | null } | null)?.handoverAfter ?? null };
  await db.query(
    `UPDATE change_requests SET status = 'applied', applied_at = now(), applied_by = $3, applied_seal_id = $4, applied_schedule = $5::jsonb, time_impact_days = $6, handover_before = $7,
            handover_after = $8, apply_problem = NULL, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, actorUserId, seal.sealId, JSON.stringify(applied), Math.min(365, preview.finishDelay), preview.handoverBefore, preview.handoverAfter]);
  await db.query(`UPDATE delivery_projects SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId]);
  await event(db, workspaceId, id, "applied", actorUserId ? { userId: actorUserId } : null, `${seal.label}${applied.frozenHandoverAfter && applied.frozenHandoverAfter !== preview.handoverAfter
    ? ` · handover ${preview.handoverAfter ?? "unchanged"} (sent as ${applied.frozenHandoverAfter})` : ""}`);
  await recordAudit(db, { workspaceId, actorUserId, source: actorUserId ? "user" : "internal", action: "change_request.applied.v1", entityType: "change_request", entityId: id,
    before: { handover: project.promiseDate, projectVersion: project.version }, after: applied });
  await recordAudit(db, { workspaceId, actorUserId, source: actorUserId ? "user" : "internal", action: "project.change_applied", entityType: "project", entityId: projectId,
    before: { promiseDate: project.promiseDate }, after: { changeRequestId: id, reference: current.reference, seal: seal.label, promiseDate: preview.handoverAfter, moved: moved.length } });

  const change = (await readChangeById(db, workspaceId, id))!;
  const day = async (value: string | null) => (value ? workspaceDay(db, workspaceId, value) : null);
  const outcome: ApplyOutcome = {
    label: seal.label, payment, orders: orders.map((order) => order.number),
    added: seal.lines.filter((line) => line.changeOp !== "omit" && line.changeOp !== "move").map((line) => line.title),
    removed: seal.lines.filter((line) => line.changeOp === "omit").map((line) => line.title),
    make: supplies.has("make"), buy: ["buy", "ready_made", "subcontract"].some((supply) => supplies.has(supply)),
    handoverBefore: await day(preview.handoverBefore), handoverAfter: await day(preview.handoverAfter),
    stages: preview.stages.map((stage) => ({ name: stage.name, delay: stage.delay })),
    movedMemberships: moved.map((move) => move.assigneeId).filter((value): value is string => Boolean(value)),
  };
  await noticeProjectChangeDecided(db, workspaceId, { ...noticeOf(change), status: change.status, declineNote: null, decidedByName: change.decidedByName }, outcome);
  for (const move of moved.filter((item) => item.assigneeId))
    await noticeWork(db, { workspaceId, projectId, key: `${move.id}:change:${id}`, actorUserId: actor,
      notice: { code: "work.moved", item: { id: move.id, number: move.number, title: move.title, dueDate: move.dueDate ?? move.startDate }, note: current.reference, memberships: [move.assigneeId!] } });
  return { replayed: false, change, outcome };
}

// ---------------------------------------------------------------- withdraw

/** Withdraws a project change that isn't decided: its approval request is cancelled, its variation withdrawn, open links closed. */
export async function withdrawProjectChange(db: Db, workspaceId: string, current: ChangeRow, input: { version?: unknown; reason?: unknown }, userId: string) {
  rule(() => nextStatus(current.status, "withdraw", "project"));
  if (Number(input.version) !== current.version) throw new ConflictException("This change was updated in another window. Reload and try again.");
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 2000) : "";
  if (!reason) throw new BadRequestException("Say why it's withdrawn.");
  if (current.status === "pending_approval") await cancelApproval(db, { workspaceId, kind: "change_request", subjectId: current.id, actorUserId: userId, reason });
  if (current.quoteId) {
    const data = await loadCommercial(db, workspaceId, current.caseId);
    const quote = variationOf(data, current);
    if (["draft", "internal_review", "internal_approved", "issued"].includes(quote.status)) {
      quote.status = "withdrawn";
      await persistCommercial(db, workspaceId, current.caseId, data, await userName(db, userId), `Withdrew ${current.reference}`, quote.id, reason);
    }
  }
  await closeLinks(db, workspaceId, current.id);
  await db.query(`UPDATE change_requests SET status = 'withdrawn', withdrawn_at = now(), withdraw_reason = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, current.id, reason]);
  await event(db, workspaceId, current.id, "withdrawn", { userId }, reason);
  await recordAudit(db, { workspaceId, actorUserId: userId, action: "change_request.withdrawn.v1", entityType: "change_request", entityId: current.id, after: { reason, quoteId: current.quoteId } });
  return (await readChangeById(db, workspaceId, current.id))!;
}

// ---------------------------------------------------------------- reads for others

export type ApprovedVariation = {
  sealId: string; label: string; quoteId: string; changeRequestId: string | null; reference: string | null; title: string;
  net: string; tax: string; total: string; currency: string; acceptedAt: string; appliedAt: string;
};

/**
 * The project's approved variations as separate revenue lines (the Money view and the project P&L read them): each
 * sealed VO-n with its change request, net, tax and total from its sealed snapshot. The sealed quotation stays apart,
 * so agreed = sealed + Σ variations.
 */
export async function approvedVariations(db: Db, workspaceId: string, projectId: string) {
  const rows = (await db.query<ApprovedVariation & { kind: string; number: number | null }>(
    `SELECT seal.id AS "sealId", seal.revision_label AS label, seal.quote_id AS "quoteId", seal.kind, change.id AS "changeRequestId", change.number,
            coalesce(change.title, quote.title, seal.revision_label) AS title, coalesce(seal.snapshot->'pricing'->>'net', seal.total::text) AS net,
            coalesce(seal.snapshot->'pricing'->>'tax', '0') AS tax, seal.total::text AS total, trim(seal.currency) AS currency, seal.accepted_at AS "acceptedAt", seal.sealed_at AS "appliedAt"
       FROM project_scope_seals seal
       LEFT JOIN change_requests change ON change.workspace_id = seal.workspace_id AND change.applied_seal_id = seal.id
       LEFT JOIN delivery_projects project ON project.workspace_id = seal.workspace_id AND project.id = seal.project_id
       LEFT JOIN commercial_quotes quote ON quote.workspace_id = seal.workspace_id AND quote.case_id = project.case_id AND quote.id = seal.quote_id
      WHERE seal.workspace_id = $1 AND seal.project_id = $2 ORDER BY seal.kind <> 'baseline', seal.sealed_at, seal.revision_label`, [workspaceId, projectId])).rows;
  const iso = (value: unknown) => new Date(value as string).toISOString();
  const baseline = rows.find((row) => row.kind === "baseline");
  const variations = rows.filter((row) => row.kind === "variation").map(({ kind: _kind, number, ...row }) => ({ ...row, reference: number ? changeReference(number) : null,
    acceptedAt: iso(row.acceptedAt), appliedAt: iso(row.appliedAt) }));
  const sum = (values: string[]) => values.reduce((total, value) => total.add(value), Dec.ZERO);
  return {
    currency: baseline?.currency ?? variations[0]?.currency ?? null,
    sealed: baseline ? { label: baseline.label, net: Dec.of(baseline.net).toFixed(2), tax: Dec.of(baseline.tax).toFixed(2), total: Dec.of(baseline.total).toFixed(2) } : null,
    variations: variations.map((row) => ({ ...row, net: Dec.of(row.net).toFixed(2), tax: Dec.of(row.tax).toFixed(2), total: Dec.of(row.total).toFixed(2) })),
    variationsTotal: sum(variations.map((row) => row.total)).toFixed(2),
    variationsNet: sum(variations.map((row) => row.net)).toFixed(2),
    agreed: sum(rows.map((row) => row.total)).toFixed(2),
  };
}

// ---------------------------------------------------------------- who may do what

export type ProjectViewerRights = { all: boolean; onTeam: boolean; lead: boolean; membershipId: string | null; commercial: boolean };

/** The rights a person has on a change, and so its actions and the one next step. */
export async function changeRightsFor(db: Db, workspaceId: string, change: ChangeRow, viewer: ProjectViewerRights, userId: string): Promise<ChangeRights> {
  let approver = false;
  if (change.status === "pending_approval") {
    const approval = await approvalStatus(db, workspaceId, "change_request", change.id);
    approver = Boolean(approval && approval.status === "pending" && (await canDecideApproval(db, workspaceId, approval.id, userId)).canDecide);
  }
  return { view: viewer.all || viewer.onTeam || viewer.commercial || approver, commercial: viewer.commercial, manager: viewer.lead || viewer.all, raiser: change.raisedBy === userId, approver };
}

export function actionsFor(change: ChangeRow, qs: QsState, rights: ChangeRights) {
  const actions = allowedActions({ status: change.status, hasQuote: Boolean(change.quoteId), qs }, rights);
  return { actions, next: nextStep(actions) };
}
