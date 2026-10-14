import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { assertMemberFree } from "../crm/shared/calendar-clash";
import { checkIntroSlot, meetingLocation, meetingWhen } from "../crm/opportunities/intro-meeting.domain";
import { confirmAppointment } from "../crm/conversations/inbox/client-followups";
import { caseFacts, leadDesigner, salesAdminMembership } from "../design/design-journey.store";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { casePlan } from "../pre-projects/case-plan";
import { quotationReference } from "../proposals/quote-issue";
import { money } from "../reminders/sources/support";
import {
  budgetOf, idleSince, keptPriceStands, overBudgetBy, roundChargeable, startProblem, veLead, veStep, type Money, type VeOrigin, type VeOutcome, type VeStep,
} from "./value-engineering.domain";

type Db = Pick<PoolClient, "query">;

export type RoundRow = {
  id: string; caseId: string; quoteId: string; familyId: string; quoteNumber: number; round: number; chargeable: boolean; origin: VeOrigin; status: "open" | "closed";
  currency: string; quotedTotal: string; budgetAmount: string | null; leadMembershipId: string | null; leadFallback: boolean; qsUserId: string | null; note: string;
  optionsNote: string | null; optionsAgreedAt: Date | null; optionsAgreedBy: string | null; meetingActivityId: string | null; outcome: VeOutcome | null;
  outcomeQuoteId: string | null; outcomeNote: string | null; closedAt: Date | null; closedBy: string | null; lastMovedAt: Date; startedBy: string | null; startedAt: Date; version: number;
};

const ROUND_SELECT = `SELECT round.id, round.case_id AS "caseId", round.quote_id AS "quoteId", round.family_id AS "familyId", round.quote_number AS "quoteNumber",
  round.round, round.chargeable, round.origin, round.status, round.currency, round.quoted_total::text AS "quotedTotal", round.budget_amount::text AS "budgetAmount",
  round.lead_membership_id AS "leadMembershipId", round.lead_fallback AS "leadFallback", round.qs_user_id AS "qsUserId", round.note, round.options_note AS "optionsNote",
  round.options_agreed_at AS "optionsAgreedAt", round.options_agreed_by AS "optionsAgreedBy", round.meeting_activity_id AS "meetingActivityId", round.outcome,
  round.outcome_quote_id AS "outcomeQuoteId", round.outcome_note AS "outcomeNote", round.closed_at AS "closedAt", round.closed_by AS "closedBy",
  round.last_moved_at AS "lastMovedAt", round.started_by AS "startedBy", round.started_at AS "startedAt", round.version
  FROM quote_value_engineering round`;

/**
 * The done-check of an open round, read from the quotation records: a later version of the estimate sent to the client
 * after the round started (or the same version sent at a new price), else the client accepting the version the round
 * started on (they kept the price). Used to close rounds and by the idle reminder, so the two never disagree.
 */
export const NEW_VERSION_SQL = `(SELECT later.id FROM commercial_quotes later
     JOIN quote_issue_snapshots shot ON shot.workspace_id = later.workspace_id AND shot.case_id = later.case_id AND shot.quote_id = later.id
    WHERE later.workspace_id = round.workspace_id AND later.case_id = round.case_id AND coalesce(later.family_id, later.id) = round.family_id
      AND later.number >= round.quote_number AND later.status IN ('issued', 'accepted', 'changes_requested', 'declined', 'expired')
      AND shot.issued_at >= round.started_at AND (later.id <> round.quote_id OR later.total <> round.quoted_total)
    ORDER BY later.number DESC LIMIT 1)`;
export const KEPT_PRICE_SQL = `EXISTS (SELECT 1 FROM commercial_quotes same WHERE same.workspace_id = round.workspace_id AND same.case_id = round.case_id
    AND same.id = round.quote_id AND same.status = 'accepted')`;

const href = (caseId: string, quoteId: string) => `/workspace/pre-projects/cases/${caseId}/quotations?quote=${encodeURIComponent(quoteId)}`;

