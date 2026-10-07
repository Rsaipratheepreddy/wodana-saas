import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { recordAudit } from "../../audit/record-audit";
import { approvalStatus, canDecideApproval, cancelApproval, decideApproval, requestApproval, tellApprovers } from "../../approvals/approval-engine";
import type { ApprovalStatus } from "../../approvals/approval-policy";
import { currencyDecimals } from "../../common/currency";
import { PARTY_TYPES, type BooksPartyType } from "../books-contract";
import { postingDate, readBooksSettings, resolveRole, type BooksSettings } from "../ledger/ledger";
import {
  addDays, amount, BOOKS, checkVersion, day, firstTime, format, oneOf, optionalUuid, readCompany, requireAny, text, units, uuid, versionOf,
  type BooksCtx, type Company, type Db,
} from "../settings/books-common";
import { applyManualJournalDecision } from "./manual-journal-approval";
import { journalLink, readJournalRows, readLines, type ManualJournalRow } from "./manual-journal-store";
import { parseOpening, type RowError } from "./opening-balances";

/**
 * Manual and opening journals (plan §6.21b P15): a preparer (books.post) drafts the lines, submits them, and someone
 * else holding books.approve approves through the approval engine (E3), which puts it in the Approvals inbox on the
 * web and the phone. Approval posts it with `postJournal` and its JV number; a return sends it back with the reason.
 * Opening balances come from a trial balance file and post against the company's start date, on control accounts too.
 * Every command is checked, runs once by its id, is version-checked and audited.
 */

export const JOURNAL_ACTIONS = ["save", "submit", "approve", "return", "cancel", "import_opening"] as const;
export type JournalAction = (typeof JOURNAL_ACTIONS)[number];
export const MAX_LINES = 500;

const READERS = [BOOKS.view, BOOKS.post, BOOKS.approve, BOOKS.manage];

/** The company's manual and opening journals, newest first. */
export async function listJournals(db: Db, ctx: BooksCtx, query: Record<string, unknown>) {
  await requireAny(ctx, READERS, "You don't have access to the Ledger.");
  const legalEntityId = optionalUuid(query.legalEntityId, "Company") ?? undefined;
  const status = typeof query.status === "string" && query.status ? oneOf(query.status, ["draft", "submitted", "returned", "approved", "cancelled"] as const, "Unknown status.") : undefined;
  return { journals: await readJournalRows(db, ctx.workspaceId, { legalEntityId, status }), canPost: await ctx.can(BOOKS.post), me: ctx.userId };
}

/** One journal with its lines, its approval and what this person may do with it. */
export async function readJournal(db: Db, ctx: BooksCtx, id: string) {
  await requireAny(ctx, READERS, "You don't have access to the Ledger.");
  const journal = (await readJournalRows(db, ctx.workspaceId, { id: uuid(id, "Journal") }))[0];
  if (!journal) throw new NotFoundException("Journal not found.");
  const approval = await approvalStatus(db, ctx.workspaceId, "manual_journal", journal.id);
  const eligibility = approval?.status === "pending" ? await canDecideApproval(db, ctx.workspaceId, approval.id, ctx.userId) : null;
  const mine = journal.preparedBy === ctx.userId;
  const post = await ctx.can(BOOKS.post);
  const editable = journal.status === "draft" || journal.status === "returned";
  return {
    journal, lines: await readLines(db, ctx.workspaceId, journal.id), approval,
    canEdit: editable && mine && post,
    canSubmit: editable && mine && post,
    canApprove: journal.status === "submitted" && !mine && Boolean(eligibility?.canDecide && eligibility.via !== "waiver"),
    canCancel: (editable || journal.status === "submitted") && ((mine && post) || await ctx.can(BOOKS.manage)),
  };
}

