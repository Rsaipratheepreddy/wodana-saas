import type { PoolClient } from "pg";
import { currencyDecimals } from "../../common/currency";
import { ACCOUNT_ROLES, type AccountRole, type BooksPartyType, type BooksSourceType, type JournalKind, type PostingIssueCode, PARTY_TYPES } from "../books-contract";

/**
 * The Ledger core (plan §6.21b): the one way a journal is written. Every posting rule, manual journal and opening
 * balance goes through `postJournal`, which checks the company, dates, accounts and balance, converts to the
 * functional currency, rounds, numbers the journal gap-free and makes a re-post of the same source event return
 * the journal already there.
 */

export type Db = Pick<PoolClient, "query">;

export type BooksSettings = {
  workspaceId: string;
  legalEntityId: string;
  enabled: boolean;
  startDate: string;
  lockDate: string | null;
  functionalCurrency: string;
  fiscalYearStartMonth: number;
  templateCode: string | null;
  templateVersion: number | null;
  revenueRecognition: "invoice";
  taxPointOnPayment: boolean;
  vatRegion: string | null;
  version: number;
};

/** An account by the role it plays for the company, or by id (it must belong to the journal's company). */
export type AccountRef = { role: AccountRole } | { accountId: string };

export type DraftLine = {
  account: AccountRef;
  side: "debit" | "credit";
  /** In the journal's document currency, > 0, at most 4 decimals. */
  amount: string;
  /** The exact functional amount (reversals, or a settlement at a known amount): used as is instead of converting. */
  functionalAmount?: string;
  description?: string;
  projectId?: string | null;
  caseId?: string | null;
  businessUnitId?: string | null;
  party?: { type: BooksPartyType; id: string } | null;
  taxCodeId?: string | null;
  /** The base the tax was charged on, in the document currency (converted like the amount). */
  taxBase?: string | null;
  /** The base in the functional currency, used as is (reversals). */
  functionalTaxBase?: string | null;
  taxRegion?: string | null;
};

export type JournalSource = { type: BooksSourceType | string; id: string; event: string; label?: string; href?: string };

export type JournalDraft = {
  legalEntityId: string;
  /** auto (default), manual, opening; reversal when `reversesJournalId` is given. */
  kind?: JournalKind;
  /** The day the event happened (YYYY-MM-DD). The journal date follows from it (`postingDate`). */
  eventDate: string;
  source: JournalSource;
  /** The document currency of the lines' amounts. */
  currency: string;
  /** Functional units per document unit. Looked up in exchange_rates on the event date when absent. */
  rate?: string;
  description?: string;
  lines: DraftLine[];
  reversesJournalId?: string | null;
  postedBy?: string | null;
};

export type PostedJournal = {
  id: string;
  legalEntityId: string;
  number: string;
  journalDate: string;
  eventDate: string;
  late: boolean;
  kind: JournalKind;
  sourceType: string;
  sourceId: string;
  sourceEvent: string;
  sourceLabel: string;
  sourceHref: string;
  description: string;
  currency: string;
  functionalCurrency: string;
  rate: string;
  total: string;
  reversesJournalId: string | null;
  postedBy: string | null;
  postedAt: string;
};

export type PostedLine = {
  id: string;
  journalId: string;
  position: number;
  accountId: string;
  debit: string;
  credit: string;
  docAmount: string | null;
  description: string;
  projectId: string | null;
  caseId: string | null;
  businessUnitId: string | null;
  partyType: BooksPartyType | null;
  partyId: string | null;
  taxCodeId: string | null;
  taxBase: string | null;
  taxRegion: string | null;
};

export type PostOutcome =
  | { status: "posted"; journal: PostedJournal }
  | { status: "existing"; journal: PostedJournal }
  | { status: "issue"; code: PostingIssueCode; detail: string }
  | { status: "skipped"; reason: "before_start" };

export type LedgerErrorCode =
  | PostingIssueCode
  | "unbalanced" | "invalid_amount" | "invalid_line" | "invalid_date" | "invalid_source" | "manual_not_allowed" | "locked" | "before_start"
  | "invalid_reversal" | "unknown_template" | "invalid_template" | "template_conflict" | "unknown_entity";

