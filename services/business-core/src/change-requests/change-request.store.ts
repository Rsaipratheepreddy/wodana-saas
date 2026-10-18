import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { approvalStatus, cancelApproval, requestApproval } from "../approvals/approval-engine.api";
import type { ApprovalDecision, ApprovalStatus } from "../approvals/approval-engine.api";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { readLedger } from "../design/design-ledger.store";
import { readCalendar, workdays } from "../project-core/work-calendar";
import {
  allowanceDraw, ChangeRuleError, changeReference, cleanDraft, nextStatus, priceImpact, submitProblem,
  type ChangeKind, type ChangeStatus, type CleanLine, type DraftInput,
} from "./change-request.domain";
import { noticeChangeDecided, noticeChangeRaised, noticeChangeToClient } from "./change-request-notices";
import { decideProjectChange, projectApprovalOutcome, withdrawProjectChange } from "./project-changes.store";

type Db = Pick<PoolClient, "query">;

/** Who acts: a staff user, or a client contact through the portal (their grant on the project). */
export type ChangeActor = { userId: string } | { grantId: string; name: string };

export type ChangeLineRow = CleanLine & { position: number; roomName: string | null };
export type ChangeRow = {
  id: string; caseId: string; number: number; reference: string; kind: ChangeKind; title: string; description: string; designImpact: string; status: ChangeStatus;
  currency: string; priceImpact: string; allowanceDraw: string; timeImpactDays: number; handoverBefore: string | null; handoverAfter: string | null;
  raisedByClient: boolean; raisedByName: string | null; raisedByGrantId: string | null; submittedAt: string | null; sentAt: string | null; documentId: string | null; esignRequestId: string | null;
  decidedAt: string | null; decidedByName: string | null; decidedByGrantId: string | null; decisionMethod: "portal" | "signed_link" | null; declineNote: string | null;
  lockNumber: number | null; withdrawnAt: string | null; withdrawReason: string | null; version: number; createdAt: string; updatedAt: string;
  /** On a started project (null on a planning record): why it was raised, its variation quotation and what applying it did. */
  projectId: string | null; reason: "client_request" | "site_condition" | "design_change" | "error"; quoteId: string | null; paymentRule: "before_work" | "next_milestone" | null;
  scheduleSnapshot: unknown; issuedHash: string | null; appliedAt: string | null; appliedSealId: string | null; appliedSchedule: unknown; applyProblem: string | null;
  submittedBy: string | null; raisedBy: string | null;
  lines: ChangeLineRow[];
};

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

function rule<T>(work: () => T): T {
  try { return work(); } catch (error) {
    if (error instanceof ChangeRuleError) throw error.code === "conflict" ? new ConflictException(error.message) : new UnprocessableEntityException(error.message);
    throw error;
  }
}

const CHANGE_SELECT = `SELECT change.id, change.case_id AS "caseId", change.number, change.kind, change.title, change.description, change.design_impact AS "designImpact",
  change.status, trim(change.currency) AS currency, change.price_impact::text AS "priceImpact", change.time_impact_days AS "timeImpactDays",
  change.handover_before::text AS "handoverBefore", change.handover_after::text AS "handoverAfter", change.raised_by_grant_id IS NOT NULL AS "raisedByClient",
  COALESCE(raiser.display_name, grant_row.name) AS "raisedByName", change.raised_by_grant_id AS "raisedByGrantId", change.submitted_at AS "submittedAt", change.sent_at AS "sentAt",
  change.document_id AS "documentId", change.esign_request_id AS "esignRequestId", change.decided_at AS "decidedAt", change.decided_by_name AS "decidedByName",
  change.decided_by_grant_id AS "decidedByGrantId", change.decision_method AS "decisionMethod", change.decline_note AS "declineNote", change.lock_number AS "lockNumber",
  change.withdrawn_at AS "withdrawnAt", change.withdraw_reason AS "withdrawReason", change.version, change.created_at AS "createdAt", change.updated_at AS "updatedAt",
  change.project_id AS "projectId", change.reason, change.quote_id AS "quoteId", change.payment_rule AS "paymentRule", change.schedule_snapshot AS "scheduleSnapshot",
  change.issued_hash AS "issuedHash", change.applied_at AS "appliedAt", change.applied_seal_id AS "appliedSealId", change.applied_schedule AS "appliedSchedule",
  change.apply_problem AS "applyProblem", change.submitted_by AS "submittedBy", change.raised_by AS "raisedBy"
  FROM change_requests change
  LEFT JOIN users raiser ON raiser.id = change.raised_by
  LEFT JOIN client_portal_grants grant_row ON grant_row.workspace_id = change.workspace_id AND grant_row.id = change.raised_by_grant_id`;