/** What the editor offers for one company: open accounts, projects and parties for the dimensions. */
export async function journalOptions(db: Db, ctx: BooksCtx, query: Record<string, unknown>) {
  await requireAny(ctx, [BOOKS.post, BOOKS.approve, BOOKS.manage], "You don't prepare journals.");
  const ws = ctx.workspaceId;
  const company = await readCompany(db, ws, uuid(query.legalEntityId, "Company"));
  const settings = await readBooksSettings(db, ws, company.id);
  const accounts = (await db.query<{ id: string; code: string; name: string; type: string; isControl: boolean; allowManual: boolean }>(
    `SELECT id, code, name, type, is_control AS "isControl", allow_manual AS "allowManual" FROM books_accounts
      WHERE workspace_id = $1 AND legal_entity_id = $2 AND archived_at IS NULL ORDER BY code`, [ws, company.id])).rows;
  const projects = (await db.query<{ id: string; name: string }>(
    `SELECT id, concat_ws(' · ', reference, name) AS name FROM delivery_projects WHERE workspace_id = $1 AND status <> 'archived' ORDER BY reference NULLS LAST, name LIMIT 1000`,
    [ws])).rows;
  const parties = [
    ...(await db.query<{ id: string; name: string }>(
      `SELECT id, display_name AS name FROM crm_parties WHERE workspace_id = $1 AND merged_into_party_id IS NULL AND archived_at IS NULL ORDER BY display_name LIMIT 2000`, [ws])).rows
      .map((row) => ({ type: "client" as const, ...row })),
    ...(await db.query<{ id: string; name: string }>(`SELECT id, display_name AS name FROM workspace_vendors WHERE workspace_id = $1 ORDER BY display_name LIMIT 2000`, [ws])).rows
      .map((row) => ({ type: "vendor" as const, ...row })),
    ...(await db.query<{ id: string; name: string }>(
      `SELECT person.id, coalesce(nullif(btrim(person.display_name), ''), person.primary_email) AS name FROM workspace_memberships membership
         JOIN users person ON person.id = membership.user_id WHERE membership.workspace_id = $1 AND membership.status = 'active' ORDER BY 2`, [ws])).rows
      .map((row) => ({ type: "employee" as const, ...row })),
  ];
  return {
    company: { id: company.id, name: company.name, currency: settings?.functionalCurrency ?? company.baseCurrency, decimals: currencyDecimals(settings?.functionalCurrency ?? company.baseCurrency) },
    settings: settings ? { enabled: settings.enabled, startDate: settings.startDate, lockDate: settings.lockDate } : null,
    accounts, projects, parties,
  };
}

// ---------------------------------------------------------------- lines

export type LineInput = {
  accountId: string; debit: string; credit: string; description: string; projectId: string | null; party: { type: BooksPartyType; id: string } | null; taxCodeId: string | null;
};

type AccountFacts = { id: string; code: string; name: string; isControl: boolean; allowManual: boolean; archived: boolean };

/** The lines as sent: each an account of the company with a debit or a credit, its description and dimensions. */
export function parseLines(value: unknown): LineInput[] {
  if (!Array.isArray(value)) throw new BadRequestException("Add the journal's lines.");
  if (value.length > MAX_LINES) throw new BadRequestException(`A journal has at most ${MAX_LINES} lines.`);
  return value.map((raw, index) => {
    const line = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const where = `Line ${index + 1}`;
    const debit = amount(line.debit, where), credit = amount(line.credit, where);
    if ((units(debit) > 0n) === (units(credit) > 0n)) throw new BadRequestException(`${where}: enter a debit or a credit.`);
    const party = line.party && typeof line.party === "object" ? line.party as Record<string, unknown> : null;
    return {
      accountId: uuid(line.accountId, `${where} account`),
      debit, credit,
      description: text(line.description, 500, `${where} description`),
      projectId: optionalUuid(line.projectId, `${where} project`),
      party: party && party.id ? { type: oneOf(party.type, PARTY_TYPES, `${where}: choose who it is about.`), id: uuid(party.id, `${where} party`) } : null,
      taxCodeId: optionalUuid(line.taxCodeId, `${where} tax code`),
    };
  });
}

export function totals(lines: Array<Pick<LineInput, "debit" | "credit">>) {
  const debit = lines.reduce((sum, line) => sum + units(line.debit), 0n);
  const credit = lines.reduce((sum, line) => sum + units(line.credit), 0n);
  return { debit, credit, balanced: debit === credit && debit > 0n };
}