/** The client's budget as recorded on the brief (discovery), or null. */
export async function clientBudget(db: Db, workspaceId: string, caseId: string): Promise<Money | null> {
  const row = (await db.query<{ amount: string | null; currency: string | null }>(
    `SELECT content->>'budgetAmount' AS amount, content->>'currencyCode' AS currency FROM pre_project_briefs WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0];
  return row ? budgetOf(row.amount, row.currency) : null;
}

/** The firm's free value engineering rounds per job (null: no limit). */
export async function freeRounds(db: Db, workspaceId: string): Promise<number | null> {
  return (await db.query<{ rounds: number | null }>(`SELECT value_engineering_free_rounds AS rounds FROM workspace_quotation_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.rounds ?? null;
}

/** Who leads value engineering on the job now, whether it has design work, and its Account Manager. */
export async function jobLead(db: Db, workspaceId: string, caseId: string) {
  const facts = await caseFacts(db, workspaceId, caseId);
  const designer = await leadDesigner(db, workspaceId, caseId);
  const designWork = (await casePlan(db, workspaceId, caseId)).design;
  return { lead: veLead({ designer, accountManager: facts?.accountManagerId ?? null, designWork }), designWork, accountManager: facts?.accountManagerId ?? null, facts };
}

type QuoteFacts = { id: string; kind: string; round: string | null; status: string; number: number; title: string; total: string; currency: string; familyId: string; latest: boolean; version: number };

/** An estimate version with its family (v1, v2...) and whether it is the latest version. */
export async function quoteFacts(db: Db, workspaceId: string, caseId: string, quoteId: string): Promise<QuoteFacts | null> {
  return (await db.query<QuoteFacts>(
    `SELECT quote.id, quote.kind, quote.round, quote.status, quote.number, quote.title, quote.total::text AS total, quote.currency, coalesce(quote.family_id, quote.id) AS "familyId",
            NOT EXISTS (SELECT 1 FROM commercial_quotes later WHERE later.workspace_id = quote.workspace_id AND later.case_id = quote.case_id
                         AND coalesce(later.family_id, later.id) = coalesce(quote.family_id, quote.id) AND later.number > quote.number AND later.status <> 'withdrawn') AS latest,
            (SELECT count(*)::int FROM commercial_quotes earlier WHERE earlier.workspace_id = quote.workspace_id AND earlier.case_id = quote.case_id
               AND coalesce(earlier.family_id, earlier.id) = coalesce(quote.family_id, quote.id) AND earlier.number <= quote.number) AS version
       FROM commercial_quotes quote WHERE quote.workspace_id = $1 AND quote.case_id = $2 AND quote.id = $3`, [workspaceId, caseId, quoteId])).rows[0] ?? null;
}

/** How people name an estimate version: its quotation number and version (PLM-QUO-0001 R2), else Q-3. */
async function quoteName(db: Db, workspaceId: string, caseId: string, quote: Pick<QuoteFacts, "familyId" | "number" | "version">) {
  const reference = (await quotationReference(db, workspaceId, caseId, quote.familyId))?.reference;
  return reference ? `${reference} R${quote.version}` : `Q-${quote.number}`;
}

/** The QS on an estimate version: who confirmed its pricing (the QS review, else the QS estimate), else who it is with. */
async function quoteQs(db: Db, workspaceId: string, caseId: string, quoteId: string): Promise<string | null> {
  return (await db.query<{ userId: string | null }>(
    `SELECT coalesce(
       (SELECT coalesce(review.decided_by, review.assignee_user_id) FROM quote_qs_reviews review WHERE review.workspace_id = $1 AND review.case_id = $2 AND review.quote_id = $3
         ORDER BY review.requested_at DESC, review.id DESC LIMIT 1),
       (SELECT nullif(quote.detail->'qsEstimate'->>'reviewedById', '')::uuid FROM commercial_quotes quote WHERE quote.workspace_id = $1 AND quote.case_id = $2 AND quote.id = $3)) AS "userId"`,
    [workspaceId, caseId, quoteId])).rows[0]?.userId ?? null;
}

export async function membershipOf(db: Db, workspaceId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  return (await db.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, userId])).rows[0]?.id ?? null;
}