type Raw = Omit<ChangeRow, "reference" | "lines" | "allowanceDraw">;

async function withLines(db: Db, workspaceId: string, rows: Raw[]): Promise<ChangeRow[]> {
  if (!rows.length) return [];
  const lines = (await db.query<ChangeLineRow & { changeId: string }>(
    `SELECT line.change_request_id AS "changeId", line.id, line.position, line.source, line.action, line.quote_id AS "quoteId", line.quote_line_id AS "quoteLineId",
            line.ledger_entry_id AS "ledgerEntryId", line.ledger_version_id AS "ledgerVersionId", line.room_id AS "roomId", room.name AS "roomName", line.title,
            line.quantity::text AS quantity, line.unit, line.unit_price::text AS "unitPrice", line.amount::text AS amount,
            line.catalog_item_id AS "catalogItemId", line.boq_line_id AS "boqLineId"
       FROM change_request_lines line LEFT JOIN pre_project_rooms room ON room.id = line.room_id
      WHERE line.workspace_id = $1 AND line.change_request_id = ANY($2::uuid[]) ORDER BY line.position`, [workspaceId, rows.map((row) => row.id)])).rows;
  return rows.map((row) => {
    const own = lines.filter((line) => line.changeId === row.id).map(({ changeId: _id, ...line }) => line);
    return {
      ...row, reference: changeReference(row.number), allowanceDraw: allowanceDraw(own), lines: own,
      submittedAt: iso(row.submittedAt), sentAt: iso(row.sentAt), decidedAt: iso(row.decidedAt), withdrawnAt: iso(row.withdrawnAt), createdAt: iso(row.createdAt)!, updatedAt: iso(row.updatedAt)!,
      appliedAt: iso(row.appliedAt),
    };
  });
}

/** A case's change requests, newest first, each with its lines (a project's changes too: the client sees them all in one place). */
export async function readChanges(db: Db, workspaceId: string, caseId: string) {
  return withLines(db, workspaceId, (await db.query<Raw>(`${CHANGE_SELECT} WHERE change.workspace_id = $1 AND change.case_id = $2 ORDER BY change.number DESC`,
    [workspaceId, caseId])).rows);
}

/** A project's change requests, newest first, each with its lines. */
export async function readProjectChangeRows(db: Db, workspaceId: string, projectId: string) {
  return withLines(db, workspaceId, (await db.query<Raw>(`${CHANGE_SELECT} WHERE change.workspace_id = $1 AND change.project_id = $2 ORDER BY change.number DESC`,
    [workspaceId, projectId])).rows);
}

/** One change by its id (whatever case it's on), for the commands that find it from elsewhere (the approvals inbox, a signed link). */
export async function readChangeById(db: Db, workspaceId: string, id: string, lock = false) {
  const row = (await db.query<Raw>(`${CHANGE_SELECT} WHERE change.workspace_id = $1 AND change.id = $2${lock ? " FOR UPDATE OF change" : ""}`, [workspaceId, id])).rows[0];
  return row ? (await withLines(db, workspaceId, [row]))[0] : null;
}

export async function readChange(db: Db, workspaceId: string, caseId: string, id: string, lock = false) {
  const row = (await db.query<Raw>(`${CHANGE_SELECT} WHERE change.workspace_id = $1 AND change.case_id = $2 AND change.id = $3${lock ? " FOR UPDATE OF change" : ""}`,
    [workspaceId, caseId, id])).rows[0];
  if (!row) throw new NotFoundException("This change request isn't on this project.");
  return (await withLines(db, workspaceId, [row]))[0];
}

/** The history of one change, oldest first, with who acted (a staff name or the client contact). */
export async function readChangeEvents(db: Db, workspaceId: string, changeId: string) {
  return (await db.query<{ event: string; at: string; note: string | null; actorName: string | null; byClient: boolean }>(
    `SELECT event.event, event.at, event.note, COALESCE(person.display_name, grant_row.name) AS "actorName", event.actor_grant_id IS NOT NULL AS "byClient"
       FROM change_request_events event
       LEFT JOIN users person ON person.id = event.actor_user_id
       LEFT JOIN client_portal_grants grant_row ON grant_row.workspace_id = event.workspace_id AND grant_row.id = event.actor_grant_id
      WHERE event.workspace_id = $1 AND event.change_request_id = $2 ORDER BY event.at, event.id`, [workspaceId, changeId])).rows
    .map((row) => ({ ...row, at: iso(row.at)! }));
}