/**
 * The lines against the company's records: open accounts (a manual journal never touches an account posted only by
 * its own records, such as receivables and payables; an opening balance may), projects and parties that exist,
 * and the company's tax codes.
 */
async function checkLines(db: Db, ws: string, legalEntityId: string, kind: "manual" | "opening", lines: LineInput[]) {
  const ids = [...new Set(lines.map((line) => line.accountId))];
  const accounts = new Map((await db.query<AccountFacts>(
    `SELECT id, code, name, is_control AS "isControl", allow_manual AS "allowManual", archived_at IS NOT NULL AS archived FROM books_accounts
      WHERE workspace_id = $1 AND legal_entity_id = $2 AND id = ANY($3::uuid[])`, [ws, legalEntityId, ids])).rows.map((row) => [row.id, row]));
  const exists = async (sql: string, values: unknown[]) => Boolean((await db.query(sql, values)).rowCount);
  for (const [index, line] of lines.entries()) {
    const where = `Line ${index + 1}`;
    const account = accounts.get(line.accountId);
    if (!account) throw new UnprocessableEntityException(`${where}: choose one of this company's accounts.`);
    if (account.archived) throw new UnprocessableEntityException(`${where}: account ${account.code} is archived.`);
    if (kind === "manual" && !account.allowManual) throw new UnprocessableEntityException(`${where}: ${account.code} ${account.name} is posted only by its own records.`);
    if (line.projectId && !await exists(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [ws, line.projectId])) {
      throw new UnprocessableEntityException(`${where}: choose a project of this workspace.`);
    }
    if (line.party) {
      const table = { client: `SELECT 1 FROM crm_parties WHERE workspace_id = $1 AND id = $2`, vendor: `SELECT 1 FROM workspace_vendors WHERE workspace_id = $1 AND id = $2`,
        employee: `SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`, team: `SELECT 1 FROM hrms_crews WHERE workspace_id = $1 AND id = $2` }[line.party.type];
      if (!await exists(table, [ws, line.party.id])) throw new UnprocessableEntityException(`${where}: choose who it is about from the list.`);
    }
    if (line.taxCodeId && !await exists(`SELECT 1 FROM books_tax_codes WHERE workspace_id = $1 AND legal_entity_id = $2 AND id = $3`, [ws, legalEntityId, line.taxCodeId])) {
      throw new UnprocessableEntityException(`${where}: choose one of this company's tax codes.`);
    }
  }
}

async function writeLines(db: Db, ws: string, legalEntityId: string, journalId: string, lines: LineInput[]) {
  await db.query(`DELETE FROM books_manual_journal_lines WHERE workspace_id = $1 AND manual_journal_id = $2`, [ws, journalId]);
  for (const [position, line] of lines.entries()) {
    await db.query(
      `INSERT INTO books_manual_journal_lines (workspace_id, legal_entity_id, manual_journal_id, position, account_id, debit, credit, description, project_id,
                                               party_type, party_id, tax_code_id)
       VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8, $9, $10, $11, $12)`,
      [ws, legalEntityId, journalId, position, line.accountId, line.debit, line.credit, line.description, line.projectId, line.party?.type ?? null, line.party?.id ?? null,
        line.taxCodeId]);
  }
}

// ---------------------------------------------------------------- commands