async function usersOf(db: Db, workspaceId: string, memberships: Array<string | null | undefined>): Promise<string[]> {
  const ids = [...new Set(memberships.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return [];
  return (await db.query<{ userId: string }>(`SELECT DISTINCT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
    [workspaceId, ids])).rows.map((row) => row.userId);
}

async function nameOfUser(db: Db, userId: string | null) {
  if (!userId) return "";
  return (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? "";
}

async function nameOfMember(db: Db, workspaceId: string, membershipId: string | null) {
  if (!membershipId) return "";
  return (await db.query<{ name: string }>(
    `SELECT account.display_name AS name FROM workspace_memberships member JOIN users account ON account.id = member.user_id WHERE member.workspace_id = $1 AND member.id = $2`,
    [workspaceId, membershipId])).rows[0]?.name ?? "";
}

/** One notice to people (by user id), in the app and by email when asked; the person acting is left out. */
async function tell(db: Db, input: { workspaceId: string; userIds: Array<string | null | undefined>; code: string; variables: Record<string, string>; deepLink: string; key: string; email: boolean; except?: string | null }) {
  const users = [...new Set(input.userIds.filter((id): id is string => Boolean(id) && id !== input.except))];
  for (const userId of users) {
    const message = { workspaceId: input.workspaceId, recipientUserId: userId, code: input.code, eventType: input.code, variables: input.variables, deepLink: input.deepLink };
    await notifyUserInApp(db, { ...message, idempotencyKey: `${input.code}:${input.key}:${userId}` });
    if (input.email) await queueUserEmail(db, { ...message, idempotencyKey: `${input.code}:${input.key}:${userId}:email` });
  }
  return users.length;
}

/** A savepoint: a failure rolls back only this work. */
async function inSavepoint<T>(db: Db, work: () => Promise<T>): Promise<T> {
  const name = `value_engineering_${randomUUID().replaceAll("-", "")}`;
  await db.query(`SAVEPOINT ${name}`);
  try {
    const value = await work();
    await db.query(`RELEASE SAVEPOINT ${name}`);
    return value;
  } catch (error) {
    await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await db.query(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}

/** Serialises value engineering on a job (two people acting at once). */
async function lockCase(db: Db, workspaceId: string, caseId: string) {
  const found = await db.query(`SELECT 1 FROM pre_project_cases WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, caseId]);
  if (!found.rowCount) throw new NotFoundException("Planning case not found.");
}

export async function readRounds(db: Db, workspaceId: string, caseId: string): Promise<RoundRow[]> {
  return (await db.query<RoundRow>(`${ROUND_SELECT} WHERE round.workspace_id = $1 AND round.case_id = $2 ORDER BY round.started_at DESC, round.id`, [workspaceId, caseId])).rows;
}

async function readRound(db: Db, workspaceId: string, caseId: string, roundId: string, lock = false): Promise<RoundRow> {
  const row = (await db.query<RoundRow>(`${ROUND_SELECT} WHERE round.workspace_id = $1 AND round.case_id = $2 AND round.id = $3 ${lock ? "FOR UPDATE" : ""}`,
    [workspaceId, caseId, roundId])).rows[0];
  if (!row) throw new NotFoundException("This value engineering round isn't on the job.");
  return row;
}

/** The people a round's notices go to: its lead, its QS (a user), the Account Manager and the client's name. */
async function roundPeople(db: Db, workspaceId: string, round: RoundRow) {
  const facts = await caseFacts(db, workspaceId, round.caseId);
  const lead = (await leadDesigner(db, workspaceId, round.caseId)) ?? round.leadMembershipId;
  return {
    clientName: facts?.clientName ?? "", accountManager: facts?.accountManagerId ?? null, lead, leadName: await nameOfMember(db, workspaceId, lead),
    qsName: await nameOfUser(db, round.qsUserId), qsUserId: round.qsUserId,
  };
}

/** The over-budget line the notices start with, in plain words. */
function whyLine(input: { price: string; currency: string; budget: Money | null; over: string | null; actor: string; title: string }) {
  const price = money(input.currency, input.price);
  if (input.budget && input.over) return `${input.title} is priced at ${price}, ${money(input.currency, input.over)} over the client's budget of ${money(input.budget.currency, input.budget.amount)}`;
  return `${input.actor || "The QS"} flagged ${input.title} at ${price} as over the client's budget`;
}

export type StartInput = { workspaceId: string; caseId: string; quoteId: string; origin: VeOrigin; actorUserId: string; note?: string; qsUserId?: string | null };

/**
 * Opens a value engineering round on an estimate version (one open round per job): the lead designer leads it (the
 * Account Manager on a design job without one, and the notice says so), the QS is the second party, the Account
 * Manager is copied, and Sales hears when the round is past the firm's free rounds. Starting again while a round is
 * open returns it. A job without design work and without a designer keeps the existing flow (refused).
 */
export async function startRound(db: Db, input: StartInput): Promise<{ round: RoundRow; created: boolean }> {
  await lockCase(db, input.workspaceId, input.caseId);
  await settleRounds(db, input.workspaceId, input.caseId);
  const open = (await db.query<RoundRow>(`${ROUND_SELECT} WHERE round.workspace_id = $1 AND round.case_id = $2 AND round.status = 'open'`, [input.workspaceId, input.caseId])).rows[0];
  const quote = await quoteFacts(db, input.workspaceId, input.caseId, input.quoteId);
  if (!quote) throw new NotFoundException("Quote not found.");
  if (open) {
    if (open.familyId === quote.familyId) return { round: open, created: false };
    throw new ConflictException("Value engineering is already open on another estimate of this job.");
  }
  const { lead, designWork, accountManager, facts } = await jobLead(db, input.workspaceId, input.caseId);
  const problem = startProblem({ kind: quote.kind, round: quote.round, status: quote.status, latest: quote.latest }, lead, designWork);
  if (problem) throw new UnprocessableEntityException(problem);
  const budget = await clientBudget(db, input.workspaceId, input.caseId);
  const comparable = budget && budget.currency === quote.currency ? budget : null;
  const over = overBudgetBy(quote.total, quote.currency, comparable);
  const counted = (await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM quote_value_engineering WHERE workspace_id = $1 AND case_id = $2 AND coalesce(outcome, '') <> 'withdrawn'`, [input.workspaceId, input.caseId])).rows[0].count;
  const number = counted + 1;
  const chargeable = roundChargeable(number, await freeRounds(db, input.workspaceId));
  const qsUserId = input.qsUserId ?? (await quoteQs(db, input.workspaceId, input.caseId, input.quoteId)) ?? input.actorUserId;
  const note = (input.note ?? "").trim().slice(0, 2000);
  const id = randomUUID();
  const inserted = await db.query(
    `INSERT INTO quote_value_engineering (id, workspace_id, case_id, quote_id, family_id, quote_number, round, chargeable, origin, currency, quoted_total, budget_amount,
       lead_membership_id, lead_fallback, qs_user_id, note, started_by, started_at, last_moved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::numeric, $12::numeric, $13, $14, $15, $16, $17, clock_timestamp(), clock_timestamp())
     ON CONFLICT (workspace_id, case_id) WHERE status = 'open' DO NOTHING`,
    [id, input.workspaceId, input.caseId, quote.id, quote.familyId, quote.number, number, chargeable, input.origin, quote.currency, quote.total, comparable?.amount ?? null,
      lead!.membershipId, lead!.fallback, qsUserId, note, input.actorUserId]);
  if (!inserted.rowCount) {
    const existing = (await db.query<RoundRow>(`${ROUND_SELECT} WHERE round.workspace_id = $1 AND round.case_id = $2 AND round.status = 'open'`, [input.workspaceId, input.caseId])).rows[0];
    return { round: existing, created: false };
  }
  const round = await readRound(db, input.workspaceId, input.caseId, id);
  const actor = await nameOfUser(db, input.actorUserId);
  const title = await quoteName(db, input.workspaceId, input.caseId, quote);
  const why = whyLine({ price: quote.total, currency: quote.currency, budget: comparable, over, actor, title });
  await recordAudit(db, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "quotation.value_engineering_started.v1", entityType: "pre_project_case", entityId: input.caseId,
    after: { roundId: id, quoteId: quote.id, number: `Round ${number}`, origin: input.origin, chargeable, total: quote.total, currency: quote.currency, budget: comparable?.amount ?? null,
      leadMembershipId: lead!.membershipId, leadFallback: lead!.fallback, note: note || why } });
  const qsName = await nameOfUser(db, qsUserId);
  const leadName = await nameOfMember(db, input.workspaceId, lead!.membershipId);
  const variables = { title, clientName: facts?.clientName ?? "", actor, lead: leadName, qs: qsName || "the QS", why, round: String(number), when: "", place: "", budget: comparable ? money(comparable.currency, comparable.amount) : "", note };
  const deepLink = href(input.caseId, quote.id);
  const [leadUser] = await usersOf(db, input.workspaceId, [lead!.membershipId]);
  // The lead designer: over budget, value engineering to lead (the Account Manager when the job has no lead designer).
  await tell(db, { workspaceId: input.workspaceId, userIds: [leadUser], code: lead!.fallback ? "quotation.value_engineering_no_designer" : "quotation.value_engineering_lead",
    variables, deepLink, key: id, email: true, except: input.actorUserId });
  // The Account Manager is copied for information (they may attend; the design input is the designer's).
  if (!lead!.fallback) await tell(db, { workspaceId: input.workspaceId, userIds: await usersOf(db, input.workspaceId, [accountManager]), code: "quotation.value_engineering_copy",
    variables, deepLink, key: id, email: true, except: input.actorUserId });
  // Past the free rounds: Sales (the Account Manager and the Sales Admin) agree the fee before the work.
  if (chargeable) await tell(db, { workspaceId: input.workspaceId, userIds: await usersOf(db, input.workspaceId, [accountManager, await salesAdminMembership(db, input.workspaceId, input.caseId)]),
    code: "quotation.value_engineering_chargeable", variables, deepLink, key: id, email: true, except: input.actorUserId });
  return { round, created: true };
}

/**
 * PLM-147: after the QS confirms a price, the over-budget check: above the client's recorded budget (in the estimate's
 * currency), a round opens with the QS as the one who started it. Without a recorded budget, under it, on a job that
 * keeps the existing flow (no design work and no designer), while a round is open, or once the client chose to keep
 * this price (a round of this estimate closed with "kept price" at this amount), nothing happens. A changed price still
 * opens one. A failure here never undoes the QS's confirmation.
 */
export async function checkOverBudget(db: Db, input: { workspaceId: string; caseId: string; quoteId: string; actorUserId: string }) {
  try {
    return await inSavepoint(db, async () => {
      const quote = await quoteFacts(db, input.workspaceId, input.caseId, input.quoteId);
      if (!quote || quote.kind !== "quotation" || quote.round === "design") return null;
      const budget = await clientBudget(db, input.workspaceId, input.caseId);
      if (!overBudgetBy(quote.total, quote.currency, budget)) return null;
      const rounds = await readRounds(db, input.workspaceId, input.caseId);
      if (rounds.some((round) => round.status === "open")) return null;
      if (keptPriceStands(rounds, quote)) return null;
      const { lead, designWork } = await jobLead(db, input.workspaceId, input.caseId);
      if (startProblem({ kind: quote.kind, round: quote.round, status: quote.status, latest: quote.latest }, lead, designWork)) return null;
      return (await startRound(db, { ...input, origin: "automatic", qsUserId: input.actorUserId })).round;
    });
  } catch {
    return null;
  }
}

/**
 * Closes the open rounds of a job whose client has decided, from the quotation records (a new version sent, or the
 * version accepted at its price), and keeps each open round's lead on the job's current lead designer (a designer
 * allocated or changed since it started takes it over, and is told).
 */
export async function settleRounds(db: Db, workspaceId: string, caseId: string) {
  const rows = (await db.query<{ id: string; newVersionId: string | null; kept: boolean }>(
    `SELECT round.id, ${NEW_VERSION_SQL} AS "newVersionId", ${KEPT_PRICE_SQL} AS kept
       FROM quote_value_engineering round WHERE round.workspace_id = $1 AND round.case_id = $2 AND round.status = 'open' FOR UPDATE OF round`, [workspaceId, caseId])).rows;
  for (const row of rows) {
    const round = await readRound(db, workspaceId, caseId, row.id);
    if (row.newVersionId || row.kept) {
      const outcome: VeOutcome = row.newVersionId ? "new_version" : "kept_price";
      const quoteId = row.newVersionId ?? round.quoteId;
      const quote = await quoteFacts(db, workspaceId, caseId, quoteId);
      const name = quote ? await quoteName(db, workspaceId, caseId, quote) : quoteId;
      const note = outcome === "new_version" ? `${name} went to the client` : `The client accepted ${name} at its price`;
      await db.query(
        `UPDATE quote_value_engineering SET status = 'closed', outcome = $3, outcome_quote_id = $4, outcome_note = $5, closed_at = clock_timestamp(), version = version + 1, updated_at = now()
          WHERE workspace_id = $1 AND id = $2 AND status = 'open'`, [workspaceId, round.id, outcome, quoteId, note]);
      await recordAudit(db, { workspaceId, actorUserId: null, source: "internal", action: "quotation.value_engineering_closed.v1", entityType: "pre_project_case", entityId: caseId,
        after: { roundId: round.id, number: `Round ${round.round}`, outcome, quoteId, note } });
      continue;
    }
    const { lead } = await jobLead(db, workspaceId, caseId);
    if (lead && lead.membershipId !== round.leadMembershipId && !(lead.fallback && !round.leadFallback)) {
      await db.query(`UPDATE quote_value_engineering SET lead_membership_id = $3, lead_fallback = $4, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, round.id, lead.membershipId, lead.fallback]);
      await recordAudit(db, { workspaceId, actorUserId: null, source: "internal", action: "quotation.value_engineering_reassigned.v1", entityType: "pre_project_case", entityId: caseId,
        before: { leadMembershipId: round.leadMembershipId }, after: { roundId: round.id, number: `Round ${round.round}`, leadMembershipId: lead.membershipId } });
      const quote = await quoteFacts(db, workspaceId, caseId, round.quoteId);
      const people = await roundPeople(db, workspaceId, round);
      const title = quote ? await quoteName(db, workspaceId, caseId, quote) : round.quoteId;
      const why = whyLine({ price: round.quotedTotal, currency: round.currency, budget: round.budgetAmount ? { amount: round.budgetAmount, currency: round.currency } : null,
        over: round.budgetAmount ? overBudgetBy(round.quotedTotal, round.currency, { amount: round.budgetAmount, currency: round.currency }) : null, actor: people.qsName, title });
      await tell(db, { workspaceId, userIds: await usersOf(db, workspaceId, [lead.membershipId]), code: lead.fallback ? "quotation.value_engineering_no_designer" : "quotation.value_engineering_lead",
        variables: { title, clientName: people.clientName, actor: "", lead: await nameOfMember(db, workspaceId, lead.membershipId), qs: people.qsName || "the QS", why, round: String(round.round),
          when: "", place: "", budget: "", note: round.optionsNote ?? "" }, deepLink: href(caseId, round.quoteId), key: `${round.id}:${lead.membershipId}`, email: true });
    }
  }
}