/** A draft that can never post as written (a bug in the caller, or a manual journal to correct). */
export class LedgerError extends Error {
  constructor(readonly code: LedgerErrorCode, message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

/** A source event that isn't ready to post (recorded as a posting issue and retried by the sweep). */
export type PostingIssueResult = { issue: PostingIssueCode; detail: string };

/** One event a source adapter has to post: its unique source key, the company (when known) and the day. */
export type PendingEvent = {
  sourceType: BooksSourceType;
  sourceId: string;
  sourceEvent: string;
  legalEntityId: string | null;
  eventDate: string;
  label?: string;
  href?: string;
};

/**
 * One source of journals (P1 to P15). The sweep asks each adapter for the events that have no journal yet
 * (an anti-join on the journal source key), builds each one and posts it with `postJournal`.
 */
export interface PostingAdapter<E extends PendingEvent = PendingEvent> {
  readonly sourceType: BooksSourceType;
  /** Events not yet posted for the enabled companies, oldest first, at most `limit`. */
  pending(db: Db, workspaceId: string, settings: readonly BooksSettings[], limit: number): Promise<E[]>;
  /** The journal draft for one event, or the issue that keeps it from posting yet. */
  build(db: Db, workspaceId: string, event: E): Promise<JournalDraft | PostingIssueResult>;
}

// ---------------------------------------------------------------------------------------------------------------
// Exact decimals (BigInt). Amounts are carried as units of 10^-4, the scale of every money column.

const SCALE = 4;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function parseDecimal(text: string): { units: bigint; scale: number } {
  const match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(String(text).trim());
  if (!match) throw new LedgerError("invalid_amount", `"${text}" is not a decimal number`);
  const [, sign, whole, fraction = ""] = match;
  const units = BigInt(whole + fraction);
  return { units: sign === "-" ? -units : units, scale: fraction.length };
}

/** Divides and rounds half away from zero. */
function divRound(numerator: bigint, denominator: bigint) {
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  let q = n / d;
  if ((n % d) * 2n >= d) q += 1n;
  return negative ? -q : q;
}

/** Exact units of 10^-4; refuses more than 4 decimals. */
function units4(text: string, what = "Amount"): bigint {
  const { units, scale } = parseDecimal(text);
  if (scale > SCALE) throw new LedgerError("invalid_amount", `${what} ${text} has more than ${SCALE} decimals`);
  return units * 10n ** BigInt(SCALE - scale);
}

function format4(units: bigint) {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / 10n ** BigInt(SCALE);
  const fraction = (abs % 10n ** BigInt(SCALE)).toString().padStart(SCALE, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** amount × rate rounded (half away from zero) to `places` decimals, as units of 10^-4. */
function convertUnits(amountUnits: bigint, rate: string, places: number): bigint {
  const parsed = parseDecimal(rate);
  const product = amountUnits * parsed.units; // scale SCALE + parsed.scale
  const keep = Math.min(places, SCALE);
  const rounded = divRound(product, 10n ** BigInt(SCALE + parsed.scale - keep));
  return rounded * 10n ** BigInt(SCALE - keep);
}

/** Rounds units of 10^-4 to `places` decimals. */
function roundUnits(units: bigint, places: number) {
  const keep = Math.min(places, SCALE);
  const step = 10n ** BigInt(SCALE - keep);
  return divRound(units, step) * step;
}

export const ledgerDecimal = { units4, format4, convertUnits, roundUnits };

// ---------------------------------------------------------------------------------------------------------------
// Dates.

function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function assertDay(day: string, what: string) {
  if (!DAY.test(day) || Number.isNaN(new Date(`${day}T00:00:00Z`).getTime()) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) {
    throw new LedgerError("invalid_date", `${what} ${day} is not a calendar day`);
  }
}

/**
 * The day a journal for an event dated `eventDate` posts on. Before the start date nothing posts. On or before the
 * lock date an automatic posting moves to the first open day and is marked late; a manual or opening journal is
 * refused instead (`allowLate: false`).
 */
export function postingDate(
  settings: Pick<BooksSettings, "startDate" | "lockDate">, eventDate: string, options: { allowLate: boolean } = { allowLate: true },
): { journalDate: string; late: boolean } | { refused: "before_start" | "locked" } {
  assertDay(eventDate, "Date");
  if (eventDate < settings.startDate) return { refused: "before_start" };
  if (settings.lockDate && eventDate <= settings.lockDate) {
    if (!options.allowLate) return { refused: "locked" };
    const firstOpen = addDays(settings.lockDate, 1);
    return { journalDate: firstOpen < settings.startDate ? settings.startDate : firstOpen, late: true };
  }
  return { journalDate: eventDate, late: false };
}

// ---------------------------------------------------------------------------------------------------------------
// Reads.

const SETTINGS_COLUMNS = `settings.workspace_id AS "workspaceId", settings.legal_entity_id AS "legalEntityId", settings.enabled,
  settings.start_date::text AS "startDate", settings.lock_date::text AS "lockDate", settings.functional_currency AS "functionalCurrency",
  settings.fiscal_year_start_month AS "fiscalYearStartMonth", settings.template_code AS "templateCode", settings.template_version AS "templateVersion",
  settings.revenue_recognition AS "revenueRecognition", settings.tax_point_on_payment AS "taxPointOnPayment", settings.vat_region AS "vatRegion",
  settings.version`;

export async function readBooksSettings(db: Db, workspaceId: string, legalEntityId: string): Promise<BooksSettings | null> {
  return (await db.query<BooksSettings>(`SELECT ${SETTINGS_COLUMNS} FROM books_settings settings WHERE settings.workspace_id = $1 AND settings.legal_entity_id = $2`,
    [workspaceId, legalEntityId])).rows[0] ?? null;
}

/** The companies with the Ledger on. */
export async function enabledBooksSettings(db: Db, workspaceId: string): Promise<BooksSettings[]> {
  return (await db.query<BooksSettings>(`SELECT ${SETTINGS_COLUMNS} FROM books_settings settings WHERE settings.workspace_id = $1 AND settings.enabled
    ORDER BY settings.legal_entity_id`, [workspaceId])).rows;
}

const JOURNAL_COLUMNS = `journal.id, journal.legal_entity_id AS "legalEntityId", journal.number, journal.journal_date::text AS "journalDate",
  journal.event_date::text AS "eventDate", journal.late, journal.kind, journal.source_type AS "sourceType", journal.source_id AS "sourceId",
  journal.source_event AS "sourceEvent", journal.source_label AS "sourceLabel", journal.source_href AS "sourceHref", journal.description,
  journal.currency, journal.functional_currency AS "functionalCurrency", journal.rate::text AS rate, journal.total::text AS total,
  journal.reverses_journal_id AS "reversesJournalId", journal.posted_by AS "postedBy", journal.posted_at::text AS "postedAt"`;

export async function readJournal(db: Db, workspaceId: string, journalId: string): Promise<PostedJournal | null> {
  return (await db.query<PostedJournal>(`SELECT ${JOURNAL_COLUMNS} FROM books_journals journal WHERE journal.workspace_id = $1 AND journal.id = $2`,
    [workspaceId, journalId])).rows[0] ?? null;
}

export async function readJournalBySource(db: Db, workspaceId: string, source: Pick<JournalSource, "type" | "id" | "event">): Promise<PostedJournal | null> {
  return (await db.query<PostedJournal>(
    `SELECT ${JOURNAL_COLUMNS} FROM books_journals journal
      WHERE journal.workspace_id = $1 AND journal.source_type = $2 AND journal.source_id = $3 AND journal.source_event = $4`,
    [workspaceId, source.type, source.id, source.event])).rows[0] ?? null;
}

export async function readJournalLines(db: Db, workspaceId: string, journalId: string): Promise<PostedLine[]> {
  return (await db.query<PostedLine>(
    `SELECT line.id, line.journal_id AS "journalId", line.position, line.account_id AS "accountId", line.debit::text AS debit, line.credit::text AS credit,
            line.doc_amount::text AS "docAmount", line.description, line.project_id AS "projectId", line.case_id AS "caseId",
            line.business_unit_id AS "businessUnitId", line.party_type AS "partyType", line.party_id AS "partyId", line.tax_code_id AS "taxCodeId",
            line.tax_base::text AS "taxBase", line.tax_region AS "taxRegion"
       FROM books_journal_lines line WHERE line.workspace_id = $1 AND line.journal_id = $2 ORDER BY line.position`,
    [workspaceId, journalId])).rows;
}

/** The account that plays `role` for the company, or null when it has none (or it is archived). */
export async function resolveRole(db: Db, workspaceId: string, legalEntityId: string, role: AccountRole) {
  return (await db.query<{ accountId: string; code: string; name: string }>(
    `SELECT account.id AS "accountId", account.code, account.name
       FROM books_account_roles mapping
       JOIN books_accounts account ON account.workspace_id = mapping.workspace_id AND account.legal_entity_id = mapping.legal_entity_id
        AND account.id = mapping.account_id AND account.archived_at IS NULL
      WHERE mapping.workspace_id = $1 AND mapping.legal_entity_id = $2 AND mapping.role = $3`,
    [workspaceId, legalEntityId, role])).rows[0] ?? null;
}

/**
 * Functional units per one unit of `currency` on `onDay`: 1 for the same currency, else the latest rate on or before
 * the day in either direction of the pair (inverted to 12 decimals). Null when there is no rate.
 */
export async function functionalRate(db: Db, workspaceId: string, currency: string, functionalCurrency: string, onDay: string): Promise<string | null> {
  if (currency === functionalCurrency) return "1";
  assertDay(onDay, "Date");
  const row = (await db.query<{ rate: string }>(
    `SELECT CASE WHEN rate.base_currency = $2 THEN rate.rate ELSE round(1 / rate.rate, 12) END::text AS rate
       FROM exchange_rates rate
      WHERE rate.workspace_id = $1 AND rate.rate > 0
        AND ((rate.base_currency = $2 AND rate.quote_currency = $3) OR (rate.base_currency = $3 AND rate.quote_currency = $2))
        AND rate.effective_at < ($4::date + 1)
      ORDER BY rate.effective_at DESC, (rate.base_currency = $2) DESC LIMIT 1`, [workspaceId, currency, functionalCurrency, onDay])).rows[0];
  return row?.rate ?? null;
}

/** An amount in the functional currency on a day, rounded to its decimals; null when there is no rate. */
export async function toFunctional(
  db: Db, workspaceId: string, input: { amount: string; currency: string; functionalCurrency: string; onDay: string },
): Promise<{ amount: string; rate: string } | null> {
  const rate = await functionalRate(db, workspaceId, input.currency, input.functionalCurrency, input.onDay);
  if (!rate) return null;
  return { amount: format4(convertUnits(units4(input.amount), rate, currencyDecimals(input.functionalCurrency))), rate };
}

/** The lines that undo posted lines: each side swapped, same accounts, dimensions and exact functional amounts. */
export function reverseLines(lines: readonly PostedLine[]): DraftLine[] {
  return lines.map((line) => {
    const debit = units4(line.debit);
    const functional = format4(debit > 0n ? debit : units4(line.credit));
    return {
      account: { accountId: line.accountId },
      side: debit > 0n ? "credit" : "debit",
      amount: line.docAmount ?? functional,
      functionalAmount: functional,
      description: line.description,
      projectId: line.projectId,
      caseId: line.caseId,
      businessUnitId: line.businessUnitId,
      party: line.partyType && line.partyId ? { type: line.partyType, id: line.partyId } : null,
      taxCodeId: line.taxCodeId,
      taxBase: null,
      functionalTaxBase: line.taxBase,
      taxRegion: line.taxRegion,
    } satisfies DraftLine;
  });
}

/** The draft that reverses a posted journal for a source event (P4, P6, P8, P10 and corrections). */
export function reversalDraft(journal: PostedJournal, lines: readonly PostedLine[], input: { eventDate: string; source: JournalSource; postedBy?: string | null; description?: string }): JournalDraft {
  return {
    legalEntityId: journal.legalEntityId,
    kind: "reversal",
    eventDate: input.eventDate,
    source: input.source,
    currency: journal.currency,
    rate: journal.rate,
    description: input.description ?? journal.description,
    lines: reverseLines(lines),
    reversesJournalId: journal.id,
    postedBy: input.postedBy ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Line arithmetic (pure).

export type ResolvedLine = Omit<DraftLine, "account"> & { accountId: string };
export type FunctionalLine = {
  accountId: string;
  debit: bigint;
  credit: bigint;
  docAmount: bigint | null;
  taxBase: bigint | null;
  source: ResolvedLine | null;
};

/**
 * Converts balanced document-currency lines to the functional currency at `rate`, rounded to the currency's
 * `decimals`; lines that round to nothing are dropped and the rounding residual goes to `roundingAccountId`.
 * Throws when the document amounts don't balance.
 */
export function functionalLines(lines: readonly ResolvedLine[], rate: string, decimals: number, roundingAccountId: () => string): FunctionalLine[] {
  if (lines.length < 2) throw new LedgerError("invalid_line", "A journal needs at least two lines");
  let docDebit = 0n, docCredit = 0n;
  const out: FunctionalLine[] = [];
  for (const line of lines) {
    if (line.side !== "debit" && line.side !== "credit") throw new LedgerError("invalid_line", "Each line is a debit or a credit");
    const amount = units4(line.amount);
    if (amount <= 0n) throw new LedgerError("invalid_amount", `Line amounts are positive (got ${line.amount})`);
    if (line.side === "debit") docDebit += amount; else docCredit += amount;
    const functional = line.functionalAmount !== undefined ? roundUnits(units4(line.functionalAmount, "Functional amount"), decimals) : convertUnits(amount, rate, decimals);
    if (functional < 0n) throw new LedgerError("invalid_amount", "Functional amounts are positive");
    const taxBase = line.functionalTaxBase != null ? units4(line.functionalTaxBase, "Tax base")
      : line.taxBase != null ? convertUnits(units4(line.taxBase, "Tax base"), rate, decimals) : null;
    if (functional === 0n) continue;
    out.push({ accountId: line.accountId, debit: line.side === "debit" ? functional : 0n, credit: line.side === "credit" ? functional : 0n,
      docAmount: amount, taxBase, source: line });
  }
  if (docDebit !== docCredit) {
    throw new LedgerError("unbalanced", `Debits ${format4(docDebit)} and credits ${format4(docCredit)} don't balance`);
  }
  const residual = out.reduce((sum, line) => sum + line.debit - line.credit, 0n);
  if (residual !== 0n) {
    // Rounding only: never more than one minor unit per line.
    const minor = 10n ** BigInt(SCALE - Math.min(decimals, SCALE));
    if ((residual < 0n ? -residual : residual) > minor * BigInt(lines.length)) {
      throw new LedgerError("unbalanced", `The functional amounts are off by ${format4(residual)}, more than rounding`);
    }
    out.push({ accountId: roundingAccountId(), debit: residual < 0n ? -residual : 0n, credit: residual > 0n ? residual : 0n, docAmount: null, taxBase: null, source: null });
  }
  if (out.length < 2) throw new LedgerError("invalid_line", "A journal needs at least two lines with an amount");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Posting.

const SAVEPOINT = "books_post_journal";

function isManual(kind: JournalKind) {
  return kind === "manual" || kind === "opening";
}

/**
 * Posts one journal. Idempotent: a source event that already has a journal returns it (`existing`), even when two
 * transactions post it at once. Gap-free: the number is allocated from the company's JOURNAL sequence inside a
 * savepoint, so a duplicate rolls the counter back with the insert.
 *
 * Automatic postings (kind auto or reversal) that can't post yet return an `issue` (the sweep records it and
 * retries); manual and opening journals throw a LedgerError instead, and are refused on or before the lock date.
 * Events before the company's start date are `skipped`.
 */
export async function postJournal(db: Db, workspaceId: string, draft: JournalDraft): Promise<PostOutcome> {
  const kind: JournalKind = draft.kind ?? (draft.reversesJournalId ? "reversal" : "auto");
  const manual = isManual(kind);
  const source = draft.source;
  if (!source || !/^[a-z][a-z0-9_]{0,39}$/.test(source.type) || !/^[a-z][a-z0-9_]{0,39}$/.test(source.event) || !source.id || source.id.length > 160) {
    throw new LedgerError("invalid_source", "A journal names its source type, id and event");
  }
  if (source.href && !source.href.startsWith("/")) throw new LedgerError("invalid_source", "A source link is a path inside the workspace");
  if (!/^[A-Z]{3}$/.test(draft.currency)) throw new LedgerError("invalid_line", `${draft.currency} is not a currency code`);
  if ((kind === "reversal") !== Boolean(draft.reversesJournalId)) throw new LedgerError("invalid_reversal", "A reversal names the journal it reverses");
  assertDay(draft.eventDate, "Date");

  const existing = await readJournalBySource(db, workspaceId, source);
  if (existing) return { status: "existing", journal: existing };

  const fail = (code: PostingIssueCode, detail: string): PostOutcome => {
    if (manual) throw new LedgerError(code, detail);
    return { status: "issue", code, detail };
  };

  const settings = await readBooksSettings(db, workspaceId, draft.legalEntityId);
  if (!settings?.enabled) return fail("entity_not_enabled", "The Ledger is not on for this company");

  const date = postingDate(settings, draft.eventDate, { allowLate: !manual });
  if ("refused" in date) {
    if (manual) {
      throw date.refused === "locked"
        ? new LedgerError("locked", `The books are locked up to ${settings.lockDate}`)
        : new LedgerError("before_start", `The Ledger starts on ${settings.startDate}`);
    }
    return { status: "skipped", reason: "before_start" };
  }

  if (draft.reversesJournalId) {
    const reversed = await readJournal(db, workspaceId, draft.reversesJournalId);
    if (!reversed || reversed.legalEntityId !== draft.legalEntityId) throw new LedgerError("invalid_reversal", "The journal to reverse is not this company's");
  }

  // Accounts: roles resolved, ids checked against the company.
  const roles = [...new Set(draft.lines.flatMap((line) => ("role" in line.account ? [line.account.role] : [])))];
  for (const role of roles) if (!(ACCOUNT_ROLES as readonly string[]).includes(role)) throw new LedgerError("invalid_line", `Unknown account role ${role}`);
  const ids = [...new Set(draft.lines.flatMap((line) => ("accountId" in line.account ? [line.account.accountId] : [])))];
  type AccountRow = { id: string; role: string | null; code: string; currency: string | null; allowManual: boolean; archived: boolean };
  const accounts = (await db.query<AccountRow>(
    `SELECT account.id, mapping.role, account.code, account.currency, account.allow_manual AS "allowManual", account.archived_at IS NOT NULL AS archived
       FROM books_accounts account
       LEFT JOIN books_account_roles mapping ON mapping.workspace_id = account.workspace_id AND mapping.legal_entity_id = account.legal_entity_id
        AND mapping.account_id = account.id AND mapping.role = ANY($4::text[])
      WHERE account.workspace_id = $1 AND account.legal_entity_id = $2
        AND (account.id = ANY($3::uuid[]) OR mapping.role IS NOT NULL)`,
    [workspaceId, draft.legalEntityId, ids, [...roles, "rounding"]])).rows;
  const byRole = new Map(accounts.filter((row) => row.role).map((row) => [row.role!, row]));
  const byId = new Map(accounts.map((row) => [row.id, row]));
  const missingRoles = roles.filter((role) => !byRole.get(role) || byRole.get(role)!.archived);
  if (missingRoles.length) return fail("missing_account", `No account for ${missingRoles.join(", ")}`);
  const unknownIds = ids.filter((id) => !byId.get(id) || byId.get(id)!.archived);
  if (unknownIds.length) return fail("missing_account", "An account is not one of this company's open accounts");

  const resolved: ResolvedLine[] = [];
  for (const line of draft.lines) {
    const account = "role" in line.account ? byRole.get(line.account.role)! : byId.get(line.account.accountId)!;
    if (kind === "manual" && !account.allowManual) throw new LedgerError("manual_not_allowed", `Account ${account.code} is posted only by its own records`);
    if (account.currency && account.currency !== draft.currency) {
      return fail("currency_mismatch", `Account ${account.code} keeps ${account.currency}, the journal is in ${draft.currency}`);
    }
    if (line.party && (!(PARTY_TYPES as readonly string[]).includes(line.party.type) || !line.party.id)) throw new LedgerError("invalid_line", "A party has a type and an id");
    const { account: _account, ...rest } = line;
    resolved.push({ ...rest, accountId: account.id });
  }

  const taxCodes = [...new Set(resolved.flatMap((line) => (line.taxCodeId ? [line.taxCodeId] : [])))];
  if (taxCodes.length) {
    const found = (await db.query<{ id: string }>(`SELECT id FROM books_tax_codes WHERE workspace_id = $1 AND legal_entity_id = $2 AND id = ANY($3::uuid[])`,
      [workspaceId, draft.legalEntityId, taxCodes])).rows.length;
    if (found !== taxCodes.length) return fail("unknown_tax", "A tax code is not one of this company's");
  }

  // Currency: the given rate, else the day's rate.
  const functionalCurrency = settings.functionalCurrency;
  let rate = draft.currency === functionalCurrency ? "1" : draft.rate ?? null;
  if (rate !== null && parseDecimal(rate).units <= 0n) throw new LedgerError("invalid_amount", "A rate is positive");
  if (rate === null) rate = await functionalRate(db, workspaceId, draft.currency, functionalCurrency, draft.eventDate);
  if (rate === null) return fail("missing_rate", `No ${draft.currency} to ${functionalCurrency} rate on or before ${draft.eventDate}`);

  let roundingNeeded = false;
  const rounding = byRole.get("rounding");
  const lines = functionalLines(resolved, rate, currencyDecimals(functionalCurrency), () => {
    roundingNeeded = true;
    return rounding && !rounding.archived ? rounding.id : "";
  });
  if (roundingNeeded && (!rounding || rounding.archived)) return fail("missing_account", "No account for rounding");
  const total = lines.reduce((sum, line) => sum + line.debit, 0n);

  // Numbering: never reset, so back-dated journals keep the sequence gap-free.
  await db.query(
    `INSERT INTO document_sequences (workspace_id, legal_entity_id, document_type, prefix, padding, reset_policy, next_number)
     SELECT $1, entity.id, 'JOURNAL', entity.code || '-JV-', 6, 'never', 1 FROM legal_entities entity WHERE entity.workspace_id = $1 AND entity.id = $2
     ON CONFLICT (legal_entity_id, document_type) DO NOTHING`, [workspaceId, draft.legalEntityId]);

  await db.query(`SAVEPOINT ${SAVEPOINT}`);
  let journalId: string;
  try {
    const number = (await db.query<{ number: string }>(
      `SELECT allocate_document_number($1, $2, 'JOURNAL',
         ($3::date + time '12:00') AT TIME ZONE (SELECT entity.timezone FROM legal_entities entity WHERE entity.workspace_id = $1 AND entity.id = $2)) AS number`,
      [workspaceId, draft.legalEntityId, date.journalDate])).rows[0].number;
    journalId = (await db.query<{ id: string }>(
      `INSERT INTO books_journals (workspace_id, legal_entity_id, number, journal_date, event_date, late, kind, source_type, source_id, source_event,
                                   source_label, source_href, description, currency, functional_currency, rate, total, reverses_journal_id, posted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
      [workspaceId, draft.legalEntityId, number, date.journalDate, draft.eventDate, date.late, kind, source.type, source.id, source.event,
        (source.label ?? "").slice(0, 240), source.href ?? "", (draft.description ?? "").slice(0, 500), draft.currency, functionalCurrency, rate, format4(total),
        draft.reversesJournalId ?? null, draft.postedBy ?? null])).rows[0].id;
    const values: unknown[] = [];
    const rows = lines.map((line, position) => {
      const s = line.source;
      values.push(workspaceId, draft.legalEntityId, journalId, position, line.accountId, format4(line.debit), format4(line.credit),
        line.docAmount === null ? null : format4(line.docAmount), (s?.description ?? (s ? "" : "Rounding")).slice(0, 500), s?.projectId ?? null, s?.caseId ?? null,
        s?.businessUnitId ?? null, s?.party?.type ?? null, s?.party?.id ?? null, s?.taxCodeId ?? null, line.taxBase === null ? null : format4(line.taxBase),
        s?.taxRegion ?? null);
      const base = position * 17;
      return `(${Array.from({ length: 17 }, (_, index) => `$${base + index + 1}`).join(", ")})`;
    });
    await db.query(
      `INSERT INTO books_journal_lines (workspace_id, legal_entity_id, journal_id, position, account_id, debit, credit, doc_amount, description,
                                        project_id, case_id, business_unit_id, party_type, party_id, tax_code_id, tax_base, tax_region)
       VALUES ${rows.join(", ")}`, values);
    await db.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
  } catch (error) {
    await db.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
    await db.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    if ((error as { code?: string; constraint?: string }).code === "23505" && (error as { constraint?: string }).constraint === "books_journals_source_key") {
      const winner = await readJournalBySource(db, workspaceId, source);
      if (winner) return { status: "existing", journal: winner };
    }
    throw error;
  }
  return { status: "posted", journal: (await readJournal(db, workspaceId, journalId))! };
}