/** One journal command, once by its id. Returns the journal's id. */
export async function runJournalCommand(db: Db, ctx: BooksCtx, body: Record<string, unknown>): Promise<string> {
  const action = oneOf(body.action, JOURNAL_ACTIONS, "Unknown action.");
  const id = uuid(body.id, "Journal");
  const commandId = uuid(body.commandId, "Command");
  if (action === "approve" || action === "return") await requireAny(ctx, [BOOKS.approve], "Only Ledger approvers decide journals.");
  else if (action === "cancel") await requireAny(ctx, [BOOKS.post, BOOKS.manage], "You don't prepare journals.");
  else await requireAny(ctx, [BOOKS.post], "You don't prepare journals.");
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('books-manual-journal:' || $1::text, 0))`, [id]);
  if (!(await firstTime(db, ctx, commandId, action, id))) return id;
  if (action === "save") await save(db, ctx, id, body);
  else if (action === "import_opening") await importOpening(db, ctx, id, body);
  else if (action === "submit") await submit(db, ctx, id, body);
  else if (action === "approve" || action === "return") await decide(db, ctx, id, action, body, commandId);
  else await cancel(db, ctx, id, body);
  return id;
}

async function enabledSettings(db: Db, ws: string, company: Company): Promise<BooksSettings> {
  const settings = await readBooksSettings(db, ws, company.id);
  if (!settings?.enabled) throw new ConflictException("The Ledger is not on for this company.");
  return settings;
}

async function nextReference(db: Db, ws: string) {
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('books-manual-journal-number:' || $1::text, 0))`, [ws]);
  const next = (await db.query<{ next: string }>(
    `SELECT (coalesce(max(substring(reference FROM 4)::bigint), 0) + 1)::text AS next FROM books_manual_journals WHERE workspace_id = $1`, [ws])).rows[0].next;
  return `MJ-${next}`;
}

function auditable(journal: ManualJournalRow) {
  return { reference: journal.reference, kind: journal.kind, legalEntityId: journal.legalEntityId, journalDate: journal.journalDate, currency: journal.currency,
    status: journal.status, debit: journal.debit, credit: journal.credit, lines: journal.lineCount, memo: journal.memo };
}

const audit = (db: Db, ctx: BooksCtx, action: string, id: string, before: unknown, after: unknown) =>
  recordAudit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action, entityType: "books_manual_journal", entityId: id, before: before ?? null, after });

async function lockJournal(db: Db, ws: string, id: string, version: unknown) {
  const journal = (await readJournalRows(db, ws, { id, forUpdate: true }))[0];
  if (!journal) throw new NotFoundException("Journal not found.");
  checkVersion(journal.version, versionOf(version), `${journal.reference}`);
  return journal;
}