/** Settles a job's rounds after a quotation step (sent, decided), without ever undoing that step. */
export async function settleQuietly(db: Db, workspaceId: string, caseId: string) {
  try { await inSavepoint(db, () => settleRounds(db, workspaceId, caseId)); } catch { /* read again on the next view */ }
}

/** Checks a command's version against the round's; a stale one is refused. */
function checkVersion(round: RoundRow, version: unknown) {
  if (version !== undefined && Number(version) !== round.version) throw new ConflictException("This changed while you were looking. Reload to see the latest.");
}

/** PLM-147: the lead designer records the savings agreed with the QS (marble to porcelain); the QS is told, the Account Manager copied. */
export async function agreeOptions(db: Db, input: { workspaceId: string; caseId: string; roundId: string; version: unknown; note: string; actorUserId: string }) {
  await lockCase(db, input.workspaceId, input.caseId);
  await settleRounds(db, input.workspaceId, input.caseId);
  const round = await readRound(db, input.workspaceId, input.caseId, input.roundId, true);
  if (round.status !== "open") throw new ConflictException("This value engineering round is closed.");
  if (!input.note) throw new BadRequestException("Say which savings you agreed with the QS.");
  if (round.optionsAgreedAt && round.optionsNote === input.note) return round;
  checkVersion(round, input.version);
  await db.query(
    `UPDATE quote_value_engineering SET options_note = $3, options_agreed_at = clock_timestamp(), options_agreed_by = $4, last_moved_at = clock_timestamp(), version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND id = $2`, [input.workspaceId, round.id, input.note, input.actorUserId]);
  await recordAudit(db, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "quotation.value_engineering_options_confirmed.v1", entityType: "pre_project_case",
    entityId: input.caseId, before: round.optionsNote ? { note: round.optionsNote } : undefined, after: { roundId: round.id, number: `Round ${round.round}`, note: input.note } });
  const people = await roundPeople(db, input.workspaceId, round);
  const quote = await quoteFacts(db, input.workspaceId, input.caseId, round.quoteId);
  const variables = { title: quote ? await quoteName(db, input.workspaceId, input.caseId, quote) : round.quoteId, clientName: people.clientName, actor: await nameOfUser(db, input.actorUserId),
    lead: people.leadName, qs: people.qsName, why: "", round: String(round.round), when: "", place: "", budget: "", note: input.note };
  const key = `${round.id}:${round.version + 1}`;
  await tell(db, { workspaceId: input.workspaceId, userIds: [people.qsUserId], code: "quotation.value_engineering_agreed", variables, deepLink: href(input.caseId, round.quoteId), key, email: true, except: input.actorUserId });
  await tell(db, { workspaceId: input.workspaceId, userIds: await usersOf(db, input.workspaceId, [people.accountManager]), code: "quotation.value_engineering_agreed", variables,
    deepLink: href(input.caseId, round.quoteId), key, email: false, except: input.actorUserId });
  return readRound(db, input.workspaceId, input.caseId, round.id);
}