/** M-5: the open purchase orders an approved change touches, as listed when it was approved. */
export async function readPoImpacts(db: Db, workspaceId: string, changeId: string) {
  return (await db.query<{ purchaseOrderId: string; number: string; status: string; matchedOn: string }>(
    `SELECT purchase_order_id AS "purchaseOrderId", number, status, matched_on AS "matchedOn" FROM change_request_po_impacts
      WHERE workspace_id = $1 AND change_request_id = $2 ORDER BY number`, [workspaceId, changeId])).rows;
}

export async function event(db: Db, workspaceId: string, changeId: string, name: string, actor: ChangeActor | null, note: string | null = null) {
  await db.query(`INSERT INTO change_request_events (id, workspace_id, change_request_id, event, actor_user_id, actor_grant_id, note) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), workspaceId, changeId, name, actor && "userId" in actor ? actor.userId : null, actor && "grantId" in actor ? actor.grantId : null, note]);
}

const auditActor = (actor: ChangeActor) => ("userId" in actor ? actor.userId : null);
const auditSource = (actor: ChangeActor) => ("userId" in actor ? "user" as const : "client_portal" as const);

/** The case's currency (the deal's, else the workspace's) and its project's handover date and id. */
async function caseFacts(db: Db, workspaceId: string, caseId: string) {
  const row = (await db.query<{ status: string; currency: string; projectId: string | null; promiseDate: string | null }>(
    `SELECT pre_case.status, COALESCE(NULLIF(trim(project.currency), ''), NULLIF(opportunity.currency_code, ''), workspace.default_currency) AS currency,
            project.id AS "projectId", project.promise_date::text AS "promiseDate"
       FROM pre_project_cases pre_case
       JOIN workspaces workspace ON workspace.id = pre_case.workspace_id
       LEFT JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN delivery_projects project ON project.workspace_id = pre_case.workspace_id AND project.case_id = pre_case.id AND project.started_at IS NOT NULL AND project.status <> 'archived'
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2 FOR UPDATE OF pre_case`, [workspaceId, caseId])).rows[0];
  if (!row) throw new NotFoundException("Case not found");
  return row;
}

/** The handover date a change would give: the current one moved by its working days (none without a date). */
async function shiftedHandover(db: Db, workspaceId: string, before: string | null, days: number) {
  if (!before || !days) return before;
  return workdays(await readCalendar(db, workspaceId)).shift(before, days);
}

/**
 * Checks each line belongs to this case (its quote line, its ledger entry and version, its room) and prices a ledger
 * line from its version: a choice changed after sign-off, its price impact against the version it replaces (E5-1).
 */
async function resolveLines(db: Db, workspaceId: string, caseId: string, lines: CleanLine[]) {
  const resolved: CleanLine[] = [];
  for (const line of lines) {
    if (line.quoteId) {
      const found = (await db.query<{ kind: string }>(
        `SELECT line.kind FROM commercial_quote_lines line JOIN commercial_quotes quote ON quote.workspace_id = line.workspace_id AND quote.case_id = line.case_id AND quote.id = line.quote_id
          WHERE line.workspace_id = $1 AND line.case_id = $2 AND line.quote_id = $3 AND line.id = $4 AND quote.status = 'accepted'`,
        [workspaceId, caseId, line.quoteId, line.quoteLineId])).rows[0];
      if (!found) throw new BadRequestException(`"${line.title}": choose a line of the accepted quotation.`);
      if (line.source === "allowance" && found.kind !== "allowance") throw new BadRequestException(`"${line.title}" isn't an allowance line.`);
    }
    if (line.roomId && !(await db.query(`SELECT 1 FROM pre_project_rooms WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, line.roomId])).rowCount)
      throw new BadRequestException(`"${line.title}": choose a room of this project.`);
    if (line.source === "ledger") {
      const version = (await db.query<{ priceImpact: string; afterLock: boolean; status: string; current: boolean }>(
        `SELECT version.price_impact::text AS "priceImpact", version.after_lock AS "afterLock", version.status, version.number = entry.current_number AS current
           FROM design_ledger_versions version JOIN design_ledger_entries entry ON entry.workspace_id = version.workspace_id AND entry.id = version.entry_id
          WHERE version.workspace_id = $1 AND version.case_id = $2 AND version.entry_id = $3 AND version.id = $4 AND entry.archived_at IS NULL`,
        [workspaceId, caseId, line.ledgerEntryId, line.ledgerVersionId])).rows[0];
      if (!version) throw new BadRequestException(`"${line.title}": choose a material of this project.`);
      if (!version.afterLock) throw new BadRequestException(`"${line.title}" isn't a change after sign-off; the client confirms it on the list.`);
      if (!version.current || version.status === "declined" || version.status === "superseded") throw new ConflictException(`"${line.title}" changed again. Reload and pick its latest version.`);
      resolved.push({ ...line, amount: Dec.of(version.priceImpact).toFixed(2) });
    } else resolved.push(line);
  }
  return resolved;
}

export async function writeLines(db: Db, workspaceId: string, changeId: string, lines: CleanLine[]) {
  await db.query(`DELETE FROM change_request_lines WHERE workspace_id = $1 AND change_request_id = $2`, [workspaceId, changeId]);
  for (const [position, line] of lines.entries())
    await db.query(
      `INSERT INTO change_request_lines (id, workspace_id, change_request_id, position, source, action, quote_id, quote_line_id, ledger_entry_id, ledger_version_id, room_id,
                                         title, quantity, unit, unit_price, amount, catalog_item_id, boq_line_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::numeric, $14, $15::numeric, $16::numeric, $17, $18)`,
      [line.id, workspaceId, changeId, position, line.source, line.action, line.quoteId, line.quoteLineId, line.ledgerEntryId, line.ledgerVersionId, line.roomId,
        line.title, line.quantity, line.unit, line.unitPrice, line.amount, line.catalogItemId ?? null, line.boqLineId ?? null]);
}

export type CreateInput = DraftInput & { id: string };

/**
 * A new change request (a draft). From staff it comes with its assessment; from the client it is their words only
 * (the team assesses it). Idempotent by its id: the same request again returns it; another with that id is refused.
 */
export async function createChange(db: Db, workspaceId: string, caseId: string, input: CreateInput, actor: ChangeActor) {
  if (!/^[0-9a-f-]{36}$/i.test(input.id)) throw new BadRequestException("Send the change's id.");
  const draft = rule(() => cleanDraft("grantId" in actor ? { title: input.title, description: input.description, kind: "addition" } : input));
  const existing = (await db.query<{ caseId: string; title: string }>(`SELECT case_id AS "caseId", title FROM change_requests WHERE workspace_id = $1 AND id = $2`, [workspaceId, input.id])).rows[0];
  if (existing) {
    if (existing.caseId !== caseId || existing.title !== draft.title) throw new ConflictException("This change id is already in use.");
    return { replayed: true, change: await readChange(db, workspaceId, caseId, input.id) };
  }
  const facts = await caseFacts(db, workspaceId, caseId);
  if (!["active", "released"].includes(facts.status)) throw new ConflictException("This project isn't taking changes.");
  const lines = await resolveLines(db, workspaceId, caseId, draft.lines);
  const number = (await db.query<{ next: number }>(`SELECT COALESCE(max(number), 0) + 1 AS next FROM change_requests WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0].next;
  const before = facts.promiseDate;
  await db.query(
    `INSERT INTO change_requests (id, workspace_id, case_id, number, kind, title, description, design_impact, currency, price_impact, time_impact_days, handover_before, handover_after,
                                  raised_by, raised_by_grant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::numeric, $11, $12, $13, $14, $15)`,
    [input.id, workspaceId, caseId, number, draft.kind, draft.title, draft.description, draft.designImpact, facts.currency, priceImpact(lines), draft.timeImpactDays, before,
      await shiftedHandover(db, workspaceId, before, draft.timeImpactDays), "userId" in actor ? actor.userId : null, "grantId" in actor ? actor.grantId : null]);
  await writeLines(db, workspaceId, input.id, lines);
  await event(db, workspaceId, input.id, "raised", actor, "grantId" in actor ? draft.description || null : null);
  await recordAudit(db, { workspaceId, actorUserId: auditActor(actor), source: auditSource(actor), action: "change_request.raised.v1", entityType: "change_request", entityId: input.id,
    after: { caseId, number, title: draft.title, kind: draft.kind, priceImpact: priceImpact(lines), timeImpactDays: draft.timeImpactDays, lines: lines.length, byClient: "grantId" in actor } });
  const change = await readChange(db, workspaceId, caseId, input.id);
  if ("grantId" in actor) await noticeChangeRaised(db, workspaceId, change, actor.name);
  return { replayed: false, change };
}

/** Saves a draft's assessment (fields and lines) against the version the editor saw. */
export async function saveDraft(db: Db, workspaceId: string, caseId: string, id: string, input: DraftInput & { version?: unknown }, userId: string) {
  const current = await readChange(db, workspaceId, caseId, id, true);
  if (current.projectId) throw new ConflictException("This change is on its project. Open it there.");
  rule(() => nextStatus(current.status, "edit"));
  if (Number(input.version) !== current.version) throw new ConflictException("This change was edited in another window. Reload and try again.");
  const draft = rule(() => cleanDraft(input));
  const lines = await resolveLines(db, workspaceId, caseId, draft.lines);
  const facts = await caseFacts(db, workspaceId, caseId);
  await writeLines(db, workspaceId, id, lines);
  await db.query(
    `UPDATE change_requests SET title = $3, kind = $4, description = $5, design_impact = $6, price_impact = $7::numeric, time_impact_days = $8, handover_before = $9, handover_after = $10,
            version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, draft.title, draft.kind, draft.description, draft.designImpact, priceImpact(lines), draft.timeImpactDays, facts.promiseDate,
      await shiftedHandover(db, workspaceId, facts.promiseDate, draft.timeImpactDays)]);
  await event(db, workspaceId, id, "edited", { userId });
  await recordAudit(db, { workspaceId, actorUserId: userId, action: "change_request.edited.v1", entityType: "change_request", entityId: id,
    before: { version: current.version, priceImpact: current.priceImpact, timeImpactDays: current.timeImpactDays },
    after: { priceImpact: priceImpact(lines), timeImpactDays: draft.timeImpactDays, lines: lines.length } });
  return readChange(db, workspaceId, caseId, id);
}

const changeHref = (caseId: string, id: string) => `/workspace/pre-projects/cases/${caseId}/variations?change=${id}`;

/** Sends a draft for approval inside the firm on E3 (kind change_request), at its price impact. */
export async function submitChange(db: Db, workspaceId: string, caseId: string, id: string, input: { version?: unknown }, userId: string) {
  const current = await readChange(db, workspaceId, caseId, id, true);
  if (current.projectId) throw new ConflictException("This change is on its project. Open it there.");
  rule(() => nextStatus(current.status, "submit"));
  if (Number(input.version) !== current.version) throw new ConflictException("This change was edited in another window. Reload and try again.");
  const problem = submitProblem(current);
  if (problem) throw new UnprocessableEntityException(problem);
  // The lines must still be what they were assessed on (a material changed again since is refused).
  await resolveLines(db, workspaceId, caseId, current.lines);
  await db.query(`UPDATE change_requests SET status = 'pending_approval', submitted_by = $3, submitted_at = now(), version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, userId]);
  const approval = await requestApproval(db, { workspaceId, kind: "change_request", subjectId: id, title: `${current.reference} · ${current.title}`.slice(0, 300), href: changeHref(caseId, id),
    amount: Dec.of(current.priceImpact).abs().toFixed(2), currency: current.currency, requesterUserId: userId });
  await event(db, workspaceId, id, "submitted", { userId });
  await recordAudit(db, { workspaceId, actorUserId: userId, action: "change_request.submitted.v1", entityType: "change_request", entityId: id,
    after: { approvalId: approval.id, priceImpact: current.priceImpact, currency: current.currency } });
  return readChange(db, workspaceId, caseId, id);
}

/**
 * What an E3 decision on a change does (from the change's screen or the Approvals inbox): approved → it goes to the
 * client; returned → back to draft with the note; rejected → withdrawn. A step approved midway changes nothing.
 */
export async function applyChangeApproval(db: Db, workspaceId: string, approval: ApprovalStatus, decision: ApprovalDecision, userId: string, note: string | null) {
  const row = (await db.query<{ caseId: string }>(`SELECT case_id AS "caseId" FROM change_requests WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, approval.subjectId])).rows[0];
  if (!row) return;
  const current = await readChange(db, workspaceId, row.caseId, approval.subjectId);
  // A change on a started project: its variation moves with the decision too.
  if (current.projectId) return projectApprovalOutcome(db, workspaceId, current, approval, decision, userId, note);
  if (current.status !== "pending_approval") return;
  if (decision === "approve" && approval.status !== "approved") return;
  const event_ = decision === "approve" ? "internal_approved" as const : decision === "return" ? "returned" as const : "rejected" as const;
  const status = rule(() => nextStatus(current.status, event_));
  await db.query(`UPDATE change_requests SET status = $3::varchar, withdrawn_at = CASE WHEN $3::varchar = 'withdrawn' THEN now() ELSE withdrawn_at END,
            withdraw_reason = CASE WHEN $3::varchar = 'withdrawn' THEN $4::text ELSE withdraw_reason END, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, current.id, status, note]);
  await event(db, workspaceId, current.id, event_ === "internal_approved" ? "approved_internal" : event_, { userId }, note);
  await recordAudit(db, { workspaceId, actorUserId: userId, action: `change_request.${event_}.v1`, entityType: "change_request", entityId: current.id, after: { status, note } });
  if (status === "with_client") await noticeChangeToClient(db, workspaceId, current);
}

/** Records the signing link sent for a change (its document and request) once e-sign made them. */
export async function recordSent(db: Db, workspaceId: string, caseId: string, id: string, input: { documentId: string; esignRequestId: string; userId: string }) {
  const current = await readChange(db, workspaceId, caseId, id, true);
  rule(() => nextStatus(current.status, "send"));
  await db.query(`UPDATE change_requests SET document_id = $3, esign_request_id = $4, sent_by = $5, sent_at = now(), version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, input.documentId, input.esignRequestId, input.userId]);
  await event(db, workspaceId, id, "sent", { userId: input.userId });
  return readChange(db, workspaceId, caseId, id);
}