/** Creates a draft (version 0) or changes a draft or returned journal: its company, date, currency, memo and lines. Only its preparer edits it. */
async function save(db: Db, ctx: BooksCtx, id: string, body: Record<string, unknown>) {
  const ws = ctx.workspaceId;
  const existing = (await readJournalRows(db, ws, { id, forUpdate: true }))[0];
  const company = await readCompany(db, ws, uuid(body.legalEntityId ?? existing?.legalEntityId, "Company"));
  const settings = await enabledSettings(db, ws, company);
  const journalDate = day(body.journalDate, "Journal date");
  const currency = typeof body.currency === "string" && body.currency ? body.currency.trim().toUpperCase() : settings.functionalCurrency;
  if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException("Choose the currency.");
  const memo = text(body.memo, 1000, "Memo");
  const lines = parseLines(body.lines);
  if (existing) {
    checkVersion(existing.version, versionOf(body.version), existing.reference);
    if (existing.kind !== "manual") throw new ConflictException("Opening balances are changed by importing the file again.");
    if (existing.preparedBy !== ctx.userId) throw new ForbiddenException("Only who prepared this journal changes it.");
    if (existing.status !== "draft" && existing.status !== "returned") throw new ConflictException(`${existing.reference} is ${existing.status} and can't change.`);
    if (existing.legalEntityId !== company.id) throw new ConflictException("A journal stays with its company.");
  } else if (versionOf(body.version ?? 0) !== 0) throw new NotFoundException("Journal not found.");
  await checkLines(db, ws, company.id, "manual", lines);
  if (existing) {
    await db.query(`UPDATE books_manual_journals SET journal_date = $3, currency = $4, memo = $5, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
      [ws, id, journalDate, currency, memo]);
  } else {
    await db.query(
      `INSERT INTO books_manual_journals (id, workspace_id, legal_entity_id, reference, kind, journal_date, currency, memo, prepared_by)
       VALUES ($1, $2, $3, $4, 'manual', $5, $6, $7, $8)`, [id, ws, company.id, await nextReference(db, ws), journalDate, currency, memo, ctx.userId]);
  }
  await writeLines(db, ws, company.id, id, lines);
  const after = (await readJournalRows(db, ws, { id }))[0];
  await audit(db, ctx, existing ? "books.manual_journal_changed" : "books.manual_journal_drafted", id, existing ? auditable(existing) : null, auditable(after));
}

/** Why a journal can't be submitted on its date (null when it can): before the start, or on or before the lock date. */
export function dateProblem(settings: Pick<BooksSettings, "startDate" | "lockDate">, journalDate: string) {
  const date = postingDate(settings, journalDate, { allowLate: false });
  if (!("refused" in date)) return null;
  return date.refused === "locked" ? `The books are locked up to ${settings.lockDate}. Date it after that.` : `The Ledger starts on ${settings.startDate}. Date it on or after that.`;
}

/**
 * Sends a journal for approval: at least two lines that balance, accounts still open and allowed, a date the books
 * aren't locked on. It goes to the approval engine (Ledger approvers, never its preparer) and the Approvals inbox.
 */
async function submit(db: Db, ctx: BooksCtx, id: string, body: Record<string, unknown>) {
  const ws = ctx.workspaceId;
  const journal = await lockJournal(db, ws, id, body.version);
  if (journal.preparedBy !== ctx.userId) throw new ForbiddenException("Only who prepared this journal submits it.");
  if (journal.status !== "draft" && journal.status !== "returned") throw new ConflictException(`${journal.reference} is ${journal.status}.`);
  await submitJournal(db, ctx, journal);
}

async function submitJournal(db: Db, ctx: BooksCtx, journal: ManualJournalRow) {
  const ws = ctx.workspaceId;
  const company = await readCompany(db, ws, journal.legalEntityId);
  const settings = await enabledSettings(db, ws, company);
  const lines = (await readLines(db, ws, journal.id)).map((line): LineInput => ({ accountId: line.accountId, debit: line.debit, credit: line.credit, description: line.description,
    projectId: line.projectId, party: line.partyType && line.partyId ? { type: line.partyType, id: line.partyId } : null, taxCodeId: line.taxCodeId }));
  if (lines.length < 2) throw new UnprocessableEntityException("A journal needs at least two lines.");
  const sum = totals(lines);
  if (!sum.balanced) throw new UnprocessableEntityException(`Debits ${format(sum.debit)} and credits ${format(sum.credit)} don't balance.`);
  const problem = dateProblem(settings, journal.journalDate);
  if (problem) throw new UnprocessableEntityException({ message: problem, code: problem.startsWith("The books are locked") ? "locked" : "before_start" });
  await checkLines(db, ws, company.id, journal.kind, lines);
  const total = format(sum.debit);
  const status = await requestApproval(db, {
    workspaceId: ws, kind: "manual_journal", subjectId: journal.id, title: journalTitle(journal), href: journalLink(journal.id),
    amount: total, currency: journal.currency, requesterUserId: ctx.userId,
  });
  await db.query(`UPDATE books_manual_journals SET status = 'submitted', submitted_at = now(), returned_reason = NULL, approval_request_id = $3, version = version + 1, updated_at = now()
    WHERE workspace_id = $1 AND id = $2`, [ws, journal.id, status.id]);
  await audit(db, ctx, "books.manual_journal_submitted", journal.id, { status: journal.status }, { ...auditable(journal), status: "submitted", approvalId: status.id, total });
  // A policy that needs nobody (none in the product defaults) approves at once: the journal posts now.
  if (status.status === "approved") await applyManualJournalDecision(db, ws, status, "approve", ctx.userId, null);
}

export function journalTitle(journal: Pick<ManualJournalRow, "reference" | "kind" | "companyName" | "memo">) {
  return [journal.reference, journal.kind === "opening" ? "Opening balances" : "Manual journal", journal.companyName, journal.memo].filter(Boolean).join(" · ").slice(0, 300);
}

/** A Ledger approver decides it here (or in the Approvals inbox): approved, it posts; returned, it goes back with the reason. Never its preparer. */
async function decide(db: Db, ctx: BooksCtx, id: string, action: "approve" | "return", body: Record<string, unknown>, commandId: string) {
  const ws = ctx.workspaceId;
  const journal = await lockJournal(db, ws, id, body.version);
  if (journal.preparedBy === ctx.userId) throw new ForbiddenException("You prepared this journal; someone else approves it.");
  if (journal.status !== "submitted") throw new ConflictException(`${journal.reference} is ${journal.status}.`);
  const note = text(body.note, 1000, "Note", action === "return");
  const decision = action === "approve" ? "approve" : "return";
  const status: ApprovalStatus = await decideApproval(db, { workspaceId: ws, kind: "manual_journal", subjectId: id, deciderUserId: ctx.userId, decision, note: note || null,
    commandId, notify: false });
  if (status.status === "pending") await tellApprovers(db, ws, status, ctx.userId);
  await applyManualJournalDecision(db, ws, status, decision, ctx.userId, note || null);
}

/** Withdraws a journal that hasn't posted: by its preparer, or someone who sets up the Ledger. Its open approval is withdrawn too. */
async function cancel(db: Db, ctx: BooksCtx, id: string, body: Record<string, unknown>) {
  const ws = ctx.workspaceId;
  const journal = await lockJournal(db, ws, id, body.version);
  if (journal.preparedBy !== ctx.userId && !(await ctx.can(BOOKS.manage))) throw new ForbiddenException("Only who prepared this journal cancels it.");
  if (!["draft", "returned", "submitted"].includes(journal.status)) throw new ConflictException(`${journal.reference} is ${journal.status}.`);
  const reason = text(body.reason, 1000, "Reason") || "Cancelled";
  if (journal.status === "submitted") await cancelApproval(db, { workspaceId: ws, kind: "manual_journal", subjectId: id, actorUserId: ctx.userId, reason });
  await db.query(`UPDATE books_manual_journals SET status = 'cancelled', cancelled_at = now(), version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [ws, id]);
  await audit(db, ctx, "books.manual_journal_cancelled", id, { status: journal.status }, { ...auditable(journal), status: "cancelled", reason });
}

// ---------------------------------------------------------------- opening balances

export type OpeningPreview = {
  lines: Array<{ row: number; accountId: string | null; code: string; name: string; debit: string; credit: string }>;
  errors: RowError[];
  debit: string;
  credit: string;
  balanced: boolean;
  journalDate: string | null;
  asAt: string | null;
};

/**
 * A trial balance file read against the company's chart: every code must be one of its open accounts (an unknown
 * code is refused with its row number) and the debits must equal the credits; the difference names the opening
 * balance equity account to put it in.
 */
export async function previewOpening(db: Db, ctx: BooksCtx, body: Record<string, unknown>): Promise<OpeningPreview> {
  await requireAny(ctx, [BOOKS.post], "You don't prepare journals.");
  const ws = ctx.workspaceId;
  const company = await readCompany(db, ws, uuid(body.legalEntityId, "Company"));
  const settings = await readBooksSettings(db, ws, company.id);
  if (typeof body.csv !== "string") throw new BadRequestException("Choose the trial balance file.");
  const parsed = parseOpening(body.csv);
  const errors = [...parsed.errors];
  const codes = [...new Set(parsed.rows.map((row) => row.code.toLowerCase()))];
  const accounts = new Map((await db.query<{ id: string; code: string; name: string; archived: boolean }>(
    `SELECT id, code, name, archived_at IS NOT NULL AS archived FROM books_accounts WHERE workspace_id = $1 AND legal_entity_id = $2 AND lower(code) = ANY($3::text[])`,
    [ws, company.id, codes])).rows.map((row) => [row.code.toLowerCase(), row]));
  const lines: OpeningPreview["lines"] = [];
  for (const row of parsed.rows) {
    const account = accounts.get(row.code.toLowerCase());
    if (!account) errors.push({ row: row.row, message: `There is no account ${row.code}` });
    else if (account.archived) errors.push({ row: row.row, message: `Account ${account.code} is archived` });
    lines.push({ row: row.row, accountId: account && !account.archived ? account.id : null, code: account?.code ?? row.code, name: account?.name ?? row.description,
      debit: row.debit, credit: row.credit });
  }
  const debit = units(parsed.debit), credit = units(parsed.credit);
  if (parsed.rows.length && debit !== credit) {
    const equity = settings ? await resolveRole(db, ws, company.id, "opening_balance_equity") : null;
    const difference = format(debit > credit ? debit - credit : credit - debit);
    errors.push({ row: null, message: `Debits ${format(debit)} and credits ${format(credit)} differ by ${difference}.${equity ? ` Add the difference to ${equity.code} ${equity.name}.` : ""}` });
  }
  errors.sort((left, right) => (left.row ?? Number.MAX_SAFE_INTEGER) - (right.row ?? Number.MAX_SAFE_INTEGER));
  return {
    lines, errors, debit: parsed.debit, credit: parsed.credit, balanced: parsed.rows.length > 0 && debit === credit,
    journalDate: settings?.startDate ?? null, asAt: settings ? addDays(settings.startDate, -1) : null,
  };
}

/**
 * Opening balances: the file's rows become an opening journal dated the company's start date (the balances as at
 * the day before), submitted for approval at once. One set per company: a returned set is replaced by importing again.
 */
async function importOpening(db: Db, ctx: BooksCtx, id: string, body: Record<string, unknown>) {
  const ws = ctx.workspaceId;
  const preview = await previewOpening(db, ctx, body);
  if (preview.errors.length) {
    throw new UnprocessableEntityException({ message: preview.errors[0].row ? `Row ${preview.errors[0].row}: ${preview.errors[0].message}.` : preview.errors[0].message, errors: preview.errors });
  }
  const company = await readCompany(db, ws, uuid(body.legalEntityId, "Company"));
  const settings = await enabledSettings(db, ws, company);
  const problem = dateProblem(settings, settings.startDate);
  if (problem) throw new UnprocessableEntityException({ message: `Opening balances post on the start date, ${settings.startDate}. ${problem}`, code: "locked" });
  const existing = (await readJournalRows(db, ws, { id, forUpdate: true }))[0];
  const other = (await db.query<{ id: string; reference: string; status: string }>(
    `SELECT id, reference, status FROM books_manual_journals WHERE workspace_id = $1 AND legal_entity_id = $2 AND kind = 'opening' AND status <> 'cancelled' AND id <> $3 LIMIT 1`,
    [ws, company.id, id])).rows[0];
  if (other) throw new ConflictException(other.status === "approved" ? `The opening balances are posted (${other.reference}).` : `The opening balances are already in ${other.reference}.`);
  if (existing) {
    checkVersion(existing.version, versionOf(body.version), existing.reference);
    if (existing.kind !== "opening" || existing.preparedBy !== ctx.userId || existing.status !== "returned") throw new ConflictException(`${existing.reference} can't take a new file.`);
  }
  const lines: LineInput[] = preview.lines.map((line) => ({ accountId: line.accountId!, debit: line.debit, credit: line.credit, description: "", projectId: null, party: null, taxCodeId: null }));
  const memo = text(body.memo, 1000, "Memo") || `Opening balances at ${preview.asAt}`;
  if (existing) {
    await db.query(`UPDATE books_manual_journals SET journal_date = $3, memo = $4, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
      [ws, id, settings.startDate, memo]);
  } else {
    await db.query(
      `INSERT INTO books_manual_journals (id, workspace_id, legal_entity_id, reference, kind, journal_date, currency, memo, prepared_by)
       VALUES ($1, $2, $3, $4, 'opening', $5, $6, $7, $8)`, [id, ws, company.id, await nextReference(db, ws), settings.startDate, settings.functionalCurrency, memo, ctx.userId]);
  }
  await writeLines(db, ws, company.id, id, lines);
  const journal = (await readJournalRows(db, ws, { id }))[0];
  await audit(db, ctx, "books.opening_imported", id, existing ? auditable(existing) : null, { ...auditable(journal), rows: lines.length });
  await submitJournal(db, ctx, journal);
}
