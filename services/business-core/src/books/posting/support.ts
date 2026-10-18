import { Dec } from "../../catalog-core/decimal";
import { currencyDecimals } from "../../common/currency";
import type { AccountRole, BooksPartyType, BooksSourceType, PaymentMethod, PostingIssueCode } from "../books-contract";
import { PAYMENT_METHODS } from "../books-contract";
import {
  type AccountRef, type BooksSettings, type Db, type DraftLine, type JournalDraft, type PendingEvent, type PostingAdapter, type PostingIssueResult,
  readBooksSettings, readJournalBySource, readJournalLines, reversalDraft,
} from "../ledger/ledger";

/**
 * Shared pieces of the posting rules (plan §6.21b): the pending-event query every adapter runs, the SQL that finds
 * a record's company and day, tax codes, payment accounts, and a draft builder that takes signed amounts.
 */

export type { Db };

export const issue = (code: PostingIssueCode, detail: string): PostingIssueResult => ({ issue: code, detail });
export const isIssue = (value: unknown): value is PostingIssueResult => Boolean(value && typeof value === "object" && "issue" in value);

/** The workspace's time zone (its local day is the day an event happened). */
export const ZONE = `(SELECT coalesce(nullif(zone_workspace.default_timezone, ''), 'UTC') FROM workspaces zone_workspace WHERE zone_workspace.id = $1)`;

/** The workspace-local day of a timestamp expression. */
export const localDay = (expression: string) => `((${expression}) AT TIME ZONE ${ZONE})::date`;

/** A text column that holds a uuid, as a uuid (null when it isn't one). */
export const textUuid = (expression: string) =>
  `(CASE WHEN (${expression}) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (${expression})::uuid END)`;

/**
 * The company a project was contracted by: the company on its latest tax invoice, else the deal's contract company
 * (the same rule as accounting sync's PROJECT_COMPANY).
 */
export const projectCompany = (projectExpression: string) => `coalesce(
  (SELECT company_invoice.legal_entity_id FROM client_invoices company_invoice
    WHERE company_invoice.workspace_id = $1 AND company_invoice.project_id = (${projectExpression}) ORDER BY company_invoice.issued_at DESC LIMIT 1),
  (SELECT ${textUuid("company_case.content->'financeContext'->>'legalEntityId'")} FROM delivery_projects company_project
     JOIN commercial_cases company_case ON company_case.workspace_id = company_project.workspace_id AND company_case.case_id = company_project.case_id
    WHERE company_project.workspace_id = $1 AND company_project.id = (${projectExpression})))`;

/** The only company with the Ledger on (null when there are several or none). */
export const SINGLE_ENABLED = `(SELECT (array_agg(single.legal_entity_id))[1] FROM books_settings single WHERE single.workspace_id = $1 AND single.enabled HAVING count(*) = 1)`;

/** A journal exists for a source event. */
export const journalExists = (type: string, id: string, event: string) => `EXISTS (SELECT 1 FROM books_journals posted
  WHERE posted.workspace_id = $1 AND posted.source_type = '${type}' AND posted.source_id = ${id} AND posted.source_event = '${event}')`;

/** The company's Ledger start date (null when it isn't on). */
export const startOf = (entityExpression: string) => `(SELECT started.start_date FROM books_settings started
  WHERE started.workspace_id = $1 AND started.legal_entity_id = (${entityExpression}) AND started.enabled)`;

/** Open issues are tried again after this long (or at once, when someone asks to retry). */
export const ISSUE_RETRY_INTERVAL = "5 minutes";

/**
 * One adapter's pending events: rows of `select` (source_id, source_event, entity_id, event_date, at, label, href)
 * for enabled companies from their start date (or with no company yet, from the earliest start date, so they
 * surface as `no_entity`), without a journal and not tried in the last few minutes, oldest first.
 * `select` may use $1 (workspace) and `enabled` (the companies with the Ledger on); its own values start at $4.
 */