export type ClientDecision = {
  decision: "approve" | "decline"; note?: string | null; method: "portal" | "signed_link"; name: string; grantId: string | null;
  /** The version the client saw (portal); a signed link is bound to its document instead. */
  version?: number | null;
};

/**
 * The client's decision on a change sent to them (portal with a code, or a signed link). Approved: its ledger lines
 * become the client's confirmed choices and the list is locked again with them (E5-1), the open purchase orders it
 * touches are listed (M-5), the handover date moves by its working days, and every open signing link closes.
 * Declined: it stays as history; a new assessment is a new change (§6.20). The first decision stands.
 */
export async function decideChange(db: Db, workspaceId: string, caseId: string, id: string, input: ClientDecision) {
  const current = await readChange(db, workspaceId, caseId, id, true);
  if (current.status === "approved" || current.status === "applied" || current.status === "declined") {
    const approved = current.status !== "declined";
    const same = approved === (input.decision === "approve") && (current.decidedByGrantId ?? null) === (input.grantId ?? null);
    if (same) return { replayed: true, change: current };
    throw new ConflictException(`This change was already ${approved ? "approved" : "declined"} by ${current.decidedByName ?? "someone else"}.`);
  }
  // A change on a started project: priced as a variation, accepted with it and applied to the project.
  if (current.projectId) return decideProjectChange(db, workspaceId, current, input);
  rule(() => nextStatus(current.status, input.decision === "approve" ? "client_approved" : "client_declined"));
  if (input.version !== undefined && input.version !== null && input.version !== current.version) throw new ConflictException("This change was updated. Reload to see the latest.");
  const note = (input.note ?? "").trim().slice(0, 2000);
  if (input.decision === "decline" && !note) throw new BadRequestException("Say why you're declining.");
  const name = input.name.trim().slice(0, 200);
  if (!name) throw new BadRequestException("Say who decided.");
  const actor: ChangeActor = input.grantId ? { grantId: input.grantId, name } : { grantId: "", name };
  if (input.decision === "decline") {
    await db.query(`UPDATE change_requests SET status = 'declined', decided_at = now(), decided_by_name = $3, decided_by_grant_id = $4, decision_method = $5, decline_note = $6,
              version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, name, input.grantId, input.method, note]);
    await closeLinks(db, workspaceId, id);
    await event(db, workspaceId, id, "declined", input.grantId ? actor : null, note);
    await recordAudit(db, { workspaceId, actorUserId: null, source: "client_portal", action: "change_request.declined.v1", entityType: "change_request", entityId: id,
      after: { by: name, grantId: input.grantId, method: input.method, note } });
    const change = await readChange(db, workspaceId, caseId, id);
    await noticeChangeDecided(db, workspaceId, change);
    return { replayed: false, change };
  }
  const lockNumber = await lockLedgerLines(db, workspaceId, caseId, current, input);
  const facts = await caseFacts(db, workspaceId, caseId);
  const handoverAfter = await shiftedHandover(db, workspaceId, facts.promiseDate, current.timeImpactDays);
  if (facts.projectId && facts.promiseDate && handoverAfter && handoverAfter !== facts.promiseDate)
    await db.query(`UPDATE delivery_projects SET promise_date = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, facts.projectId, handoverAfter]);
  await db.query(`UPDATE change_requests SET status = 'approved', decided_at = now(), decided_by_name = $3, decided_by_grant_id = $4, decision_method = $5, lock_number = $6,
            handover_before = $7, handover_after = $8, decline_note = NULL, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, name, input.grantId, input.method, lockNumber, facts.promiseDate, handoverAfter]);
  const listed = await listPurchaseOrders(db, workspaceId, current, facts.projectId);
  await closeLinks(db, workspaceId, id, input.method === "signed_link" ? current.esignRequestId : null);
  await event(db, workspaceId, id, "approved", input.grantId ? actor : null, note || null);
  await recordAudit(db, { workspaceId, actorUserId: null, source: "client_portal", action: "change_request.approved.v1", entityType: "change_request", entityId: id,
    after: { by: name, grantId: input.grantId, method: input.method, priceImpact: current.priceImpact, lockNumber, handoverBefore: facts.promiseDate, handoverAfter, purchaseOrders: listed } });
  const change = await readChange(db, workspaceId, caseId, id);
  await noticeChangeDecided(db, workspaceId, change, listed);
  return { replayed: false, change };
}

/** Closes the open signing links of a change (the decision was made); the one that signed is already closed. */
export async function closeLinks(db: Db, workspaceId: string, changeId: string, except: string | null = null) {
  const document = (await db.query<{ documentId: string | null }>(`SELECT document_id AS "documentId" FROM change_requests WHERE workspace_id = $1 AND id = $2`, [workspaceId, changeId])).rows[0]?.documentId;
  if (!document) return;
  await db.query(`UPDATE esign_requests SET status = 'revoked', revoked_at = now(), version = version + 1
                   WHERE workspace_id = $1 AND document_id = $2 AND status = 'pending' AND id IS DISTINCT FROM $3`, [workspaceId, document, except]);
}

/**
 * E5-1: the change's ledger lines become the client's confirmed choices (who, when, how) and the list gets a new
 * lock: the previous lock's versions with this change's in their place. Other changes still waiting stay out.
 */
async function lockLedgerLines(db: Db, workspaceId: string, caseId: string, change: ChangeRow, input: ClientDecision) {
  const ledgerLines = change.lines.filter((line) => line.source === "ledger");
  if (!ledgerLines.length) return null;
  const ledger = await readLedger(db, workspaceId, caseId);
  if (!ledger.lock) throw new ConflictException("Lock the material list at the design sign-off first.");
  for (const line of ledgerLines) {
    const entry = ledger.entries.find((item) => item.id === line.ledgerEntryId);
    const version = entry?.versions.find((item) => item.id === line.ledgerVersionId);
    if (!entry || !version || entry.archivedAt || entry.current?.id !== version.id) throw new ConflictException(`"${line.title}" changed again since this change was sent. The team will send a new one.`);
    if (version.status === "proposed")
      await db.query(
        `UPDATE design_ledger_versions SET status = 'confirmed', confirmed_at = clock_timestamp(), confirmation_method = $4, confirmed_by_name = $5, confirmed_by_grant_id = $6,
                confirmation_note = $7 WHERE workspace_id = $1 AND entry_id = $2 AND id = $3`,
        [workspaceId, entry.id, version.id, input.method === "portal" ? "portal" : "signed_document", input.name.slice(0, 200), input.grantId,
          `${change.reference} approved${input.method === "signed_link" ? " by signature" : " in the portal"}`]);
    else if (version.status !== "confirmed") throw new ConflictException(`"${line.title}" was declined; this change can't be approved as it is.`);
  }
  const previous = (await db.query<{ entryId: string; versionId: string }>(
    `SELECT line.entry_id AS "entryId", line.version_id AS "versionId" FROM design_ledger_lock_lines line JOIN design_ledger_locks lock ON lock.workspace_id = line.workspace_id AND lock.id = line.lock_id
      WHERE lock.workspace_id = $1 AND lock.case_id = $2 AND lock.number = $3`, [workspaceId, caseId, ledger.lock.number])).rows;
  const lines = new Map(previous.map((line) => [line.entryId, line.versionId]));
  for (const line of ledgerLines) lines.set(line.ledgerEntryId!, line.ledgerVersionId!);
  const lockId = randomUUID();
  const number = ledger.lock.number + 1;
  await db.query(`INSERT INTO design_ledger_locks (id, workspace_id, case_id, number, reason, note, locked_by) VALUES ($1, $2, $3, $4, 'change_approved', $5, $6)`,
    [lockId, workspaceId, caseId, number, `${change.reference} ${change.title}`.slice(0, 2000), change.lines.length ? await submitterOf(db, workspaceId, change.id) : null]);
  for (const [entryId, versionId] of lines)
    await db.query(`INSERT INTO design_ledger_lock_lines (workspace_id, lock_id, entry_id, version_id) VALUES ($1, $2, $3, $4)`, [workspaceId, lockId, entryId, versionId]);
  // The list matches its lock again: nothing is left for a separate ledger-change approval.
  const after = await readLedger(db, workspaceId, caseId);
  if (after.state === "locked") {
    const open = await approvalStatus(db, workspaceId, "ledger_change", caseId);
    if (open?.status === "pending") await cancelApproval(db, { workspaceId, kind: "ledger_change", subjectId: caseId, actorUserId: null, reason: `Approved with ${change.reference}` });
  }
  return number;
}