export type MeetingInput = { startsAt: string; endsAt: string; timezone: string; address?: string | null };

/**
 * PLM-147: the value engineering meeting where the designer presents the options to the client, booked as a CRM meeting
 * (so its minutes and the client's confirmation work as on any client meeting): the lead runs it, the QS and the Account
 * Manager are invited. Booking again moves it. The QS and the Account Manager are told.
 */
export async function bookMeeting(db: Db, input: { workspaceId: string; caseId: string; roundId: string; version: unknown; meeting: MeetingInput; actorUserId: string }) {
  await lockCase(db, input.workspaceId, input.caseId);
  await settleRounds(db, input.workspaceId, input.caseId);
  const round = await readRound(db, input.workspaceId, input.caseId, input.roundId, true);
  if (round.status !== "open") throw new ConflictException("This value engineering round is closed.");
  checkVersion(round, input.version);
  const { startsAt, endsAt, timezone } = input.meeting;
  const problem = checkIntroSlot({ startsAt, endsAt, timezone, mode: "in_person" });
  if (problem) throw new UnprocessableEntityException(problem);
  const facts = await caseFacts(db, input.workspaceId, input.caseId);
  if (!facts) throw new NotFoundException("Planning case not found.");
  const people = await roundPeople(db, input.workspaceId, round);
  const owner = people.lead ?? round.leadMembershipId;
  if (!owner) throw new UnprocessableEntityException("Allocate the lead designer first.");
  await assertMemberFree(db, input.workspaceId, owner, startsAt, endsAt, "The lead designer", round.meetingActivityId);
  const attendees = [...new Set([owner, await membershipOf(db, input.workspaceId, round.qsUserId), people.accountManager].filter((id): id is string => Boolean(id)))];
  let activityId = round.meetingActivityId;
  if (!activityId) {
    activityId = (await db.query<{ id: string }>(
      `INSERT INTO crm_activities (workspace_id, party_id, lead_id, opportunity_id, type, interaction_direction, title, owner_membership_id, priority, due_at, is_next_action, customer_visible, created_by)
       VALUES ($1, $2, $3, $4, 'meeting'::crm_activity_type, 'internal', 'Value engineering meeting', $5, 'high', $6, false, false, $7) RETURNING id`,
      [input.workspaceId, facts.partyId, facts.leadId, facts.opportunityId, owner, startsAt, input.actorUserId])).rows[0].id;
  } else {
    await db.query(`UPDATE crm_activities SET owner_membership_id = $3, due_at = $4, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [input.workspaceId, activityId, owner, startsAt]);
  }
  const location = meetingLocation("in_person", input.meeting.address ?? null);
  await db.query(
    `INSERT INTO crm_appointments (workspace_id, activity_id, starts_at, ends_at, timezone, location, attendee_party_ids, attendee_membership_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (workspace_id, activity_id) DO UPDATE SET starts_at = excluded.starts_at, ends_at = excluded.ends_at, timezone = excluded.timezone,
       location = excluded.location, attendee_membership_ids = excluded.attendee_membership_ids, version = crm_appointments.version + 1`,
    [input.workspaceId, activityId, startsAt, endsAt, timezone, location, JSON.stringify([facts.partyId]), JSON.stringify(attendees)]);
  await db.query(`UPDATE quote_value_engineering SET meeting_activity_id = $3, last_moved_at = clock_timestamp(), version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
    [input.workspaceId, round.id, activityId]);
  // The client gets the meeting's confirmation (on the firm's WhatsApp, when it has it on).
  await confirmAppointment(db, input.workspaceId, activityId, { actorUserId: input.actorUserId });
  await recordAudit(db, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "quotation.value_engineering_meeting_booked.v1", entityType: "pre_project_case", entityId: input.caseId,
    after: { roundId: round.id, number: `Round ${round.round}`, activityId, startsAt, endsAt, timezone, attendees } });
  const locale = (await db.query<{ locale: string }>(`SELECT default_locale AS locale FROM workspaces WHERE id = $1`, [input.workspaceId])).rows[0]?.locale ?? "en";
  const quote = await quoteFacts(db, input.workspaceId, input.caseId, round.quoteId);
  const variables = { title: quote ? await quoteName(db, input.workspaceId, input.caseId, quote) : round.quoteId, clientName: people.clientName, actor: await nameOfUser(db, input.actorUserId),
    lead: people.leadName, qs: people.qsName, why: "", round: String(round.round), when: meetingWhen(startsAt, endsAt, timezone, locale), place: location.address ?? "", budget: "", note: "" };
  await tell(db, { workspaceId: input.workspaceId, userIds: [people.qsUserId, ...await usersOf(db, input.workspaceId, [people.accountManager, owner])], code: "quotation.value_engineering_meeting",
    variables, deepLink: href(input.caseId, round.quoteId), key: `${round.id}:${Date.parse(startsAt)}`, email: true, except: input.actorUserId });
  return readRound(db, input.workspaceId, input.caseId, round.id);
}

/** Closes a round by a recorded decision: the client keeps the price, or the round is withdrawn (with a reason). */
export async function closeRound(db: Db, input: { workspaceId: string; caseId: string; roundId: string; version: unknown; outcome: "kept_price" | "withdrawn"; note: string; actorUserId: string }) {
  await lockCase(db, input.workspaceId, input.caseId);
  await settleRounds(db, input.workspaceId, input.caseId);
  const round = await readRound(db, input.workspaceId, input.caseId, input.roundId, true);
  if (round.status !== "open") {
    if (round.outcome === input.outcome) return round;
    throw new ConflictException(round.outcome === "new_version" ? "A new version already went to the client." : "This value engineering round is closed.");
  }
  if (input.outcome === "withdrawn" && !input.note) throw new BadRequestException("Say why value engineering stops.");
  checkVersion(round, input.version);
  const quote = await quoteFacts(db, input.workspaceId, input.caseId, round.quoteId);
  const name = quote ? await quoteName(db, input.workspaceId, input.caseId, quote) : round.quoteId;
  const actor = await nameOfUser(db, input.actorUserId);
  const note = input.outcome === "kept_price"
    ? `${actor} recorded that the client keeps the price of ${name}${input.note ? `: ${input.note}` : ""}`
    : `${actor} stopped value engineering on ${name}: ${input.note}`;
  await db.query(
    `UPDATE quote_value_engineering SET status = 'closed', outcome = $3, outcome_quote_id = $4, outcome_note = $5, closed_at = clock_timestamp(), closed_by = $6, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND id = $2`, [input.workspaceId, round.id, input.outcome, round.quoteId, input.note || null, input.actorUserId]);
  await recordAudit(db, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, entityType: "pre_project_case", entityId: input.caseId,
    action: input.outcome === "kept_price" ? "quotation.value_engineering_decided.v1" : "quotation.value_engineering_withdrawn.v1",
    after: { roundId: round.id, number: `Round ${round.round}`, outcome: input.outcome, quoteId: round.quoteId, note: input.note || (input.outcome === "kept_price" ? "The client keeps the price" : "") } });
  const people = await roundPeople(db, input.workspaceId, round);
  await tell(db, { workspaceId: input.workspaceId, userIds: [people.qsUserId, ...await usersOf(db, input.workspaceId, [people.lead, people.accountManager])], code: "quotation.value_engineering_closed",
    variables: { title: name, clientName: people.clientName, actor, lead: people.leadName, qs: people.qsName, why: "", round: String(round.round), when: "", place: "", budget: "", note },
    deepLink: href(input.caseId, round.quoteId), key: round.id, email: false, except: input.actorUserId });
  return readRound(db, input.workspaceId, input.caseId, round.id);
}