export async function pendingRows<E extends PendingEvent = PendingEvent>(
  db: Db, workspaceId: string, sourceType: BooksSourceType, limit: number, select: string, values: unknown[] = [],
): Promise<E[]> {
  if (limit <= 0) return [];
  const rows = (await db.query<{ sourceId: string; sourceEvent: string; entityId: string | null; eventDate: string; label: string | null; href: string | null }>(
    `WITH enabled AS (SELECT legal_entity_id, start_date FROM books_settings WHERE workspace_id = $1 AND enabled),
          events AS (${select})
     SELECT event.source_id AS "sourceId", event.source_event AS "sourceEvent", event.entity_id AS "entityId", event.event_date::text AS "eventDate",
            event.label, event.href
       FROM events event
       LEFT JOIN enabled company ON company.legal_entity_id = event.entity_id
      WHERE ((company.legal_entity_id IS NOT NULL AND event.event_date >= company.start_date)
             OR (event.entity_id IS NULL AND event.event_date >= (SELECT min(start_date) FROM enabled)))
        AND NOT EXISTS (SELECT 1 FROM books_journals posted WHERE posted.workspace_id = $1 AND posted.source_type = $2
                          AND posted.source_id = event.source_id AND posted.source_event = event.source_event)
        AND NOT EXISTS (SELECT 1 FROM books_posting_issues waiting WHERE waiting.workspace_id = $1 AND waiting.source_type = $2
                          AND waiting.source_id = event.source_id AND waiting.source_event = event.source_event AND waiting.resolved_at IS NULL
                          AND waiting.last_seen_at > now() - interval '${ISSUE_RETRY_INTERVAL}')
      ORDER BY event.at, event.source_id, event.source_event
      LIMIT $3`, [workspaceId, sourceType, limit, ...values])).rows;
  return rows.map((row) => ({
    sourceType, sourceId: row.sourceId, sourceEvent: row.sourceEvent, legalEntityId: row.entityId, eventDate: row.eventDate,
    label: row.label ?? undefined, href: row.href ?? undefined,
  }) as E);
}

/** An adapter for one rule (or a pair of rules on one source). */
export type RuleAdapter<E extends PendingEvent = PendingEvent> = PostingAdapter<E> & { readonly rule: string };

// ---------------------------------------------------------------------------------------------------------------
// Drafts.

type LineDetail = Omit<DraftLine, "account" | "side" | "amount">;

/**
 * Builds a journal's lines from signed amounts (positive debits, negative credits; zero is left out). Amounts are
 * rounded to the document currency's minor units.
 */
export class Lines {
  readonly lines: DraftLine[] = [];
  constructor(readonly currency: string) {}

  get places() { return currencyDecimals(this.currency); }

  /** Debit a positive amount (a negative one credits). */
  debit(account: AccountRef, amount: Dec | string, detail: LineDetail = {}) {
    const value = Dec.of(amount).round(this.places);
    if (value.isZero()) return this;
    this.lines.push({ ...detail, account, side: value.isNegative() ? "credit" : "debit", amount: value.abs().toFixed(4) });
    return this;
  }

  /** Credit a positive amount (a negative one debits). */
  credit(account: AccountRef, amount: Dec | string, detail: LineDetail = {}) {
    return this.debit(account, Dec.of(amount).neg(), detail);
  }

  /** Σdebit − Σcredit so far. */
  balance() {
    return this.lines.reduce((sum, line) => (line.side === "debit" ? sum.add(line.amount) : sum.sub(line.amount)), Dec.ZERO);
  }
}

export const role = (name: AccountRole): AccountRef => ({ role: name });
export const accountId = (id: string): AccountRef => ({ accountId: id });
export const party = (type: BooksPartyType, id: string | null | undefined) => (id ? { type, id } : null);

/** The same journal with every line on the other side (a rebuilt original, undone). */
export function inverted(draft: JournalDraft, patch: Pick<JournalDraft, "eventDate" | "source"> & Partial<JournalDraft>): JournalDraft {
  return { ...draft, ...patch, kind: "auto", reversesJournalId: null, lines: draft.lines.map((line) => ({ ...line, side: line.side === "debit" ? "credit" : "debit" })) };
}

/**
 * The draft that undoes an earlier event: the reversal of its journal when it posted, else (the original fell
 * before the Ledger's start date and was never posted) the original rebuilt from its record and turned around.
 */
export async function undo(
  db: Db, workspaceId: string, original: { type: BooksSourceType; id: string; event: string },
  input: { eventDate: string; source: JournalDraft["source"] }, rebuild: () => Promise<JournalDraft | PostingIssueResult>,
): Promise<JournalDraft | PostingIssueResult> {
  const journal = await readJournalBySource(db, workspaceId, original);
  if (journal) return reversalDraft(journal, await readJournalLines(db, workspaceId, journal.id), input);
  const rebuilt = await rebuild();
  if (isIssue(rebuilt)) return rebuilt;
  return inverted(rebuilt, input);
}