/** Who sent the change for approval (the lock records a staff member; the client's signature is on the change). */
async function submitterOf(db: Db, workspaceId: string, changeId: string) {
  return (await db.query<{ userId: string | null }>(`SELECT COALESCE(submitted_by, raised_by) AS "userId" FROM change_requests WHERE workspace_id = $1 AND id = $2`, [workspaceId, changeId])).rows[0]?.userId ?? null;
}

const OPEN_PO = ["draft", "pending_approval", "approved", "sent", "confirmed", "partly_received"];

/**
 * M-5: the project's open purchase orders with a line for what the change touches (the same catalogue item or the
 * same name as a changed line or the version it replaces), recorded once with what they matched.
 */
async function listPurchaseOrders(db: Db, workspaceId: string, change: ChangeRow, projectId: string | null) {
  if (!projectId) return [];
  const names = new Set<string>(change.lines.map((line) => line.title.trim().toLowerCase()));
  const catalog = new Set<string>();
  const entries = change.lines.filter((line) => line.ledgerEntryId).map((line) => line.ledgerEntryId!);
  if (entries.length) {
    const versions = (await db.query<{ title: string; catalogItemId: string | null }>(
      `SELECT title, catalog_item_id AS "catalogItemId" FROM design_ledger_versions WHERE workspace_id = $1 AND entry_id = ANY($2::uuid[])`, [workspaceId, entries])).rows;
    for (const version of versions) { names.add(version.title.trim().toLowerCase()); if (version.catalogItemId) catalog.add(version.catalogItemId); }
  }
  const quoted = change.lines.filter((line) => line.quoteLineId);
  for (const line of quoted) {
    const title = (await db.query<{ title: string }>(`SELECT title FROM commercial_quote_lines WHERE workspace_id = $1 AND quote_id = $2 AND id = $3`, [workspaceId, line.quoteId, line.quoteLineId])).rows[0]?.title;
    if (title) names.add(title.trim().toLowerCase());
  }
  const found = (await db.query<{ id: string; number: string; status: string; matchedOn: string }>(
    `SELECT DISTINCT ON (po.id) po.id, po.number, po.status, line.description AS "matchedOn"
       FROM purchase_orders po
       JOIN purchase_order_lines line ON line.workspace_id = po.workspace_id AND line.order_id = po.id AND line.project_id = $2
       LEFT JOIN project_material_items material ON material.workspace_id = line.workspace_id AND material.id = line.material_item_id
      WHERE po.workspace_id = $1 AND po.status = ANY($3::text[])
        AND (lower(btrim(line.description)) = ANY($4::text[]) OR material.catalog_item_id = ANY($5::uuid[]))
      ORDER BY po.id, line.position`, [workspaceId, projectId, OPEN_PO, [...names], [...catalog]])).rows;
  for (const order of found)
    await db.query(`INSERT INTO change_request_po_impacts (workspace_id, change_request_id, purchase_order_id, number, status, matched_on) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [workspaceId, change.id, order.id, order.number, order.status, order.matchedOn.slice(0, 240)]);
  return found.map((order) => ({ purchaseOrderId: order.id, number: order.number, status: order.status, matchedOn: order.matchedOn }));
}

/** Withdraws a change that isn't decided: its approval request is cancelled and open signing links close. */
export async function withdrawChange(db: Db, workspaceId: string, caseId: string, id: string, input: { version?: unknown; reason?: unknown }, userId: string) {
  const current = await readChange(db, workspaceId, caseId, id, true);
  if (current.projectId) return withdrawProjectChange(db, workspaceId, current, input, userId);
  rule(() => nextStatus(current.status, "withdraw"));
  if (Number(input.version) !== current.version) throw new ConflictException("This change was updated in another window. Reload and try again.");
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 2000) : "";
  if (!reason) throw new BadRequestException("Say why it's withdrawn.");
  if (current.status === "pending_approval") await cancelApproval(db, { workspaceId, kind: "change_request", subjectId: id, actorUserId: userId, reason });
  await closeLinks(db, workspaceId, id);
  await db.query(`UPDATE change_requests SET status = 'withdrawn', withdrawn_at = now(), withdraw_reason = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, reason]);
  await event(db, workspaceId, id, "withdrawn", { userId }, reason);
  await recordAudit(db, { workspaceId, actorUserId: userId, action: "change_request.withdrawn.v1", entityType: "change_request", entityId: id, after: { reason } });
  return readChange(db, workspaceId, caseId, id);
}

/** What the client has approved on a case: approved changes in order, for the budget tracker (R1). */
export async function approvedChanges(db: Db, workspaceId: string, caseId: string) {
  return (await readChanges(db, workspaceId, caseId)).filter((change) => change.status === "approved" || change.status === "applied");
}