/**
 * The client's budget changed on the brief while a round is open: the lead and the QS hear it (with whether the price
 * now fits). The round keeps the budget it started from; the view shows both.
 */
export async function budgetChanged(db: Db, input: { workspaceId: string; caseId: string; before: Money | null; after: Money | null; actorUserId: string }) {
  if (input.before?.amount === input.after?.amount && input.before?.currency === input.after?.currency) return;
  const round = (await db.query<RoundRow>(`${ROUND_SELECT} WHERE round.workspace_id = $1 AND round.case_id = $2 AND round.status = 'open'`, [input.workspaceId, input.caseId])).rows[0];
  if (!round) return;
  const after = input.after && input.after.currency === round.currency ? input.after : null;
  const fits = after ? !overBudgetBy(round.quotedTotal, round.currency, after) : false;
  await recordAudit(db, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "quotation.value_engineering_budget_changed.v1", entityType: "pre_project_case", entityId: input.caseId,
    before: { budget: input.before?.amount ?? null }, after: { roundId: round.id, number: `Round ${round.round}`, budget: input.after?.amount ?? null, currency: input.after?.currency ?? round.currency } });
  const people = await roundPeople(db, input.workspaceId, round);
  const quote = await quoteFacts(db, input.workspaceId, input.caseId, round.quoteId);
  await tell(db, { workspaceId: input.workspaceId, userIds: [people.qsUserId, ...await usersOf(db, input.workspaceId, [people.lead])], code: "quotation.value_engineering_budget_changed",
    variables: { title: quote ? await quoteName(db, input.workspaceId, input.caseId, quote) : round.quoteId, clientName: people.clientName, actor: await nameOfUser(db, input.actorUserId),
      lead: people.leadName, qs: people.qsName, why: "", round: String(round.round), when: "", place: "",
      budget: input.after ? money(input.after.currency, input.after.amount) : "none", note: fits ? `${money(round.currency, round.quotedTotal)} now fits the budget.` : "" },
    deepLink: href(input.caseId, round.quoteId), key: `${round.id}:budget:${input.after?.amount ?? "none"}`, email: false, except: input.actorUserId });
}