// ---------------------------------------------------------------------------------------------------------------
// Settings, tax codes and payment accounts.

export async function settingsFor(db: Db, workspaceId: string, legalEntityId: string | null): Promise<BooksSettings | PostingIssueResult> {
  if (!legalEntityId) return issue("no_entity", "Which company this belongs to isn't known: record the company on the project or the order.");
  const settings = await readBooksSettings(db, workspaceId, legalEntityId);
  if (!settings?.enabled) return issue("entity_not_enabled", "The Ledger is not on for this company.");
  return settings;
}

export type TaxCode = { id: string; code: string; rate: string; treatment: string; recoverable: boolean };

/**
 * The company's tax code for a document line on a day: the named code, else the standard code at the line's rate
 * (the zero-rated code, or none, at 0%). An unknown code, or a taxed rate without a code, is an issue.
 */
export async function taxCodeFor(
  db: Db, workspaceId: string, legalEntityId: string, direction: "sales" | "purchases", line: { code?: string | null; rate: string }, onDay: string,
): Promise<TaxCode | null | PostingIssueResult> {
  const rate = Dec.of(line.rate);
  const query = (where: string, values: unknown[]) => db.query<TaxCode>(
    `SELECT id, code, rate::text AS rate, treatment, recoverable FROM books_tax_codes
      WHERE workspace_id = $1 AND legal_entity_id = $2 AND direction = $3 AND archived_at IS NULL AND effective_from <= $4::date
        AND (effective_to IS NULL OR effective_to >= $4::date) AND ${where}
      ORDER BY effective_from DESC, code LIMIT 1`, [workspaceId, legalEntityId, direction, onDay, ...values]);
  if (line.code) {
    const found = (await query("code = $5", [line.code])).rows[0];
    return found ?? issue("unknown_tax", `Tax code ${line.code} isn't one of this company's ${direction} codes on ${onDay}.`);
  }
  if (rate.isZero()) return (await query("treatment = 'zero' AND rate = 0", [])).rows[0] ?? null;
  const found = (await query("treatment = 'standard' AND rate = $5::numeric", [rate.toString()])).rows[0];
  return found ?? issue("unknown_tax", `No ${direction} tax code at ${rate.toString()}% for this company: add one in Settings › Ledger.`);
}

/** The account money comes in to or goes out of by method. */
export async function paymentAccount(db: Db, workspaceId: string, legalEntityId: string, direction: "in" | "out", method: string): Promise<string | PostingIssueResult> {
  const known = (PAYMENT_METHODS as readonly string[]).includes(method) ? (method as PaymentMethod) : "other";
  const row = (await db.query<{ accountId: string }>(
    `SELECT payment.account_id AS "accountId" FROM books_payment_accounts payment
       JOIN books_accounts account ON account.workspace_id = payment.workspace_id AND account.legal_entity_id = payment.legal_entity_id
        AND account.id = payment.account_id AND account.archived_at IS NULL
      WHERE payment.workspace_id = $1 AND payment.legal_entity_id = $2 AND payment.direction = $3 AND payment.method = $4`,
    [workspaceId, legalEntityId, direction, known])).rows[0];
  return row?.accountId ?? issue("missing_account", `No account for money ${direction === "in" ? "received" : "paid"} by ${known}: choose one in Settings › Ledger.`);
}

/** The workspace's currency (stock and labour are valued in it). */
export async function workspaceCurrency(db: Db, workspaceId: string) {
  return (await db.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].currency.trim();
}

/** The workspace's local day of an instant (today when the instant isn't known). */
export async function dayOf(db: Db, workspaceId: string, at: Date | string | null) {
  return (await db.query<{ day: string }>(`SELECT ${localDay("coalesce($2::timestamptz, now())")}::text AS day`, [workspaceId, at])).rows[0].day;
}

/** When an audited action happened to a record (its first audit event), in the workspace's day; null when unknown. */
export const auditedDay = (entityType: string, action: string, entityExpression: string) => `(SELECT ${localDay("min(happened.occurred_at)")}
  FROM audit_events happened WHERE happened.workspace_id = $1 AND happened.entity_type = '${entityType}' AND happened.action = '${action}'
   AND happened.entity_id = (${entityExpression}))`;

export const money = (value: Dec | string, currency: string) => Dec.of(value).toFixed(currencyDecimals(currency));