export type RoundView = Omit<RoundRow, "caseId" | "optionsAgreedBy" | "closedBy" | "startedBy" | "lastMovedAt"> & {
  step: VeStep; quoteName: string; outcomeQuoteName: string | null; overBy: string | null; idleSince: Date;
  lead: { membershipId: string | null; name: string; fallback: boolean }; qsName: string; startedByName: string; optionsAgreedByName: string;
  meeting: { activityId: string; startsAt: Date | null; endsAt: Date | null; timezone: string | null; address: string | null; minutes: boolean } | null;
};

/** A round as the quote page and the case show it, with the people's names and where it stands. */
export async function roundView(db: Db, workspaceId: string, round: RoundRow, now = new Date()): Promise<RoundView> {
  const quote = await quoteFacts(db, workspaceId, round.caseId, round.quoteId);
  const outcomeQuote = round.outcomeQuoteId && round.outcomeQuoteId !== round.quoteId ? await quoteFacts(db, workspaceId, round.caseId, round.outcomeQuoteId) : null;
  const meeting = round.meetingActivityId ? (await db.query<{ startsAt: Date | null; endsAt: Date | null; timezone: string | null; location: { address?: string | null } | null; minutes: boolean }>(
    `SELECT appointment.starts_at AS "startsAt", appointment.ends_at AS "endsAt", appointment.timezone, appointment.location,
            EXISTS (SELECT 1 FROM meeting_minutes minutes WHERE minutes.workspace_id = appointment.workspace_id AND minutes.activity_id = appointment.activity_id) AS minutes
       FROM crm_appointments appointment WHERE appointment.workspace_id = $1 AND appointment.activity_id = $2`, [workspaceId, round.meetingActivityId])).rows[0] ?? null : null;
  const lead = round.status === "open" ? (await leadDesigner(db, workspaceId, round.caseId)) ?? round.leadMembershipId : round.leadMembershipId;
  const fallback = round.status === "open" && lead !== round.leadMembershipId ? false : round.leadFallback;
  const { caseId: _case, optionsAgreedBy, closedBy: _closed, startedBy, lastMovedAt, ...rest } = round;
  return {
    ...rest, step: veStep({ status: round.status, optionsAgreedAt: round.optionsAgreedAt, meetingStartsAt: meeting?.startsAt ?? null }, now),
    quoteName: quote ? await quoteName(db, workspaceId, round.caseId, quote) : round.quoteId,
    outcomeQuoteName: outcomeQuote ? await quoteName(db, workspaceId, round.caseId, outcomeQuote) : null,
    overBy: round.budgetAmount ? overBudgetBy(round.quotedTotal, round.currency, { amount: round.budgetAmount, currency: round.currency }) : null,
    idleSince: idleSince(new Date(lastMovedAt), meeting?.endsAt ? new Date(meeting.endsAt) : null),
    lead: { membershipId: lead, name: await nameOfMember(db, workspaceId, lead), fallback },
    qsName: await nameOfUser(db, round.qsUserId), startedByName: await nameOfUser(db, startedBy), optionsAgreedByName: await nameOfUser(db, optionsAgreedBy),
    meeting: round.meetingActivityId && meeting ? { activityId: round.meetingActivityId, startsAt: meeting.startsAt, endsAt: meeting.endsAt, timezone: meeting.timezone,
      address: meeting.location?.address ?? null, minutes: meeting.minutes } : null,
  };
}
